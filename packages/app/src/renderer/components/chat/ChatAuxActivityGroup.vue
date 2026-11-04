<template>
  <div :class="[CHAT_ROW_BASE_CLASS, 'chat-row--aux-activity']">
    <section ref="activityRef" class="chat-aux-activity" :class="activityClass" :aria-busy="status === 'running'">
      <svg v-if="meteorReady" class="chat-aux-activity__meteor-svg" aria-hidden="true" focusable="false">
        <path class="chat-aux-activity__meteor-glow" :d="meteorPath" pathLength="100" fill="none" />
        <path class="chat-aux-activity__meteor-tail" :d="meteorPath" pathLength="100" fill="none" />
        <path class="chat-aux-activity__meteor-head" :d="meteorPath" pathLength="100" fill="none" />
      </svg>
      <button
        class="chat-aux-activity__summary"
        type="button"
        :aria-expanded="open ? 'true' : 'false'"
        @click="toggleOpen"
      >
        <span class="chat-aux-activity__icon" aria-hidden="true">
          <Activity class="h-3.5 w-3.5 [stroke-width:2.25]" />
        </span>
        <span class="chat-aux-activity__main min-w-0">
          <span class="chat-aux-activity__title">{{ titleText }}</span>
          <span class="chat-aux-activity__counts">
            <span v-for="item in summaryItems" :key="item.key" class="chat-aux-activity__count">
              <span class="chat-aux-activity__count-label">{{ item.label }}</span>
              <span class="chat-aux-activity__count-value">{{ item.valueText ?? item.count }}</span>
              <template v-if="item.addText || item.delText">
                <span v-if="item.addText" class="chat-aux-activity__count-delta chat-aux-activity__count-delta--add">
                  <span class="chat-aux-activity__count-delta-sign">+</span>
                  <span class="chat-aux-activity__count-delta-number">{{ unsignedDeltaText(item.addText) }}</span>
                </span>
                <span v-if="item.delText" class="chat-aux-activity__count-delta chat-aux-activity__count-delta--del">
                  <span class="chat-aux-activity__count-delta-sign">-</span>
                  <span class="chat-aux-activity__count-delta-number">{{ unsignedDeltaText(item.delText) }}</span>
                </span>
              </template>
            </span>
          </span>
        </span>
        <span class="chat-aux-activity__state">{{ statusText }}</span>
        <span class="chat-aux-activity__chevron-box" aria-hidden="true">
          <ChevronDown
            class="chat-aux-activity__chevron h-3.5 w-3.5 [stroke-width:2.35]"
            :class="{ 'rotate-180': open }"
          />
        </span>
      </button>

      <div
        class="chat-aux-activity__body-shell"
        :class="{ 'is-open': open }"
        :aria-hidden="open ? 'false' : 'true'"
        @transitionend="onBodyTransitionEnd"
      >
        <div class="chat-aux-activity__body-frame">
          <ChatAuxActivityViewport
            v-if="bodyMounted"
            :key="id"
            :items="items"
            :active="open"
            @layout-change="emit('layout-change')"
          >
            <template #default="{ item }"><slot :item="item" /></template>
          </ChatAuxActivityViewport>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Activity, ChevronDown } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import type { ChatAuxActivityStatus, ChatAuxActivitySummaryItem, ChatAuxiliaryRow } from "../layout/types/chat.types";
import { CHAT_ROW_BASE_CLASS } from "../layout/chat/chatPresentation";
import ChatAuxActivityViewport from "./ChatAuxActivityViewport.vue";
import { provideActivityItemStates } from "./activityItemState";

const props = defineProps<{
  id: string;
  items: ChatAuxiliaryRow[];
  summaryItems: ChatAuxActivitySummaryItem[];
  summaryText: string;
  status: ChatAuxActivityStatus;
  defaultCollapsed: boolean;
  startedAtMs: number | null;
  answerStartedAtMs: number | null;
  elapsedLive: boolean;
}>();

defineSlots<{
  default(props: { item: ChatAuxiliaryRow }): unknown;
}>();

const emit = defineEmits<{
  (e: "layout-change"): void;
}>();

const { t } = useI18n();
const resetItemStates = provideActivityItemStates();
const activityRef = ref<HTMLElement | null>(null);
const open = ref(!props.defaultCollapsed);
const bodyMounted = ref(open.value);
let bodyUnmountTimer: ReturnType<typeof setTimeout> | null = null;
const userTouched = ref(false);
const nowMs = ref(Date.now());
let elapsedTimer: ReturnType<typeof setInterval> | null = null;
let activityResizeObserver: ResizeObserver | null = null;
type MeteorGeometry = {
  width: number;
  height: number;
  inset: number;
  radius: number;
};

const meteorSize = ref<MeteorGeometry>({ width: 1, height: 1, inset: 0.5, radius: 3.5 });

const titleText = computed(() => t("chat.activity.auxTitle"));

const meteorPath = computed(() => {
  const width = Math.max(1, meteorSize.value.width);
  const height = Math.max(1, meteorSize.value.height);
  const inset = meteorSize.value.inset;
  const right = Math.max(inset, width - inset);
  const bottom = Math.max(inset, height - inset);
  const radius = Math.max(0, Math.min(meteorSize.value.radius, (Math.min(width, height) - inset * 2) / 2));
  const leftCurve = inset + radius;
  const rightCurve = Math.max(leftCurve, right - radius);
  const topCurve = inset + radius;
  const bottomCurve = Math.max(topCurve, bottom - radius);
  return [
    `M ${leftCurve} ${inset}`,
    `H ${rightCurve}`,
    `Q ${right} ${inset} ${right} ${topCurve}`,
    `V ${bottomCurve}`,
    `Q ${right} ${bottom} ${rightCurve} ${bottom}`,
    `H ${leftCurve}`,
    `Q ${inset} ${bottom} ${inset} ${bottomCurve}`,
    `V ${topCurve}`,
    `Q ${inset} ${inset} ${leftCurve} ${inset}`,
    "Z",
  ].join(" ");
});
const meteorReady = computed(() => meteorSize.value.width > 16 && meteorSize.value.height > 16);

const elapsedMs = computed(() => {
  const startedAt = Number(props.startedAtMs);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return null;
  const completedAt = Number(props.answerStartedAtMs);
  const endAt = Number.isFinite(completedAt) && completedAt > 0 ? completedAt : props.elapsedLive ? nowMs.value : null;
  if (endAt == null) return null;
  return Math.max(0, Math.round(endAt - startedAt));
});

const elapsedText = computed(() => {
  const ms = elapsedMs.value;
  if (ms == null) return "";
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
});

const statusText = computed(() => {
  const elapsed = elapsedText.value;
  if (props.elapsedLive && elapsed) return t("chat.activity.runningElapsed", { elapsed });
  if (props.elapsedLive) return t("chat.activity.running");
  if (elapsed) {
    return open.value
      ? t("chat.activity.expandedElapsed", { elapsed })
      : t("chat.activity.collapsedElapsed", { elapsed });
  }
  return open.value ? t("chat.activity.expanded") : t("chat.activity.collapsed");
});

const activityClass = computed(() => ({
  "is-open": open.value,
  "is-running": props.status === "running",
}));

function unsignedDeltaText(value: string): string {
  return String(value ?? "").replace(/^[+-]/, "");
}

function toggleOpen() {
  userTouched.value = true;
  open.value = !open.value;
  if (open.value) {
    void nextTick(() => {
      emit("layout-change");
    });
    return;
  }
  emit("layout-change");
}

function onBodyTransitionEnd(event: TransitionEvent) {
  if (event.target !== event.currentTarget || event.propertyName !== "grid-template-rows") return;
  if (!open.value) unmountBody();
  emit("layout-change");
}

function clearBodyUnmountTimer() {
  if (bodyUnmountTimer == null) return;
  clearTimeout(bodyUnmountTimer);
  bodyUnmountTimer = null;
}

function unmountBody() {
  clearBodyUnmountTimer();
  bodyMounted.value = false;
}

watch(
  open,
  (next) => {
    clearBodyUnmountTimer();
    if (next) {
      bodyMounted.value = true;
    } else if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      unmountBody();
    } else if (bodyMounted.value) {
      // transitionend is not guaranteed (hidden windows or interrupted motion).
      bodyUnmountTimer = setTimeout(unmountBody, 280);
    }
  },
  { flush: "sync" }
);

function syncElapsedTimer() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
  if (!props.elapsedLive || !props.startedAtMs) return;
  nowMs.value = Date.now();
  elapsedTimer = setInterval(() => {
    nowMs.value = Date.now();
  }, 1000);
}

watch(() => [props.elapsedLive, props.startedAtMs] as const, syncElapsedTimer, { immediate: true });

function syncMeteorSize() {
  const element = activityRef.value;
  const rect = element?.getBoundingClientRect();
  if (!element || !rect) return;
  const styles = getComputedStyle(element);
  const borderWidth = Number.parseFloat(styles.borderTopWidth) || 0;
  const borderRadius = Number.parseFloat(styles.borderTopLeftRadius) || 0;
  const inset = borderWidth / 2;
  meteorSize.value = {
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
    inset,
    radius: Math.max(0, borderRadius - inset),
  };
}

onMounted(() => {
  syncMeteorSize();
  if (typeof ResizeObserver !== "undefined" && activityRef.value) {
    activityResizeObserver = new ResizeObserver(syncMeteorSize);
    activityResizeObserver.observe(activityRef.value);
  }
});

onBeforeUnmount(() => {
  clearBodyUnmountTimer();
  if (elapsedTimer) clearInterval(elapsedTimer);
  activityResizeObserver?.disconnect();
  activityResizeObserver = null;
});

watch(
  () => props.id,
  () => {
    userTouched.value = false;
    resetItemStates();
    open.value = !props.defaultCollapsed;
    void nextTick(() => {
      emit("layout-change");
    });
  }
);

watch(
  () => props.defaultCollapsed,
  (next) => {
    if (next) {
      open.value = false;
      emit("layout-change");
      return;
    }
    if (!userTouched.value) {
      open.value = true;
      void nextTick(() => {
        emit("layout-change");
      });
    }
  }
);
</script>
