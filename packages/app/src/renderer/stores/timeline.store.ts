// 时间线 Store：管理对话/事件时间线数据、加载状态与 UI 定位等。
import { defineStore } from "pinia";
import type { TimelineEventItem, TimelineEventLevel } from "../domain/types";
import { resolveStreamFlushPlan } from "./timelineFlushPolicy";

const MAX_EVENT_PARAMS_CHARS = 60_000;
const COMMAND_OUTPUT_MAX_CHARS = 20_000;
const COMMAND_OUTPUT_MAX_LINES = 500;

type PendingAppend = {
  threadId: string;
  id: string;
  method: string;
  chunk: string;
  params?: unknown;
  turnId?: string;
  level?: TimelineEventLevel;
  localKind?: TimelineEventItem["localKind"];
  localState?: TimelineEventItem["localState"];
  thinkingPhase?: TimelineEventItem["thinkingPhase"];
  localMessageId?: string;
  hidden?: boolean;
  createdAt?: number;
};

const pendingAppendsByKey = new Map<string, PendingAppend>();
let flushScheduled = false;
let scheduledFlushRafId: number | null = null;
let scheduledFlushTimeoutId: ReturnType<typeof setTimeout> | null = null;
let scheduledFlushRunner: (() => void) | null = null;
let visibilityFlushBound = false;

type ThreadTimelineState = {
  order: string[];
  renderEvents: TimelineEventItem[];
  renderIndexById: Map<string, number>;
  eventsById: Map<string, TimelineEventItem>;
  byTurnId: Map<string, Set<string>>;
  contentRevision: number;
  structureRevision: number;
};

export type TimelineThreadStats = {
  eventCount: number;
  renderEventCount: number;
  turnCount: number;
  renderTurnCount: number;
  contentRevision: number;
  structureRevision: number;
};

const EMPTY_TIMELINE_EVENTS: TimelineEventItem[] = [];

function isCommandOutputMethod(method: unknown): boolean {
  const normalized = String(method ?? "").trim();
  return normalized === "command/exec/outputDelta" || normalized === "item/commandExecution/outputDelta";
}

function trimCommandOutputText(text: string): string {
  let next = text;
  if (next.length > COMMAND_OUTPUT_MAX_CHARS) next = next.slice(next.length - COMMAND_OUTPUT_MAX_CHARS);
  const lines = next.split(/\r?\n/);
  if (lines.length > COMMAND_OUTPUT_MAX_LINES) next = lines.slice(lines.length - COMMAND_OUTPUT_MAX_LINES).join("\n");
  return next;
}

// 控制 paramsText 上限，避免大 payload 挤爆内存与渲染。
function trimEventParamsText(text: string, method?: unknown): string {
  const normalized = String(text ?? "");
  if (isCommandOutputMethod(method)) return trimCommandOutputText(normalized);
  if (normalized.length <= MAX_EVENT_PARAMS_CHARS) return normalized;
  return normalized.slice(normalized.length - MAX_EVENT_PARAMS_CHARS);
}

// 统一线程 key：空值落到应用级线程。
function ensureThreadId(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || "__app__";
}

// 若调用方未传事件 id，则生成一个线程内唯一 id。
function ensureEventId(threadId: string, id: unknown): string {
  const text = String(id ?? "").trim();
  if (text) return text;
  return `${threadId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function canUseAnimationFrame(): boolean {
  return typeof (globalThis as any).requestAnimationFrame === "function";
}

function isStreamFlushHidden(): boolean {
  try {
    return typeof document !== "undefined" && document.visibilityState === "hidden";
  } catch {
    return false;
  }
}

function cancelScheduledFlush() {
  if (scheduledFlushRafId != null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(scheduledFlushRafId);
  }
  if (scheduledFlushTimeoutId != null) clearTimeout(scheduledFlushTimeoutId);
  scheduledFlushRafId = null;
  scheduledFlushTimeoutId = null;
}

// 窗口重新可见时立即补一次，避免后台降频漏掉最后一帧。
function bindVisibilityFlush() {
  if (visibilityFlushBound) return;
  if (typeof document === "undefined" || typeof document.addEventListener !== "function") return;
  visibilityFlushBound = true;
  document.addEventListener("visibilitychange", () => {
    if (isStreamFlushHidden()) return;
    scheduledFlushRunner?.();
  });
}

function scheduleFlush(store: { flushPendingAppends: () => void }) {
  if (flushScheduled) return;
  flushScheduled = true;
  const runner = () => {
    if (!flushScheduled) return;
    flushScheduled = false;
    scheduledFlushRunner = null;
    cancelScheduledFlush();
    store.flushPendingAppends();
  };
  scheduledFlushRunner = runner;
  bindVisibilityFlush();
  const plan = resolveStreamFlushPlan({ hidden: isStreamFlushHidden(), rafAvailable: canUseAnimationFrame() });
  if (plan.useRaf) {
    scheduledFlushRafId = (globalThis as any).requestAnimationFrame(runner);
  }
  scheduledFlushTimeoutId = setTimeout(runner, plan.delayMs);
}

function createEmptyThreadState(): ThreadTimelineState {
  return {
    order: [],
    renderEvents: [],
    renderIndexById: new Map<string, number>(),
    eventsById: new Map<string, TimelineEventItem>(),
    byTurnId: new Map<string, Set<string>>(),
    contentRevision: 0,
    structureRevision: 0,
  };
}

function touchThreadRevision(state: ThreadTimelineState, kind: "content" | "structure" = "structure") {
  if (kind === "structure") state.structureRevision += 1;
  state.contentRevision += 1;
}

function rebuildRenderEventIndexes(state: ThreadTimelineState) {
  state.renderIndexById.clear();
  for (let index = 0; index < state.renderEvents.length; index += 1) {
    const event = state.renderEvents[index];
    if (!event) continue;
    state.renderIndexById.set(event.id, index);
  }
}

function pushRenderEvent(state: ThreadTimelineState, event: TimelineEventItem) {
  state.renderIndexById.set(event.id, state.renderEvents.length);
  state.renderEvents.push(event);
}

function replaceRenderEvent(state: ThreadTimelineState, event: TimelineEventItem) {
  const index = state.renderIndexById.get(event.id);
  if (index == null) {
    pushRenderEvent(state, event);
    return;
  }
  state.renderEvents[index] = event;
}

function removeRenderEvent(state: ThreadTimelineState, eventId: string) {
  const index = state.renderIndexById.get(eventId);
  if (index == null) return;
  state.renderEvents.splice(index, 1);
  state.renderIndexById.delete(eventId);
  rebuildRenderEventIndexes(state);
}

function addTurnIndex(state: ThreadTimelineState, turnIdValue: unknown, eventId: string) {
  const turnId = String(turnIdValue ?? "").trim();
  if (!turnId) return;
  const set = state.byTurnId.get(turnId) ?? new Set<string>();
  set.add(eventId);
  state.byTurnId.set(turnId, set);
}

function removeTurnIndex(state: ThreadTimelineState, turnIdValue: unknown, eventId: string) {
  const turnId = String(turnIdValue ?? "").trim();
  if (!turnId) return;
  const set = state.byTurnId.get(turnId);
  if (!set) return;
  set.delete(eventId);
  if (set.size === 0) state.byTurnId.delete(turnId);
}

export const useTimelineStore = defineStore("timeline", {
  state: () => ({
    threads: new Map<string, ThreadTimelineState>(),
  }),
  getters: {
    // 返回当前线程按时间顺序的可渲染事件列表。
    eventsForThread(state): (threadId: string) => TimelineEventItem[] {
      return (threadIdValue: string) => {
        const threadId = ensureThreadId(threadIdValue);
        const t = state.threads.get(threadId);
        if (!t) return EMPTY_TIMELINE_EVENTS;
        return t.renderEvents;
      };
    },
    threadContentRevisionForThread(state): (threadId: string) => number {
      return (threadIdValue: string) => {
        const threadId = ensureThreadId(threadIdValue);
        return state.threads.get(threadId)?.contentRevision ?? 0;
      };
    },
    threadStructureRevisionForThread(state): (threadId: string) => number {
      return (threadIdValue: string) => {
        const threadId = ensureThreadId(threadIdValue);
        return state.threads.get(threadId)?.structureRevision ?? 0;
      };
    },
    timelineStatsForThread(state): (threadId: string) => TimelineThreadStats {
      return (threadIdValue: string) => {
        const threadId = ensureThreadId(threadIdValue);
        const t = state.threads.get(threadId);
        if (!t) {
          return {
            eventCount: 0,
            renderEventCount: 0,
            turnCount: 0,
            renderTurnCount: 0,
            contentRevision: 0,
            structureRevision: 0,
          };
        }
        const renderTurnIds = new Set<string>();
        for (const event of t.renderEvents) {
          const turnId = String(event.turnId ?? "").trim();
          if (turnId) renderTurnIds.add(turnId);
        }
        return {
          eventCount: t.eventsById.size,
          renderEventCount: t.renderEvents.length,
          turnCount: t.byTurnId.size,
          renderTurnCount: renderTurnIds.size,
          contentRevision: t.contentRevision,
          structureRevision: t.structureRevision,
        };
      };
    },
  },
  actions: {
    // flush 高频流式 chunk，避免每个 delta 都触发一次响应式更新。
    flushPendingAppends() {
      if (pendingAppendsByKey.size === 0) return;
      const entries = Array.from(pendingAppendsByKey.values());
      pendingAppendsByKey.clear();
      const changedThreads = new Map<string, "content" | "structure">();

      for (const params of entries) {
        const chunk = String(params.chunk ?? "");
        if (!chunk) continue;
        const threadId = ensureThreadId(params.threadId);
        const state = this.ensureThread(threadId);
        const id = ensureEventId(threadId, params.id);
        const existing = state.eventsById.get(id) ?? null;

        const createdAt =
          existing?.createdAt ?? (Number.isFinite(params.createdAt) ? Number(params.createdAt) : Date.now());
        const nextTurnId = params.turnId ?? existing?.turnId;
        if (existing?.turnId !== nextTurnId) {
          removeTurnIndex(state, existing?.turnId, id);
          addTurnIndex(state, nextTurnId, id);
        }

        const next: TimelineEventItem = {
          id,
          method: String(params.method ?? existing?.method ?? ""),
          paramsText: trimEventParamsText(`${existing?.paramsText ?? ""}${chunk}`, params.method ?? existing?.method),
          params: params.params ?? existing?.params,
          createdAt,
          threadId,
          turnId: nextTurnId,
          level: params.level ?? existing?.level ?? "info",
          localKind: params.localKind ?? existing?.localKind,
          localState: params.localState ?? existing?.localState,
          thinkingPhase: params.thinkingPhase ?? existing?.thinkingPhase,
          localMessageId: params.localMessageId ?? existing?.localMessageId,
          hidden: params.hidden ?? existing?.hidden,
        };

        state.eventsById.set(id, next);
        const changeKind = existing ? "content" : "structure";
        if (!existing) {
          state.order.push(id);
          pushRenderEvent(state, next);
        } else {
          replaceRenderEvent(state, next);
        }
        const previousKind = changedThreads.get(threadId);
        changedThreads.set(threadId, previousKind === "structure" ? "structure" : changeKind);
      }

      for (const [threadId, kind] of changedThreads) {
        const state = this.threads.get(threadId);
        if (!state) continue;
        touchThreadRevision(state, kind);
      }
    },
    // 确保线程状态容器存在（惰性创建）。
    ensureThread(threadIdValue: string): ThreadTimelineState {
      const threadId = ensureThreadId(threadIdValue);
      const existing = this.threads.get(threadId);
      if (existing) return existing;
      const created = createEmptyThreadState();
      this.threads.set(threadId, created);
      return created;
    },
    // 新增一条事件（不检查是否已存在）。
    appendEvent(params: {
      threadId: string;
      method: string;
      paramsText: string;
      params?: unknown;
      turnId?: string;
      level?: TimelineEventLevel;
      id?: string;
      localKind?: TimelineEventItem["localKind"];
      localState?: TimelineEventItem["localState"];
      thinkingPhase?: TimelineEventItem["thinkingPhase"];
      localMessageId?: string;
      hidden?: boolean;
      createdAt?: number;
    }) {
      this.flushPendingAppends();
      const threadId = ensureThreadId(params.threadId);
      const state = this.ensureThread(threadId);
      const id = ensureEventId(threadId, params.id);
      const createdAt = Number.isFinite(params.createdAt) ? Number(params.createdAt) : Date.now();
      const event: TimelineEventItem = {
        id,
        method: String(params.method ?? ""),
        paramsText: trimEventParamsText(params.paramsText, params.method),
        params: params.params,
        createdAt,
        threadId,
        turnId: params.turnId,
        level: params.level ?? "info",
        localKind: params.localKind,
        localState: params.localState,
        thinkingPhase: params.thinkingPhase,
        localMessageId: params.localMessageId,
        hidden: params.hidden,
      };

      state.order.push(id);
      state.eventsById.set(id, event);
      pushRenderEvent(state, event);
      addTurnIndex(state, event.turnId, id);
      touchThreadRevision(state, "structure");
    },
    // 存在则更新，不存在则创建。
    upsertEvent(params: {
      threadId: string;
      id: string;
      method: string;
      paramsText: string;
      params?: unknown;
      turnId?: string;
      level?: TimelineEventLevel;
      localKind?: TimelineEventItem["localKind"];
      localState?: TimelineEventItem["localState"];
      thinkingPhase?: TimelineEventItem["thinkingPhase"];
      localMessageId?: string;
      hidden?: boolean;
      createdAt?: number;
    }) {
      this.flushPendingAppends();
      const threadId = ensureThreadId(params.threadId);
      const state = this.ensureThread(threadId);
      const id = ensureEventId(threadId, params.id);
      const existing = state.eventsById.get(id) ?? null;
      const createdAt =
        existing?.createdAt ?? (Number.isFinite(params.createdAt) ? Number(params.createdAt) : Date.now());
      const nextTurnId = params.turnId ?? existing?.turnId;
      if (existing?.turnId !== nextTurnId) {
        removeTurnIndex(state, existing?.turnId, id);
        addTurnIndex(state, nextTurnId, id);
      }

      const next: TimelineEventItem = {
        id,
        method: String(params.method ?? existing?.method ?? ""),
        paramsText: trimEventParamsText(params.paramsText, params.method ?? existing?.method),
        params: params.params ?? existing?.params,
        createdAt,
        threadId,
        turnId: nextTurnId,
        level: params.level ?? existing?.level ?? "info",
        localKind: params.localKind ?? existing?.localKind,
        localState: params.localState ?? existing?.localState,
        thinkingPhase: params.thinkingPhase ?? existing?.thinkingPhase,
        localMessageId: params.localMessageId ?? existing?.localMessageId,
        hidden: params.hidden ?? existing?.hidden,
      };

      state.eventsById.set(id, next);
      if (!existing) {
        state.order.push(id);
        pushRenderEvent(state, next);
      } else {
        replaceRenderEvent(state, next);
      }
      touchThreadRevision(state, existing ? "content" : "structure");
    },
    // 给流式事件追加文本 chunk（如 delta 增量）。
    appendToEvent(params: {
      threadId: string;
      id: string;
      method: string;
      chunk: string;
      params?: unknown;
      turnId?: string;
      level?: TimelineEventLevel;
      localKind?: TimelineEventItem["localKind"];
      localState?: TimelineEventItem["localState"];
      thinkingPhase?: TimelineEventItem["thinkingPhase"];
      localMessageId?: string;
      hidden?: boolean;
      createdAt?: number;
    }) {
      const chunk = String(params.chunk ?? "");
      if (!chunk) return;
      const threadId = ensureThreadId(params.threadId);
      const id = ensureEventId(threadId, params.id);
      const key = `${threadId}::${id}`;
      const existing = pendingAppendsByKey.get(key);
      if (existing) {
        existing.chunk = `${existing.chunk}${chunk}`;
        existing.method = String(params.method ?? existing.method);
        existing.params = params.params ?? existing.params;
        existing.turnId = params.turnId ?? existing.turnId;
        existing.level = params.level ?? existing.level;
        existing.localKind = params.localKind ?? existing.localKind;
        existing.localState = params.localState ?? existing.localState;
        existing.thinkingPhase = params.thinkingPhase ?? existing.thinkingPhase;
        existing.localMessageId = params.localMessageId ?? existing.localMessageId;
        existing.hidden = params.hidden ?? existing.hidden;
        existing.createdAt = params.createdAt ?? existing.createdAt;
      } else {
        pendingAppendsByKey.set(key, {
          threadId,
          id,
          method: String(params.method ?? ""),
          chunk,
          params: params.params,
          turnId: params.turnId,
          level: params.level,
          localKind: params.localKind,
          localState: params.localState,
          thinkingPhase: params.thinkingPhase,
          localMessageId: params.localMessageId,
          hidden: params.hidden,
          createdAt: params.createdAt,
        });
      }
      scheduleFlush(this);
    },
    // 对事件做局部字段补丁更新。
    patchEvent(params: {
      threadId: string;
      id: string;
      patch: Partial<
        Pick<
          TimelineEventItem,
          | "method"
          | "paramsText"
          | "params"
          | "turnId"
          | "level"
          | "localKind"
          | "localState"
          | "thinkingPhase"
          | "localMessageId"
          | "hidden"
        >
      >;
    }) {
      this.flushPendingAppends();
      const threadId = ensureThreadId(params.threadId);
      const state = this.threads.get(threadId);
      if (!state) return;
      const existing = state.eventsById.get(params.id);
      if (!existing) return;

      const patch = params.patch ?? {};
      const nextTurnId = patch.turnId ?? existing.turnId;
      if (existing.turnId !== nextTurnId) {
        removeTurnIndex(state, existing.turnId, existing.id);
        addTurnIndex(state, nextTurnId, existing.id);
      }

      const nextParamsText =
        typeof patch.paramsText === "string"
          ? trimEventParamsText(patch.paramsText, patch.method ?? existing.method)
          : existing.paramsText;
      const next = { ...existing, ...patch, turnId: nextTurnId, paramsText: nextParamsText };
      state.eventsById.set(existing.id, next);
      replaceRenderEvent(state, next);
      touchThreadRevision(state, "structure");
    },
    // 删除单个事件。
    removeEvent(params: { threadId: string; id: string }) {
      this.flushPendingAppends();
      const threadId = ensureThreadId(params.threadId);
      const state = this.threads.get(threadId);
      if (!state) return;
      const id = String(params.id ?? "").trim();
      if (!id) return;
      const existing = state.eventsById.get(id);
      if (existing) removeTurnIndex(state, existing.turnId, id);
      state.eventsById.delete(id);
      const idx = state.order.indexOf(id);
      if (idx >= 0) state.order.splice(idx, 1);
      removeRenderEvent(state, id);
      touchThreadRevision(state, "structure");
    },
    // 跨线程搬移事件（切会话时的本地补偿场景）。
    moveEvent(params: { fromThreadId: string; toThreadId: string; id: string }) {
      this.flushPendingAppends();
      const fromThreadId = ensureThreadId(params.fromThreadId);
      const toThreadId = ensureThreadId(params.toThreadId);
      const id = String(params.id ?? "").trim();
      if (!id || fromThreadId === toThreadId) return;

      const fromState = this.threads.get(fromThreadId);
      if (!fromState) return;
      const event = fromState.eventsById.get(id);
      if (!event) return;

      this.removeEvent({ threadId: fromThreadId, id });
      const toState = this.ensureThread(toThreadId);
      const moved: TimelineEventItem = { ...event, threadId: toThreadId };
      toState.order.push(id);
      toState.eventsById.set(id, moved);
      pushRenderEvent(toState, moved);
      addTurnIndex(toState, moved.turnId, id);
      touchThreadRevision(toState);
    },
    // 原子替换某线程的完整事件快照（用于历史回放/批量重建）。
    replaceThreadEvents(threadIdValue: string, events: TimelineEventItem[]) {
      this.flushPendingAppends();
      const threadId = ensureThreadId(threadIdValue);
      const incoming = Array.isArray(events) ? events : [];
      if (incoming.length === 0) {
        this.threads.delete(threadId);
        return;
      }

      const prevContentRevision = this.threads.get(threadId)?.contentRevision ?? 0;
      const prevStructureRevision = this.threads.get(threadId)?.structureRevision ?? 0;
      const nextState = createEmptyThreadState();
      nextState.contentRevision = prevContentRevision + 1;
      nextState.structureRevision = prevStructureRevision + 1;

      const seenIds = new Set<string>();
      for (const rawEvent of incoming) {
        const id = ensureEventId(threadId, rawEvent?.id);
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);

        const event: TimelineEventItem = {
          ...rawEvent,
          id,
          threadId,
          paramsText: trimEventParamsText(String(rawEvent?.paramsText ?? ""), rawEvent?.method),
          createdAt: Number.isFinite(rawEvent?.createdAt) ? Number(rawEvent.createdAt) : Date.now(),
          level: rawEvent?.level ?? "info",
        };

        nextState.order.push(id);
        nextState.eventsById.set(id, event);
        pushRenderEvent(nextState, event);
        addTurnIndex(nextState, event.turnId, id);
      }

      this.threads.set(threadId, nextState);
    },
    moveThread(fromThreadIdValue: string, toThreadIdValue: string) {
      this.flushPendingAppends();
      const fromThreadId = ensureThreadId(fromThreadIdValue);
      const toThreadId = ensureThreadId(toThreadIdValue);
      if (!fromThreadId || !toThreadId || fromThreadId === toThreadId) return;

      const fromState = this.threads.get(fromThreadId);
      if (!fromState) return;
      const toState = this.ensureThread(toThreadId);

      for (const id of fromState.order) {
        const event = fromState.eventsById.get(id);
        if (!event) continue;
        if (toState.eventsById.has(id)) continue;
        const moved: TimelineEventItem = { ...event, threadId: toThreadId };
        toState.order.push(id);
        toState.eventsById.set(id, moved);
        pushRenderEvent(toState, moved);
        addTurnIndex(toState, moved.turnId, id);
      }
      this.threads.delete(fromThreadId);
      touchThreadRevision(toState, "structure");
    },
    // 按 turn 批量删除事件（回滚时使用）。
    removeTurnEvents(threadIdValue: string, turnIds: string[]) {
      this.flushPendingAppends();
      const threadId = ensureThreadId(threadIdValue);
      const state = this.threads.get(threadId);
      if (!state) return;
      const targets = (turnIds ?? []).map((x) => String(x ?? "").trim()).filter(Boolean);
      if (targets.length === 0) return;
      const idsToRemove = new Set<string>();
      for (const tid of targets) {
        const set = state.byTurnId.get(tid);
        if (!set) continue;
        for (const id of set) idsToRemove.add(id);
      }
      if (idsToRemove.size === 0) return;
      state.order = state.order.filter((id) => !idsToRemove.has(id));
      for (const id of idsToRemove) {
        const e = state.eventsById.get(id);
        if (e) removeTurnIndex(state, e.turnId, id);
        state.eventsById.delete(id);
        state.renderIndexById.delete(id);
      }
      state.renderEvents = state.renderEvents.filter((event) => !idsToRemove.has(event.id));
      rebuildRenderEventIndexes(state);
      touchThreadRevision(state, "structure");
    },
    // 清空某个线程的全部事件状态。
    clearThread(threadIdValue: string) {
      this.flushPendingAppends();
      const threadId = ensureThreadId(threadIdValue);
      this.threads.delete(threadId);
    },
  },
});
