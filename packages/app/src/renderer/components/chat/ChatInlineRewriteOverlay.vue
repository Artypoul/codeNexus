<template>
  <div ref="overlayRef" class="chat-inline-rewrite-overlay" @click.stop @pointerdown.stop>
    <ComposerPanel
      :composeInput="draft.composeInput"
      :composeAttachments="draft.composeAttachments"
      :composeFileMentions="draft.composeFileMentions"
      :historyRewriteActive="true"
      historyRewriteSource="history"
      :composeMode="draft.composeMode"
      :model="draft.model"
      :reasoningEffort="draft.reasoningEffort"
      :sandboxMode="draft.sandboxMode"
      :modelOptions="modelOptions"
      :sandboxModeOptions="sandboxModeOptions"
      sandboxRiskText=""
      contextUsageTooltip=""
      :contextUsagePercent="0"
      contextUsageLevel="normal"
      contextUsageTokensText=""
      :isTurnRunning="draft.sending"
      :sendDisabled="sendDisabled || draft.sending"
      :sendTitle="draft.sending ? t('chat.planActions.sending') : t('chat.planActions.sendEdit')"
      :interruptDisabled="true"
      :interruptTitle="t('chat.planActions.sendingEdit')"
      :composerPanelRef="bindInlinePanelRef"
      :composerInputRef="bindInlineInputRef"
      :composerImageInputRef="bindInlineImageInputRef"
      inputId="inline-history-rewrite-input"
      :inputPlaceholder="t('chat.planActions.editPlaceholder')"
      variant="inline"
      :interactionOwnerId="INLINE_REWRITE_OWNER_ID"
      @update:composeInput="emit('update', { composeInput: $event })"
      @update:composeFileMentions="emit('update', { composeFileMentions: $event })"
      @update:model="emit('update', { model: $event })"
      @update:reasoningEffort="emit('update', { reasoningEffort: $event })"
      @update:sandboxMode="emit('update', { sandboxMode: $event })"
      @set-compose-mode="emit('update', { composeMode: $event })"
      @cancel-rewrite="emit('cancel')"
      @send="emit('send')"
      @composer-keydown="onInlineComposerKeydown"
      @remove-attachment="onRemoveAttachment"
    />
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import ComposerPanel from "../layout/composer/ComposerPanel.vue";
import type { ChatInlineRewriteDraft } from "../layout/types/chat.types";
import type { ModelPickerOption } from "@codenexus/shared/modelCatalog";

type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

const props = defineProps<{
  draft: ChatInlineRewriteDraft;
  modelOptions: readonly ModelPickerOption[];
  sandboxModeOptions: readonly SelectOption[];
  sendDisabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "update", patch: Partial<ChatInlineRewriteDraft>): void;
  (e: "cancel"): void;
  (e: "send"): void;
}>();

const { t } = useI18n();
const inlinePanelRef = ref<HTMLDivElement | null>(null);
const inlineInputRef = ref<HTMLDivElement | null>(null);
const inlineImageInputRef = ref<HTMLInputElement | null>(null);
const overlayRef = ref<HTMLElement | null>(null);
const INLINE_REWRITE_OWNER_ID = "inline-history-rewrite";

function bindInlinePanelRef(el: HTMLDivElement | null) {
  inlinePanelRef.value = el;
}

function bindInlineInputRef(el: HTMLDivElement | null) {
  inlineInputRef.value = el;
}

function bindInlineImageInputRef(el: HTMLInputElement | null) {
  inlineImageInputRef.value = el;
}

function onInlineComposerKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("cancel");
    return;
  }

  if (event.key === "Tab" && event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    emit("update", { composeMode: props.draft.composeMode === "plan" ? "default" : "plan" });
    nextTick(() => inlineInputRef.value?.focus({ preventScroll: true }));
    return;
  }

  if (event.key !== "Enter") return;
  if (event.isComposing) return;
  if (event.shiftKey) return;
  event.preventDefault();
  event.stopPropagation();
  if (props.sendDisabled || props.draft.sending) return;
  emit("send");
}

function onRemoveAttachment(attachmentId: string) {
  const id = String(attachmentId ?? "").trim();
  if (!id) return;
  emit("update", {
    composeAttachments: props.draft.composeAttachments.filter((attachment) => attachment.id !== id),
  });
}

function isOwnedTeleportTarget(target: Element) {
  return Boolean(target.closest(`[data-composer-owner="${INLINE_REWRITE_OWNER_ID}"]`));
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const overlay = overlayRef.value;
  if (overlay?.contains(target)) return;
  if (isOwnedTeleportTarget(target)) return;
  emit("cancel");
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown, true);
});

watch(
  () => props.draft.anchorEventId,
  (id) => {
    if (!id) return;
    nextTick(() => inlineInputRef.value?.focus({ preventScroll: true }));
  },
  { immediate: true, flush: "post" }
);
</script>
