import type { useConfigRequirementsStore } from "../../stores/configRequirements.store";
import type { useConfigStore } from "../../stores/config.store";
import {
  buildConfigBatchChangesFromDraft,
  createDefaultGlobalConfigDraft,
  extractConfigRequirementsFromReadResult,
  extractGlobalConfigFromReadResult,
  type ConfigWriteChange,
} from "../serverInterop";
import type { ConfigReadResponse } from "@codenexus/generated/codex-app-server/v2/ConfigReadResponse";
import type { ConfigRequirementsReadResponse } from "@codenexus/generated/codex-app-server/v2/ConfigRequirementsReadResponse";

type ConfigStore = ReturnType<typeof useConfigStore>;
type ConfigRequirementsStore = ReturnType<typeof useConfigRequirementsStore>;
type RuntimeEventLevel = "info" | "warn" | "error";
type ToastKind = "info" | "success" | "warn" | "error";

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;
type PushEvent = (method: string, paramsText: string, opts?: { threadId?: string; level?: RuntimeEventLevel }) => void;
type ShowToast = (options: { kind?: ToastKind; title?: string; message: string }) => void;

export type SaveGlobalConfigOptions = {
  source?: "manual" | "auto";
  silentSuccessToast?: boolean;
};

export type GlobalConfigManagementRuntimeDeps = {
  appTimelineId: string;
  configStore: ConfigStore;
  configRequirementsStore: ConfigRequirementsStore;
  getWorkspacePath: () => string;
  getServerIdForWorkspace: (workspacePath: string) => string;
  requestConfigRead: () => Promise<ConfigReadResponse>;
  requestConfigRequirementsRead: () => Promise<ConfigRequirementsReadResponse>;
  requestConfigBatchWrite: (changes: ConfigWriteChange[], filePath?: string | null) => Promise<void>;
  pushEvent: PushEvent;
  translate: TranslateFn;
  showToast: ShowToast;
};

export type GlobalConfigManagementRuntime = {
  refreshGlobalConfig: () => Promise<void>;
  ensureGlobalConfigLoadedOnce: () => Promise<void>;
  saveGlobalConfig: (options?: SaveGlobalConfigOptions) => Promise<void>;
  resetGlobalConfig: () => void;
};

function normalizeWorkspacePath(value: unknown): string {
  return String(value ?? "").trim();
}

function readErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (message) return String(message);
  }
  return String(error);
}

export function createGlobalConfigManagementRuntime(
  deps: GlobalConfigManagementRuntimeDeps
): GlobalConfigManagementRuntime {
  const {
    appTimelineId,
    configStore,
    configRequirementsStore,
    getWorkspacePath,
    getServerIdForWorkspace,
    requestConfigRead,
    requestConfigRequirementsRead,
    requestConfigBatchWrite,
    pushEvent,
    translate,
    showToast,
  } = deps;

  let globalConfigAutoLoadAttempted = false;

  const refreshGlobalConfig = async () => {
    const workspace = normalizeWorkspacePath(getWorkspacePath());
    if (!getServerIdForWorkspace(workspace)) {
      configStore.resetState(translate("runtime.noService"));
      configRequirementsStore.resetState(translate("runtime.noService"));
      return;
    }
    configStore.setLoadState("loading", translate("runtime.readingConfig"));
    configRequirementsStore.setLoadState("loading", translate("runtime.readingRequirements"));

    const [configResult, requirementsResult] = await Promise.allSettled([
      requestConfigRead(),
      requestConfigRequirementsRead(),
    ]);

    if (configResult.status === "fulfilled") {
      const draft = extractGlobalConfigFromReadResult(configResult.value);
      configStore.applySnapshot(draft);
      configStore.setLoadState("ready", translate("runtime.configReadSynced"));
    } else {
      const msg = readErrorMessage(configResult.reason);
      configStore.setLoadState("error", translate("runtime.readFailedWithMessage", { message: msg }));
    }

    if (requirementsResult.status === "fulfilled") {
      const requirements = extractConfigRequirementsFromReadResult(requirementsResult.value);
      configRequirementsStore.setRequirements(requirements);
      configRequirementsStore.setLoadState(
        "ready",
        requirements ? translate("runtime.requirementsSynced") : translate("runtime.noRequirementsConfigured")
      );
      return;
    }

    const requirementsMsg = readErrorMessage(requirementsResult.reason);
    configRequirementsStore.setRequirements(null);
    configRequirementsStore.setLoadState(
      "error",
      translate("runtime.requirementsReadFailed", { message: requirementsMsg })
    );
  };

  const ensureGlobalConfigLoadedOnce = async () => {
    const workspace = normalizeWorkspacePath(getWorkspacePath());
    if (globalConfigAutoLoadAttempted) return;
    if (!getServerIdForWorkspace(workspace)) return;
    globalConfigAutoLoadAttempted = true;
    await refreshGlobalConfig();
  };

  const saveGlobalConfig = async (options?: SaveGlobalConfigOptions) => {
    const source = options?.source ?? "manual";
    const silentSuccessToast =
      typeof options?.silentSuccessToast === "boolean" ? options.silentSuccessToast : source === "auto";
    const workspace = normalizeWorkspacePath(getWorkspacePath());
    if (!getServerIdForWorkspace(workspace) || configStore.saving) return;
    const baseline = configStore.snapshot ?? createDefaultGlobalConfigDraft();
    const draft = configStore.draft ?? createDefaultGlobalConfigDraft();
    const changes = buildConfigBatchChangesFromDraft(draft, baseline);
    if (changes.length === 0) {
      configStore.setLoadState("ready", translate("runtime.configReadSynced"));
      return;
    }
    configStore.setSaving(true);
    configStore.setLoadState("ready", translate("runtime.saving"));
    try {
      await requestConfigBatchWrite(changes);
      pushEvent("config", `saved ${changes.length} keys`, { threadId: appTimelineId });
      await refreshGlobalConfig();
      if (!silentSuccessToast) {
        showToast({
          kind: "success",
          title:
            source === "auto" ? translate("runtime.globalConfigAutoSaved") : translate("runtime.globalConfigSaved"),
          message: translate("runtime.configItemsWritten", { count: changes.length }),
        });
      }
    } catch (error: unknown) {
      const msg = readErrorMessage(error);
      configStore.setLoadState("error", translate("runtime.saveFailedWithMessage", { message: msg }));
      pushEvent("config:error", msg, { threadId: appTimelineId, level: "error" });
      showToast({
        kind: "error",
        title:
          source === "auto"
            ? translate("runtime.globalConfigAutoSaveFailed")
            : translate("runtime.globalConfigSaveFailed"),
        message: msg,
      });
    } finally {
      configStore.setSaving(false);
      if (configStore.loadState !== "error") {
        configStore.setLoadState(
          "ready",
          configStore.isDirty ? translate("runtime.unsavedChanges") : translate("runtime.configReadSynced")
        );
      }
    }
  };

  const resetGlobalConfig = () => {
    configStore.resetToSnapshot();
    configStore.setLoadState(
      "ready",
      configStore.isDirty ? translate("runtime.unsavedChanges") : translate("runtime.configReadSynced")
    );
  };

  return {
    refreshGlobalConfig,
    ensureGlobalConfigLoadedOnce,
    saveGlobalConfig,
    resetGlobalConfig,
  };
}
