import { codexDesktop } from "../../api/codexDesktopClient";
import { fallbackThreadTitle } from "../../features/history/threadTitle";
import { appendDebugLog } from "../../shared/debugLog";
import type { useMessageQueueStore } from "../../stores/messageQueue.store";
import type { useRuntimeStore } from "../../stores/runtime.store";
import type { useThreadStore } from "../../stores/thread.store";
import type { useTimelineStore } from "../../stores/timeline.store";
import { normalizeModelName } from "../serverInterop";
import type { LocalThreadItem, ThreadHistoryItem } from "../types";
import type { ThreadResumeParams } from "@codenexus/generated/codex-app-server/v2/ThreadResumeParams";
import type { ThreadStartParams } from "@codenexus/generated/codex-app-server/v2/ThreadStartParams";
import {
  buildThreadStartConfigOverridesForModel,
  hasThreadStartConfigOverridesForModel,
  type ThreadStartConfigOverrides,
} from "@codenexus/shared/modelToolFeatureOverrides";

type MessageQueueStore = ReturnType<typeof useMessageQueueStore>;
type RuntimeStore = ReturnType<typeof useRuntimeStore>;
type ThreadStore = ReturnType<typeof useThreadStore>;
type TimelineStore = ReturnType<typeof useTimelineStore>;

type RuntimeEventLevel = "info" | "warn" | "error";
type TranslateFn = (key: string, params?: Record<string, unknown>) => string;
type PushEvent = (method: string, paramsText: string, opts?: { threadId?: string; level?: RuntimeEventLevel }) => void;

type ThreadScopedState = {
  delete: (threadId: string) => unknown;
};

type ThreadStartBuildResult = {
  params: ThreadStartParams;
  configOverrides: ThreadStartConfigOverrides | null;
};

type EnsureThreadModelToolCompatibilityResult = { ok: true; threadId: string } | { ok: false; error: string };

export type ThreadModelCompatibilityRuntimeDeps = {
  runtimeStore: RuntimeStore;
  threadStore: ThreadStore;
  timelineStore: TimelineStore;
  messageQueueStore: MessageQueueStore;
  resumedThreadIds: Set<string>;
  resumePromisesByThread: Map<string, Promise<boolean>>;
  threadScopedCaches: ThreadScopedState[];
  normalizeWorkspacePath: (value: string) => string;
  buildThreadStartParamsForModel: (args: {
    model: string;
    workspace: string;
    sandboxMode: string;
  }) => ThreadStartBuildResult;
  findThreadListItem: (threadId: string) => ThreadHistoryItem | LocalThreadItem | undefined;
  setThreadWorkspace: (threadId: string, workspacePath: string | undefined) => void;
  clearThreadWorkspace: (threadId: string) => void;
  pushEvent: PushEvent;
  translate: TranslateFn;
};

export type ThreadModelCompatibilityRuntime = {
  rememberThreadStartConfigOverrides: (
    threadId: string,
    overrides: ThreadStartConfigOverrides | null | undefined
  ) => void;
  clearThreadStartConfigOverrides: (threadId: string) => void;
  ensureThreadModelToolCompatibility: (args: {
    threadId: string;
    threadWorkspace: string;
    threadServerId: string;
    model: string;
  }) => Promise<EnsureThreadModelToolCompatibilityResult>;
};

function perfNow() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
  return Date.now();
}

function elapsedMs(startedAt: number) {
  return Number((perfNow() - startedAt).toFixed(1));
}

function readErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (message) return String(message);
  }
  return String(error);
}

export function createThreadModelCompatibilityRuntime(
  deps: ThreadModelCompatibilityRuntimeDeps
): ThreadModelCompatibilityRuntime {
  const {
    runtimeStore,
    threadStore,
    timelineStore,
    messageQueueStore,
    resumedThreadIds,
    resumePromisesByThread,
    threadScopedCaches,
    normalizeWorkspacePath,
    buildThreadStartParamsForModel,
    findThreadListItem,
    setThreadWorkspace,
    clearThreadWorkspace,
    pushEvent,
    translate,
  } = deps;

  const threadStartConfigOverridesByThreadId = new Map<string, ThreadStartConfigOverrides>();

  const rememberThreadStartConfigOverrides = (
    threadIdValue: string,
    overrides: ThreadStartConfigOverrides | null | undefined
  ) => {
    const threadId = String(threadIdValue ?? "").trim();
    if (!threadId) return;
    if (overrides) threadStartConfigOverridesByThreadId.set(threadId, { ...overrides });
    else threadStartConfigOverridesByThreadId.delete(threadId);
  };

  const clearThreadStartConfigOverrides = (threadIdValue: string) => {
    const threadId = String(threadIdValue ?? "").trim();
    if (!threadId) return;
    threadStartConfigOverridesByThreadId.delete(threadId);
  };

  const hasThreadModelToolConfigForModel = (threadIdValue: string, modelValue: string): boolean => {
    const threadId = String(threadIdValue ?? "").trim();
    if (!threadId) return false;
    return hasThreadStartConfigOverridesForModel(threadStartConfigOverridesByThreadId.get(threadId), modelValue);
  };

  const hasStartedConversationActivity = (threadIdValue: string): boolean => {
    const threadId = String(threadIdValue ?? "").trim();
    if (!threadId) return false;
    return timelineStore.eventsForThread(threadId).some((event) => {
      const method = String(event.method ?? "").trim();
      return (
        event.localKind === "user" ||
        method === "user" ||
        method.startsWith("turn/") ||
        method.startsWith("item/") ||
        method.startsWith("local/")
      );
    });
  };

  const canRecreateEmptyUnpersistedThreadForModelConfig = (threadIdValue: string): boolean => {
    const threadId = String(threadIdValue ?? "").trim();
    if (!threadId) return false;
    if (!threadStore.hasLocalThread(threadId)) return false;
    if (threadStore.runningThreadIds.has(threadId)) return false;
    return !hasStartedConversationActivity(threadId);
  };

  const recreateEmptyUnpersistedThreadForModelConfig = async (args: {
    threadId: string;
    threadWorkspace: string;
    threadServerId: string;
    model: string;
  }): Promise<string> => {
    const oldThreadId = String(args.threadId ?? "").trim();
    const workspace = normalizeWorkspacePath(args.threadWorkspace);
    const serverId = String(args.threadServerId ?? "").trim();
    const model = normalizeModelName(args.model);
    if (!oldThreadId || !workspace || !serverId) throw new Error("invalid thread recreation params");

    const existing = findThreadListItem(oldThreadId);
    const oldLocalThread = threadStore.localThreads.find((item) => item.id === oldThreadId);
    const { params: threadStartParams, configOverrides } = buildThreadStartParamsForModel({
      model,
      workspace,
      sandboxMode: runtimeStore.sandboxMode,
    });
    const startedAt = perfNow();
    appendDebugLog("thread.create", "recreate empty thread for model config begin", {
      oldThreadId,
      workspace,
      model,
      config: threadStartParams.config ?? null,
    });

    const res = await codexDesktop.codexServer.rpc({
      serverId,
      method: "thread/start",
      params: threadStartParams,
    });
    const result = (res.result ?? {}) as { thread?: { id?: unknown } };
    const newThreadId = String(result.thread?.id ?? "").trim();
    if (!newThreadId) throw new Error("thread/start did not return thread id");

    const oldTitle = String(existing?.title ?? oldLocalThread?.title ?? "").trim();
    const oldFallback = fallbackThreadTitle(oldThreadId);
    const nextTitle = oldTitle && oldTitle !== oldFallback ? oldTitle : fallbackThreadTitle(newThreadId);
    const now = Date.now();
    const nextLocalThread: LocalThreadItem = {
      ...(oldLocalThread ?? {}),
      id: newThreadId,
      title: nextTitle,
      meta: String(existing?.meta ?? oldLocalThread?.meta ?? workspace).trim() || translate("runtime.noWorkspace"),
      cwd: workspace || undefined,
      createdAt: oldLocalThread?.createdAt ?? now,
      updatedAt: now,
      running: false,
      status: "ready",
    };

    runtimeStore.moveThreadComposeState(oldThreadId, newThreadId);
    runtimeStore.movePendingThreadInitSendCount(oldThreadId, newThreadId);
    timelineStore.moveThread(oldThreadId, newThreadId);
    threadStore.replaceThreadId(oldThreadId, newThreadId);
    threadStore.replaceLocalThreadId(oldThreadId, newThreadId, nextLocalThread);
    messageQueueStore.moveThreadQueue(oldThreadId, newThreadId);
    resumedThreadIds.delete(oldThreadId);
    resumedThreadIds.add(newThreadId);
    resumePromisesByThread.delete(oldThreadId);
    clearThreadStartConfigOverrides(oldThreadId);
    rememberThreadStartConfigOverrides(newThreadId, configOverrides);
    for (const cache of threadScopedCaches) cache.delete(oldThreadId);
    setThreadWorkspace(newThreadId, workspace);
    clearThreadWorkspace(oldThreadId);
    runtimeStore.setCurrentThread(newThreadId, { savePrev: false });
    threadStore.setCurrentThread(newThreadId);

    appendDebugLog("thread.create", "recreate empty thread for model config resolved", {
      oldThreadId,
      threadId: newThreadId,
      model,
      elapsedMs: elapsedMs(startedAt),
    });
    return newThreadId;
  };

  const resumeThreadWithModelToolConfig = async (args: {
    threadId: string;
    threadWorkspace: string;
    threadServerId: string;
    model: string;
    configOverrides: ThreadStartConfigOverrides;
  }): Promise<boolean> => {
    const threadId = String(args.threadId ?? "").trim();
    const workspace = normalizeWorkspacePath(args.threadWorkspace);
    const serverId = String(args.threadServerId ?? "").trim();
    const model = normalizeModelName(args.model);
    if (!threadId || !workspace || !serverId) return false;
    try {
      const resumeParams: ThreadResumeParams = {
        threadId,
        model,
        cwd: workspace,
        config: { ...args.configOverrides },
      };
      const res = await codexDesktop.codexServer.rpc({ serverId, method: "thread/resume", params: resumeParams });
      const result = (res.result ?? {}) as { model?: unknown };
      const appliedModel = normalizeModelName(result.model ?? model);
      if (appliedModel !== model) return false;
      resumedThreadIds.add(threadId);
      rememberThreadStartConfigOverrides(threadId, args.configOverrides);
      return true;
    } catch (error: unknown) {
      pushEvent("thread:resume:error", readErrorMessage(error), { threadId, level: "error" });
      return false;
    }
  };

  const ensureThreadModelToolCompatibility = async (args: {
    threadId: string;
    threadWorkspace: string;
    threadServerId: string;
    model: string;
  }): Promise<EnsureThreadModelToolCompatibilityResult> => {
    const threadId = String(args.threadId ?? "").trim();
    const model = normalizeModelName(args.model);
    const configOverrides = buildThreadStartConfigOverridesForModel(model);
    if (!configOverrides) return { ok: true, threadId };
    if (hasThreadModelToolConfigForModel(threadId, model)) return { ok: true, threadId };

    if (canRecreateEmptyUnpersistedThreadForModelConfig(threadId)) {
      try {
        const nextThreadId = await recreateEmptyUnpersistedThreadForModelConfig({
          threadId,
          threadWorkspace: args.threadWorkspace,
          threadServerId: args.threadServerId,
          model,
        });
        return { ok: true, threadId: nextThreadId };
      } catch (error: unknown) {
        return {
          ok: false,
          error: readErrorMessage(error) || translate("runtime.createImageGenerationDisabledThreadFailed"),
        };
      }
    }

    const resumed = await resumeThreadWithModelToolConfig({
      threadId,
      threadWorkspace: args.threadWorkspace,
      threadServerId: args.threadServerId,
      model,
      configOverrides,
    });
    if (resumed && hasThreadModelToolConfigForModel(threadId, model)) return { ok: true, threadId };

    return {
      ok: false,
      error: translate("runtime.cannotDisableOfficialImageGenerationForThread"),
    };
  };

  return {
    rememberThreadStartConfigOverrides,
    clearThreadStartConfigOverrides,
    ensureThreadModelToolCompatibility,
  };
}
