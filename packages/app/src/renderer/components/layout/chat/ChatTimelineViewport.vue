<template>
  <div
    ref="viewportRef"
    class="chat-timeline-viewport"
    :class="{ 'chat-timeline-viewport--virtual': virtualEnabled }"
    :data-virtualized="virtualEnabled ? 'true' : 'false'"
    :style="virtualViewportStyle"
  >
    <template v-if="virtualEnabled">
      <div
        v-for="item in virtualRows"
        :key="item.row.id"
        class="chat-timeline-row"
        :class="item.presentation.className"
        :data-row-id="item.row.id"
        :data-row-kind="item.row.kind"
        :data-row-group="item.presentation.group"
        :data-row-role="item.presentation.role"
        :data-row-density="item.presentation.density"
        :data-row-status="item.presentation.status"
        :data-row-expandable="item.presentation.expandable ? 'true' : 'false'"
        :data-row-estimated-height="item.presentation.estimatedHeightPx"
        :data-row-index="item.index"
        :style="{ transform: `translate3d(0, ${item.top}px, 0)` }"
        :ref="(el) => bindVirtualRowElement(item.row.id, el)"
      >
        <slot :row="item.row" />
      </div>
    </template>

    <template v-else>
      <div
        v-for="item in renderedRows"
        :key="item.row.id"
        class="chat-timeline-row"
        :class="item.presentation.className"
        :data-row-id="item.row.id"
        :data-row-kind="item.row.kind"
        :data-row-group="item.presentation.group"
        :data-row-role="item.presentation.role"
        :data-row-density="item.presentation.density"
        :data-row-status="item.presentation.status"
        :data-row-expandable="item.presentation.expandable ? 'true' : 'false'"
        :data-row-estimated-height="item.presentation.estimatedHeightPx"
        :data-row-index="item.index"
      >
        <slot :row="item.row" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  triggerRef,
  watch,
  type ComponentPublicInstance,
  type CSSProperties,
} from "vue";
import type { ChatRenderedRow } from "../types/chat.types";
import { getChatRowPresentation, type ChatTimelineRowGroup } from "./chatPresentation";
import { TIMELINE_FOLLOW_THRESHOLD_PX, type TimelineViewportAdapter } from "./timelineScrollPolicy";

type RenderedTimelineRow = {
  row: ChatRenderedRow;
  index: number;
  top: number;
  height: number;
  bottom: number;
  presentation: ReturnType<typeof getChatRowPresentation>;
};

const DEFAULT_VIRTUAL_THRESHOLD = 250;
const OVERSCAN_VIEWPORT_MULTIPLIER = 1.5;
const MIN_OVERSCAN_ROWS = 8;
const ROW_HEIGHT_EPSILON_PX = 1;
const FALLBACK_CLIENT_HEIGHT_PX = 720;
const DEFAULT_ROW_GAPS = {
  activity: 2,
  body: 5,
  command: 2,
  mixed: 5,
} satisfies Record<ChatTimelineRowGroup | "mixed", number>;

const props = withDefaults(
  defineProps<{
    rows: ChatRenderedRow[];
    timelineKey: string;
    scrollElement?: HTMLElement | null;
    virtualThreshold?: number;
    onLayoutChange?: () => void;
    onViewportAdapterChange?: (adapter: TimelineViewportAdapter | null) => void;
    onPinnedUserRowChange?: (rowId: string) => void;
  }>(),
  {
    scrollElement: null,
    virtualThreshold: DEFAULT_VIRTUAL_THRESHOLD,
  }
);

defineSlots<{
  default(props: { row: ChatRenderedRow }): unknown;
}>();

let layoutChangePending = false;
let pendingHeightRestoreRafId: number | null = null;
let pendingScrollMetricsRafId: number | null = null;
let userRowElements: HTMLElement[] | null = null;
let scrollElementCleanup: (() => void) | null = null;
let scrollElementResizeObserver: ResizeObserver | null = null;

type PendingHeightRestore = {
  anchor: ReturnType<typeof captureVisibleAnchor>;
  wasFollowing: boolean;
  scrollTopAtCapture: number;
};

let pendingHeightRestore: PendingHeightRestore | null = null;

const scrollTopPx = shallowRef(0);
const clientHeightPx = shallowRef(FALLBACK_CLIENT_HEIGHT_PX);
const viewportTopPx = shallowRef(0);
const rowGapPx = shallowRef({ ...DEFAULT_ROW_GAPS });
const rowHeightsByKey = shallowRef(new Map<string, number>());
const rowElementsById = new Map<string, HTMLElement>();
const rowResizeObserversById = new Map<string, ResizeObserver>();
const viewportRef = ref<HTMLElement | null>(null);

const renderedRows = computed<RenderedTimelineRow[]>(() => {
  let nextTop = 0;
  let previousGroup: ChatTimelineRowGroup | null = null;
  return props.rows.map((row, index) => {
    const presentation = getChatRowPresentation(row);
    const height = measuredOrEstimatedHeight(row.id, presentation.estimatedHeightPx);
    const gap =
      index === 0
        ? 0
        : previousGroup === presentation.group
          ? rowGapPx.value[presentation.group]
          : rowGapPx.value.mixed;
    const top = nextTop + gap;
    const bottom = top + height;
    nextTop = bottom;
    previousGroup = presentation.group;
    return {
      row,
      index,
      top,
      height,
      bottom,
      presentation,
    };
  });
});

const userRows = computed(() => renderedRows.value.filter((item) => item.row.kind === "user"));

const totalHeightPx = computed(() => {
  const rows = renderedRows.value;
  return Math.max(0, rows[rows.length - 1]?.bottom ?? 0);
});

const virtualEnabled = computed(
  () => props.rows.length > Math.max(0, Math.round(props.virtualThreshold)) && Boolean(props.scrollElement)
);

const virtualViewportStyle = computed<CSSProperties>(() =>
  virtualEnabled.value
    ? {
        height: `${totalHeightPx.value}px`,
      }
    : {}
);

const virtualRange = computed(() => {
  const rows = renderedRows.value;
  if (!virtualEnabled.value || rows.length === 0) return { start: 0, end: rows.length };

  const viewportHeight = Math.max(1, clientHeightPx.value || FALLBACK_CLIENT_HEIGHT_PX);
  const overscanPx = viewportHeight * OVERSCAN_VIEWPORT_MULTIPLIER;
  const localScrollTop = Math.max(0, scrollTopPx.value - viewportTopPx.value);
  const minTop = Math.max(0, localScrollTop - overscanPx);
  const maxBottom = localScrollTop + viewportHeight + overscanPx;

  let start = firstRowIndexAtOrAfter(minTop);
  let end = firstRowIndexAfter(maxBottom);
  start = Math.max(0, Math.min(start, rows.length));
  end = Math.max(start, Math.min(end, rows.length));

  start = Math.max(0, start - MIN_OVERSCAN_ROWS);
  end = Math.min(rows.length, end + MIN_OVERSCAN_ROWS);
  return { start, end };
});

const virtualRows = computed(() => {
  const range = virtualRange.value;
  return renderedRows.value.slice(range.start, range.end);
});

const rowStructureSignature = computed(() =>
  [
    `gaps:${rowGapPx.value.body}:${rowGapPx.value.command}:${rowGapPx.value.activity}:${rowGapPx.value.mixed}`,
    ...renderedRows.value.map(
      (item) =>
        `${String(item.row.id ?? "")}:${String(item.row.kind ?? "")}:${item.presentation.group}:${item.presentation.estimatedHeightPx}`
    ),
  ].join("\n")
);

function heightCacheKey(rowId: string) {
  return `${String(props.timelineKey || "__app__")}:${rowId}`;
}

function measuredOrEstimatedHeight(rowId: string, estimatedHeightPx: number): number {
  const measured = rowHeightsByKey.value.get(heightCacheKey(rowId));
  if (Number.isFinite(measured) && measured && measured > 0) return measured;
  return Math.max(1, Math.round(estimatedHeightPx || 1));
}

function firstRowIndexAtOrAfter(offsetPx: number): number {
  const rows = renderedRows.value;
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid].bottom < offsetPx) low = mid + 1;
    else high = mid;
  }
  return low;
}

function firstRowIndexAfter(offsetPx: number): number {
  const rows = renderedRows.value;
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid].top <= offsetPx) low = mid + 1;
    else high = mid;
  }
  return low;
}

function clampScrollTop(value: number): number {
  const element = props.scrollElement;
  const maxScrollTop = Math.max(
    0,
    (element?.scrollHeight ?? totalHeightPx.value) - (element?.clientHeight ?? clientHeightPx.value)
  );
  return Math.max(0, Math.min(maxScrollTop, Math.round(value)));
}

function distanceToBottom(element: HTMLElement): number {
  return Math.max(0, Math.round(element.scrollHeight - element.clientHeight - element.scrollTop));
}

function isFollowingBottom(element: HTMLElement): boolean {
  return distanceToBottom(element) <= TIMELINE_FOLLOW_THRESHOLD_PX;
}

function viewportContentTop(): number {
  const element = props.scrollElement;
  const viewport = viewportRef.value;
  if (!element || !viewport) return 0;
  const elementRect = element.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();
  return Math.max(0, Math.round(viewportRect.top - elementRect.top + element.scrollTop));
}

function parseCssPx(value: string, fallback: number): number {
  const parsed = Number.parseFloat(String(value ?? "").trim());
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.round(parsed));
}

function syncTimelineGapMetrics() {
  const viewport = viewportRef.value;
  if (!viewport) return false;
  const styles = getComputedStyle(viewport);
  const next = {
    activity: parseCssPx(styles.getPropertyValue("--chat-row-gap-activity"), DEFAULT_ROW_GAPS.activity),
    body: parseCssPx(styles.getPropertyValue("--chat-row-gap-body"), DEFAULT_ROW_GAPS.body),
    command: parseCssPx(styles.getPropertyValue("--chat-row-gap-command"), DEFAULT_ROW_GAPS.command),
    mixed: parseCssPx(styles.getPropertyValue("--chat-row-gap-mixed"), DEFAULT_ROW_GAPS.mixed),
  };
  const previous = rowGapPx.value;
  if (
    previous.activity === next.activity &&
    previous.body === next.body &&
    previous.command === next.command &&
    previous.mixed === next.mixed
  ) {
    return false;
  }
  rowGapPx.value = next;
  return true;
}

function updateScrollMetrics() {
  const element = props.scrollElement;
  scrollTopPx.value = Math.max(0, Math.round(element?.scrollTop ?? 0));
  clientHeightPx.value = Math.max(1, Math.round(element?.clientHeight ?? FALLBACK_CLIENT_HEIGHT_PX));
  viewportTopPx.value = viewportContentTop();
  syncPinnedUserRow();
}

function scheduleLayoutChangeNotify() {
  layoutChangePending = true;
  scheduleScrollMetricsUpdate();
}

function scheduleScrollMetricsUpdate() {
  if (pendingScrollMetricsRafId != null) return;
  pendingScrollMetricsRafId = requestAnimationFrame(() => {
    pendingScrollMetricsRafId = null;
    const notifyLayoutChange = layoutChangePending;
    layoutChangePending = false;
    updateScrollMetrics();
    if (notifyLayoutChange) props.onLayoutChange?.();
  });
}

function updateMeasuredHeight(rowId: string, element: HTMLElement) {
  const nextHeight = Math.max(1, Math.round(element.getBoundingClientRect().height));
  const key = heightCacheKey(rowId);
  const previousHeight = rowHeightsByKey.value.get(key) ?? 0;
  if (Math.abs(previousHeight - nextHeight) <= ROW_HEIGHT_EPSILON_PX) return;
  scheduleHeightChangeRestore();
  rowHeightsByKey.value.set(key, nextHeight);
  triggerRef(rowHeightsByKey);
  scheduleLayoutChangeNotify();
}

function scheduleHeightChangeRestore() {
  if (!virtualEnabled.value) return;
  const element = props.scrollElement;
  if (!element) return;
  if (!pendingHeightRestore) {
    pendingHeightRestore = {
      anchor: captureVisibleAnchor(),
      wasFollowing: isFollowingBottom(element),
      scrollTopAtCapture: Math.max(0, Math.round(element.scrollTop)),
    };
  }
  if (pendingHeightRestoreRafId != null) return;
  void nextTick(() => {
    if (pendingHeightRestoreRafId != null) return;
    pendingHeightRestoreRafId = requestAnimationFrame(() => {
      pendingHeightRestoreRafId = null;
      const restore = pendingHeightRestore;
      pendingHeightRestore = null;
      if (!restore) return;
      const element = props.scrollElement;
      if (!element) {
        updateScrollMetrics();
        return;
      }
      const scrollTop = Math.max(0, Math.round(element.scrollTop));
      if (Math.abs(scrollTop - restore.scrollTopAtCapture) > ROW_HEIGHT_EPSILON_PX) {
        updateScrollMetrics();
        return;
      }
      if (restore.wasFollowing) {
        scrollToBottom("auto");
      } else if (restore.anchor) {
        restoreVisibleAnchor(restore.anchor);
      } else {
        updateScrollMetrics();
      }
    });
  });
}

function toElement(value: Element | ComponentPublicInstance | null): HTMLElement | null {
  if (!value) return null;
  if (value instanceof HTMLElement) return value;
  const element = (value as ComponentPublicInstance).$el;
  return element instanceof HTMLElement ? element : null;
}

function bindVirtualRowElement(rowId: string, value: Element | ComponentPublicInstance | null) {
  const element = toElement(value);
  const existing = rowElementsById.get(rowId);
  if (existing === element) return;
  rowResizeObserversById.get(rowId)?.disconnect();
  rowResizeObserversById.delete(rowId);
  rowElementsById.delete(rowId);
  if (!element) return;

  rowElementsById.set(rowId, element);
  updateMeasuredHeight(rowId, element);

  if (typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver(() => {
    updateMeasuredHeight(rowId, element);
  });
  observer.observe(element);
  rowResizeObserversById.set(rowId, observer);
}

function disconnectVirtualRowObservers() {
  for (const observer of rowResizeObserversById.values()) observer.disconnect();
  rowResizeObserversById.clear();
  rowElementsById.clear();
}

function pruneHeightCache() {
  const allowed = new Set(props.rows.map((row) => heightCacheKey(row.id)));
  let changed = false;
  for (const key of rowHeightsByKey.value.keys()) {
    if (allowed.has(key)) continue;
    rowHeightsByKey.value.delete(key);
    changed = true;
  }
  if (changed) triggerRef(rowHeightsByKey);
}

function captureVisibleAnchor() {
  const element = props.scrollElement;
  if (!element || renderedRows.value.length === 0) return null;
  const scrollTop = Math.max(0, Math.round(element.scrollTop));
  const viewportTop = viewportContentTop();
  const localScrollTop = Math.max(0, scrollTop - viewportTop);
  const index = firstRowIndexAtOrAfter(localScrollTop);
  const item = renderedRows.value[Math.min(index, renderedRows.value.length - 1)];
  if (!item) return null;
  return {
    rowId: item.row.id,
    topOffsetPx: viewportTop + item.top - scrollTop,
  };
}

function restoreVisibleAnchor(anchor: { rowId: string; topOffsetPx: number }) {
  const element = props.scrollElement;
  if (!element) return false;
  const item = renderedRows.value.find((row) => row.row.id === anchor.rowId);
  if (!item) return false;
  element.scrollTop = clampScrollTop(viewportContentTop() + item.top - anchor.topOffsetPx);
  updateScrollMetrics();
  return true;
}

function scrollRowToTop(rowId: string, offsetPx = 0, behavior: ScrollBehavior = "auto") {
  const element = props.scrollElement;
  if (!element) return false;
  const id = String(rowId ?? "").trim();
  if (!id) return false;
  const item = renderedRows.value.find((row) => row.row.id === id);
  if (!item) return false;
  const targetTop = clampScrollTop(viewportContentTop() + item.top - Math.max(0, Math.round(offsetPx)));
  element.scrollTo({ top: targetTop, behavior });
  updateScrollMetrics();
  return true;
}

function scrollLastRowByKindToTop(kind: string, offsetPx = 0, behavior: ScrollBehavior = "auto") {
  const normalizedKind = String(kind ?? "").trim();
  if (!normalizedKind) return false;
  for (let index = renderedRows.value.length - 1; index >= 0; index -= 1) {
    const item = renderedRows.value[index];
    if (item?.row.kind !== normalizedKind) continue;
    return scrollRowToTop(item.row.id, offsetPx, behavior);
  }
  return false;
}

function scrollToBottom(behavior: ScrollBehavior = "auto") {
  const element = props.scrollElement;
  if (!element) return;
  element.scrollTo({ top: element.scrollHeight, behavior });
  updateScrollMetrics();
}

function getScrollMetrics() {
  const element = props.scrollElement;
  return {
    scrollTop: Math.max(0, Math.round(element?.scrollTop ?? 0)),
    scrollHeight: Math.max(0, Math.round(element?.scrollHeight ?? totalHeightPx.value ?? 0)),
    clientHeight: Math.max(1, Math.round(element?.clientHeight ?? clientHeightPx.value)),
  };
}

const viewportAdapter: TimelineViewportAdapter = {
  captureVisibleAnchor,
  restoreVisibleAnchor,
  scrollToBottom,
  scrollRowToTop,
  scrollLastRowByKindToTop,
  getScrollMetrics,
  notifyLayoutChange: scheduleLayoutChangeNotify,
};

function findPinnedUserRowId(): string {
  const element = props.scrollElement;
  if (!element || renderedRows.value.length === 0) return "";
  if (!virtualEnabled.value) {
    const viewport = viewportRef.value;
    if (!viewport) return "";
    const top = element.getBoundingClientRect().top;
    userRowElements ??= Array.from(
      viewport.querySelectorAll<HTMLElement>(":scope > .chat-timeline-row[data-row-kind='user']")
    );
    let low = 0;
    let high = userRowElements.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (userRowElements[mid].getBoundingClientRect().bottom <= top) low = mid + 1;
      else high = mid;
    }
    return userRowElements[low - 1]?.dataset.rowId ?? "";
  }
  const localScrollTop = Math.max(0, scrollTopPx.value - viewportTopPx.value);
  const rows = userRows.value;
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid].bottom <= localScrollTop) low = mid + 1;
    else high = mid;
  }
  return rows[low - 1]?.row.id ?? "";
}

function syncPinnedUserRow() {
  props.onPinnedUserRowChange?.(findPinnedUserRowId());
}

function syncViewportAdapter() {
  props.onViewportAdapterChange?.(virtualEnabled.value ? viewportAdapter : null);
}

function attachScrollElement(element: HTMLElement | null | undefined) {
  scrollElementCleanup?.();
  scrollElementCleanup = null;
  scrollElementResizeObserver?.disconnect();
  scrollElementResizeObserver = null;
  if (!element) {
    updateScrollMetrics();
    return;
  }

  const onScroll = scheduleScrollMetricsUpdate;
  element.addEventListener("scroll", onScroll, { passive: true });
  scrollElementCleanup = () => element.removeEventListener("scroll", onScroll);
  if (typeof ResizeObserver !== "undefined") {
    scrollElementResizeObserver = new ResizeObserver(() => {
      const gapChanged = syncTimelineGapMetrics();
      updateScrollMetrics();
      if (gapChanged) scheduleLayoutChangeNotify();
    });
    scrollElementResizeObserver.observe(element);
  }
  syncTimelineGapMetrics();
  updateScrollMetrics();
}

watch(
  rowStructureSignature,
  () => {
    userRowElements = null;
    scheduleLayoutChangeNotify();
  },
  { flush: "post" }
);

watch(
  () => props.timelineKey,
  () => {
    userRowElements = null;
    rowHeightsByKey.value = new Map();
    disconnectVirtualRowObservers();
    updateScrollMetrics();
    syncViewportAdapter();
    scheduleLayoutChangeNotify();
  },
  { flush: "post" }
);

watch(
  () => props.rows.map((row) => row.id).join("\n"),
  () => {
    pruneHeightCache();
    void nextTick(() => {
      updateScrollMetrics();
      scheduleLayoutChangeNotify();
    });
  },
  { flush: "post" }
);

watch(
  () => props.scrollElement,
  (element) => {
    attachScrollElement(element);
    syncViewportAdapter();
  },
  { flush: "post" }
);

watch(virtualEnabled, () => {
  userRowElements = null;
  if (!virtualEnabled.value) disconnectVirtualRowObservers();
  syncViewportAdapter();
  void nextTick(() => {
    syncTimelineGapMetrics();
    updateScrollMetrics();
    scheduleLayoutChangeNotify();
  });
});

onMounted(() => {
  attachScrollElement(props.scrollElement);
  syncTimelineGapMetrics();
  syncViewportAdapter();
  scheduleLayoutChangeNotify();
});

onBeforeUnmount(() => {
  if (pendingScrollMetricsRafId != null) cancelAnimationFrame(pendingScrollMetricsRafId);
  pendingScrollMetricsRafId = null;
  userRowElements = null;
  props.onPinnedUserRowChange?.("");
  props.onViewportAdapterChange?.(null);
  if (pendingHeightRestoreRafId != null) cancelAnimationFrame(pendingHeightRestoreRafId);
  pendingHeightRestoreRafId = null;
  pendingHeightRestore = null;
  scrollElementCleanup?.();
  scrollElementCleanup = null;
  scrollElementResizeObserver?.disconnect();
  scrollElementResizeObserver = null;
  disconnectVirtualRowObservers();
  layoutChangePending = false;
});
</script>
