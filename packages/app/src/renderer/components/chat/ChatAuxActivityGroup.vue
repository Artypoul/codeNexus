<template>
  <div :class="[CHAT_ROW_BASE_CLASS, 'chat-row--aux-activity']">
    <section class="chat-aux-activity" :class="activityClass" :aria-busy="status === 'running'">
      <button
        class="chat-aux-activity__summary"
        type="button"
        :aria-expanded="open ? 'true' : 'false'"
        @click="toggleOpen"
      >
        <span class="chat-aux-activity__icon" aria-hidden="true">
          <ExecutionCoreIcon class="chat-aux-activity__core" :running="status === 'running'" />
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
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { ChevronDown } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import type { ChatAuxActivityStatus, ChatAuxActivitySummaryItem, ChatAuxiliaryRow } from "../layout/types/chat.types";
import { CHAT_ROW_BASE_CLASS } from "../layout/chat/chatPresentation";
import ExecutionCoreIcon from "../ui/ExecutionCoreIcon.vue";
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
const open = ref(!props.defaultCollapsed);
const bodyMounted = ref(open.value);
let bodyUnmountTimer: ReturnType<typeof setTimeout> | null = null;
const userTouched = ref(false);
const nowMs = ref(Date.now());
let elapsedTimer: ReturnType<typeof setInterval> | null = null;

const titleText = computed(() => t("chat.activity.auxTitle"));

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

onBeforeUnmount(() => {
  clearBodyUnmountTimer();
  if (elapsedTimer) clearInterval(elapsedTimer);
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
