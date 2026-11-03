import { codexDesktop } from "../../api/codexDesktopClient";
import type { ReplayTimelineEvent } from "../../features/history/replayParsers";
import type { useRuntimeStore } from "../../stores/runtime.store";
import type { useThreadStore } from "../../stores/thread.store";
import type { useTimelineStore } from "../../stores/timeline.store";
import type { TimelineEventItem } from "../types";
import {
  buildCompletedTurnsFromReplay,
  countReplayTurns,
  dedupeReplayEvents,
  extractProposedPlanBody,
  hasOlderReplayHistory,
  isReplayCarryoverEvent,
  normalizePlanText,
  sortReplayEvents,
  splitReplayEventsByRecentTurns,
  stripProposedPlanTags,
  toPlanSignatureText,
  toPlanTurnKey,
  type ThreadReplayCache,
} from "./historyReplayRuntime";

type RuntimeStore = ReturnType<typeof useRuntimeStore>;
type ThreadStore = ReturnType<typeof useThreadStore>;
type TimelineStore = ReturnType<typeof useTimelineStore>;

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

export type ThreadReplayWindowState = {
  nextBefore: number;
  hasMorePages: boolean;
  bufferedOlderEvents: ThreadReplayCache;
};

type ReplayBatchResult = {
  loaded: number;
  hasMore: boolean;
  events: ReplayTimelineEvent[];
};

export type HistoryReplayWindowRuntimeDeps = {
  runtimeStore: RuntimeStore;
  threadStore: ThreadStore;
  timelineStore: TimelineStore;
  replayCacheByThread: Map<string, ThreadReplayCache>;
  replayWindowStateByThread: Map<string, ThreadReplayWindowState>;
  replayRequestSeqByThread: Map<string, number>;
  olderHistoryLoadPromiseByThread: Map<string, Promise<boolean>>;
  historyReplayBatch: number;
  historyReplayTurnSegments: number;
  timelineMaxVisibleTurns: number;
  translate: TranslateFn;
};

export type HistoryReplayWindowRuntime = {
  hydrateReplayFromCacheIfNeeded: (threadId: string) => boolean;
  loadHistoryMessages: (threadId: string, options?: { isCurrent?: () => boolean }) => Promise<boolean>;
  loadOlderHistoryTurns: (threadId?: string) => Promise<boolean>;
};

async function parseSessionReplayEventsLazy(
  entries: Parameters<(typeof import("../../features/history/replayParsers"))["parseSessionReplayEvents"]>[0],
  threadId: string,
  isCurrent: () => boolean = () => true
): Promise<ReplayTimelineEvent[]> {
  const { parseSessionReplayEvents } = await import("../../features/history/replayParsers");
  if (!isCurrent()) return [];
  return parseSessionReplayEvents(entries, threadId);
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error ?? "");
}

export function createHistoryReplayWindowRuntime(deps: HistoryReplayWindowRuntimeDeps): HistoryReplayWindowRuntime {
  const {
    runtimeStore,
    threadStore,
    timelineStore,
    replayCacheByThread,
    replayWindowStateByThread,
    replayRequestSeqByThread,
    olderHistoryLoadPromiseByThread,
    historyReplayBatch,
    historyReplayTurnSegments,
    timelineMaxVisibleTurns,
    translate,
  } = deps;

  const preserveNonHistoryTimelineEvents = (
    threadIdValue: string,
    historyEventIds: Set<string>,
    latestReplayCreatedAt: number
  ): TimelineEventItem[] => {
    const threadId = String(threadIdValue ?? "").trim();
    if (!threadId) return [];
    const existing = timelineStore.eventsForThread(threadId);
    if (existing.length === 0) return [];
    return existing
      .filter((event) => {
        const id = String(event.id ?? "").trim();
        if (!id) return false;
        if (isReplayCarryoverEvent(event)) return true;
        if (historyEventIds.has(id)) return false;
        const createdAt = Number.isFinite(event.createdAt) ? Number(event.createdAt) : 0;
        return createdAt > latestReplayCreatedAt;
      })
      .map((event) => ({ ...event }));
  };

  const rebuildRollbackStateFromReplay = (
    threadIdValue: string,
    events: Array<{ method: string; turnId?: string; params?: unknown; paramsText: string; createdAt?: number }>
  ) => {
    threadStore.replaceRollbackState(threadIdValue, buildCompletedTurnsFromReplay(events));
  };

  const rebuildTokenUsageFromReplay = (
    threadIdValue: string,
    events: Array<{ method: string; turnId?: string; params?: unknown; createdAt?: number }>
  ) => {
    const threadId = String(threadIdValue ?? "").trim();
    if (!threadId) return;
    for (const event of events) {
      if (event.method !== "thread/tokenUsage/updated") continue;
      const params = event.params && typeof event.params === "object" ? (event.params as any) : null;
      const tokenUsage = params?.tokenUsage;
      if (!tokenUsage || typeof tokenUsage !== "object") continue;
      const turnId = String(event.turnId ?? params?.turnId ?? "").trim();
      const usage = {
        ...(tokenUsage as Record<string, unknown>),
        updatedAt: Number.isFinite(event.createdAt) ? Number(event.createdAt) : Date.now(),
      };
      threadStore.setTokenUsage(threadId, usage);
      if (turnId) threadStore.setTurnTokenUsage(threadId, turnId, usage);
    }
  };

  const renderReplayEvents = (threadIdValue: string, replayEvents: ThreadReplayCache) => {
    const historyEventIds = new Set<string>();
    for (const event of replayEvents) {
      const id = String(event.id ?? "").trim();
      if (!id) continue;
      historyEventIds.add(id);
    }
    const latestReplayCreatedAt = replayEvents.reduce((max, event) => {
      const createdAt = Number.isFinite(event.createdAt) ? Number(event.createdAt) : 0;
      return Math.max(max, createdAt);
    }, 0);
    const preservedTimelineEvents = preserveNonHistoryTimelineEvents(
      threadIdValue,
      historyEventIds,
      latestReplayCreatedAt
    );
    const combined = [
      ...sortReplayEvents(replayEvents).map((event) => ({
        id: event.id,
        method: event.method,
        paramsText: event.paramsText,
        params: event.params,
        turnId: event.turnId,
        level: event.level,
        localKind: event.localKind,
        localState: event.localState,
        thinkingPhase: event.thinkingPhase,
        localMessageId: undefined as string | undefined,
        hidden: event.hidden,
        createdAt: event.createdAt,
      })),
      ...preservedTimelineEvents.map((prompt) => ({
        id: prompt.id,
        method: prompt.method,
        paramsText: prompt.paramsText,
        params: prompt.params,
        turnId: prompt.turnId,
        level: prompt.level,
        localKind: prompt.localKind,
        localState: prompt.localState,
        thinkingPhase: prompt.thinkingPhase,
        localMessageId: prompt.localMessageId,
        hidden: prompt.hidden,
        createdAt: prompt.createdAt,
      })),
    ].sort((a, b) => {
      const ta = Number.isFinite(a.createdAt) ? Number(a.createdAt) : 0;
      const tb = Number.isFinite(b.createdAt) ? Number(b.createdAt) : 0;
      if (ta !== tb) return ta - tb;
      return String(a.id ?? "").localeCompare(String(b.id ?? ""));
    });

    const seenIds = new Set<string>();
    const unique: typeof combined = [];
    for (const item of combined) {
      const id = String(item.id ?? "").trim();
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      unique.push(item);
    }

    const planKeyById = new Map<string, string>();
    const bestTextByPlanKey = new Map<string, string>();
    const selectedIdByPlanKey = new Map<string, { id: string; preferNotif: boolean; textLen: number }>();

    const preferNotifPlanId = (id: string) => id.startsWith("notif:item/plan/delta:");

    const considerPlanCandidate = (planKey: string, item: (typeof unique)[number]) => {
      if (!planKey) return;
      const id = String(item.id ?? "").trim();
      if (!id) return;

      const text = normalizePlanText(item.paramsText);
      const textLen = text.length;
      const existingBest = bestTextByPlanKey.get(planKey);
      if (!existingBest || textLen > existingBest.length) bestTextByPlanKey.set(planKey, text);

      const candidatePreferNotif = preferNotifPlanId(id);
      const existing = selectedIdByPlanKey.get(planKey);
      if (!existing) {
        selectedIdByPlanKey.set(planKey, { id, preferNotif: candidatePreferNotif, textLen });
        return;
      }
      if (candidatePreferNotif && !existing.preferNotif) {
        selectedIdByPlanKey.set(planKey, { id, preferNotif: candidatePreferNotif, textLen });
        return;
      }
      if (candidatePreferNotif === existing.preferNotif && textLen > existing.textLen) {
        selectedIdByPlanKey.set(planKey, { id, preferNotif: candidatePreferNotif, textLen });
      }
    };

    const transformed = unique.map((raw) => {
      const id = String(raw.id ?? "").trim();
      const turnKey = toPlanTurnKey(raw.turnId, raw.createdAt);

      if (raw.method === "item/plan/delta") {
        const sig = toPlanSignatureText(raw.paramsText);
        if (sig) {
          const planKey = `${turnKey}|${sig}`;
          planKeyById.set(id, planKey);
          considerPlanCandidate(planKey, raw);
        }
        return raw;
      }

      if (raw.method === "item/agentMessage/delta") {
        const proposedBody = extractProposedPlanBody(raw.paramsText);
        const proposedSig = toPlanSignatureText(proposedBody);
        if (proposedBody && proposedSig) {
          const planKey = `${turnKey}|${proposedSig}`;
          const cleanedText = stripProposedPlanTags(raw.paramsText);
          const next = {
            ...raw,
            method: "item/plan/delta",
            paramsText: cleanedText,
          };
          planKeyById.set(id, planKey);
          considerPlanCandidate(planKey, next);
          return next;
        }
        return raw;
      }

      return raw;
    });

    rebuildRollbackStateFromReplay(threadIdValue, transformed);
    rebuildTokenUsageFromReplay(threadIdValue, transformed);
    const nextTimelineEvents: TimelineEventItem[] = [];

    for (const item of transformed) {
      const id = String(item.id ?? "").trim();
      if (!id) continue;

      if (item.method === "turn/diff/updated" || item.method === "thread/tokenUsage/updated") continue;

      const planKey = planKeyById.get(id) ?? "";
      if (planKey) {
        const selected = selectedIdByPlanKey.get(planKey);
        if (!selected || selected.id !== id) continue;
        const bestText = bestTextByPlanKey.get(planKey);
        const paramsText = typeof bestText === "string" && bestText ? bestText : item.paramsText;
        nextTimelineEvents.push({
          id,
          method: "item/plan/delta",
          paramsText,
          params: item.params,
          turnId: item.turnId,
          level: item.level ?? "info",
          localKind: item.localKind,
          localState: item.localState,
          thinkingPhase: item.thinkingPhase,
          localMessageId: item.localMessageId,
          hidden: item.hidden,
          createdAt: Number.isFinite(item.createdAt) ? Number(item.createdAt) : Date.now(),
        });
        continue;
      }

      nextTimelineEvents.push({
        id,
        method: item.method,
        paramsText: item.paramsText,
        params: item.params,
        turnId: item.turnId,
        level: item.level ?? "info",
        localKind: item.localKind,
        localState: item.localState,
        thinkingPhase: item.thinkingPhase,
        localMessageId: item.localMessageId,
        hidden: item.hidden,
        createdAt: Number.isFinite(item.createdAt) ? Number(item.createdAt) : Date.now(),
      });
    }

    timelineStore.replaceThreadEvents(threadIdValue, nextTimelineEvents);
  };

  const hydrateReplayFromCacheIfNeeded = (threadIdValue: string): boolean => {
    const cache = replayCacheByThread.get(threadIdValue);
    if (!cache) return false;
    const existingTimelineEventCount = timelineStore.eventsForThread(threadIdValue).length;
    if (existingTimelineEventCount === 0) {
      renderReplayEvents(threadIdValue, cache);
    }
    return true;
  };

  const nextReplayRequestSeq = (threadIdValue: string): number => {
    const next = (replayRequestSeqByThread.get(threadIdValue) ?? 0) + 1;
    replayRequestSeqByThread.set(threadIdValue, next);
    return next;
  };

  const isReplayRequestSeqCurrent = (threadIdValue: string, requestSeq: number): boolean => {
    return (replayRequestSeqByThread.get(threadIdValue) ?? 0) === requestSeq;
  };

  const markReplayIncompatible = (threadIdValue: string, detail: string) => {
    replayCacheByThread.delete(threadIdValue);
    replayWindowStateByThread.delete(threadIdValue);
    olderHistoryLoadPromiseByThread.delete(threadIdValue);
    timelineStore.clearThread(threadIdValue);
    threadStore.replaceRollbackState(threadIdValue, []);
    timelineStore.appendEvent({
      threadId: threadIdValue,
      method: "history/replay_incompatible",
      paramsText: detail,
      level: "error",
    });
  };

  const loadReplayBatchFromSessions = async (
    threadIdValue: string,
    before = 0,
    isCurrent: () => boolean = () => true
  ): Promise<ReplayBatchResult | null> => {
    const page = await codexDesktop.history.getThreadEvents({
      threadId: threadIdValue,
      limit: historyReplayBatch,
      before,
    });
    if (!isCurrent()) return null;
    const entries = Array.isArray(page?.entries) ? page.entries : [];
    const events = entries.length > 0 ? await parseSessionReplayEventsLazy(entries, threadIdValue, isCurrent) : [];
    return {
      loaded: Number.isFinite(page?.loaded) ? Math.max(0, Math.round(Number(page.loaded))) : 0,
      hasMore: Boolean(page?.hasMore),
      events,
    };
  };

  const collectReplayEventsForTurnCount = async (
    threadIdValue: string,
    requestSeq: number,
    opts?: {
      turnLimit?: number;
      before?: number;
      seedEvents?: ReplayTimelineEvent[];
      hasMorePages?: boolean;
      isCurrent?: () => boolean;
    }
  ): Promise<{
    events: ThreadReplayCache;
    nextBefore: number;
    hasMorePages: boolean;
  } | null> => {
    const turnLimit = Number.isFinite(opts?.turnLimit)
      ? Math.max(1, Math.round(Number(opts?.turnLimit)))
      : historyReplayTurnSegments;
    let before = Number.isFinite(opts?.before) ? Math.max(0, Math.round(Number(opts?.before))) : 0;
    let hasMorePages = opts?.hasMorePages ?? true;
    let collected = dedupeReplayEvents(opts?.seedEvents ?? []);
    const isCurrent = () => isReplayRequestSeqCurrent(threadIdValue, requestSeq) && (opts?.isCurrent?.() ?? true);

    while (countReplayTurns(collected) < turnLimit && hasMorePages) {
      if (!isCurrent()) return null;
      const batch = await loadReplayBatchFromSessions(threadIdValue, before, isCurrent);
      if (!batch || !isCurrent()) return null;
      const { loaded, hasMore, events } = batch;
      collected = dedupeReplayEvents([...events, ...collected]);

      if (hasMore && loaded <= before) {
        throw new Error(`history pagination stalled at loaded=${loaded}, before=${before}`);
      }
      before = loaded;
      hasMorePages = hasMore;
    }

    return {
      events: collected,
      nextBefore: before,
      hasMorePages,
    };
  };

  const countTimelineTurnsForThread = (threadIdValue: string): number => {
    const threadId = String(threadIdValue ?? "").trim();
    if (!threadId) return 0;
    timelineStore.flushPendingAppends();
    const events = timelineStore.eventsForThread(threadId);
    const turnIds = new Set<string>();
    for (const event of events) {
      const turnId = String(event?.turnId ?? "").trim();
      if (turnId) turnIds.add(turnId);
    }
    return turnIds.size;
  };

  const loadHistoryMessages = async (
    threadIdValue: string,
    options?: { isCurrent?: () => boolean }
  ): Promise<boolean> => {
    if (!threadIdValue || options?.isCurrent?.() === false) return false;

    const requestSeq = nextReplayRequestSeq(threadIdValue);
    replayCacheByThread.delete(threadIdValue);
    replayWindowStateByThread.delete(threadIdValue);

    try {
      const collected = await collectReplayEventsForTurnCount(threadIdValue, requestSeq, {
        turnLimit: historyReplayTurnSegments,
        isCurrent: options?.isCurrent,
      });
      if (!collected) return false;
      if (!isReplayRequestSeqCurrent(threadIdValue, requestSeq) || options?.isCurrent?.() === false) return false;
      const { olderEvents, visibleEvents } = splitReplayEventsByRecentTurns(
        collected.events,
        historyReplayTurnSegments
      );
      replayWindowStateByThread.set(threadIdValue, {
        nextBefore: collected.nextBefore,
        hasMorePages: collected.hasMorePages,
        bufferedOlderEvents: olderEvents,
      });
      replayCacheByThread.set(threadIdValue, visibleEvents);
      renderReplayEvents(threadIdValue, visibleEvents);
      return true;
    } catch (sessionsErr: unknown) {
      if (!isReplayRequestSeqCurrent(threadIdValue, requestSeq) || options?.isCurrent?.() === false) return false;
      const sessionsMsg = readErrorMessage(sessionsErr);
      markReplayIncompatible(threadIdValue, translate("runtime.historyReplayFailed", { message: sessionsMsg }));
      return false;
    }
  };

  const loadOlderHistoryTurns = async (threadIdValue?: string): Promise<boolean> => {
    const threadId = String(threadIdValue ?? runtimeStore.timelineKey ?? "").trim();
    if (!threadId) return false;

    const pending = olderHistoryLoadPromiseByThread.get(threadId);
    if (pending) return pending;

    if (countTimelineTurnsForThread(threadId) >= timelineMaxVisibleTurns) return false;
    const navigationRevision = runtimeStore.navigationRevision;
    const isActive = () =>
      runtimeStore.navigationRevision === navigationRevision && runtimeStore.timelineKey === threadId;
    const requestSeq = nextReplayRequestSeq(threadId);

    const task = (async () => {
      const currentState = replayWindowStateByThread.get(threadId);
      if (!hasOlderReplayHistory(currentState)) return false;

      const collected = await collectReplayEventsForTurnCount(threadId, requestSeq, {
        turnLimit: historyReplayTurnSegments,
        before: currentState?.nextBefore ?? 0,
        seedEvents: currentState?.bufferedOlderEvents ?? [],
        hasMorePages: currentState?.hasMorePages ?? false,
        isCurrent: isActive,
      });
      if (!collected) return false;
      if (!isReplayRequestSeqCurrent(threadId, requestSeq) || !isActive()) return false;

      const { olderEvents, visibleEvents } = splitReplayEventsByRecentTurns(
        collected.events,
        historyReplayTurnSegments
      );
      replayWindowStateByThread.set(threadId, {
        nextBefore: collected.nextBefore,
        hasMorePages: collected.hasMorePages,
        bufferedOlderEvents: olderEvents,
      });
      if (visibleEvents.length === 0) return false;

      const previousCache = replayCacheByThread.get(threadId) ?? [];
      const nextCache = dedupeReplayEvents([...visibleEvents, ...previousCache]);
      if (nextCache.length === previousCache.length) return false;

      replayCacheByThread.set(threadId, nextCache);
      renderReplayEvents(threadId, nextCache);
      return true;
    })()
      .catch((sessionsErr: unknown) => {
        if (!isReplayRequestSeqCurrent(threadId, requestSeq) || !isActive()) return false;
        const sessionsMsg = readErrorMessage(sessionsErr);
        markReplayIncompatible(threadId, translate("runtime.historyReplayFailed", { message: sessionsMsg }));
        return false;
      })
      .finally(() => {
        if (olderHistoryLoadPromiseByThread.get(threadId) === task) olderHistoryLoadPromiseByThread.delete(threadId);
      });

    olderHistoryLoadPromiseByThread.set(threadId, task);
    return task;
  };

  return {
    hydrateReplayFromCacheIfNeeded,
    loadHistoryMessages,
    loadOlderHistoryTurns,
  };
}
