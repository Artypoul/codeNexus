import { buildComposeDraftFromUserTurnInputs, hasMeaningfulComposeText } from "../composeFileMentions";
import type { ComposeImageAttachment, TimelineEventItem, UserTurnInput } from "../types";
import type { useMessageQueueStore } from "../../stores/messageQueue.store";
import type { useRuntimeStore } from "../../stores/runtime.store";
import type { useThreadStore } from "../../stores/thread.store";
import type { useTimelineStore } from "../../stores/timeline.store";

type MessageQueueStore = ReturnType<typeof useMessageQueueStore>;
type RuntimeStore = ReturnType<typeof useRuntimeStore>;
type ThreadStore = ReturnType<typeof useThreadStore>;
type TimelineStore = ReturnType<typeof useTimelineStore>;

type RuntimeEventLevel = "info" | "warn" | "error";
type ToastKind = "info" | "success" | "warn" | "error";

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;
type PushEvent = (method: string, paramsText: string, opts?: { threadId?: string; level?: RuntimeEventLevel }) => void;
type ShowToast = (options: { kind?: ToastKind; title?: string; message: string }) => void;

type TimelineUserMessagePayload = {
  displayText: string;
  payload: unknown;
};

type TurnStart = (params: {
  threadId: string;
  threadWorkspace: string;
  threadServerId: string;
  input: UserTurnInput[];
  model?: string;
}) => Promise<{ ok: true } | { ok: false; error: string }>;

type EnsureThreadModelToolCompatibility = (args: {
  threadId: string;
  threadWorkspace: string;
  threadServerId: string;
  model: string;
}) => Promise<{ ok: true; threadId: string; model: string } | { ok: false; error: string }>;

export type MessageQueueRuntimeDeps = {
  runtimeStore: RuntimeStore;
  threadStore: ThreadStore;
  timelineStore: TimelineStore;
  messageQueueStore: MessageQueueStore;
  normalizeWorkspacePath: (value: string) => string;
  getWorkspaceForThread: (threadId: string) => string;
  resolveModel: (value: string) => string;
  ensureServerForWorkspace: (workspacePath: string) => Promise<string>;
  ensureThreadResumed: (threadId: string) => Promise<boolean>;
  ensureThreadModelToolCompatibility: EnsureThreadModelToolCompatibility;
  requestTurnSteer: (threadId: string, input: UserTurnInput[], turnIdValue: string) => Promise<boolean>;
  startTurnWithInput: TurnStart;
  clearThreadPreparingEvent: (threadId: string) => void;
  upsertThreadPreparingEvent: (threadId: string) => void;
  cloneUserTurnInputs: (values: UserTurnInput[]) => UserTurnInput[];
  buildComposeAttachmentsFromUserTurnInputs: (values: UserTurnInput[]) => Promise<{
    attachments: ComposeImageAttachment[];
    failedLocalPaths: string[];
  }>;
  buildTimelineUserMessagePayload: (values: UserTurnInput[]) => TimelineUserMessagePayload;
  fileNameFromPathLike: (value: string, fallback: string) => string;
  pushEvent: PushEvent;
  translate: TranslateFn;
  showToast: ShowToast;
};

export type MessageQueueRuntime = {
  flushQueueForThread: (threadId: string) => Promise<void>;
  sendQueuedMessageNow: (messageId: string) => Promise<void>;
  editQueuedMessage: (messageId: string) => Promise<void>;
  removeQueuedMessage: (messageId: string) => Promise<void>;
};

export function createMessageQueueRuntime(deps: MessageQueueRuntimeDeps): MessageQueueRuntime {
  const {
    runtimeStore,
    threadStore,
    timelineStore,
    messageQueueStore,
    normalizeWorkspacePath,
    getWorkspaceForThread,
    resolveModel,
    ensureServerForWorkspace,
    ensureThreadResumed,
    ensureThreadModelToolCompatibility,
    requestTurnSteer,
    startTurnWithInput,
    clearThreadPreparingEvent,
    upsertThreadPreparingEvent,
    cloneUserTurnInputs,
    buildComposeAttachmentsFromUserTurnInputs,
    buildTimelineUserMessagePayload,
    fileNameFromPathLike,
    pushEvent,
    translate,
    showToast,
  } = deps;

  const summarizeQueuedMessagePreview = (message: {
    text?: string;
    inputs?: UserTurnInput[];
    displayText?: string;
  }): string => {
    const displayText = String(message.displayText ?? "").trim();
    if (displayText) return displayText;
    const payload = buildTimelineUserMessagePayload(Array.isArray(message.inputs) ? message.inputs : []);
    if (payload.displayText) return payload.displayText;
    const text = String(message.text ?? "").trim();
    if (text) return text;
    const inputs = Array.isArray(message.inputs) ? message.inputs : [];
    const imageCount = inputs.filter((item) => item?.type === "image" || item?.type === "localImage").length;
    if (imageCount > 0) return translate("runtime.imageCount", { count: imageCount });
    return translate("runtime.emptyMessage");
  };

  const flushQueueForThread = async (threadIdValue: string) => {
    let threadId = String(threadIdValue ?? "").trim();
    if (!threadId) return;
    if (threadStore.runningThreadIds.has(threadId)) return;
    const next = messageQueueStore.peekNextQueued(threadId);
    if (!next) return;

    const previewText = summarizeQueuedMessagePreview(next);
    const previewPayload = buildTimelineUserMessagePayload(Array.isArray(next.inputs) ? next.inputs : []);

    const localEventId =
      String(next.localEventId ?? "").trim() || `local:user:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const localMessageId = `local-user-msg:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    messageQueueStore.setLocalEventId(threadId, next.id, localEventId);
    const ensureLocalEvent = () => {
      if (String(next.localEventId ?? "").trim()) return;
      timelineStore.appendEvent({
        threadId,
        id: localEventId,
        method: "user",
        paramsText: previewText,
        params: previewPayload.payload,
        level: "info",
        localKind: "user",
        localState: "pending",
        localMessageId,
      });
      runtimeStore.requestScrollTimelineToBottom(threadId);
    };
    const patchLocalEvent = (patch: Partial<TimelineEventItem>) => {
      timelineStore.patchEvent({ threadId, id: localEventId, patch });
    };

    ensureLocalEvent();

    let threadWorkspace = normalizeWorkspacePath(getWorkspaceForThread(threadId) || runtimeStore.workspacePath);
    let threadServerId = await ensureServerForWorkspace(threadWorkspace);
    if (!threadServerId) {
      messageQueueStore.markStatus(threadId, next.id, "failed");
      patchLocalEvent({ localState: "failed", level: "error" });
      clearThreadPreparingEvent(threadId);
      return;
    }
    // 只有当前线程还没有显式模型选择时，才回落到服务端线程的实际模型。
    // 否则会把用户在输入框里刚选好的模型覆盖回旧值。
    const localModel = String(runtimeStore.model ?? "").trim();
    let requestedModel = resolveModel(localModel);
    const compatibility = await ensureThreadModelToolCompatibility({
      threadId,
      threadWorkspace,
      threadServerId,
      model: requestedModel,
    });
    if (!compatibility.ok) {
      messageQueueStore.markStatus(threadId, next.id, "failed");
      patchLocalEvent({ localState: "failed", level: "error" });
      clearThreadPreparingEvent(threadId);
      pushEvent("turn:error", compatibility.error, { threadId, level: "error" });
      return;
    }
    if (compatibility.threadId !== threadId) {
      threadId = compatibility.threadId;
      threadWorkspace = normalizeWorkspacePath(getWorkspaceForThread(threadId) || threadWorkspace);
      threadServerId = await ensureServerForWorkspace(threadWorkspace);
      if (!threadServerId) {
        messageQueueStore.markStatus(threadId, next.id, "failed");
        patchLocalEvent({ localState: "failed", level: "error" });
        clearThreadPreparingEvent(threadId);
        return;
      }
    }
    if (!localModel && compatibility.model !== requestedModel) {
      requestedModel = compatibility.model;
      if (String(runtimeStore.currentThreadId ?? "").trim() === threadId) {
        runtimeStore.model = requestedModel;
        runtimeStore.saveThreadComposeState(threadId, { save: true });
      }
    }
    const resumed = await ensureThreadResumed(threadId);
    if (!resumed) {
      messageQueueStore.markStatus(threadId, next.id, "failed");
      patchLocalEvent({ localState: "failed", level: "error" });
      clearThreadPreparingEvent(threadId);
      return;
    }

    messageQueueStore.markStatus(threadId, next.id, "sending");
    patchLocalEvent({ localState: "sending", level: "info" });

    const fallbackInput = next.text.trim() ? [{ type: "text", text: next.text.trim() } as UserTurnInput] : [];
    const queueInput = Array.isArray(next.inputs) && next.inputs.length > 0 ? next.inputs : fallbackInput;
    if (queueInput.length === 0) {
      messageQueueStore.markStatus(threadId, next.id, "failed");
      patchLocalEvent({ localState: "failed", level: "error" });
      clearThreadPreparingEvent(threadId);
      return;
    }
    if (threadStore.hasLocalThread(threadId)) {
      upsertThreadPreparingEvent(threadId);
    }
    const started = await startTurnWithInput({
      threadId,
      threadWorkspace,
      threadServerId,
      input: queueInput,
      model: requestedModel,
    });
    if (started.ok) {
      messageQueueStore.remove(threadId, next.id);
      patchLocalEvent({ localState: "sent", level: "info" });
      return;
    }
    messageQueueStore.markStatus(threadId, next.id, "failed");
    patchLocalEvent({ localState: "failed", level: "error" });
    clearThreadPreparingEvent(threadId);
  };

  const editQueuedMessage = async (messageIdValue: string) => {
    const threadId = String(runtimeStore.currentThreadId ?? "").trim();
    if (!threadId) return;
    const messageId = String(messageIdValue ?? "").trim();
    if (!messageId) return;

    const list = messageQueueStore.queueByThread.get(threadId) ?? [];
    const queuedMessage =
      list.find((item) => item.id === messageId && (item.status === "queued" || item.status === "failed")) ?? null;
    if (!queuedMessage) return;

    const queueInputs = cloneUserTurnInputs(Array.isArray(queuedMessage.inputs) ? queuedMessage.inputs : []);
    const textValue = String(queuedMessage.text ?? "");
    const { attachments, failedLocalPaths } = await buildComposeAttachmentsFromUserTurnInputs(queueInputs);
    const draft = buildComposeDraftFromUserTurnInputs(queueInputs);
    const prefillText = draft.composeInput || textValue;
    const mentions = draft.composeFileMentions;
    if (!hasMeaningfulComposeText(prefillText) && attachments.length === 0 && mentions.length === 0) {
      showToast({
        kind: "warn",
        title: translate("runtime.cannotEditQueuedMessageTitle"),
        message: translate("runtime.queuedMessageNoEditableContent"),
      });
      return;
    }

    const taken = messageQueueStore.takeEditable(threadId, messageId);
    if (!taken) return;

    runtimeStore.startQueueRewrite({
      prefillText,
      prefillAttachments: attachments,
      prefillMentions: mentions,
    });

    if (failedLocalPaths.length > 0) {
      const names = failedLocalPaths
        .slice(0, 2)
        .map((item) => fileNameFromPathLike(item, translate("runtime.imageFallbackName")));
      const summary = names.join(translate("runtime.listSeparator"));
      const suffix =
        failedLocalPaths.length > 2 ? translate("runtime.moreImagesSuffix", { count: failedLocalPaths.length }) : "";
      showToast({
        kind: "warn",
        title: translate("runtime.someImagesNotRestoredTitle"),
        message: summary
          ? translate("runtime.namedImagesNotRestored", { summary: `${summary}${suffix}` })
          : translate("runtime.someImagesNotRestoredMessage"),
      });
    }
  };

  const removeQueuedMessage = async (messageIdValue: string) => {
    const threadId = String(runtimeStore.currentThreadId ?? "").trim();
    if (!threadId) return;
    const messageId = String(messageIdValue ?? "").trim();
    if (!messageId) return;

    const list = messageQueueStore.queueByThread.get(threadId) ?? [];
    const msg = list.find((item) => item.id === messageId) ?? null;
    if (!msg) return;
    if (msg.status === "sending") return;

    const localEventId = String(msg.localEventId ?? "").trim();
    messageQueueStore.remove(threadId, messageId);
    if (localEventId) {
      timelineStore.removeEvent({ threadId, id: localEventId });
    }
  };

  const sendQueuedMessageNow = async (messageIdValue: string) => {
    const threadId = String(runtimeStore.currentThreadId ?? "").trim();
    if (!threadId) return;
    const messageId = String(messageIdValue ?? "").trim();
    if (!messageId) return;

    const list = messageQueueStore.queueByThread.get(threadId) ?? [];
    const msg = list.find((m) => m.id === messageId) ?? null;
    if (!msg || (msg.status !== "queued" && msg.status !== "failed")) return;

    const previewText = summarizeQueuedMessagePreview(msg);
    const previewPayload = buildTimelineUserMessagePayload(Array.isArray(msg.inputs) ? msg.inputs : []);

    const localEventId =
      String(msg.localEventId ?? "").trim() || `local:user:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const localMessageId = `local-user-msg:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    messageQueueStore.setLocalEventId(threadId, msg.id, localEventId);
    const ensureLocalEvent = () => {
      if (String(msg.localEventId ?? "").trim()) return;
      timelineStore.appendEvent({
        threadId,
        id: localEventId,
        method: "user",
        paramsText: previewText,
        params: previewPayload.payload,
        level: "info",
        localKind: "user",
        localState: "pending",
        localMessageId,
      });
      runtimeStore.requestScrollTimelineToBottom(threadId);
    };
    const patchLocalEvent = (patch: Partial<TimelineEventItem>) => {
      timelineStore.patchEvent({ threadId, id: localEventId, patch });
    };

    ensureLocalEvent();

    const threadWorkspace = normalizeWorkspacePath(getWorkspaceForThread(threadId) || runtimeStore.workspacePath);
    const threadServerId = await ensureServerForWorkspace(threadWorkspace);
    if (!threadServerId) {
      messageQueueStore.markStatus(threadId, msg.id, "failed");
      patchLocalEvent({ localState: "failed", level: "error" });
      clearThreadPreparingEvent(threadId);
      return;
    }

    const resumed = await ensureThreadResumed(threadId);
    if (!resumed) {
      messageQueueStore.markStatus(threadId, msg.id, "failed");
      patchLocalEvent({ localState: "failed", level: "error" });
      clearThreadPreparingEvent(threadId);
      return;
    }

    const fallbackInput = msg.text.trim() ? [{ type: "text", text: msg.text.trim() } as UserTurnInput] : [];
    const queueInput = Array.isArray(msg.inputs) && msg.inputs.length > 0 ? msg.inputs : fallbackInput;
    if (queueInput.length === 0) {
      messageQueueStore.markStatus(threadId, msg.id, "failed");
      patchLocalEvent({ localState: "failed", level: "error" });
      clearThreadPreparingEvent(threadId);
      return;
    }

    messageQueueStore.markStatus(threadId, msg.id, "sending");
    patchLocalEvent({ localState: "sending", level: "info" });

    const running = threadStore.runningThreadIds.has(threadId);
    if (running) {
      const turnIdValue = String(threadStore.activeTurnIdByThread.get(threadId) ?? "").trim();
      if (!turnIdValue) {
        messageQueueStore.markStatus(threadId, msg.id, "queued");
        patchLocalEvent({ localState: "queued", level: "warn" });
        pushEvent("steer:error", translate("runtime.missingActiveTurnForQueuedSteer"), { threadId, level: "error" });
        return;
      }
      const ok = await requestTurnSteer(threadId, queueInput, turnIdValue);
      if (ok) {
        messageQueueStore.remove(threadId, msg.id);
        patchLocalEvent({ localState: "sent", level: "info", turnId: turnIdValue });
        return;
      }
      messageQueueStore.markStatus(threadId, msg.id, "failed");
      patchLocalEvent({ localState: "failed", level: "error", turnId: turnIdValue });
      return;
    }

    if (threadStore.hasLocalThread(threadId)) {
      upsertThreadPreparingEvent(threadId);
    }
    const started = await startTurnWithInput({ threadId, threadWorkspace, threadServerId, input: queueInput });
    if (started.ok) {
      messageQueueStore.remove(threadId, msg.id);
      patchLocalEvent({ localState: "sent", level: "info" });
      return;
    }
    messageQueueStore.markStatus(threadId, msg.id, "failed");
    patchLocalEvent({ localState: "failed", level: "error" });
    clearThreadPreparingEvent(threadId);
  };

  return {
    flushQueueForThread,
    sendQueuedMessageNow,
    editQueuedMessage,
    removeQueuedMessage,
  };
}
