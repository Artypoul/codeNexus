<template>
  <div :class="[CHAT_ROW_BASE_CLASS, 'chat-row--user', 'chat-row--user-shell']">
    <div class="chat-user-bubble-stack" :class="{ 'is-editing': inlineRewriteDraft }">
      <ChatUserBubbleFrame @click="$emit('click', event)">
        <template v-for="part in messageParts" :key="part.key">
          <span v-if="part.type === 'text'">{{ part.text }}</span>
          <button
            v-else-if="part.type === 'file'"
            class="chat-inline-file-token"
            type="button"
            v-tooltip="part.title"
            @click.stop="$emit('file-token-click', part.path)"
          >
            <Icon class="chat-inline-file-token__icon" :icon="part.icon" aria-hidden="true" />
            <span class="chat-inline-file-token__label">{{ part.label }}</span>
          </button>
          <div v-else class="chat-environment-context">
            <div class="chat-environment-context__title mono">{{ t("chat.environmentContext.title") }}</div>
            <dl class="chat-environment-context__grid">
              <template v-for="row in environmentContextRows(part.context)" :key="row.key">
                <dt class="mono">{{ row.label }}</dt>
                <dd class="mono">{{ row.value }}</dd>
              </template>
            </dl>
            <pre v-if="environmentContextRows(part.context).length === 0" class="chat-environment-context__raw mono">{{
              part.context.raw
            }}</pre>
          </div>
        </template>
        <div v-if="imageCount > 0" class="chat-user-images mt-2.5 flex flex-col gap-2">
          <div class="mono dim text-[11px]">{{ t("chat.activity.attachedImages", { count: imageCount }) }}</div>
          <div v-if="visibleImages.length > 0" class="chat-user-image-list flex flex-wrap gap-2 max-[1500px]:gap-1.5">
            <LazyImageThumb
              v-for="image in visibleImages"
              :key="image.id"
              :imageId="image.id"
              class="h-[92px] w-[92px] max-w-full"
              :source="image.source"
              :sourceKind="image.sourceKind"
              :previewTitle="image.title"
              v-tooltip="image.title"
              :workspaceRoot="workspaceRoot"
              :rootMarginPx="260"
              @load-error="$emit('thumb-load-error', $event)"
              @preview="$emit('preview-image', $event)"
            />
          </div>
        </div>
        <template #meta>
          <span v-if="showTimestamps" class="mono dim">{{ formattedTime }}</span>
        </template>
      </ChatUserBubbleFrame>
      <ChatInlineRewriteOverlay
        v-if="inlineRewriteDraft"
        :draft="inlineRewriteDraft"
        :modelOptions="modelOptions"
        :sandboxModeOptions="sandboxModeOptions"
        :sendDisabled="sendDisabled"
        @update="$emit('inline-rewrite-update', $event)"
        @cancel="$emit('inline-rewrite-cancel')"
        @send="$emit('inline-rewrite-send')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Icon } from "@iconify/vue";
import LazyImageThumb from "../ui/LazyImageThumb.vue";
import ChatUserBubbleFrame from "./ChatUserBubbleFrame.vue";
import ChatInlineRewriteOverlay from "./ChatInlineRewriteOverlay.vue";
import type { TimelineEventItem } from "../../domain/types";
import type { EnvironmentContextBlock } from "../../domain/taggedMessageBlocks";
import { CHAT_ROW_BASE_CLASS } from "../layout/chat/chatPresentation";
import type { ChatInlineRewriteDraft, ChatUserMessagePart } from "../layout/types/chat.types";
import type { ModelPickerOption } from "@codenexus/shared/modelCatalog";

type SelectOption = {
  value: string;
  label: string;
};

defineProps<{
  event: TimelineEventItem;
  workspaceRoot: string;
  messageParts: readonly ChatUserMessagePart[];
  imageCount: number;
  visibleImages: any[];
  showTimestamps: boolean;
  formattedTime: string;
  inlineRewriteDraft?: ChatInlineRewriteDraft | null;
  modelOptions: readonly ModelPickerOption[];
  sandboxModeOptions: readonly SelectOption[];
  sendDisabled?: boolean;
}>();

const { t } = useI18n();

const environmentContextRows = (context: EnvironmentContextBlock) => {
  const rows = [
    { key: "cwd", label: "cwd", value: context.cwd },
    { key: "shell", label: "shell", value: context.shell },
    { key: "current_date", label: "date", value: context.currentDate },
    { key: "timezone", label: "zone", value: context.timezone },
  ];
  return rows.filter((row) => row.value);
};

defineEmits<{
  (e: "click", event: TimelineEventItem): void;
  (e: "file-token-click", path: string): void;
  (e: "thumb-load-error", err: any): void;
  (e: "preview-image", payload: any): void;
  (e: "inline-rewrite-update", patch: Partial<ChatInlineRewriteDraft>): void;
  (e: "inline-rewrite-cancel"): void;
  (e: "inline-rewrite-send"): void;
}>();
</script>

<style scoped>
.chat-environment-context {
  display: grid;
  gap: 8px;
  margin: 0 0 8px;
  border: 1px solid color-mix(in srgb, var(--bubble-user-border) 78%, var(--text-muted) 18%);
  border-radius: 6px;
  background: color-mix(in srgb, var(--bubble-user-bg) 82%, var(--surface-1) 18%);
  padding: 9px 10px;
  white-space: normal;
}

.chat-environment-context__title {
  color: var(--text-muted);
  font-size: 11px;
  letter-spacing: 0;
}

.chat-environment-context__grid {
  display: grid;
  grid-template-columns: minmax(54px, max-content) minmax(0, 1fr);
  gap: 5px 10px;
  margin: 0;
  min-width: 0;
}

.chat-environment-context__grid dt {
  color: var(--text-muted);
  font-size: 11px;
}

.chat-environment-context__grid dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text);
  font-size: 12px;
}

.chat-environment-context__raw {
  margin: 0;
  max-height: 160px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text);
  font-size: 12px;
}
</style>
