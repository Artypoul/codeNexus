import type { Pinia } from "pinia";
import { createEventBridge } from "../../infra/ipc/eventBridge";
import { normalizePlanItems } from "../../domain/serverInterop";
import { useThreadStore } from "../../stores/thread.store";
import { useGoalShutdownStore } from "../../stores/goalShutdown.store";
import { useTimelineStore } from "../../stores/timeline.store";
import { useRuntimeStore } from "../../stores/runtime.store";
import { safeJsonStringify } from "../../utils/safeJson";
import { useDebugTimelineStore } from "../../stores/debugTimeline.store";
import { resolveThreadTitle } from "../../features/history/threadTitle";
import { buildThreadHistoryMetadataFromServerThread } from "../../features/history/threadMetadata";
import { codexDesktop } from "../../api/codexDesktopClient";
import {
  buildProtocolNoticeTimelineText,
  buildProtocolNoticeToast,
} from "../../features/timeline/protocolNoticeRender";
import { showToast } from "../../ui/toast";
import { translate } from "../../i18n/translate";
import { appendDebugLog } from "../../shared/debugLog";
import {
  bindThreadCreateAttemptToThread,
  findRecentPendingThreadCreateAttemptId,
  findThreadCreateAttemptIdByThreadId,
} from "../../shared/threadCreateDebug";
import type { NormalizedNotification } from "../../core/protocol/notifications";
import type { OfficialCodexServerNotification } from "@codenexus/shared/codex-protocol";
import type { ThreadItem } from "@codenexus/generated/codex-app-server/v2/ThreadItem";

// 按方法名筛选通知的类型
type NotificationByMethod<M extends OfficialCodexServerNotification["method"]> = Extract<
  NormalizedNotification,
  { method: M }
>;
// Item 生命周期通知类型
type ItemLifecycleNotification = NotificationByMethod<"item/started"> | NotificationByMethod<"item/completed">;
// 线程 Token 使用量负载类型
type ThreadTokenUsagePayload = NotificationByMethod<"thread/tokenUsage/updated">["params"]["tokenUsage"];
// 上下文压缩线程项类型
type ContextCompactionThreadItem = Extract<ThreadItem, { type: "contextCompaction" }>;
type CommandExecutionThreadItem = Extract<ThreadItem, { type: "commandExecution" }>;
type AgentMessagePhase = "commentary" | "final_answer";

// 判断是否为 Item 生命周期通知
function isItemLifecycleNotification(notification: NormalizedNotification): notification is ItemLifecycleNotification {
  return notification.method === "item/started" || notification.method === "item/completed";
}

// 获取生命周期通知中的 Item
function getLifecycleItem(notification: NormalizedNotification): ThreadItem | null {
  return isItemLifecycleNotification(notification) ? notification.params.item : null;
}

// 判断是否为上下文压缩线程项
function isContextCompactionThreadItem(item: ThreadItem | null): item is ContextCompactionThreadItem {
  return item?.type === "contextCompaction";
}

// 将值转换为有限数字
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Convert a value to an epoch timestamp in milliseconds.
function toEpochMs(value: unknown): number | null {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  if (raw >= 1_000_000_000_000) return Math.round(raw); // Already milliseconds.
  return Math.round(raw * 1000); // Convert seconds to milliseconds.
}

// 提取线程 Token 使用信息
function toThreadTokenUsage(tokenUsage: ThreadTokenUsagePayload | Record<string, unknown> | null | undefined) {
  const tokenUsageRecord = toRecord(tokenUsage);
  const lastUsageRecord = toRecord(tokenUsageRecord.last);
  const totalUsageRecord = toRecord(tokenUsageRecord.total);
  const toBreakdown = (record: Record<string, unknown>) => ({
    totalTokens: toFiniteNumber(record.totalTokens),
    inputTokens: toFiniteNumber(record.inputTokens),
    cachedInputTokens: toFiniteNumber(record.cachedInputTokens),
    outputTokens: toFiniteNumber(record.outputTokens),
    reasoningOutputTokens: toFiniteNumber(record.reasoningOutputTokens),
  });
  const last = toBreakdown(lastUsageRecord);
  const total = toBreakdown(totalUsageRecord);
  const usedTokens = toFiniteNumber(
    tokenUsageRecord.usedTokens ?? last.totalTokens ?? last.inputTokens ?? total.totalTokens
  );
  const contextWindow = toFiniteNumber(tokenUsageRecord.modelContextWindow);
  return {
    usedTokens,
    contextWindow,
    last,
    total,
    modelContextWindow: contextWindow,
    updatedAt: Date.now(),
  };
}

// 转换为格式化的 JSON 字符串
function toPrettyJson(value: unknown): string {
  return safeJsonStringify(value ?? {}, { space: 2 });
}

function decodeBase64Utf8(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    if (typeof atob === "function") {
      const binary = atob(raw);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
  } catch {}
  return raw;
}

// 提取推理摘要文本
function toReasoningSummaryTexts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const texts: string[] = [];
  for (const part of value) {
    if (typeof part === "string") {
      const s = part.trim();
      if (s) texts.push(s);
      continue;
    }
    const partRecord = toRecord(part);
    if (!partRecord) continue;
    const text = typeof partRecord.text === "string" ? partRecord.text.trim() : "";
    if (text) texts.push(text);
  }
  return texts;
}

// 提取原始推理正文分片
function toReasoningRawContentTexts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((part) => (typeof part === "string" ? part : "")).filter((part) => part.trim().length > 0);
}

// 思考阶段类型
type ThinkingPhase = "queued" | "preparing" | "reasoning" | "streaming" | "waiting_more" | "completed" | "failed";

// 思考状态时间间隔常量（毫秒）
const THINKING_GAP_MS = 900;
const THINKING_SETTLE_MS = 450;
const CONTEXT_COMPACTION_SETTLE_MS = 1800;

const HIDDEN_OFFICIAL_NOTIFICATION_METHODS = new Set<OfficialCodexServerNotification["method"]>([
  "process/outputDelta",
  "process/exited",
  "remoteControl/status/changed",
  "thread/goal/updated",
  "thread/goal/cleared",
]);

// 思考阶段提示文本
const THINKING_PHASE_BODY_KEY: Record<ThinkingPhase, string> = {
  queued: "runtime.thinkingQueuedBody",
  preparing: "runtime.thinkingPreparingBody",
  reasoning: "runtime.thinkingReasoningBody",
  streaming: "runtime.thinkingStreamingBody",
  waiting_more: "runtime.thinkingWaitingMoreBody",
  completed: "runtime.thinkingCompletedBody",
  failed: "runtime.thinkingFailedBody",
};

const THREAD_PREPARING_EVENT_ID = "local:threadPreparing";

// 从候选值中解析出有效的 ID
function resolveId(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const text = String(candidate ?? "").trim();
    if (text) return text;
  }
  return "";
}

// 将值转换为 Record 对象
function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function playConfiguredNotificationSoundOnceLazy() {
  const { playConfiguredNotificationSoundOnce } = await import("../../features/notificationSound/player");
  await playConfiguredNotificationSoundOnce();
}

function isGuardianApprovalReviewMethodName(method: unknown): boolean {
  return method === "item/autoApprovalReview/started" || method === "item/autoApprovalReview/completed";
}

// UI：最多保留最近 N 轮对话，避免长对话导致渲染/内存持续膨胀。
const TIMELINE_MAX_VISIBLE_TURNS = 16;

function pruneTimelineToRecentTurns(
  timelineStore: ReturnType<typeof useTimelineStore>,
  threadIdValue: string,
  maxTurns: number = TIMELINE_MAX_VISIBLE_TURNS
) {
  const threadId = String(threadIdValue ?? "").trim();
  if (!threadId || threadId === "__app__") return;
  const limit = Math.max(0, Math.round(Number(maxTurns) || 0));
  if (limit <= 0) return;

  // turn/completed 到达时可能仍有 delta 未 flush；先刷一次保证 turnId 集合准确。
  timelineStore.flushPendingAppends();
  const events = timelineStore.eventsForThread(threadId);
  if (events.length === 0) return;

  const allTurnIds = new Set<string>();
  for (const event of events) {
    const turnId = String(event?.turnId ?? "").trim();
    if (turnId) allTurnIds.add(turnId);
  }
  if (allTurnIds.size <= limit) return;

  const keepTurnIds = new Set<string>();
  for (let idx = events.length - 1; idx >= 0 && keepTurnIds.size < limit; idx -= 1) {
    const turnId = String(events[idx]?.turnId ?? "").trim();
    if (!turnId) continue;
    keepTurnIds.add(turnId);
  }
  if (keepTurnIds.size === 0) return;

  const dropTurnIds: string[] = [];
  for (const turnId of allTurnIds) {
    if (!keepTurnIds.has(turnId)) dropTurnIds.push(turnId);
  }
  if (dropTurnIds.length > 0) {
    timelineStore.removeTurnEvents(threadId, dropTurnIds);
  }
}

// 生成命令生命周期事件 ID
function toCommandLifecycleEventId(
  method: "item/started" | "item/completed",
  threadId: string,
  turnId: string,
  itemId: string
): string {
  const normalizedThreadId = String(threadId ?? "").trim() || "__app__";
  const normalizedTurnId = String(turnId ?? "").trim() || "unknown";
  const normalizedItemId = String(itemId ?? "").trim() || "unknown";
  return `notif:${method}:commandExecution:${normalizedThreadId}:${normalizedTurnId}:${normalizedItemId}`;
}

// 安装协议事件流水线：处理来自 codexDesktop 的协议通知并更新 store
export function installEventPipeline(pinia: Pinia) {
  // 该流水线负责把协议通知标准化并写入 thread/timeline 两类 store。
  const threadStore = useThreadStore(pinia);
  const goalShutdownStore = useGoalShutdownStore(pinia);
  const timelineStore = useTimelineStore(pinia);
  const runtimeStore = useRuntimeStore(pinia);
  const debugTimelineStore = useDebugTimelineStore(pinia);
  const bridge = createEventBridge();
  // 思考状态定时器映射
  const thinkingGapTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const thinkingSettleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const contextCompactionSettleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Turn ID 到 Thread ID 的映射
  const threadIdByTurnId = new Map<string, string>();
  // 已警告的路由键集合
  const routingWarned = new Set<string>();
  // 推理 Item ID 映射
  const reasoningItemIdByTurnKey = new Map<string, string>();
  // 推理摘要事件 ID 映射
  const reasoningSummaryEventIdByKey = new Map<string, string>();
  const commandExecutionByProcessId = new Map<
    string,
    { threadId: string; turnId: string; itemId: string; item: CommandExecutionThreadItem }
  >();
  const agentMessagePhaseByKey = new Map<string, AgentMessagePhase>();

  // 旁路日志：把关键协议事件落盘到 ~/.codex/logs，便于排查"历史回放缺少文件修改"等问题。
  // 注意：此日志不是 UI 的真数据源，只作为回放/诊断兜底。
  const appendAuxJsonlLog = (record: unknown) => {
    try {
      void codexDesktop.app.appendFileChangeLog({ record });
    } catch {}
  };

  // 生成思考事件 ID
  const toThinkingEventId = (threadId: string, turnId: string) => `local:thinking:${threadId}:${turnId}`;
  // 生成思考回合键
  const toThinkingTurnKey = (threadId: string, turnId: string) => `${threadId}:${turnId}`;
  // 生成上下文压缩事件 ID
  const toContextCompactionEventId = (threadId: string, turnId: string) =>
    `local:contextCompaction:${threadId}:${turnId}`;
  // 生成推理回合键
  const toReasoningTurnKey = (threadId: string, turnId: string) => `${threadId}:${turnId}`;
  // 生成推理摘要键
  const toReasoningSummaryKey = (threadId: string, turnId: string, itemId: string, summaryIndex: number) =>
    `${threadId}:${turnId}:${itemId}:${summaryIndex}`;
  const toAgentMessageKey = (threadId: string, turnId: string, itemId: string) =>
    `${threadId || "__app__"}:${turnId || "unknown"}:${itemId || "unknown"}`;

  const normalizeAgentMessagePhase = (value: unknown): AgentMessagePhase | "" => {
    const phase = String(value ?? "").trim();
    return phase === "commentary" || phase === "final_answer" ? phase : "";
  };

  const rememberAgentMessagePhase = (params: { threadId: string; turnId: string; itemId: string; phase: unknown }) => {
    const phase = normalizeAgentMessagePhase(params.phase);
    const itemId = String(params.itemId ?? "").trim();
    if (!phase || !itemId) return "";
    agentMessagePhaseByKey.set(toAgentMessageKey(params.threadId, params.turnId, itemId), phase);
    return phase;
  };

  const resolveAgentMessagePhase = (params: {
    threadId: string;
    turnId: string;
    itemId: string;
    phase?: unknown;
  }): AgentMessagePhase | "" => {
    const explicit = normalizeAgentMessagePhase(params.phase);
    if (explicit) return explicit;
    const itemId = String(params.itemId ?? "").trim();
    if (!itemId) return "";
    return agentMessagePhaseByKey.get(toAgentMessageKey(params.threadId, params.turnId, itemId)) ?? "";
  };

  const withAgentMessagePhase = <T extends Record<string, unknown>>(
    params: T,
    itemId: string,
    phase: AgentMessagePhase | ""
  ) => {
    if (!phase) return params;
    return {
      ...params,
      item: {
        type: "agentMessage",
        id: itemId,
        phase,
      },
    };
  };

  const rememberCommandExecutionProcess = (params: {
    threadId: string;
    turnId: string;
    itemId: string;
    item: ThreadItem | null;
  }) => {
    const item = params.item;
    if (item?.type !== "commandExecution") return;
    const processId = String(item.processId ?? "").trim();
    const threadId = String(params.threadId ?? "").trim();
    const turnId = String(params.turnId ?? "").trim();
    const itemId = String(params.itemId ?? item.id ?? "").trim();
    if (!processId || !threadId || !turnId || !itemId) return;
    commandExecutionByProcessId.set(processId, { threadId, turnId, itemId, item });
  };

  // 清除指定键的定时器
  const clearTimer = (timers: Map<string, ReturnType<typeof setTimeout>>, key: string) => {
    const timer = timers.get(key);
    if (timer) {
      clearTimeout(timer);
      timers.delete(key);
    }
  };

  const clearThreadPreparingEvent = (threadIdValue: string) => {
    const threadId = String(threadIdValue ?? "").trim();
    if (!threadId || threadId === "__app__") return;
    timelineStore.removeEvent({ threadId, id: THREAD_PREPARING_EVENT_ID });
  };

  // 更新或插入上下文压缩提示事件
  const upsertContextCompactionPromptEvent = (params: {
    threadId: string;
    turnId: string;
    phase: "started" | "completed";
  }) => {
    const threadId = String(params.threadId ?? "").trim();
    const turnId = String(params.turnId ?? "").trim();
    if (!threadId || !turnId || threadId === "__app__") return;

    const key = `${threadId}:${turnId}`;
    clearTimer(contextCompactionSettleTimers, key);

    const text =
      params.phase === "started"
        ? translate("runtime.contextCompactionStarted")
        : translate("runtime.contextCompactionCompleted");
    const eventId = toContextCompactionEventId(threadId, turnId);
    timelineStore.upsertEvent({
      threadId,
      id: eventId,
      method: "local/contextCompaction",
      paramsText: text,
      params: { phase: params.phase },
      turnId,
      level: "info",
      hidden: true,
    });

    // completed 只作为短暂提示，避免一直占据底部提示条区域。
    if (params.phase === "completed") {
      const timer = setTimeout(() => {
        contextCompactionSettleTimers.delete(key);
        timelineStore.removeEvent({ threadId, id: eventId });
      }, CONTEXT_COMPACTION_SETTLE_MS);
      contextCompactionSettleTimers.set(key, timer);
    }
  };

  // 清除思考回合的定时器
  const clearThinkingTurnTimers = (threadId: string, turnId: string) => {
    const key = toThinkingTurnKey(threadId, turnId);
    clearTimer(thinkingGapTimers, key);
    clearTimer(thinkingSettleTimers, key);
  };

  // 更新或插入思考状态事件
  const upsertThinkingEvent = (params: {
    threadId: string;
    turnId: string;
    phase: ThinkingPhase;
    hidden?: boolean;
    level?: "info" | "warn" | "error";
  }) => {
    const threadId = String(params.threadId ?? "").trim();
    const turnId = String(params.turnId ?? "").trim();
    if (!threadId || !turnId || threadId === "__app__") return;
    timelineStore.upsertEvent({
      threadId,
      id: toThinkingEventId(threadId, turnId),
      method: "local/thinking",
      paramsText: translate(THINKING_PHASE_BODY_KEY[params.phase]),
      params: { phase: params.phase },
      turnId,
      level: params.level ?? (params.phase === "failed" ? "error" : "info"),
      localKind: "thinking",
      thinkingPhase: params.phase,
      hidden: Boolean(params.hidden),
    });
  };

  // 调度"等待继续输出"的思考状态
  const scheduleWaitingMoreThinking = (threadId: string, turnId: string) => {
    if (!threadId || !turnId || threadId === "__app__") return;
    const key = toThinkingTurnKey(threadId, turnId);
    clearTimer(thinkingGapTimers, key);
    const timer = setTimeout(() => {
      thinkingGapTimers.delete(key);
      const isRunning = threadStore.runningThreadIds.has(threadId);
      if (!isRunning) return;
      const activeTurnId = threadStore.activeTurnIdByThread.get(threadId);
      if (activeTurnId && activeTurnId !== turnId) return;
      upsertThinkingEvent({ threadId, turnId, phase: "waiting_more", hidden: false });
    }, THINKING_GAP_MS);
    thinkingGapTimers.set(key, timer);
  };

  // 检查是否为当前运行的回合
  const isCurrentRunningTurn = (threadId: string, turnId: string) => {
    if (!threadId || !turnId || threadId === "__app__") return false;
    if (!threadStore.runningThreadIds.has(threadId)) return false;
    const activeTurnId = resolveId(threadStore.activeTurnIdByThread.get(threadId));
    return !activeTurnId || activeTurnId === turnId;
  };

  // 标记思考状态为流式输出中
  const markThinkingOutputStreaming = (threadId: string, turnId: string) => {
    if (!isCurrentRunningTurn(threadId, turnId)) return;
    const key = toThinkingTurnKey(threadId, turnId);
    clearTimer(thinkingSettleTimers, key);
    upsertThinkingEvent({ threadId, turnId, phase: "streaming", hidden: true });
    scheduleWaitingMoreThinking(threadId, turnId);
  };

  // 完成思考事件
  const completeThinkingEvent = (params: { threadId: string; turnId: string; failed: boolean }) => {
    const threadId = String(params.threadId ?? "").trim();
    const turnId = String(params.turnId ?? "").trim();
    if (!threadId || !turnId || threadId === "__app__") return;
    const key = toThinkingTurnKey(threadId, turnId);
    clearThinkingTurnTimers(threadId, turnId);
    upsertThinkingEvent({
      threadId,
      turnId,
      phase: params.failed ? "failed" : "completed",
      hidden: false,
      level: params.failed ? "error" : "info",
    });
    const settleTimer = setTimeout(() => {
      thinkingSettleTimers.delete(key);
      timelineStore.removeEvent({ threadId, id: toThinkingEventId(threadId, turnId) });
    }, THINKING_SETTLE_MS);
    thinkingSettleTimers.set(key, settleTimer);
  };

  // 记住推理 Item ID
  const _rememberReasoningItemId = (params: { threadId: string; turnId: string; itemId: string }) => {
    const threadId = String(params.threadId ?? "").trim();
    const turnId = String(params.turnId ?? "").trim();
    const itemId = String(params.itemId ?? "").trim();
    if (!threadId || !turnId || !itemId) return;
    if (threadId === "__app__") return;
    reasoningItemIdByTurnKey.set(toReasoningTurnKey(threadId, turnId), itemId);
  };

  // 解析推理 Item ID
  const _resolveReasoningItemId = (params: { threadId: string; turnId: string; itemId: string }) => {
    const itemId = String(params.itemId ?? "").trim();
    if (itemId) return itemId;
    const threadId = String(params.threadId ?? "").trim();
    const turnId = String(params.turnId ?? "").trim();
    if (!threadId || !turnId) return "";
    return reasoningItemIdByTurnKey.get(toReasoningTurnKey(threadId, turnId)) ?? "";
  };

  // 解析推理摘要事件 ID
  const _resolveReasoningSummaryEventId = (params: {
    threadId: string;
    turnId: string;
    itemId: string;
    summaryIndex: number;
  }) => {
    const threadId = String(params.threadId ?? "").trim();
    const turnId = String(params.turnId ?? "").trim() || "unknown";
    const itemId = String(params.itemId ?? "").trim() || "unknown";
    const summaryIndex = Number.isFinite(params.summaryIndex) ? Math.max(0, Math.round(params.summaryIndex)) : 0;
    const summaryKey = toReasoningSummaryKey(threadId, turnId, itemId, summaryIndex);

    const existing = reasoningSummaryEventIdByKey.get(summaryKey);
    if (existing) return existing;

    const id = `notif:item/reasoning/summaryTextDelta:${threadId}:${turnId}:${itemId}:${summaryIndex}`;
    reasoningSummaryEventIdByKey.set(summaryKey, id);
    return id;
  };

  // 解析原始推理正文事件 ID
  const _resolveReasoningRawTextEventId = (params: {
    threadId: string;
    turnId: string;
    itemId: string;
    contentIndex: number;
  }) => {
    const threadId = String(params.threadId ?? "").trim();
    const turnId = String(params.turnId ?? "").trim() || "unknown";
    const itemId = String(params.itemId ?? "").trim() || "unknown";
    const contentIndex = Number.isFinite(params.contentIndex) ? Math.max(0, Math.round(params.contentIndex)) : 0;
    return `notif:item/reasoning/textDelta:${threadId}:${turnId}:${itemId}:${contentIndex}`;
  };

  // 生成回合键
  const toTurnKey = (serverId: string | undefined, turnId: string) =>
    `${String(serverId ?? "").trim() || "unknown"}:${turnId}`;

  // 绑定回合与线程的关系
  const bindTurnThread = (threadId: string, turnId: string, serverId?: string) => {
    const tid = String(threadId ?? "").trim();
    const turn = String(turnId ?? "").trim();
    if (!tid || !turn || tid === "__app__") return;
    threadIdByTurnId.set(toTurnKey(serverId, turn), tid);
  };

  // 警告未解析的路由
  // 警告未解析的路由
  const warnUnresolvedRouting = (params: { method: string; serverId?: string; turnId?: string }) => {
    const method = String(params.method ?? "").trim();
    if (!(method.startsWith("turn/") || method.startsWith("item/") || method.startsWith("thread/"))) return;
    const serverId = String(params.serverId ?? "").trim() || "unknown";
    const turnId = String(params.turnId ?? "").trim() || "none";
    const key = `${serverId}:${method}:${turnId}`;
    if (routingWarned.has(key)) return;
    routingWarned.add(key);
    timelineStore.appendEvent({
      threadId: "__app__",
      method: "routing:unresolvedThread",
      paramsText: `method=${method}\nserverId=${serverId}\nturnId=${turnId}`,
      level: "warn",
    });
  };

  // 订阅事件桥接器并处理通知
  const unsubscribe = bridge.subscribe((n) => {
    const params = n.params;
    const paramsRecord = toRecord(params);
    const lifecycleItem = getLifecycleItem(n);
    const lifecycleThreadId = isItemLifecycleNotification(n) ? n.params.threadId : undefined;
    const lifecycleTurnId = isItemLifecycleNotification(n) ? n.params.turnId : undefined;
    // 解析线程 ID 和回合 ID
    const rawThreadId = resolveId(n.threadId, lifecycleThreadId);
    const rawTurnId = resolveId(n.turnId, lifecycleTurnId);
    if (rawThreadId && rawTurnId) bindTurnThread(rawThreadId, rawTurnId, n.serverId);
    // 确定有效的线程 ID
    const effectiveThreadId =
      rawThreadId || (rawTurnId ? resolveId(threadIdByTurnId.get(toTurnKey(n.serverId, rawTurnId))) : "") || "__app__";
    if (effectiveThreadId === "__app__") {
      warnUnresolvedRouting({ method: n.method, serverId: n.serverId, turnId: rawTurnId });
    }
    // 获取当前活跃回合 ID
    const activeTurnId =
      effectiveThreadId && effectiveThreadId !== "__app__"
        ? resolveId(threadStore.activeTurnIdByThread.get(effectiveThreadId))
        : "";
    if ((n.method === "item/started" || n.method === "item/completed") && lifecycleItem?.type === "commandExecution") {
      const cmdTurnId = resolveId(lifecycleTurnId, rawTurnId, activeTurnId);
      const cmdItemId = resolveId(lifecycleItem.id, n.itemId);
      rememberCommandExecutionProcess({
        threadId: effectiveThreadId,
        turnId: cmdTurnId,
        itemId: cmdItemId,
        item: lifecycleItem,
      });
    }
    // Skills/MCP startup updates drive the integrations panel, not chat timeline content.
    if (n.method === "skills/changed" || n.method === "mcpServer/startupStatus/updated") {
      return;
    }
    const paramsText = toPrettyJson(params);

    if (n.method === "process/outputDelta") {
      const processHandle = String(n.params.processHandle ?? "").trim();
      const commandProcess = processHandle ? commandExecutionByProcessId.get(processHandle) : null;
      if (commandProcess) {
        const deltaText = decodeBase64Utf8(n.params.deltaBase64);
        const cmdEventId = `notif:item/commandExecution/outputDelta:${commandProcess.threadId}:${commandProcess.turnId || "unknown"}:${commandProcess.itemId || "unknown"}`;
        if (deltaText) {
          timelineStore.appendToEvent({
            threadId: commandProcess.threadId,
            id: cmdEventId,
            method: "item/commandExecution/outputDelta",
            chunk: deltaText,
            params: {
              threadId: commandProcess.threadId,
              turnId: commandProcess.turnId,
              itemId: commandProcess.itemId,
              delta: deltaText,
              item: commandProcess.item,
              processHandle,
              stream: n.params.stream,
              capReached: n.params.capReached,
            },
            turnId: commandProcess.turnId || undefined,
          });
        }
        return;
      }
    }

    if (n.method === "process/exited") {
      const processHandle = String(n.params.processHandle ?? "").trim();
      const commandProcess = processHandle ? commandExecutionByProcessId.get(processHandle) : null;
      if (commandProcess) {
        const finalOutput = [n.params.stdout, n.params.stderr].filter(Boolean).join("");
        const cmdEventId = `notif:item/commandExecution/outputDelta:${commandProcess.threadId}:${commandProcess.turnId || "unknown"}:${commandProcess.itemId || "unknown"}`;
        if (finalOutput) {
          timelineStore.appendToEvent({
            threadId: commandProcess.threadId,
            id: cmdEventId,
            method: "item/commandExecution/outputDelta",
            chunk: finalOutput,
            params: {
              threadId: commandProcess.threadId,
              turnId: commandProcess.turnId,
              itemId: commandProcess.itemId,
              delta: finalOutput,
              item: commandProcess.item,
              processHandle,
            },
            turnId: commandProcess.turnId || undefined,
          });
        }

        const exitCode = Number.isFinite(n.params.exitCode) ? Number(n.params.exitCode) : null;
        const completedItem: CommandExecutionThreadItem = {
          ...commandProcess.item,
          status: exitCode === 0 ? "completed" : "failed",
          exitCode,
        };
        timelineStore.upsertEvent({
          threadId: commandProcess.threadId,
          id: toCommandLifecycleEventId(
            "item/completed",
            commandProcess.threadId,
            commandProcess.turnId,
            commandProcess.itemId
          ),
          method: "item/completed",
          paramsText: toPrettyJson({
            threadId: commandProcess.threadId,
            turnId: commandProcess.turnId,
            item: completedItem,
          }),
          params: { threadId: commandProcess.threadId, turnId: commandProcess.turnId, item: completedItem },
          turnId: commandProcess.turnId || undefined,
        });
        commandExecutionByProcessId.delete(processHandle);
        return;
      }
    }

    if (n.method === "thread/goal/updated") {
      const params = n.params;
      const goalThreadId = resolveId(params.threadId, effectiveThreadId);
      const goalTurnId = resolveId(params.turnId, rawTurnId);
      if (goalThreadId && goalThreadId !== "__app__") {
        const previousGoal = threadStore.goalByThread.get(goalThreadId) ?? null;
        threadStore.setThreadGoal(goalThreadId, params.goal);
        goalShutdownStore.observeGoalTransition(previousGoal, threadStore.goalByThread.get(goalThreadId) ?? null);
      }
      if (runtimeStore.timelineDebugEnabled) {
        debugTimelineStore.appendEvent({
          threadId: goalThreadId || effectiveThreadId,
          method: n.method,
          paramsText,
          params,
          turnId: goalTurnId || undefined,
          hidden: true,
        });
      }
      return;
    }

    if (n.method === "thread/goal/cleared") {
      const params = n.params;
      const goalThreadId = resolveId(params.threadId, effectiveThreadId);
      if (goalThreadId && goalThreadId !== "__app__") {
        threadStore.clearThreadGoal(goalThreadId);
      }
      if (runtimeStore.timelineDebugEnabled) {
        debugTimelineStore.appendEvent({
          threadId: goalThreadId || effectiveThreadId,
          method: n.method,
          paramsText,
          params,
          turnId: rawTurnId || undefined,
          hidden: true,
        });
      }
      return;
    }

    if (HIDDEN_OFFICIAL_NOTIFICATION_METHODS.has(n.method)) {
      if (runtimeStore.timelineDebugEnabled) {
        debugTimelineStore.appendEvent({
          threadId: effectiveThreadId,
          method: n.method,
          paramsText,
          params,
          turnId: rawTurnId || undefined,
          hidden: true,
        });
      }
      return;
    }

    // 提取代理消息相关 ID
    const agentItemType = lifecycleItem?.type ?? "";
    const agentItemId = resolveId(lifecycleItem?.id, n.itemId);
    const agentTurnId = resolveId(lifecycleTurnId, n.turnId, rawTurnId, activeTurnId);
    const agentStreamEventId = `notif:item/agentMessage/delta:${effectiveThreadId}:${agentTurnId || "unknown"}:${agentItemId || "unknown"}`;
    const agentPhase =
      lifecycleItem?.type === "agentMessage"
        ? rememberAgentMessagePhase({
            threadId: effectiveThreadId,
            turnId: agentTurnId,
            itemId: agentItemId,
            phase: lifecycleItem.phase,
          })
        : resolveAgentMessagePhase({
            threadId: effectiveThreadId,
            turnId: agentTurnId,
            itemId: agentItemId,
            phase: paramsRecord.item && typeof paramsRecord.item === "object" ? (paramsRecord.item as any).phase : "",
          });
    // 提取推理相关 ID
    const reasoningItemType = lifecycleItem?.type ?? "";
    const reasoningItemId = resolveId(lifecycleItem?.id, n.itemId);
    const reasoningTurnId = resolveId(lifecycleTurnId, n.turnId, rawTurnId, activeTurnId);
    const reasoningSummaryIndexRaw =
      n.method === "item/reasoning/summaryPartAdded" || n.method === "item/reasoning/summaryTextDelta"
        ? n.params.summaryIndex
        : null;
    const reasoningSummaryIndex =
      reasoningSummaryIndexRaw == null ? 0 : Math.max(0, Math.round(reasoningSummaryIndexRaw));
    // 提取计划相关 ID
    const planItemId = resolveId(lifecycleItem?.id, n.itemId);
    const planTurnId = resolveId(lifecycleTurnId, n.turnId, rawTurnId, activeTurnId);
    const planThreadId = resolveId(n.threadId, effectiveThreadId);
    const userItemType = lifecycleItem?.type ?? "";
    const isFileChangeItem = lifecycleItem?.type === "fileChange";

    // 处理 Guardian 审批活动。该分支很低频，按需加载可避免首包拉入审批诊断格式化逻辑。
    if (isGuardianApprovalReviewMethodName(n.method)) {
      void (async () => {
        try {
          const { buildGuardianApprovalReviewActivity, buildGuardianApprovalReviewEventId } =
            await import("../../features/guardian/guardianApprovalReview");
          const guardianReviewActivity = buildGuardianApprovalReviewActivity(n.method, params);
          if (!guardianReviewActivity) return;
          const guardianThreadId = effectiveThreadId;
          const guardianTurnId = resolveId(paramsRecord.turnId, rawTurnId, activeTurnId);
          const guardianEventId = buildGuardianApprovalReviewEventId(
            guardianThreadId,
            guardianTurnId,
            guardianReviewActivity.reviewId
          );
          timelineStore.upsertEvent({
            threadId: guardianThreadId,
            id: guardianEventId,
            method: n.method,
            paramsText: guardianReviewActivity.summaryText,
            params,
            turnId: guardianTurnId || undefined,
            level: guardianReviewActivity.level,
          });
          appendAuxJsonlLog({
            ts: Date.now(),
            method: n.method,
            serverId: n.serverId,
            threadId: guardianThreadId,
            turnId: guardianTurnId || null,
            itemId: guardianReviewActivity.targetItemId,
            reviewId: guardianReviewActivity.reviewId,
            paramsText: guardianReviewActivity.summaryText,
            params,
          });
        } catch (error) {
          appendDebugLog("event-pipeline", "guardian-review-lazy-load-failed", {
            method: n.method,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();
      return;
    }

    // 处理文件变更项
    if ((n.method === "item/started" || n.method === "item/completed") && isFileChangeItem) {
      const lifecycleParams = n.params;
      const fileTurnId = resolveId(lifecycleParams.turnId, rawTurnId, activeTurnId);
      const fileItemId = resolveId(lifecycleItem?.id, n.itemId);
      appendAuxJsonlLog({
        ts: Date.now(),
        method: n.method,
        serverId: n.serverId,
        threadId: effectiveThreadId,
        turnId: fileTurnId || null,
        itemId: fileItemId || null,
        paramsText,
        params,
      });
      if (runtimeStore.timelineDebugEnabled) {
        debugTimelineStore.appendEvent({
          threadId: effectiveThreadId,
          method: n.method,
          paramsText,
          params,
          turnId: fileTurnId || undefined,
          hidden: true,
        });
      }
      // 不 return：仍让后续逻辑把该事件写入 timeline store。
    }

    if (n.method === "item/fileChange/patchUpdated") {
      const fileTurnId = resolveId(paramsRecord.turnId, rawTurnId, activeTurnId);
      const fileItemId = resolveId(paramsRecord.itemId, n.itemId);
      const changesCount = Array.isArray(paramsRecord.changes) ? paramsRecord.changes.length : 0;
      const debugParamsText = `patch updated: ${changesCount} files`;
      const patchEventId = `notif:item/fileChange/patchUpdated:${effectiveThreadId}:${fileTurnId || "unknown"}:${fileItemId || "unknown"}`;
      timelineStore.upsertEvent({
        threadId: effectiveThreadId,
        id: patchEventId,
        method: n.method,
        paramsText: debugParamsText,
        params,
        turnId: fileTurnId || undefined,
      });
      appendAuxJsonlLog({
        ts: Date.now(),
        method: n.method,
        serverId: n.serverId,
        threadId: effectiveThreadId,
        turnId: fileTurnId || null,
        itemId: fileItemId || null,
        paramsText: debugParamsText,
        params,
      });
      if (runtimeStore.timelineDebugEnabled) {
        debugTimelineStore.appendEvent({
          threadId: effectiveThreadId,
          method: n.method,
          paramsText: debugParamsText,
          params,
          turnId: fileTurnId || undefined,
          hidden: true,
        });
      }
      return;
    }

    if (n.method === "item/started" && userItemType === "userMessage") {
      return;
    }

    if (n.method === "item/completed" && userItemType === "userMessage") {
      return;
    }

    // 处理上下文压缩项
    if (
      (n.method === "item/started" || n.method === "item/completed") &&
      isContextCompactionThreadItem(lifecycleItem)
    ) {
      const lifecycleParams = n.params;
      const compactThreadId = resolveId(lifecycleParams.threadId, rawThreadId, effectiveThreadId) || effectiveThreadId;
      const compactTurnId = resolveId(lifecycleParams.turnId, rawTurnId, activeTurnId);
      if (compactThreadId && compactTurnId) bindTurnThread(compactThreadId, compactTurnId, n.serverId);
      if (compactThreadId && compactTurnId) {
        if (n.method === "item/started") {
          upsertContextCompactionPromptEvent({ threadId: compactThreadId, turnId: compactTurnId, phase: "started" });
          return;
        }
        upsertContextCompactionPromptEvent({ threadId: compactThreadId, turnId: compactTurnId, phase: "completed" });
        return;
      }
      // 若缺少 thread/turn 关键信息，则回退到通用追加逻辑以便排查协议问题。
    }

    // 处理代理消息开始事件
    if (n.method === "item/started" && agentItemType === "agentMessage") {
      if (effectiveThreadId !== "__app__" && agentTurnId) {
        upsertThinkingEvent({
          threadId: effectiveThreadId,
          turnId: agentTurnId,
          phase: "preparing",
          hidden: false,
        });
      }
      // agentMessage 走单条流式事件，started 标记会制造噪音，直接跳过。
      return;
    }

    if (n.method === "item/agentMessage/delta") {
      const params = n.params;
      const deltaText = params.delta;
      const timelineParams = withAgentMessagePhase(
        params as unknown as Record<string, unknown>,
        agentItemId,
        agentPhase
      );
      if (deltaText) {
        timelineStore.appendToEvent({
          threadId: effectiveThreadId,
          id: agentStreamEventId,
          method: "item/agentMessage/delta",
          chunk: deltaText,
          params: timelineParams,
          turnId: agentTurnId || undefined,
          hidden: false,
        });
      }
      if (runtimeStore.timelineDebugEnabled) {
        debugTimelineStore.appendEvent({
          threadId: effectiveThreadId,
          method: n.method,
          paramsText: deltaText || paramsText,
          params: timelineParams,
          turnId: agentTurnId || undefined,
          hidden: true,
        });
      }
      if (agentTurnId) markThinkingOutputStreaming(effectiveThreadId, agentTurnId);
      return;
    }

    if (n.method === "item/commandExecution/outputDelta") {
      const params = n.params;
      const cmdItemId = resolveId(params.itemId, n.itemId);
      const cmdTurnId = resolveId(params.turnId, rawTurnId, activeTurnId);
      const cmdDeltaText = params.delta;
      const cmdEventId = `notif:item/commandExecution/outputDelta:${effectiveThreadId}:${cmdTurnId || "unknown"}:${cmdItemId || "unknown"}`;
      const cmdParamsRecord = params as Record<string, any>;
      const sourceCmdItem =
        cmdParamsRecord.item && typeof cmdParamsRecord.item === "object"
          ? { ...(cmdParamsRecord.item as Record<string, any>) }
          : {};
      const cmdItem = {
        ...sourceCmdItem,
        ...(cmdItemId ? { id: cmdItemId } : {}),
        type: "commandExecution",
      };
      const cmdCommand = String((cmdItem as any).command ?? "").trim();
      if (!cmdCommand) {
        const firstCommand = String((cmdItem as any).commandActions?.[0]?.command ?? "").trim();
        if (firstCommand) {
          (cmdItem as any).command = firstCommand;
        }
      }
      if (!Array.isArray((cmdItem as any).commandActions) || (cmdItem as any).commandActions.length === 0) {
        const resolvedCommand = String((cmdItem as any).command ?? "").trim();
        if (resolvedCommand) {
          (cmdItem as any).commandActions = [{ command: resolvedCommand }];
        }
      }
      const cmdParams = {
        ...params,
        ...(cmdTurnId ? { turnId: cmdTurnId } : {}),
        ...(cmdItemId ? { itemId: cmdItemId } : {}),
        item: cmdItem,
      };

      if (cmdDeltaText) {
        timelineStore.appendToEvent({
          threadId: effectiveThreadId,
          id: cmdEventId,
          method: "item/commandExecution/outputDelta",
          chunk: cmdDeltaText,
          params: cmdParams,
          turnId: cmdTurnId || undefined,
        });
      } else {
        timelineStore.upsertEvent({
          threadId: effectiveThreadId,
          id: cmdEventId,
          method: "item/commandExecution/outputDelta",
          paramsText,
          params: cmdParams,
          turnId: cmdTurnId || undefined,
        });
      }
      return;
    }

    if ((n.method === "item/started" || n.method === "item/completed") && lifecycleItem?.type === "commandExecution") {
      const cmdTurnId = resolveId(lifecycleTurnId, rawTurnId, activeTurnId);
      const cmdItemId = resolveId(lifecycleItem?.id, n.itemId);
      const cmdEventId = toCommandLifecycleEventId(n.method, effectiveThreadId, cmdTurnId, cmdItemId);
      timelineStore.upsertEvent({
        threadId: effectiveThreadId,
        id: cmdEventId,
        method: n.method,
        paramsText,
        params,
        turnId: cmdTurnId || undefined,
      });
      return;
    }

    if (n.method === "item/completed" && userItemType === "plan") {
      const params = n.params;
      const finalText = params.item.type === "plan" ? String(params.item.text) : "";
      const planDeltaBufferId = planItemId || `turn:${planTurnId || "unknown"}`;
      const planStreamEventId = `notif:item/plan/delta:${planThreadId}:${planTurnId || "unknown"}:${planDeltaBufferId}`;
      if (planThreadId && planThreadId !== "__app__" && finalText) {
        timelineStore.upsertEvent({
          threadId: planThreadId,
          id: planStreamEventId,
          method: "item/plan/delta",
          paramsText: finalText,
          params,
          turnId: planTurnId || undefined,
          hidden: false,
        });
        if (planTurnId) markThinkingOutputStreaming(planThreadId, planTurnId);
      }
      // plan item completed 的文本是权威来源，用它覆盖累计 delta（delta 可能与最终文本不一致）。
      return;
    }

    if (n.method === "item/completed" && agentItemType === "agentMessage") {
      const params = n.params;
      const finalText = params.item.type === "agentMessage" ? params.item.text : "";
      if (finalText) {
        timelineStore.upsertEvent({
          threadId: effectiveThreadId,
          id: agentStreamEventId,
          method: "item/agentMessage/delta",
          paramsText: finalText,
          params,
          turnId: agentTurnId || undefined,
          hidden: false,
        });
        if (agentTurnId) markThinkingOutputStreaming(effectiveThreadId, agentTurnId);
      }
      // 若 completed 未携带文本，则保留已累计的 delta 内容。
      return;
    }

    if (n.method === "item/started" && reasoningItemType === "reasoning") {
      const params = n.params;
      if (effectiveThreadId !== "__app__" && reasoningTurnId) {
        const itemId = params.item.type === "reasoning" ? params.item.id : reasoningItemId;
        if (itemId) {
          _rememberReasoningItemId({ threadId: effectiveThreadId, turnId: reasoningTurnId, itemId });
        }
        upsertThinkingEvent({
          threadId: effectiveThreadId,
          turnId: reasoningTurnId,
          phase: "reasoning",
          hidden: false,
        });
      }
      // reasoning 摘要同样以单条流式行展示，隐藏 started 噪音。
      return;
    }

    if (n.method === "item/reasoning/summaryPartAdded") {
      const params = n.params;
      if (effectiveThreadId !== "__app__" && reasoningTurnId) {
        const itemId = resolveId(params.itemId, reasoningItemId);
        if (itemId) {
          _rememberReasoningItemId({ threadId: effectiveThreadId, turnId: reasoningTurnId, itemId });
        }
        upsertThinkingEvent({
          threadId: effectiveThreadId,
          turnId: reasoningTurnId,
          phase: "reasoning",
          hidden: false,
        });
      }
      // 该事件仅用于摘要分片索引控制，不单独渲染。
      return;
    }

    if (n.method === "item/reasoning/summaryTextDelta") {
      const params = n.params;
      const deltaText = params.delta;
      const resolvedItemId = _resolveReasoningItemId({
        threadId: effectiveThreadId,
        turnId: reasoningTurnId,
        itemId: reasoningItemId,
      });
      const effectiveItemId = resolvedItemId || reasoningItemId;
      if (effectiveThreadId !== "__app__" && reasoningTurnId && effectiveItemId) {
        _rememberReasoningItemId({ threadId: effectiveThreadId, turnId: reasoningTurnId, itemId: effectiveItemId });
      }
      const reasoningStreamEventId = _resolveReasoningSummaryEventId({
        threadId: effectiveThreadId,
        turnId: reasoningTurnId,
        itemId: effectiveItemId,
        summaryIndex: reasoningSummaryIndex,
      });
      const reasoningParams = {
        ...params,
        threadId: effectiveThreadId,
        turnId: reasoningTurnId || params.turnId,
        itemId: effectiveItemId,
        summaryIndex: reasoningSummaryIndex,
        item: { id: effectiveItemId, type: "reasoning" },
      };

      if (deltaText) {
        timelineStore.appendToEvent({
          threadId: effectiveThreadId,
          id: reasoningStreamEventId,
          method: "item/reasoning/summaryTextDelta",
          chunk: deltaText,
          params: reasoningParams,
          turnId: reasoningTurnId || undefined,
        });
        if (reasoningTurnId) markThinkingOutputStreaming(effectiveThreadId, reasoningTurnId);
      } else {
        timelineStore.upsertEvent({
          threadId: effectiveThreadId,
          id: reasoningStreamEventId,
          method: "item/reasoning/summaryTextDelta",
          paramsText,
          params: reasoningParams,
          turnId: reasoningTurnId || undefined,
        });
      }
      return;
    }

    if (n.method === "item/reasoning/textDelta") {
      const params = n.params;
      const deltaText = params.delta;
      const contentIndexRaw = toFiniteNumber(params.contentIndex);
      const contentIndex = contentIndexRaw == null ? 0 : Math.max(0, Math.round(contentIndexRaw));
      const resolvedItemId = _resolveReasoningItemId({
        threadId: effectiveThreadId,
        turnId: reasoningTurnId,
        itemId: reasoningItemId,
      });
      const effectiveItemId = resolvedItemId || reasoningItemId;
      if (effectiveThreadId !== "__app__" && reasoningTurnId) {
        const itemId = resolveId(params.itemId, effectiveItemId);
        if (itemId) {
          _rememberReasoningItemId({ threadId: effectiveThreadId, turnId: reasoningTurnId, itemId });
        }
        if (itemId) {
          const rawTextEventId = _resolveReasoningRawTextEventId({
            threadId: effectiveThreadId,
            turnId: reasoningTurnId,
            itemId,
            contentIndex,
          });
          const rawTextParams = {
            ...params,
            threadId: effectiveThreadId,
            turnId: reasoningTurnId || params.turnId,
            itemId,
            contentIndex,
            item: { id: itemId, type: "reasoning" },
          };
          if (deltaText) {
            timelineStore.appendToEvent({
              threadId: effectiveThreadId,
              id: rawTextEventId,
              method: "item/reasoning/textDelta",
              chunk: deltaText,
              params: rawTextParams,
              turnId: reasoningTurnId || undefined,
            });
          } else {
            timelineStore.upsertEvent({
              threadId: effectiveThreadId,
              id: rawTextEventId,
              method: "item/reasoning/textDelta",
              paramsText,
              params: rawTextParams,
              turnId: reasoningTurnId || undefined,
            });
          }
        }
        markThinkingOutputStreaming(effectiveThreadId, reasoningTurnId);
      }
      // raw reasoning 进入 render model 后会被合并进 reasoningBlock 的默认折叠区，不直接作为普通事件展示。
      return;
    }

    if (n.method === "item/completed" && reasoningItemType === "reasoning") {
      const params = n.params;
      const summaryTexts = params.item.type === "reasoning" ? toReasoningSummaryTexts(params.item.summary) : [];
      const rawContentTexts = params.item.type === "reasoning" ? toReasoningRawContentTexts(params.item.content) : [];
      if (summaryTexts.length === 0 && rawContentTexts.length === 0) return;
      const resolvedItemId = _resolveReasoningItemId({
        threadId: effectiveThreadId,
        turnId: reasoningTurnId,
        itemId: reasoningItemId,
      });
      const effectiveItemId = resolvedItemId || reasoningItemId;
      if (effectiveThreadId !== "__app__" && reasoningTurnId && effectiveItemId) {
        _rememberReasoningItemId({ threadId: effectiveThreadId, turnId: reasoningTurnId, itemId: effectiveItemId });
      }
      for (let i = 0; i < summaryTexts.length; i += 1) {
        const reasoningStreamEventId = _resolveReasoningSummaryEventId({
          threadId: effectiveThreadId,
          turnId: reasoningTurnId,
          itemId: effectiveItemId,
          summaryIndex: i,
        });
        const reasoningParams = {
          ...params,
          threadId: effectiveThreadId,
          turnId: reasoningTurnId || params.turnId,
          itemId: effectiveItemId,
          summaryIndex: i,
          item: { id: effectiveItemId, type: "reasoning" },
        };
        timelineStore.upsertEvent({
          threadId: effectiveThreadId,
          id: reasoningStreamEventId,
          method: "item/reasoning/summaryTextDelta",
          paramsText: summaryTexts[i],
          params: reasoningParams,
          turnId: reasoningTurnId || undefined,
        });
      }
      for (let i = 0; i < rawContentTexts.length; i += 1) {
        const rawTextEventId = _resolveReasoningRawTextEventId({
          threadId: effectiveThreadId,
          turnId: reasoningTurnId,
          itemId: effectiveItemId,
          contentIndex: i,
        });
        const rawTextParams = {
          ...params,
          threadId: effectiveThreadId,
          turnId: reasoningTurnId || params.turnId,
          itemId: effectiveItemId,
          contentIndex: i,
          item: { id: effectiveItemId, type: "reasoning" },
          final: true,
        };
        timelineStore.upsertEvent({
          threadId: effectiveThreadId,
          id: rawTextEventId,
          method: "item/reasoning/textDelta",
          paramsText: rawContentTexts[i],
          params: rawTextParams,
          turnId: reasoningTurnId || undefined,
        });
      }
      if (reasoningTurnId) markThinkingOutputStreaming(effectiveThreadId, reasoningTurnId);
      return;
    }

    if (n.method === "thread/started") {
      const params = n.params;
      const thread = params.thread;
      const threadId = String(thread.id ?? rawThreadId).trim();
      let attemptId = findThreadCreateAttemptIdByThreadId(threadId);
      if (!attemptId && threadId) {
        attemptId = findRecentPendingThreadCreateAttemptId();
        if (attemptId) bindThreadCreateAttemptToThread(attemptId, threadId);
      }
      appendDebugLog("thread.create", "thread/started notification", {
        attemptId: attemptId || null,
        threadId: threadId || null,
        cwd: String(thread.cwd ?? "").trim() || null,
        modelProvider: String(thread.modelProvider ?? "").trim() || null,
      });
      if (threadId) {
        const cwdText = String(thread.cwd ?? "").trim();
        const existingTitle = String(
          threadStore.threadHistory.find((item) => item.id === threadId)?.title ??
            threadStore.localThreads.find((item) => item.id === threadId)?.title ??
            ""
        ).trim();
        const historyMetadata = buildThreadHistoryMetadataFromServerThread(thread);
        const serverTitle = String(thread.name ?? thread.preview ?? "").trim();
        const createdAt = toEpochMs(thread.createdAt);
        const updatedAt = toEpochMs(thread.updatedAt) ?? Date.now();
        const nextThreadPatch = {
          id: threadId,
          title: resolveThreadTitle(threadId, serverTitle || existingTitle || `Thread ${threadId.slice(-8)}`),
          meta: cwdText || translate("runtime.noWorkspace"),
          cwd: cwdText || undefined,
          modelProvider: String(thread.modelProvider ?? "").trim() || undefined,
          ...historyMetadata,
          ...(createdAt ? { createdAt } : {}),
          updatedAt,
          running: false,
        };
        if (threadStore.hasLocalThread(threadId)) {
          threadStore.patchLocalThread(threadId, {
            ...nextThreadPatch,
            status: "ready",
          });
        } else {
          threadStore.upsertThreadHistory(nextThreadPatch);
        }
      }
      timelineStore.appendEvent({
        threadId: threadId || "__app__",
        method: n.method,
        paramsText,
        params,
        turnId: rawTurnId || undefined,
        hidden: true,
      });
      return;
    }

    if (n.method === "thread/status/changed") {
      const params = n.params;
      const statusThreadId = resolveId(params.threadId, effectiveThreadId);
      const statusRecord = toRecord(params.status);
      const statusType = String(statusRecord.type ?? "").trim();
      if (statusThreadId && statusThreadId !== "__app__") {
        if (runtimeStore.timelineDebugEnabled) {
          debugTimelineStore.appendEvent({
            threadId: statusThreadId,
            method: n.method,
            paramsText,
            params,
            turnId: rawTurnId || undefined,
            hidden: true,
          });
        }

        if (statusType !== "active") {
          clearThreadPreparingEvent(statusThreadId);
        }
      }
      // 该通知在新线程首轮完成后也可能到达；准备态由本地发送流程前置触发，这里只隐藏/记录 debug。
      return;
    }

    if (n.method === "turn/started") {
      const params = n.params;
      const startedTurnId = resolveId(params.turn.id, rawTurnId, activeTurnId);
      if (effectiveThreadId && effectiveThreadId !== "__app__") {
        clearThreadPreparingEvent(effectiveThreadId);
        const previousActiveTurnId = resolveId(threadStore.activeTurnIdByThread.get(effectiveThreadId));
        if (previousActiveTurnId && previousActiveTurnId !== startedTurnId) {
          clearThinkingTurnTimers(effectiveThreadId, previousActiveTurnId);
          timelineStore.removeEvent({
            threadId: effectiveThreadId,
            id: toThinkingEventId(effectiveThreadId, previousActiveTurnId),
          });
        }
        threadStore.setThreadRunning(effectiveThreadId, true);
        threadStore.setActiveTurn(effectiveThreadId, startedTurnId);
        if (startedTurnId) {
          bindTurnThread(effectiveThreadId, startedTurnId, n.serverId);
          threadStore.setTurnStartedAt(
            effectiveThreadId,
            startedTurnId,
            toEpochMs((params as any)?.turn?.startedAt) ?? Date.now()
          );

          // 将本地 user 输入事件补齐 turnId，避免 UI 将本回合拆成 loose 与 turn 两段。
          const events = timelineStore.eventsForThread(effectiveThreadId);
          for (let idx = events.length - 1; idx >= 0; idx -= 1) {
            const e = events[idx];
            if (!e) continue;
            if (e.localKind !== "user") continue;
            if (String(e.turnId ?? "").trim()) continue;
            const state = String(e.localState ?? "").trim();
            if (state && state !== "pending" && state !== "sending" && state !== "sent") continue;
            timelineStore.patchEvent({
              threadId: effectiveThreadId,
              id: e.id,
              patch: { turnId: startedTurnId },
            });
            break;
          }
          clearThinkingTurnTimers(effectiveThreadId, startedTurnId);
          upsertThinkingEvent({
            threadId: effectiveThreadId,
            turnId: startedTurnId,
            phase: "queued",
            hidden: false,
          });
        }
        appendAuxJsonlLog({
          ts: Date.now(),
          method: n.method,
          serverId: n.serverId,
          threadId: effectiveThreadId,
          turnId: startedTurnId || null,
          paramsText,
          params: {
            ...params,
            threadId: effectiveThreadId,
            turnId: startedTurnId || null,
            turn: { ...params.turn, id: startedTurnId || params.turn.id },
          },
        });
      }
      return;
    }

    if (n.method === "turn/completed") {
      const params = n.params;
      const completedTurnId = resolveId(params.turn.id, rawTurnId, activeTurnId);
      const err = params.turn.error ?? null;
      if (effectiveThreadId && effectiveThreadId !== "__app__") {
        clearThreadPreparingEvent(effectiveThreadId);
        threadStore.setThreadRunning(effectiveThreadId, false);
        threadStore.setActiveTurn(effectiveThreadId, "");
        if (completedTurnId) {
          bindTurnThread(effectiveThreadId, completedTurnId, n.serverId);
          threadStore.markTurnCompleted(
            effectiveThreadId,
            completedTurnId,
            toEpochMs(params.turn.completedAt),
            toFiniteNumber(params.turn.durationMs)
          );
        }
        if (completedTurnId) {
          completeThinkingEvent({
            threadId: effectiveThreadId,
            turnId: completedTurnId,
            failed: Boolean(err),
          });
          reasoningItemIdByTurnKey.delete(toReasoningTurnKey(effectiveThreadId, completedTurnId));
          const keyPrefix = `${effectiveThreadId}:${completedTurnId}:`;
          for (const key of reasoningSummaryEventIdByKey.keys()) {
            if (key.startsWith(keyPrefix)) reasoningSummaryEventIdByKey.delete(key);
          }
        }
        appendAuxJsonlLog({
          ts: Date.now(),
          method: n.method,
          serverId: n.serverId,
          threadId: effectiveThreadId,
          turnId: completedTurnId || null,
          paramsText,
          params: {
            ...params,
            threadId: effectiveThreadId,
            turnId: completedTurnId || null,
            turn: { ...params.turn, id: completedTurnId || params.turn.id },
          },
        });

        // 只保留最近 N 轮对话，旧 turn 从 timelineStore 中裁掉（不做虚拟列表）。
        pruneTimelineToRecentTurns(timelineStore, effectiveThreadId, TIMELINE_MAX_VISIBLE_TURNS);
      }

      // 线程结束提示音（全局配置，所有线程 turn/completed 均触发）。
      void playConfiguredNotificationSoundOnceLazy();
      return;
    }

    if (n.method === "turn/diff/updated") {
      const params = n.params;
      const diffTurnId = String(params.turnId ?? rawTurnId ?? "").trim();
      const diffText = params.diff || paramsText;
      if (effectiveThreadId !== "__app__" && diffTurnId) {
        bindTurnThread(effectiveThreadId, diffTurnId, n.serverId);
        threadStore.setTurnDiff(effectiveThreadId, diffTurnId, diffText);
      }
      appendAuxJsonlLog({
        ts: Date.now(),
        method: n.method,
        serverId: n.serverId,
        threadId: effectiveThreadId,
        turnId: diffTurnId || null,
        chunk: diffText || null,
        paramsText,
        params,
      });
      // turn diff 快照用于回滚/侧边栏摘要，不进入时间线 UI（避免大段 diff 混入时间线/调试 overlay）。
      return;
    }

    if (n.method === "item/plan/delta") {
      const params = n.params;
      const deltaText = params.delta;
      const planDeltaBufferId = planItemId || `turn:${planTurnId || "unknown"}`;
      const planStreamEventId = `notif:item/plan/delta:${planThreadId}:${planTurnId || "unknown"}:${planDeltaBufferId}`;
      if (planThreadId && planThreadId !== "__app__" && deltaText) {
        timelineStore.appendToEvent({
          threadId: planThreadId,
          id: planStreamEventId,
          method: "item/plan/delta",
          chunk: deltaText,
          params,
          turnId: planTurnId || undefined,
          hidden: false,
        });
        if (planTurnId) markThinkingOutputStreaming(planThreadId, planTurnId);
      } else if (planThreadId && planThreadId !== "__app__") {
        timelineStore.upsertEvent({
          threadId: planThreadId,
          id: planStreamEventId,
          method: "item/plan/delta",
          paramsText,
          params,
          turnId: planTurnId || undefined,
          hidden: false,
        });
      }
      // plan 增量按时间线流式事件聚合，并用于计划区预览。
      return;
    }

    if (n.method === "turn/plan/updated") {
      const params = n.params;
      const planThreadId = String(params.threadId ?? effectiveThreadId).trim();
      const planTurnId = String(params.turnId ?? rawTurnId ?? "").trim();
      const explanation = params.explanation;
      if (planThreadId && planTurnId) {
        bindTurnThread(planThreadId, planTurnId, n.serverId);
        threadStore.setTurnPlan(planThreadId, planTurnId, explanation, normalizePlanItems(params.plan));
      }
      if (runtimeStore.timelineDebugEnabled && planThreadId) {
        debugTimelineStore.appendEvent({
          threadId: planThreadId,
          method: n.method,
          paramsText,
          params,
          turnId: planTurnId || undefined,
          hidden: true,
        });
      }
      // 计划更新写入摘要区，默认隐藏主时间线条目。
      return;
    }

    if (n.method === "thread/tokenUsage/updated") {
      const params = n.params;
      const tokenUsage = toThreadTokenUsage(params.tokenUsage);
      const usageTurnId = resolveId((params as any)?.turnId, rawTurnId, activeTurnId);
      if (effectiveThreadId && effectiveThreadId !== "__app__") {
        threadStore.setTokenUsage(effectiveThreadId, tokenUsage);
        if (usageTurnId) {
          threadStore.setTurnTokenUsage(effectiveThreadId, usageTurnId, tokenUsage);
        }
      }
      if (effectiveThreadId && effectiveThreadId !== "__app__") {
        appendAuxJsonlLog({
          ts: Date.now(),
          method: n.method,
          serverId: n.serverId,
          threadId: effectiveThreadId,
          turnId: usageTurnId || null,
          paramsText: safeJsonStringify(
            { threadId: effectiveThreadId, turnId: usageTurnId || null, tokenUsage },
            { space: 2 }
          ),
          params: { threadId: effectiveThreadId, turnId: usageTurnId || null, tokenUsage },
        });
        if (runtimeStore.timelineDebugEnabled) {
          debugTimelineStore.appendEvent({
            threadId: effectiveThreadId,
            method: n.method,
            paramsText: safeJsonStringify(
              { threadId: effectiveThreadId, turnId: usageTurnId || null, tokenUsage },
              { space: 2 }
            ),
            params: { threadId: effectiveThreadId, turnId: usageTurnId || null, tokenUsage },
            turnId: usageTurnId || undefined,
            hidden: true,
          });
        }
      }
      // tokenUsage 用于上下文指标面板，不进入时间线主流。
      return;
    }

    if (n.method === "warning" || n.method === "guardianWarning" || n.method === "model/verification") {
      const noticeText = buildProtocolNoticeTimelineText(n.method, n.params);
      showToast(buildProtocolNoticeToast({ method: n.method, params: n.params }));
      timelineStore.appendEvent({
        threadId: effectiveThreadId,
        method: n.method,
        paramsText: noticeText,
        params: n.params,
        turnId: rawTurnId || undefined,
        level: n.method === "model/verification" ? "info" : "warn",
      });
      return;
    }

    if (n.method === "account/rateLimits/updated") {
      const params = n.params;
      const rateLimits = params.rateLimits;
      if (runtimeStore.timelineDebugEnabled) {
        debugTimelineStore.appendEvent({
          threadId: effectiveThreadId,
          method: n.method,
          paramsText: safeJsonStringify(
            { threadId: effectiveThreadId, turnId: rawTurnId || null, rateLimits: rateLimits ?? params ?? null },
            { space: 2 }
          ),
          params: { threadId: effectiveThreadId, turnId: rawTurnId || null, rateLimits: rateLimits ?? params ?? null },
          turnId: rawTurnId || undefined,
          hidden: true,
        });
      }
      // 速率限制变更属于诊断信息，默认不对用户展示。
      return;
    }

    if (n.method === "error") {
      const params = n.params;
      const errorTurnId = resolveId(params.turnId, rawTurnId, activeTurnId);
      if (effectiveThreadId && effectiveThreadId !== "__app__") {
        clearThreadPreparingEvent(effectiveThreadId);
      }
      if (effectiveThreadId && effectiveThreadId !== "__app__" && errorTurnId) {
        bindTurnThread(effectiveThreadId, errorTurnId, n.serverId);
        completeThinkingEvent({
          threadId: effectiveThreadId,
          turnId: errorTurnId,
          failed: true,
        });
      }
    }

    const level = n.method === "error" ? "error" : "info";
    timelineStore.appendEvent({
      threadId: effectiveThreadId,
      method: n.method,
      paramsText,
      params,
      turnId: rawTurnId || undefined,
      level,
    });
  });

  bridge.start();
  return () => {
    for (const timer of thinkingGapTimers.values()) clearTimeout(timer);
    thinkingGapTimers.clear();
    for (const timer of thinkingSettleTimers.values()) clearTimeout(timer);
    thinkingSettleTimers.clear();
    for (const timer of contextCompactionSettleTimers.values()) clearTimeout(timer);
    contextCompactionSettleTimers.clear();
    reasoningItemIdByTurnKey.clear();
    reasoningSummaryEventIdByKey.clear();
    commandExecutionByProcessId.clear();
    agentMessagePhaseByKey.clear();
    threadIdByTurnId.clear();
    routingWarned.clear();
    unsubscribe();
    bridge.stop();
  };
}
