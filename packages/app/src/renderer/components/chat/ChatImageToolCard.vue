<template>
  <div class="chat-tool-wrap w-full max-w-full min-w-0">
    <section class="official-image-card" :class="statusClass" :aria-label="t('chat.imageTool.aria')">
      <header class="official-image-card__header">
        <div class="official-image-card__mark" aria-hidden="true">
          <component :is="statusIcon" class="official-image-card__icon" />
        </div>

        <div class="official-image-card__heading">
          <div class="official-image-card__title-row">
            <span class="official-image-card__title">{{ titleText }}</span>
            <span class="official-image-card__badge">{{ statusText }}</span>
          </div>
          <div class="official-image-card__meta">
            <span>{{ subtitleText }}</span>
            <span v-if="showTimestamps" class="official-image-card__time mono">{{ formattedTime }}</span>
          </div>
        </div>
      </header>

      <div v-if="showRunningSkeleton" class="official-image-card__skeleton-grid" aria-hidden="true">
        <div v-for="index in skeletonCount" :key="index" class="official-image-card__skeleton" />
      </div>

      <div v-else-if="visibleImages.length > 0" class="official-image-card__grid" :class="gridClass">
        <LazyImageThumb
          v-for="image in visibleImages"
          :key="image.id"
          :imageId="image.id"
          class="official-image-card__thumb"
          :source="image.source"
          :sourceKind="image.sourceKind"
          :previewTitle="image.title"
          :workspaceRoot="workspaceRoot"
          :rootMarginPx="360"
          @load-error="$emit('load-error', $event)"
          @preview="$emit('preview', $event)"
        />
      </div>

      <div v-else class="official-image-card__empty">
        <AlertTriangle class="official-image-card__empty-icon" aria-hidden="true" />
        <span>{{ emptyText }}</span>
      </div>

      <div v-if="item.errorText" class="official-image-card__error mono">
        {{ item.errorText }}
      </div>

      <details v-if="hasDetails" class="official-image-card__details" :open="detailsOpen" @toggle="onDetailsToggle">
        <summary>
          <span>{{ t("chat.imageTool.details") }}</span>
          <span class="official-image-card__details-hint">{{ detailsHint }}</span>
        </summary>
        <template v-if="detailsOpen">
          <div v-if="revisedPromptBody" class="official-image-card__prompt">
            <div class="official-image-card__detail-label">{{ t("chat.imageTool.revisedPrompt") }}</div>
            <p>{{ revisedPromptBody }}</p>
          </div>
          <pre v-if="item.detailText" class="official-image-card__source mono">{{ item.detailText }}</pre>
        </template>
      </details>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { AlertTriangle, CheckCircle2, Eye, Image as ImageIcon, Loader2 } from "lucide-vue-next";
import type { Component } from "vue";
import type { ChatImageToolItem, ImageToolImageEntry } from "../layout/types/chat.types";
import LazyImageThumb from "../ui/LazyImageThumb.vue";
import { useActivityItemState } from "./activityItemState";

const props = defineProps<{
  item: ChatImageToolItem;
  visibleImages: ImageToolImageEntry[];
  showTimestamps: boolean;
  formattedTime: string;
  workspaceRoot: string;
}>();
const { t } = useI18n();
const detailsOpen = useActivityItemState(
  () => `image-details:${props.item.itemId}`,
  () => false
);

function onDetailsToggle(event: Event) {
  detailsOpen.value = (event.currentTarget as HTMLDetailsElement).open;
}

defineEmits<{
  (e: "load-error", payload: any): void;
  (e: "preview", payload: any): void;
}>();

const titleText = computed(() =>
  props.item.itemType === "imageView" ? t("chat.imageTool.view") : t("chat.imageTool.generate")
);

const statusText = computed(() => {
  if (props.item.status === "running") {
    return props.item.itemType === "imageView" ? t("chat.imageTool.reading") : t("chat.imageTool.generating");
  }
  if (props.item.status === "completed") {
    return props.item.itemType === "imageView" ? t("chat.imageTool.read") : t("chat.imageTool.generated");
  }
  if (props.item.status === "failed") {
    return props.item.itemType === "imageView" ? t("chat.imageTool.readFailed") : t("chat.imageTool.generationFailed");
  }
  return t("chat.imageTool.unknown");
});

const statusIcon = computed<Component>(() => {
  if (props.item.itemType === "imageView") return Eye;
  if (props.item.status === "running") return Loader2;
  if (props.item.status === "failed") return AlertTriangle;
  if (props.item.status === "completed") return CheckCircle2;
  return ImageIcon;
});

const statusClass = computed(() => ({
  "is-running": props.item.status === "running",
  "is-completed": props.item.status === "completed",
  "is-failed": props.item.status === "failed",
  "is-view": props.item.itemType === "imageView",
}));

const subtitleText = computed(() => {
  const count = props.visibleImages.length;
  if (props.item.itemType === "imageView") {
    return count > 0 ? t("chat.imageTool.viewResult") : t("chat.imageTool.viewRequest");
  }
  if (props.item.status === "running") return t("chat.imageTool.waitingGeneration");
  if (props.item.status === "failed") return t("chat.imageTool.generationFailedSubtitle");
  if (count > 0) return t("chat.imageTool.generationResults", { count });
  return t("chat.imageTool.noPreview");
});

const gridClass = computed(() => ({
  "official-image-card__grid--single": props.visibleImages.length === 1,
  "official-image-card__grid--many": props.visibleImages.length > 1,
}));

const showRunningSkeleton = computed(() => props.item.status === "running" && props.visibleImages.length === 0);
const skeletonCount = computed(() => {
  if (props.item.itemType === "imageView") return 1;
  const count = Math.round(Number(props.item.pendingImageCount ?? 1));
  if (!Number.isFinite(count)) return 1;
  return Math.max(1, Math.min(4, count));
});

const emptyText = computed(() => {
  if (props.item.status === "failed") return t("chat.imageTool.noDisplayable");
  if (props.item.itemType === "imageView") return t("chat.imageTool.waitingPath");
  return t("chat.imageTool.notArrived");
});

const revisedPromptBody = computed(() => {
  return String(props.item.revisedPrompt ?? "")
    .replace(new RegExp(`^${t("imageSidebar.revisedPrompt")}[:：]\\s*`, "iu"), "")
    .replace(/^Revised prompt:\s*/iu, "")
    .trim();
});

const hasDetails = computed(() => Boolean(revisedPromptBody.value || props.item.detailText));
const detailsHint = computed(() => {
  const parts: string[] = [];
  if (revisedPromptBody.value) parts.push("prompt");
  if (props.item.detailText) parts.push("source");
  return parts.join(" / ");
});
</script>
