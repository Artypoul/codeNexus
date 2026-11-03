import { nextTick } from "vue";
import { codexDesktop } from "../../api/codexDesktopClient";
import { appendDebugLog } from "../../shared/debugLog";
import {
  beginThreadCreateAttempt,
  bindThreadCreateAttemptToThread,
  createPendingThreadId,
} from "../../shared/threadCreateDebug";
import type { useConfigStore } from "../../stores/config.store";
import type { useMessageQueueStore } from "../../stores/messageQueue.store";
import type { useRuntimeStore } from "../../stores/runtime.store";
import type { useThreadStore } from "../../stores/thread.store";
import type { useTimelineStore } from "../../stores/timeline.store";
import { buildComposeDraftFromUserTurnInputs } from "../composeFileMentions";
import { createDefaultGlobalConfigDraft, normalizeReasoningSummary, normalizeSandboxMode } from "../serverInterop";
import type { ComposeImageAttachment, LocalThreadItem, UserTurnInput } from "../types";
import type { ThreadStartParams } from "@codenexus/generated/codex-app-server/v2/ThreadStartParams";
import type { ThreadStartConfigOverrides } from "@codenexus/shared/modelToolFeatureOverrides";
import { buildNewThreadComposeSeed } from "@codenexus/shared/newThreadComposeSeed";

type ConfigStore = ReturnType<typeof useConfigStore>;
type MessageQueueStore = ReturnType<typeof useMessageQueueStore>;
type RuntimeStore = ReturnType<typeof useRuntimeStore>;
type ThreadStore = ReturnType<typeof useThreadStore>;
type TimelineStore = ReturnType<typeof useTimelineStore>;

type RuntimeEventLevel = "info" | "warn" | "error";
type ToastKind = "info" | "success" | "warn" | "error";
type TranslateFn = (key: string, params?: Record<string, unknown>) => string;
type PushEvent = (method: string, paramsText: string, opts?: { threadId?: string; level?: RuntimeEventLevel }) => void;
type ShowToast = (options: { kind?: ToastKind; title?: string; message: string }) => void;

type ThreadStartBuildResult = {
  params: ThreadStartParams;
  configOverrides: ThreadStartConfigOverrides | null;
};

type QueuedDraftCandidate = {
  text?: unknown;
  inputs?: unknown;
};

export type ThreadCreationRuntimeDeps = {
  appTimelineId: string;
  runtimeStore: RuntimeStore;
  configStore: ConfigStore;
  threadStore: ThreadStore;
  timelineStore: TimelineStore;
  messageQueueStore: MessageQueueStore;
  normalizeWorkspacePath: (value: string) => string;
  getServerIdForWorkspace: (workspacePath: string) => string;
  resolveModel: (value: string) => string;
  resolveEffort: (modelValue: string, effort: string) => string;
  ensureModelCatalog: () => Promise<unknown>;
  startServer: () => Promise<boolean>;
  clearThreadRuntimeState: (threadId: string) => void;
  setThreadWorkspace: (threadId: string, workspacePath: string | undefined) => void;
  clearThreadWorkspace: (threadId: string) => void;
  buildThreadStartParamsForModel: (args: {
    model: string;
    workspace: string;
    sandboxMode: string;
  }) => ThreadStartBuildResult;
  rememberThreadStartConfigOverrides: (
    threadId: string,
    overrides: ThreadStartConfigOverrides | null | undefined,
    model?: string
  ) => void;
  markThreadResumed: (threadId: string) => void;
  flushQueueForThread: (threadId: string) => Promise<void>;
  cloneUserTurnInputs: (values: UserTurnInput[]) => UserTurnInput[];
  buildComposeAttachmentsFromUserTurnInputs: (values: UserTurnInput[]) => Promise<{
    attachments: ComposeImageAttachment[];
    failedLocalPaths: string[];
  }>;
  pushEvent: PushEvent;
  translate: TranslateFn;
  showToast: ShowToast;
};

export type ThreadCreationRuntime = {
  createThread: () => Promise<void>;
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

export function createThreadCreationRuntime(deps: ThreadCreationRuntimeDeps): ThreadCreationRuntime {
  const {
    appTimelineId,
    runtimeStore,
    configStore,
    threadStore,
    timelineStore,
    messageQueueStore,
    normalizeWorkspacePath,
    getServerIdForWorkspace,
    resolveModel,
    resolveEffort,
    ensureModelCatalog,
    startServer,
    clearThreadRuntimeState,
    setThreadWorkspace,
    clearThreadWorkspace,
    buildThreadStartParamsForModel,
    rememberThreadStartConfigOverrides,
    markThreadResumed,
    flushQueueForThread,
    cloneUserTurnInputs,
    buildComposeAttachmentsFromUserTurnInputs,
    pushEvent,
    translate,
    showToast,
  } = deps;

  const latestQueuedCandidateForThread = (threadId: string): QueuedDraftCandidate | null => {
    const queued = messageQueueStore.queueByThread.get(threadId) ?? [];
    return queued.length > 0 ? (queued[queued.length - 1] as QueuedDraftCandidate) : null;
  };

  const restorePreviousThreadAfterFailure = async (
    previousThreadId: string,
    candidate: QueuedDraftCandidate | null
  ) => {
    if (!previousThreadId) return;
    runtimeStore.setCurrentThread(previousThreadId, { savePrev: false });
    threadStore.setCurrentThread(previousThreadId);
    if (!candidate) return;
    try {
      const queueInputs = cloneUserTurnInputs(
        Array.isArray(candidate.inputs) ? (candidate.inputs as UserTurnInput[]) : []
      );
      const { attachments } = await buildComposeAttachmentsFromUserTurnInputs(queueInputs);
      const draft = buildComposeDraftFromUserTurnInputs(queueInputs);
      runtimeStore.composeInput = draft.composeInput || String(candidate.text ?? "");
      runtimeStore.composeAttachments = attachments;
      runtimeStore.composeFileMentions = draft.composeFileMentions;
      runtimeStore.saveThreadComposeAttachments(runtimeStore.currentThreadId);
      runtimeStore.saveThreadComposeFileMentions(runtimeStore.currentThreadId);
      showToast({
        kind: "warn",
        title: translate("runtime.threadCreateFailedTitle"),
        message: translate("runtime.pendingContentRestored"),
      });
    } catch {}
  };

  const createThread = async () => {
    const attemptId = beginThreadCreateAttempt();
    const createStartedAt = perfNow();
    const workspaceBeforeStart = normalizeWorkspacePath(runtimeStore.workspacePath);
    const serverIdBeforeStart = getServerIdForWorkspace(workspaceBeforeStart);
    const previousThreadId = String(runtimeStore.currentThreadId ?? "").trim();
    const globalDraft = configStore.draft ?? createDefaultGlobalConfigDraft();
    const runtimeModel = resolveModel(runtimeStore.model);
    const globalModel = resolveModel(globalDraft.model);
    const newThreadComposeSeed = buildNewThreadComposeSeed({
      previousThreadId,
      runtime: {
        composeMode: runtimeStore.composeMode,
        model: runtimeModel,
        reasoningEffort: resolveEffort(runtimeModel, runtimeStore.reasoningEffort),
        reasoningSummary: normalizeReasoningSummary(runtimeStore.reasoningSummary),
        sandboxMode: normalizeSandboxMode(runtimeStore.sandboxMode),
      },
      global: {
        model: globalModel,
        reasoningEffort: resolveEffort(globalModel, globalDraft.modelReasoningEffort),
        reasoningSummary: normalizeReasoningSummary(globalDraft.modelReasoningSummary),
        sandboxMode: normalizeSandboxMode(globalDraft.sandboxMode),
      },
    });
    const optimisticThreadId = createPendingThreadId();
    appendDebugLog("thread.create", "clicked", {
      attemptId,
      workspace: workspaceBeforeStart || null,
      currentThreadId: String(runtimeStore.currentThreadId ?? "").trim() || null,
      serverReady: Boolean(serverIdBeforeStart),
      serverId: serverIdBeforeStart || null,
    });
    runtimeStore.seedThreadComposeStateFromSeed(optimisticThreadId, newThreadComposeSeed);
    setThreadWorkspace(optimisticThreadId, workspaceBeforeStart);
    runtimeStore.clearPendingThreadInitSendCount(optimisticThreadId);
    const optimisticCreatedAt = Date.now();
    const optimisticLocalThread: LocalThreadItem = {
      id: optimisticThreadId,
      title: translate("runtime.creating"),
      meta: workspaceBeforeStart || translate("runtime.noWorkspace"),
      cwd: workspaceBeforeStart || undefined,
      createdAt: optimisticCreatedAt,
      updatedAt: optimisticCreatedAt,
      running: false,
      status: "creating",
    };
    threadStore.upsertLocalThread(optimisticLocalThread);
    runtimeStore.setCurrentThread(optimisticThreadId);
    threadStore.setCurrentThread(optimisticThreadId);
    appendDebugLog("thread.create", "optimistic thread shown", {
      attemptId,
      optimisticThreadId,
      elapsedMs: elapsedMs(createStartedAt),
    });
    const startServerStartedAt = perfNow();
    const ok = await startServer();
    appendDebugLog("thread.create", "startServer completed", {
      attemptId,
      ok,
      workspace: normalizeWorkspacePath(runtimeStore.workspacePath) || null,
      elapsedMs: elapsedMs(startServerStartedAt),
      totalElapsedMs: elapsedMs(createStartedAt),
    });
    if (!ok) {
      const candidate = latestQueuedCandidateForThread(optimisticThreadId);
      clearThreadRuntimeState(optimisticThreadId);
      await restorePreviousThreadAfterFailure(previousThreadId, candidate);
      appendDebugLog("thread.create", "optimistic thread rolled back", {
        attemptId,
        optimisticThreadId,
        reason: "startServer failed",
        totalElapsedMs: elapsedMs(createStartedAt),
      });
      return;
    }
    const workspace = normalizeWorkspacePath(runtimeStore.workspacePath);
    const serverId = getServerIdForWorkspace(workspace);
    if (!serverId) {
      const candidate = latestQueuedCandidateForThread(optimisticThreadId);
      clearThreadRuntimeState(optimisticThreadId);
      await restorePreviousThreadAfterFailure(previousThreadId, candidate);
      appendDebugLog("thread.create", "aborted: missing serverId after startServer", {
        attemptId,
        workspace: workspace || null,
        totalElapsedMs: elapsedMs(createStartedAt),
      });
      return;
    }
    try {
      await ensureModelCatalog();
      const resolvedSeedModel = resolveModel(newThreadComposeSeed.model);
      if (!resolvedSeedModel) {
        const candidate = latestQueuedCandidateForThread(optimisticThreadId);
        clearThreadRuntimeState(optimisticThreadId);
        await restorePreviousThreadAfterFailure(previousThreadId, candidate);
        showToast({
          kind: "error",
          title: translate("runtime.threadCreateFailedTitle"),
          message: translate("runtime.noModelAvailable"),
        });
        return;
      }
      const resolvedSeedEffort = resolveEffort(resolvedSeedModel, newThreadComposeSeed.reasoningEffort);
      runtimeStore.seedThreadComposeStateFromSeed(optimisticThreadId, {
        ...newThreadComposeSeed,
        model: resolvedSeedModel,
        reasoningEffort: resolvedSeedEffort,
      });

      // `thread/start` 的 `sandbox` 使用 kebab-case，见 schema 的 v2/ThreadStartParams.json。
      const { params: threadStartParams, configOverrides: modelConfigOverrides } = buildThreadStartParamsForModel({
        model: resolvedSeedModel,
        workspace,
        sandboxMode: newThreadComposeSeed.sandboxMode,
      });
      const rpcStartedAt = perfNow();
      appendDebugLog("thread.create", "thread/start rpc begin", {
        attemptId,
        serverId,
        workspace: workspace || null,
        model: threadStartParams.model,
        sandbox: threadStartParams.sandbox,
        approvalPolicy: threadStartParams.approvalPolicy,
      });
      const res = await codexDesktop.codexServer.rpc({
        serverId,
        method: "thread/start",
        params: threadStartParams,
      });
      const result = res.result;
      if (!result) throw new Error("thread/start failed");
      const id = String(result.thread?.id ?? "").trim();
      if (!id) throw new Error("thread/start did not return thread id");
      rememberThreadStartConfigOverrides(id, modelConfigOverrides, resolvedSeedModel);
      bindThreadCreateAttemptToThread(attemptId, id);
      appendDebugLog("thread.create", "thread/start rpc resolved", {
        attemptId,
        threadId: id,
        elapsedMs: elapsedMs(rpcStartedAt),
        totalElapsedMs: elapsedMs(createStartedAt),
      });
      const applyStateStartedAt = perfNow();
      runtimeStore.moveThreadComposeState(optimisticThreadId, id);
      runtimeStore.clearPendingThreadInitSendCount(optimisticThreadId);
      timelineStore.moveThread(optimisticThreadId, id);
      const finalizedLocalThread: LocalThreadItem = {
        id,
        title: `Thread ${id.slice(-8)}`,
        meta: workspace || translate("runtime.noWorkspace"),
        cwd: workspace || undefined,
        createdAt: optimisticCreatedAt,
        updatedAt: Date.now(),
        running: false,
        status: "ready",
      };
      threadStore.replaceThreadId(optimisticThreadId, id);
      threadStore.replaceLocalThreadId(optimisticThreadId, id, finalizedLocalThread);
      messageQueueStore.moveThreadQueue(optimisticThreadId, id);
      markThreadResumed(id);
      setThreadWorkspace(id, workspace);
      clearThreadWorkspace(optimisticThreadId);
      pushEvent("thread", translate("runtime.threadCreated"), { threadId: id });
      appendDebugLog("thread.create", "local state applied", {
        attemptId,
        threadId: id,
        threadHistorySize: threadStore.threadHistory.length,
        localThreadSize: threadStore.localThreads.length,
        elapsedMs: elapsedMs(applyStateStartedAt),
        totalElapsedMs: elapsedMs(createStartedAt),
      });
      const nextTickStartedAt = perfNow();
      await nextTick();
      appendDebugLog("thread.create", "nextTick flushed", {
        attemptId,
        threadId: id,
        elapsedMs: elapsedMs(nextTickStartedAt),
        totalElapsedMs: elapsedMs(createStartedAt),
      });
      if (!threadStore.runningThreadIds.has(id)) void flushQueueForThread(id);
    } catch (error: unknown) {
      const msg = readErrorMessage(error);
      const candidate = latestQueuedCandidateForThread(optimisticThreadId);
      clearThreadRuntimeState(optimisticThreadId);
      await restorePreviousThreadAfterFailure(previousThreadId, candidate);
      appendDebugLog("thread.create", "failed", {
        attemptId,
        workspace: workspace || null,
        serverId,
        elapsedMs: elapsedMs(createStartedAt),
        message: msg,
      });
      pushEvent("thread:error", msg, { threadId: appTimelineId, level: "error" });
    }
  };

  return { createThread };
}
