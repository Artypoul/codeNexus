<template>
  <ChatUserBubbleFrame
    class="chat-pinned-prompt"
    :title="tooltipText"
    role="button"
    tabindex="0"
    :aria-label="t('chat.activity.locateCurrentPrompt')"
    @click="emit('locate')"
    @keydown.enter.prevent="emit('locate')"
    @keydown.space.prevent="emit('locate')"
  >
    <span class="chat-pinned-prompt__content-clip">
      <span :key="contentKey" class="chat-pinned-prompt__content">
        <span class="chat-pinned-prompt__text">
          <template v-for="part in displayParts" :key="part.key">
            <span v-if="part.type === 'text'" class="chat-pinned-prompt__text-part">{{ part.text }}</span>
            <button
              v-else-if="part.type === 'file'"
              class="chat-inline-file-token chat-pinned-prompt__file-token"
              type="button"
              v-tooltip="part.title"
              @click.stop="emit('file-token-click', part.path)"
              @keydown.enter.stop
              @keydown.space.stop
            >
              <Icon class="chat-inline-file-token__icon" :icon="part.icon" aria-hidden="true" />
              <span class="chat-inline-file-token__label">{{ part.label }}</span>
            </button>
          </template>
        </span>
      </span>
    </span>
    <template #meta>
      <span v-if="showMeta" class="chat-pinned-prompt__meta-clip">
        <span :key="`${contentKey}:meta`" class="chat-pinned-prompt__meta">
          <span v-if="showTimestamp" class="mono dim">{{ formattedTime }}</span>
          <span v-if="hasMeta" class="chat-pinned-prompt__tags" aria-hidden="true">
            <span v-if="normalizedFileCount > 0" class="chat-pinned-prompt__tag">{{
              t("chat.activity.fileTag", { count: normalizedFileCount })
            }}</span>
            <span v-if="normalizedImageCount > 0" class="chat-pinned-prompt__tag">{{
              t("chat.activity.imageTag", { count: normalizedImageCount })
            }}</span>
          </span>
        </span>
      </span>
    </template>
  </ChatUserBubbleFrame>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Icon } from "@iconify/vue";
import ChatUserBubbleFrame from "./ChatUserBubbleFrame.vue";
import type { ChatUserMessagePart } from "../layout/types/chat.types";

const props = defineProps<{
  text: string;
  messageParts?: ChatUserMessagePart[];
  title?: string;
  fileCount?: number;
  imageCount?: number;
  showTimestamp?: boolean;
  formattedTime?: string;
  contentKey?: string;
}>();

const emit = defineEmits<{
  (event: "locate"): void;
  (event: "file-token-click", path: string): void;
}>();

const { t } = useI18n();

function normalizeCount(value: number | undefined): number {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
}

const normalizedFileCount = computed(() => normalizeCount(props.fileCount));
const normalizedImageCount = computed(() => normalizeCount(props.imageCount));
const hasMeta = computed(() => normalizedFileCount.value > 0 || normalizedImageCount.value > 0);
const showTimestamp = computed(() => Boolean(props.showTimestamp && String(props.formattedTime ?? "").trim()));
const showMeta = computed(() => showTimestamp.value || hasMeta.value);
const formattedTime = computed(() => String(props.formattedTime ?? "").trim());
const displayText = computed(
  () =>
    String(props.text ?? "")
      .replace(/\s+/g, " ")
      .trim() || t("chat.activity.userMessage")
);
const displayParts = computed<ChatUserMessagePart[]>(() => {
  const parts = Array.isArray(props.messageParts) ? props.messageParts : [];
  const normalized = parts
    .map((part) => {
      if (part.type === "environmentContext") return null;
      if (part.type === "file") return part;
      const text = part.text.replace(/\s+/g, " ");
      return text ? { ...part, text } : null;
    })
    .filter((part): part is ChatUserMessagePart => part != null);
  return normalized.length > 0 ? normalized : [{ key: "fallback", type: "text", text: displayText.value }];
});
const tooltipText = computed(() => String(props.title ?? "").trim() || displayText.value);
const contentKey = computed(() => String(props.contentKey ?? displayText.value).trim() || displayText.value);
</script>
