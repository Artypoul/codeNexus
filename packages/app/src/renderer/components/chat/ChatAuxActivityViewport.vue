<template>
  <div
    ref="scrollerRef"
    class="chat-aux-activity__body app-scrollbar"
    :data-virtualized="virtualEnabled ? 'true' : 'false'"
    @scroll="onScroll"
  >
    <div
      ref="contentRef"
      class="chat-aux-activity__items"
      :class="{ 'chat-aux-activity__items--virtual': virtualEnabled }"
      :style="virtualEnabled ? { height: `${totalHeight}px` } : undefined"
    >
      <div
        v-for="entry in visibleRows"
        :key="entry.item.id"
        :ref="(element) => bindRow(entry.item.id, element)"
        class="chat-aux-activity__item"
        :data-aux-id="entry.item.id"
        :data-aux-kind="entry.item.kind"
        :style="virtualEnabled ? { transform: `translateY(${entry.top}px)` } : undefined"
      >
        <slot :item="entry.item" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, shallowRef, triggerRef, watch, type ComponentPublicInstance } from "vue";
import type { ChatAuxiliaryRow } from "../layout/types/chat.types";
import { getChatRowPresentation } from "../layout/chat/chatPresentation";
import { useFollowBottomScroller } from "./useFollowBottomScroller";

const props = defineProps<{ items: ChatAuxiliaryRow[]; active: boolean }>();
defineSlots<{ default(props: { item: ChatAuxiliaryRow }): unknown }>();
const emit = defineEmits<{ (event: "layout-change"): void }>();

const VIRTUAL_THRESHOLD = 40;
const ROW_GAP = 5;
const FALLBACK_HEIGHT = 320;
const rowElements = new Map<string, HTMLElement>();
const heights = shallowRef(new Map<string, number>());
const scrollTop = shallowRef(0);
const viewportHeight = shallowRef(FALLBACK_HEIGHT);
let viewportWidth = 0;
let paddingTop = 0;
let frameId: number | null = null;
let resizeObserver: ResizeObserver | null = null;
let disposed = false;

const {
  scrollerRef,
  contentRef,
  followBottom,
  onScroll: updateFollowBottom,
  resetFollowBottom,
  scheduleScrollToBottom,
} = useFollowBottomScroller({ enabled: () => props.active, onContentResize: () => emit("layout-change") });

const virtualEnabled = computed(() => props.items.length > VIRTUAL_THRESHOLD);
const rows = computed(() => {
  let top = 0;
  return props.items.map((item) => {
    const height = heights.value.get(item.id) ?? getChatRowPresentation(item).estimatedHeightPx;
    const entry = { item, top, bottom: top + height };
    top = entry.bottom + ROW_GAP;
    return entry;
  });
});
const totalHeight = computed(() => rows.value.at(-1)?.bottom ?? 0);

function indexAt(offset: number) {
  let low = 0;
  let high = rows.value.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (rows.value[middle].bottom < offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

const visibleRows = computed(() => {
  if (!virtualEnabled.value) return rows.value;
  const height = viewportHeight.value;
  const top = followBottom.value ? Math.max(0, totalHeight.value - height) : scrollTop.value;
  const overscan = Math.max(160, height);
  const start = Math.max(0, indexAt(top - overscan) - 2);
  const end = Math.min(rows.value.length, indexAt(top + height + overscan) + 3);
  return rows.value.slice(start, end);
});

function scheduleMeasure() {
  if (disposed || !props.active || frameId != null) return;
  frameId = requestAnimationFrame(() => {
    frameId = null;
    void measure();
  });
}

async function measure() {
  const scroller = scrollerRef.value;
  if (!scroller || !props.active) return;
  const oldTop = Math.max(0, scroller.scrollTop - paddingTop);
  const anchor = rows.value[indexAt(oldTop)];
  const anchorOffset = anchor ? oldTop - anchor.top : 0;
  const following = followBottom.value;
  const widthChanged = viewportWidth > 0 && Math.abs(scroller.clientWidth - viewportWidth) > 1;
  const nextViewportHeight = scroller.clientHeight || FALLBACK_HEIGHT;
  const heightChanged = viewportHeight.value !== nextViewportHeight;
  viewportWidth = scroller.clientWidth;
  viewportHeight.value = nextViewportHeight;
  paddingTop = Number.parseFloat(getComputedStyle(scroller).paddingTop) || 0;
  scrollTop.value = Math.max(0, scroller.scrollTop - paddingTop);
  if (widthChanged) heights.value = new Map();
  let changed = widthChanged;
  for (const [rowId, element] of rowElements) {
    const height = element.getBoundingClientRect().height;
    if (height <= 0 || Math.abs((heights.value.get(rowId) ?? 0) - height) < 1) continue;
    heights.value.set(rowId, height);
    changed = true;
  }
  if (!changed) {
    if (following && heightChanged) scheduleScrollToBottom();
    return;
  }
  triggerRef(heights);
  await nextTick();
  if (disposed || scrollerRef.value !== scroller || !props.active) return;
  if (following && followBottom.value) {
    scheduleScrollToBottom();
  } else if (!following && !followBottom.value && anchor) {
    const restored = rows.value.find((entry) => entry.item.id === anchor.item.id);
    if (restored && Math.abs(scroller.scrollTop - paddingTop - oldTop) < 1) {
      scroller.scrollTop = Math.max(0, restored.top + anchorOffset + paddingTop);
      scrollTop.value = Math.max(0, scroller.scrollTop - paddingTop);
    }
  }
  emit("layout-change");
}

function bindRow(rowId: string, element: Element | ComponentPublicInstance | null) {
  const previous = rowElements.get(rowId);
  if (previous === element) return;
  if (previous) resizeObserver?.unobserve(previous);
  if (element instanceof HTMLElement) {
    rowElements.set(rowId, element);
    resizeObserver?.observe(element);
    scheduleMeasure();
  } else {
    rowElements.delete(rowId);
  }
}

function onScroll() {
  scrollTop.value = Math.max(0, (scrollerRef.value?.scrollTop ?? 0) - paddingTop);
  updateFollowBottom();
  scheduleMeasure();
}

watch(
  scrollerRef,
  (element) => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (!element) return;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleMeasure);
      resizeObserver.observe(element);
      for (const row of rowElements.values()) resizeObserver.observe(row);
    }
    scheduleMeasure();
    scheduleScrollToBottom({ force: true });
  },
  { flush: "post" }
);

watch(
  () => props.items,
  () => {
    const ids = new Set(props.items.map((item) => item.id));
    for (const rowId of heights.value.keys()) {
      if (!ids.has(rowId)) heights.value.delete(rowId);
    }
    scheduleMeasure();
    scheduleScrollToBottom();
  },
  { flush: "post" }
);

watch(
  () => props.active,
  (active) => {
    if (!active) return;
    resetFollowBottom();
    scheduleMeasure();
    scheduleScrollToBottom({ force: true });
  },
  { flush: "post" }
);

onBeforeUnmount(() => {
  disposed = true;
  if (frameId != null) cancelAnimationFrame(frameId);
  resizeObserver?.disconnect();
  rowElements.clear();
});
</script>
