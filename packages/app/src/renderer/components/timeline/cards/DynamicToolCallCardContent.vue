<template>
  <div class="grid gap-2">
    <div class="flex min-w-0 flex-wrap items-center gap-2">
      <ExecutionWaveText
        v-if="item.status === 'running'"
        class="text-[13px] font-semibold"
        color="var(--accent)"
        :text="item.label"
        :cycle-max-chars="0"
      />
      <span v-else class="text-[13px] font-semibold text-[var(--text)]">
        {{ item.label }}
      </span>
      <span
        v-if="item.approvalRequired"
        class="inline-flex h-[22px] items-center rounded-[4px] border border-[var(--border-warning)] bg-[var(--bg-warning-soft)] px-[9px] text-[11px] mono text-[var(--fg-warning)]"
      >
        {{ t("dynamicTool.approvalRequired") }}
      </span>
      <span v-if="durationText" class="mono text-[11px] dim">{{ durationText }}</span>
    </div>

    <div v-if="item.argsSummary" class="mono dim whitespace-pre-wrap [overflow-wrap:anywhere] break-words text-[11px]">
      {{ item.argsSummary }}
    </div>
    <div
      v-if="item.resultSummary"
      class="mono whitespace-pre-wrap [overflow-wrap:anywhere] break-words text-[11px] text-[var(--text)]"
    >
      {{ item.resultSummary }}
    </div>
    <div
      v-if="item.errorText"
      class="mono whitespace-pre-wrap [overflow-wrap:anywhere] break-words text-[11px] text-[var(--text)]"
    >
      {{ item.errorText }}
    </div>

    <div v-if="imageItems.length > 0" class="grid gap-2">
      <img
        v-for="(image, index) in imageItems"
        :key="`${item.callId}:image:${index}`"
        :src="image.imageUrl"
        loading="lazy"
        decoding="async"
        class="max-h-[240px] rounded-[4px] border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] object-contain"
        alt="dynamic-tool-image"
      />
    </div>

    <DetailDisclosure
      v-if="item.argsRaw"
      :open="argsOpen"
      motion="fade"
      summaryClass="mono text-[11px] dim"
      @update:open="argsOpen = $event"
    >
      <template #summary>{{ t("dynamicTool.viewFullArgs") }}</template>
      <pre
        class="mono mt-1.5 max-h-[240px] overflow-y-auto app-scrollbar rounded-[4px] border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] p-2 text-[var(--ui-code-text)] whitespace-pre-wrap [overflow-wrap:anywhere] break-words"
        >{{ item.argsRaw }}</pre
      >
    </DetailDisclosure>

    <DetailDisclosure
      v-if="hasResultContent"
      :open="resultOpen"
      motion="fade"
      summaryClass="mono text-[11px] dim"
      @update:open="resultOpen = $event"
    >
      <template #summary>{{ t("dynamicTool.viewFullResult") }}</template>
      <pre
        class="mono mt-1.5 max-h-[240px] overflow-y-auto app-scrollbar rounded-[4px] border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] p-2 text-[var(--ui-code-text)] whitespace-pre-wrap [overflow-wrap:anywhere] break-words"
        >{{ resultRawText }}</pre
      >
    </DetailDisclosure>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useActivityItemState } from "../../chat/activityItemState";
import { useI18n } from "vue-i18n";
import DetailDisclosure from "../../ui/DetailDisclosure.vue";
import ExecutionWaveText from "../../ui/ExecutionWaveText.vue";
import type { DynamicToolTimelineItem } from "../../../domain/dynamicTools";

const props = defineProps<{
  item: DynamicToolTimelineItem;
}>();

const { t } = useI18n();
const argsOpen = useActivityItemState(
  () => `dynamic-args:${props.item.callId}`,
  () => false
);
const resultOpen = useActivityItemState(
  () => `dynamic-result:${props.item.callId}`,
  () => false
);

const imageItems = computed(() => props.item.contentItems.filter((item) => item.type === "inputImage"));
const hasResultContent = computed(() =>
  props.item.contentItems.some(
    (item) => item.type === "inputImage" || (item.type === "inputText" && Boolean(item.text))
  )
);
const textItems = computed(() =>
  props.item.contentItems.filter((item) => item.type === "inputText").map((item) => item.text)
);
const durationText = computed(() => {
  const ms = props.item.durationMs;
  if (ms == null || !Number.isFinite(ms)) return "";
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s`;
  return `${Math.max(0, Math.round(ms))}ms`;
});
const resultRawText = computed(() => {
  const imageLines = imageItems.value.map((item, index) => `image[${index + 1}]: ${item.imageUrl}`);
  return [...textItems.value, ...imageLines].filter(Boolean).join("\n\n");
});
// Tool events do not show a status badge or success/failure coloring.
</script>
