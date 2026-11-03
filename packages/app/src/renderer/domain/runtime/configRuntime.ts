import { codexDesktop } from "../../api/codexDesktopClient";
import type { ConfigWriteChange } from "../serverInterop";
import type { ConfigReadParams } from "@codenexus/generated/codex-app-server/v2/ConfigReadParams";
import type { ConfigReadResponse } from "@codenexus/generated/codex-app-server/v2/ConfigReadResponse";
import type { ConfigRequirementsReadResponse } from "@codenexus/generated/codex-app-server/v2/ConfigRequirementsReadResponse";
import type { JsonValue } from "@codenexus/generated/codex-app-server/serde_json/JsonValue";

type ConfigRuntimeDeps = {
  requireActiveWorkspaceServerId: () => string;
  getWorkspacePath: () => string;
};

export type ConfigRuntime = {
  requestConfigRead: () => Promise<ConfigReadResponse>;
  requestConfigRequirementsRead: () => Promise<ConfigRequirementsReadResponse>;
  requestConfigBatchWrite: (changes: ConfigWriteChange[], filePath?: string | null) => Promise<void>;
};

function normalizeConfigWriteChanges(changes: ConfigWriteChange[]) {
  return changes
    .map((change) => ({
      keyPath: String(change.keyPath ?? "").trim(),
      value: change.value === undefined ? null : change.value,
    }))
    .filter((change) => Boolean(change.keyPath));
}

export function createConfigRuntime(deps: ConfigRuntimeDeps): ConfigRuntime {
  const requestConfigRead = async (): Promise<ConfigReadResponse> => {
    const serverId = deps.requireActiveWorkspaceServerId();
    const cwd = String(deps.getWorkspacePath() ?? "").trim();
    const params: ConfigReadParams = { includeLayers: true, ...(cwd ? { cwd } : {}) };
    const res = await codexDesktop.codexServer.rpc({
      serverId,
      method: "config/read",
      params,
    });
    return res.result;
  };

  const requestConfigRequirementsRead = async (): Promise<ConfigRequirementsReadResponse> => {
    const serverId = deps.requireActiveWorkspaceServerId();
    const res = await codexDesktop.codexServer.rpc({
      serverId,
      method: "configRequirements/read",
    });
    return res.result;
  };

  const requestConfigBatchWrite = async (changes: ConfigWriteChange[], filePath?: string | null): Promise<void> => {
    const serverId = deps.requireActiveWorkspaceServerId();
    const normalized = normalizeConfigWriteChanges(changes);
    const targetFilePath = String(filePath ?? "").trim() || null;
    if (normalized.length === 0) return;

    await codexDesktop.codexServer.rpc({
      serverId,
      method: "config/batchWrite",
      params: {
        edits: normalized.map((change) => ({
          keyPath: change.keyPath,
          value: change.value as JsonValue,
          mergeStrategy: "replace" as const,
        })),
        filePath: targetFilePath,
        reloadUserConfig: true,
      },
    });
  };

  return {
    requestConfigRead,
    requestConfigRequirementsRead,
    requestConfigBatchWrite,
  };
}
