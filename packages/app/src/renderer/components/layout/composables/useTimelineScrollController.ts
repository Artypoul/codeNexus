import { nextTick, onBeforeUnmount, onMounted, ref, watch, type ComputedRef, type Ref } from "vue";
import {
  classifyViewportFollowState,
  resolveTimelineScrollIntent,
  restorePrependScrollTop,
  snapshotTimelineViewport,
  type TimelineFollowState,
  type TimelineViewportSnapshot,
  type TimelineVisibleRowAnchor,
  type TimelineViewportAdapter,
} from "../chat/timelineScrollPolicy";
import { CHAT_TIMELINE_ROW_SELECTOR } from "../chat/chatPresentation";

type UseTimelineScrollControllerOptions = {
  timelineRef: Ref<HTMLElement | null>;
  timelineKey: ComputedRef<string>;
  timelineRevision: ComputedRef<number>;
  timelineContentRevision?: ComputedRef<number>;
  activeTurnId: ComputedRef<string>;
  isTimelineLoading: ComputedRef<boolean>;
  loadOlderHistoryTurns: (threadId: string) => Promise<boolean>;
  viewportAdapter?: Ref<TimelineViewportAdapter | null>;
  edgeFadeThresholdPx?: number;
  loadOlderTriggerPx?: number;
};

type TimelineScrollContext = {
  key: string;
  element: HTMLElement | null;
  revision: number;
};

type HistoryScrollRestore = {
  context: TimelineScrollContext;
  snapshot: TimelineViewportSnapshot;
  anchor: TimelineVisibleRowAnchor | null;
};

const DEFAULT_EDGE_FADE_THRESHOLD_PX = 1;
const DEFAULT_LOAD_OLDER_TRIGGER_PX = 24;
const LAYOUT_SCROLL_HEIGHT_EPSILON_PX = 2;

export function useTimelineScrollController(options: UseTimelineScrollControllerOptions) {
  const hasTopEdgeFade = ref(false);
  const hasBottomEdgeFade = ref(false);

  const autoFollowEnabled = ref(true);
  const pendingInitialScrollToBottomKey = ref<string | null>(null);
  const timelineRevealPending = ref(false);
  const timelineSignatureInitialized = ref(false);
  const pendingOlderHistoryThreadId = ref("");

  const edgeFadeThresholdPx = Math.max(0, Math.round(options.edgeFadeThresholdPx ?? DEFAULT_EDGE_FADE_THRESHOLD_PX));
  const loadOlderTriggerPx = Math.max(0, Math.round(options.loadOlderTriggerPx ?? DEFAULT_LOAD_OLDER_TRIGGER_PX));

  let activeInitialStabilizeToken = 0;
  let scrollIntentRevision = 0;
  let olderHistoryRequestToken = 0;
  let disposed = false;
  let lastTimelineScrollTop = 0;
  let lastScrollSnapshot: TimelineViewportSnapshot | null = null;
  let pendingHistoryRestore: HistoryScrollRestore | null = null;
  let lastActiveTurnId = "";
  let pendingAutoScrollRafId: number | null = null;
  let pendingTimelineViewportStateRafId: number | null = null;
  let timelineResizeObserver: ResizeObserver | null = null;

  function captureViewport(): TimelineViewportSnapshot | null {
    const adapterMetrics = options.viewportAdapter?.value?.getScrollMetrics();
    if (adapterMetrics) return adapterMetrics;
    const element = options.timelineRef.value;
    return element ? snapshotTimelineViewport(element) : null;
  }

  function captureScrollContext(): TimelineScrollContext {
    return {
      key: options.timelineKey.value,
      element: options.timelineRef.value,
      revision: scrollIntentRevision,
    };
  }

  function isScrollContextCurrent(context: TimelineScrollContext): boolean {
    return (
      !disposed &&
      context.key === options.timelineKey.value &&
      context.element === options.timelineRef.value &&
      context.revision === scrollIntentRevision
    );
  }

  function invalidateScrollRequests() {
    scrollIntentRevision += 1;
    activeInitialStabilizeToken += 1;
    pendingInitialScrollToBottomKey.value = null;
    timelineRevealPending.value = false;
    cancelPendingAutoScroll();
  }

  function effectiveFollowState(): TimelineFollowState {
    return autoFollowEnabled.value ? "following" : "detached";
  }

  function timelineRows(element: HTMLElement): HTMLElement[] {
    return Array.from(element.querySelectorAll<HTMLElement>(CHAT_TIMELINE_ROW_SELECTOR));
  }

  function captureVisibleRowAnchor(element: HTMLElement): TimelineVisibleRowAnchor | null {
    const adapterAnchor = options.viewportAdapter?.value?.captureVisibleAnchor();
    if (adapterAnchor) return adapterAnchor;
    const timelineRect = element.getBoundingClientRect();
    for (const row of timelineRows(element)) {
      const rowId = String(row.dataset.rowId ?? "").trim();
      if (!rowId) continue;
      const rowRect = row.getBoundingClientRect();
      if (rowRect.bottom < timelineRect.top) continue;
      if (rowRect.top > timelineRect.bottom) break;
      return {
        rowId,
        topOffsetPx: rowRect.top - timelineRect.top,
      };
    }
    return null;
  }

  function restoreVisibleRowAnchor(element: HTMLElement, anchor: TimelineVisibleRowAnchor): boolean {
    if (options.viewportAdapter?.value?.restoreVisibleAnchor(anchor)) return true;
    const row = timelineRows(element).find((item) => String(item.dataset.rowId ?? "") === anchor.rowId);
    if (!row) return false;
    const timelineRect = element.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const delta = rowRect.top - timelineRect.top - anchor.topOffsetPx;
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTop = Math.max(0, Math.min(maxScrollTop, element.scrollTop + delta));
    return true;
  }

  function syncTimelineScrollTopCache(element: HTMLElement) {
    lastScrollSnapshot = snapshotTimelineViewport(element);
    lastTimelineScrollTop = lastScrollSnapshot.scrollTop;
  }

  function updateTimelineViewportState() {
    const element = options.timelineRef.value;
    if (!element) {
      hasTopEdgeFade.value = false;
      hasBottomEdgeFade.value = false;
      return;
    }
    const snapshot = snapshotTimelineViewport(element);
    const maxScrollTop = Math.max(0, snapshot.scrollHeight - snapshot.clientHeight);
    const distanceToBottom = Math.max(0, maxScrollTop - snapshot.scrollTop);
    if (maxScrollTop <= edgeFadeThresholdPx) {
      hasTopEdgeFade.value = false;
      hasBottomEdgeFade.value = false;
      return;
    }
    hasTopEdgeFade.value = snapshot.scrollTop > edgeFadeThresholdPx;
    hasBottomEdgeFade.value = distanceToBottom > edgeFadeThresholdPx;
  }

  function scheduleTimelineViewportStateUpdate() {
    if (disposed) return;
    if (pendingTimelineViewportStateRafId != null) cancelAnimationFrame(pendingTimelineViewportStateRafId);
    pendingTimelineViewportStateRafId = requestAnimationFrame(() => {
      pendingTimelineViewportStateRafId = null;
      updateTimelineViewportState();
    });
  }

  function cancelPendingAutoScroll() {
    if (pendingAutoScrollRafId == null) return;
    cancelAnimationFrame(pendingAutoScrollRafId);
    pendingAutoScrollRafId = null;
  }

  function scrollTimelineToBottom(behavior: ScrollBehavior = "auto") {
    const adapter = options.viewportAdapter?.value;
    if (adapter) {
      adapter.scrollToBottom(behavior);
      if (options.timelineRef.value) syncTimelineScrollTopCache(options.timelineRef.value);
      scheduleTimelineViewportStateUpdate();
      return;
    }
    const element = options.timelineRef.value;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
    syncTimelineScrollTopCache(element);
    scheduleTimelineViewportStateUpdate();
  }

  function scrollDomRowToTop(row: HTMLElement, offsetPx = 0, behavior: ScrollBehavior = "auto") {
    const element = options.timelineRef.value;
    if (!element) return false;
    const timelineRect = element.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const delta = rowRect.top - timelineRect.top - Math.max(0, Math.round(offsetPx));
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTo({
      top: Math.max(0, Math.min(maxScrollTop, element.scrollTop + delta)),
      behavior,
    });
    syncTimelineScrollTopCache(element);
    scheduleTimelineViewportStateUpdate();
    return true;
  }

  function scrollRowToTop(rowId: string, offsetPx = 0, behavior: ScrollBehavior = "auto") {
    const id = String(rowId ?? "").trim();
    if (!id) return false;
    invalidateScrollRequests();
    pendingHistoryRestore = null;
    if (options.viewportAdapter?.value?.scrollRowToTop(id, offsetPx, behavior)) {
      autoFollowEnabled.value = false;
      if (options.timelineRef.value) syncTimelineScrollTopCache(options.timelineRef.value);
      scheduleTimelineViewportStateUpdate();
      return true;
    }
    const element = options.timelineRef.value;
    const row = element ? timelineRows(element).find((item) => String(item.dataset.rowId ?? "").trim() === id) : null;
    const scrolled = row ? scrollDomRowToTop(row, offsetPx, behavior) : false;
    if (scrolled) autoFollowEnabled.value = false;
    return scrolled;
  }

  async function scrollLastRowByKindToTop(kind: string, offsetPx = 0, behavior: ScrollBehavior = "auto") {
    const normalizedKind = String(kind ?? "").trim();
    if (!normalizedKind) return false;
    invalidateScrollRequests();
    pendingHistoryRestore = null;
    autoFollowEnabled.value = false;
    const context = captureScrollContext();
    await nextTick();
    await waitForAnimationFrame();
    if (!isScrollContextCurrent(context)) return false;
    if (options.viewportAdapter?.value?.scrollLastRowByKindToTop(normalizedKind, offsetPx, behavior)) {
      autoFollowEnabled.value = false;
      if (options.timelineRef.value) syncTimelineScrollTopCache(options.timelineRef.value);
      scheduleTimelineViewportStateUpdate();
      return true;
    }
    const element = options.timelineRef.value;
    if (!element) return false;
    const rows = timelineRows(element).filter((item) => String(item.dataset.rowKind ?? "").trim() === normalizedKind);
    const row = rows[rows.length - 1] ?? null;
    const scrolled = row ? scrollDomRowToTop(row, offsetPx, behavior) : false;
    if (scrolled) autoFollowEnabled.value = false;
    return scrolled;
  }

  function scheduleAutoScrollToBottom() {
    if (disposed || !autoFollowEnabled.value) return;
    cancelPendingAutoScroll();
    const context = captureScrollContext();
    pendingAutoScrollRafId = requestAnimationFrame(() => {
      pendingAutoScrollRafId = null;
      if (!isScrollContextCurrent(context) || !autoFollowEnabled.value) return;
      scrollTimelineToBottom("auto");
    });
  }

  function scrollTimelineToBottomImmediate(behavior: ScrollBehavior = "auto") {
    cancelPendingAutoScroll();
    scrollTimelineToBottom(behavior);
  }

  function forceFollowBottom(_reason: string = "explicit-bottom") {
    if (disposed) return;
    invalidateScrollRequests();
    pendingHistoryRestore = null;
    autoFollowEnabled.value = true;
    scheduleAutoScrollToBottom();
  }

  function requestFollowBottom(reason: "stream-update" | "layout-change" | "turn-changed" = "stream-update") {
    const intent = resolveTimelineScrollIntent({
      reason,
      followState: effectiveFollowState(),
      previousTurnId: lastActiveTurnId,
      nextTurnId: options.activeTurnId.value,
    });
    if (intent.kind === "scroll-to-bottom") scheduleAutoScrollToBottom();
    else scheduleTimelineViewportStateUpdate();
  }

  function waitForAnimationFrame() {
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  async function waitForTimelineLayoutToSettle() {
    let previousScrollHeight = -1;
    let stableFrameCount = 0;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await waitForAnimationFrame();
      const element = options.timelineRef.value;
      if (!element) return;
      const nextScrollHeight = element.scrollHeight;
      if (nextScrollHeight === previousScrollHeight) stableFrameCount += 1;
      else stableFrameCount = 0;
      previousScrollHeight = nextScrollHeight;
      if (stableFrameCount >= 1) return;
    }
  }

  async function stabilizeInitialViewportAtBottom() {
    const key = options.timelineKey.value;
    if (pendingInitialScrollToBottomKey.value !== key) return;
    if (options.isTimelineLoading.value) return;

    const token = (activeInitialStabilizeToken += 1);
    const context = captureScrollContext();
    timelineRevealPending.value = true;

    try {
      await nextTick();
      await waitForTimelineLayoutToSettle();
      if (token !== activeInitialStabilizeToken) return;
      if (!isScrollContextCurrent(context) || !autoFollowEnabled.value) return;

      scrollTimelineToBottomImmediate("auto");
      await nextTick();
      await waitForTimelineLayoutToSettle();
      if (token !== activeInitialStabilizeToken) return;
      if (!isScrollContextCurrent(context) || !autoFollowEnabled.value) return;

      scrollTimelineToBottomImmediate("auto");
      pendingInitialScrollToBottomKey.value = null;
      timelineRevealPending.value = false;
    } finally {
      if (token !== activeInitialStabilizeToken || !isScrollContextCurrent(context)) return;
      timelineRevealPending.value = false;
      scheduleTimelineViewportStateUpdate();
    }
  }

  async function finalizeThreadViewport() {
    const context = captureScrollContext();
    await nextTick();
    if (!isScrollContextCurrent(context)) return;
    if (options.isTimelineLoading.value) return;
    if (pendingInitialScrollToBottomKey.value === context.key) {
      await stabilizeInitialViewportAtBottom();
      return;
    }
    const intent = resolveTimelineScrollIntent({
      reason: "stream-update",
      followState: effectiveFollowState(),
    });
    if (intent.kind === "scroll-to-bottom") scheduleAutoScrollToBottom();
    scheduleTimelineViewportStateUpdate();
  }

  function applyContentChangeIntent(reason: "stream-update" | "layout-change" | "turn-changed") {
    const intent = resolveTimelineScrollIntent({
      reason,
      followState: effectiveFollowState(),
      previousTurnId: lastActiveTurnId,
      nextTurnId: options.activeTurnId.value,
    });
    if (intent.kind === "scroll-to-bottom") scheduleAutoScrollToBottom();
    else scheduleTimelineViewportStateUpdate();
  }

  function notifyTimelineLayoutChange() {
    if (disposed) return;
    const context = captureScrollContext();
    const before = captureViewport();
    const beforeElement = options.timelineRef.value;
    const wasFollowing = effectiveFollowState() === "following";
    const anchor = !wasFollowing && beforeElement ? captureVisibleRowAnchor(beforeElement) : null;
    void nextTick(() => {
      if (!isScrollContextCurrent(context) || pendingHistoryRestore) return;
      const element = options.timelineRef.value;
      if (!element) {
        scheduleTimelineViewportStateUpdate();
        return;
      }
      if (before && !wasFollowing) {
        const after = snapshotTimelineViewport(element);
        const restored = anchor ? restoreVisibleRowAnchor(element, anchor) : false;
        if (!restored) {
          element.scrollTop = Math.max(
            0,
            Math.min(Math.max(0, after.scrollHeight - after.clientHeight), before.scrollTop)
          );
        }
        syncTimelineScrollTopCache(element);
      }
      if (wasFollowing) scheduleAutoScrollToBottom();
      else scheduleTimelineViewportStateUpdate();
    });
  }

  function bumpTimelineLayoutRevision() {
    notifyTimelineLayoutChange();
  }

  async function maybeLoadOlderHistoryFromTop(previousScrollTop: number) {
    const element = options.timelineRef.value;
    const threadId = options.timelineKey.value;
    if (!element || !threadId || threadId === "__app__") return;
    if (options.isTimelineLoading.value) return;
    if (pendingInitialScrollToBottomKey.value === threadId) return;
    if (timelineRevealPending.value) return;

    const currentScrollTop = Math.max(0, element.scrollTop);
    const crossedIntoTopZone = previousScrollTop > loadOlderTriggerPx && currentScrollTop <= loadOlderTriggerPx;
    if (!crossedIntoTopZone) return;
    if (pendingOlderHistoryThreadId.value === threadId) return;

    pendingOlderHistoryThreadId.value = threadId;
    const requestToken = (olderHistoryRequestToken += 1);
    const restore: HistoryScrollRestore = {
      context: captureScrollContext(),
      snapshot: snapshotTimelineViewport(element),
      anchor: captureVisibleRowAnchor(element),
    };
    pendingHistoryRestore = restore;

    try {
      const loaded = await options.loadOlderHistoryTurns(threadId);
      if (!loaded) return;
      await nextTick();
      await waitForTimelineLayoutToSettle();
      if (pendingHistoryRestore !== restore || !isScrollContextCurrent(restore.context)) return;

      const nextElement = options.timelineRef.value;
      if (!nextElement) return;
      const after = snapshotTimelineViewport(nextElement);
      const restored = restore.anchor ? restoreVisibleRowAnchor(nextElement, restore.anchor) : false;
      if (!restored) nextElement.scrollTop = restorePrependScrollTop(restore.snapshot, after);
      syncTimelineScrollTopCache(nextElement);
      updateTimelineViewportState();
    } finally {
      if (pendingHistoryRestore === restore) pendingHistoryRestore = null;
      if (olderHistoryRequestToken === requestToken) pendingOlderHistoryThreadId.value = "";
    }
  }

  function onTimelineScroll() {
    const element = options.timelineRef.value;
    if (!element || disposed) return;
    const previousScrollTop = lastTimelineScrollTop;
    const snapshot = snapshotTimelineViewport(element);
    const delta = snapshot.scrollTop - previousScrollTop;
    const maxScrollTop = Math.max(0, snapshot.scrollHeight - snapshot.clientHeight);
    const heightDelta = snapshot.scrollHeight - (lastScrollSnapshot?.scrollHeight ?? snapshot.scrollHeight);
    const layoutAdjusted =
      (maxScrollTop < previousScrollTop && snapshot.scrollTop === maxScrollTop) ||
      (heightDelta !== 0 && Math.abs(delta - heightDelta) <= LAYOUT_SCROLL_HEIGHT_EPSILON_PX);
    if (delta !== 0 && !layoutAdjusted) {
      invalidateScrollRequests();
      autoFollowEnabled.value =
        classifyViewportFollowState(snapshot) === "following" && (autoFollowEnabled.value || delta > 0);
      if (pendingHistoryRestore && isHistoryRestoreForCurrentViewport(pendingHistoryRestore)) {
        pendingHistoryRestore.context = captureScrollContext();
        pendingHistoryRestore.snapshot = snapshot;
        pendingHistoryRestore.anchor = captureVisibleRowAnchor(element);
      }
    }
    updateTimelineViewportState();
    syncTimelineScrollTopCache(element);
    void maybeLoadOlderHistoryFromTop(previousScrollTop);
  }

  function isHistoryRestoreForCurrentViewport(restore: HistoryScrollRestore) {
    return restore.context.key === options.timelineKey.value && restore.context.element === options.timelineRef.value;
  }

  function observeTimelineElement() {
    timelineResizeObserver?.disconnect();
    timelineResizeObserver = null;
    if (typeof ResizeObserver === "undefined") return;
    const element = options.timelineRef.value;
    if (!element || disposed) return;
    timelineResizeObserver = new ResizeObserver(() => {
      if (disposed || element !== options.timelineRef.value) return;
      if (
        pendingInitialScrollToBottomKey.value !== options.timelineKey.value &&
        !timelineRevealPending.value &&
        !options.isTimelineLoading.value &&
        !pendingHistoryRestore
      ) {
        applyContentChangeIntent("layout-change");
      } else {
        scheduleTimelineViewportStateUpdate();
      }
    });
    timelineResizeObserver.observe(element);
  }

  watch(
    () => options.timelineKey.value,
    () => {
      invalidateScrollRequests();
      pendingHistoryRestore = null;
      pendingOlderHistoryThreadId.value = "";
      olderHistoryRequestToken += 1;
      if (pendingTimelineViewportStateRafId != null) {
        cancelAnimationFrame(pendingTimelineViewportStateRafId);
        pendingTimelineViewportStateRafId = null;
      }
      timelineSignatureInitialized.value = false;
      pendingInitialScrollToBottomKey.value = options.timelineKey.value;
      timelineRevealPending.value = true;
      autoFollowEnabled.value = true;
      if (options.timelineRef.value) syncTimelineScrollTopCache(options.timelineRef.value);
      lastActiveTurnId = options.activeTurnId.value;
      if (!options.isTimelineLoading.value) void finalizeThreadViewport();
      else scheduleTimelineViewportStateUpdate();
    },
    { flush: "post" }
  );

  watch(
    () =>
      [
        options.timelineKey.value,
        options.timelineRevision.value,
        options.timelineContentRevision?.value ?? options.timelineRevision.value,
      ] as const,
    (next, prev) => {
      const nextKey = next?.[0] ?? "";
      const nextRevision = next?.[1] ?? 0;
      const nextContentRevision = next?.[2] ?? 0;
      const prevKey = prev?.[0] ?? "";
      const prevRevision = prev?.[1] ?? 0;
      const prevContentRevision = prev?.[2] ?? 0;
      if (!timelineSignatureInitialized.value) {
        timelineSignatureInitialized.value = true;
        if (options.isTimelineLoading.value) {
          scheduleTimelineViewportStateUpdate();
          return;
        }
        void finalizeThreadViewport();
        return;
      }
      if (options.isTimelineLoading.value) return;
      if (nextKey === prevKey && nextRevision === prevRevision && nextContentRevision === prevContentRevision) return;
      void nextTick(async () => {
        if (disposed || nextKey !== options.timelineKey.value) return;
        if (pendingInitialScrollToBottomKey.value === options.timelineKey.value) {
          await stabilizeInitialViewportAtBottom();
          return;
        }
        applyContentChangeIntent("stream-update");
      });
    },
    { flush: "post" }
  );

  watch(
    () => options.activeTurnId.value,
    (nextTurnId, prevTurnId) => {
      const next = String(nextTurnId ?? "").trim();
      const prev = String(prevTurnId ?? "").trim();
      if (next && prev && next !== prev) {
        lastActiveTurnId = prev;
        applyContentChangeIntent("turn-changed");
      }
      if (next) lastActiveTurnId = next;
    },
    { flush: "post" }
  );

  watch(
    () => options.isTimelineLoading.value,
    (loading) => {
      if (loading) return;
      void finalizeThreadViewport();
    },
    { flush: "post" }
  );

  watch(
    options.timelineRef,
    (element) => {
      invalidateScrollRequests();
      pendingHistoryRestore = null;
      observeTimelineElement();
      if (element) {
        syncTimelineScrollTopCache(element);
        if (autoFollowEnabled.value) scheduleAutoScrollToBottom();
      }
      scheduleTimelineViewportStateUpdate();
    },
    { flush: "post" }
  );

  onMounted(() => {
    void nextTick(() => {
      if (disposed) return;
      observeTimelineElement();
      if (options.timelineRef.value) syncTimelineScrollTopCache(options.timelineRef.value);
      lastActiveTurnId = options.activeTurnId.value;
      scheduleAutoScrollToBottom();
      scheduleTimelineViewportStateUpdate();
    });
  });

  onBeforeUnmount(() => {
    disposed = true;
    invalidateScrollRequests();
    pendingHistoryRestore = null;
    if (pendingTimelineViewportStateRafId != null) cancelAnimationFrame(pendingTimelineViewportStateRafId);
    pendingTimelineViewportStateRafId = null;
    timelineResizeObserver?.disconnect();
    timelineResizeObserver = null;
  });

  return {
    hasTopEdgeFade,
    hasBottomEdgeFade,
    autoFollowEnabled,
    bumpTimelineLayoutRevision,
    forceFollowBottom,
    requestFollowBottom,
    scrollRowToTop,
    scrollLastRowByKindToTop,
    notifyTimelineLayoutChange,
    onTimelineScroll,
    scheduleTimelineViewportStateUpdate,
    updateTimelineViewportState,
    observeTimelineElement,
  };
}
