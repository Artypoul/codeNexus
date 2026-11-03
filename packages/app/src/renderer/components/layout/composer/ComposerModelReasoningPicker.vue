<template>
  <button
    ref="triggerRef"
    type="button"
    class="composer-model-reasoning-trigger"
    :class="['composer-select--model', modelToneClass, { 'is-open': open }]"
    :disabled="disabled"
    aria-haspopup="dialog"
    :aria-expanded="open ? 'true' : 'false'"
    @pointerdown="onPreservePointerFocus"
    @click="onTriggerClick"
    @keydown="onTriggerKeydown"
  >
    <span class="composer-model-reasoning-model mono">{{ modelLabel }}</span>
    <span class="composer-model-reasoning-divider" aria-hidden="true"></span>
    <span class="composer-model-reasoning-effort composer-select--effort mono" :class="reasoningToneClass">
      {{ selectedReasoningLabel }}
    </span>
    <ChevronDown class="composer-model-reasoning-chevron" :class="{ 'is-open': open }" aria-hidden="true" />
  </button>

  <Teleport to="body">
    <Transition name="ui-select-popover">
      <div
        v-if="open"
        ref="popoverRef"
        class="composer-model-reasoning-popover app-scrollbar"
        :style="popoverStyle"
        :data-composer-owner="interactionOwnerId || undefined"
        role="dialog"
        :aria-label="t('composer.modelReasoningAria')"
        @pointerdown="onPreservePointerFocus"
      >
        <div class="composer-model-reasoning-popover-head">
          <div class="composer-model-reasoning-popover-title">
            <span>{{ t("composer.chooseModel") }}</span>
          </div>
        </div>

        <div class="composer-model-reasoning-list" role="listbox">
          <button
            v-for="option in modelPickerOptions"
            :key="option.value"
            type="button"
            class="composer-model-reasoning-option"
            :class="[option.toneClass, { 'is-selected': option.selected, 'is-active': option.active }]"
            :data-value="option.value"
            role="option"
            :aria-selected="option.selected ? 'true' : 'false'"
            @mouseenter="showReasoningForModel(option.value)"
            @focus="showReasoningForModel(option.value)"
            @click="onModelClick(option.value)"
          >
            <span class="composer-model-reasoning-option-label mono">{{ option.label }}</span>
            <span class="composer-model-reasoning-option-meta">
              <Check v-if="option.selected" class="composer-model-reasoning-check" aria-hidden="true" />
              <ChevronRight class="composer-model-reasoning-next" aria-hidden="true" />
            </span>
          </button>
        </div>
      </div>
    </Transition>

    <Transition name="ui-select-popover">
      <div
        v-if="open && activeModel && activeReasoningEfforts.length > 0"
        ref="reasoningPopoverRef"
        class="composer-model-reasoning-popover composer-model-reasoning-popover--sub app-scrollbar"
        :style="reasoningPopoverStyle"
        :data-composer-owner="interactionOwnerId || undefined"
        role="listbox"
        :aria-label="t('composer.modelReasoningFor', { model: activeModelLabel })"
        @pointerdown="onPreservePointerFocus"
      >
        <div class="composer-model-reasoning-popover-head composer-model-reasoning-popover-head--sub">
          <div class="composer-model-reasoning-popover-title">
            <span>{{ t("composer.reasoningEffort") }}</span>
            <strong class="mono">{{ activeModelLabel }}</strong>
          </div>
        </div>
        <div class="composer-model-reasoning-list" role="presentation">
          <button
            v-for="option in reasoningPickerOptions"
            :key="option.value"
            type="button"
            class="composer-model-reasoning-option composer-model-reasoning-option--sub"
            :class="[option.toneClass, { 'is-selected': option.selected }]"
            :data-value="option.value"
            role="option"
            :aria-selected="option.selected ? 'true' : 'false'"
            @click="onReasoningClick(option.value)"
          >
            <span class="composer-model-reasoning-option-label mono">{{ option.label }}</span>
            <Check v-if="option.selected" class="composer-model-reasoning-check" aria-hidden="true" />
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Check, ChevronDown, ChevronRight } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import type { ModelPickerOption } from "@codenexus/shared/modelCatalog";
import { reasoningEffortLabel } from "../../../shared/reasoningEffortOptions";

type VisibleOption = {
  value: string;
  label: string;
  toneClass: string;
  selected: boolean;
  active?: boolean;
};

const props = defineProps<{
  model: string;
  reasoningEffort: string;
  modelOptions: readonly ModelPickerOption[];
  preservePointerFocus?: boolean;
  interactionOwnerId?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (event: "update:model", value: string): void;
  (event: "update:reasoningEffort", value: string): void;
}>();

const { t, te } = useI18n();
const open = ref(false);
const activeModel = ref("");
const triggerRef = ref<HTMLButtonElement | null>(null);
const popoverRef = ref<HTMLDivElement | null>(null);
const reasoningPopoverRef = ref<HTMLDivElement | null>(null);
const popoverStyle = ref<Record<string, string>>({});
const reasoningPopoverStyle = ref<Record<string, string>>({});

const POPOVER_GAP_PX = 6;
const VIEWPORT_PADDING_PX = 8;
const POPOVER_MAX_HEIGHT_PX = 320;
const MODEL_POPOVER_MIN_WIDTH_PX = 360;
const REASONING_POPOVER_WIDTH_PX = 176;

function onPreservePointerFocus(event: PointerEvent) {
  if (props.preservePointerFocus) event.preventDefault();
}

function normalizeToneKey(value: unknown): string {
  return (
    String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "default"
  );
}

const modelToneClass = computed(() => `is-${normalizeToneKey(props.model)}`);
const reasoningToneClass = computed(() => `is-${normalizeToneKey(effectiveReasoningEffort.value)}`);
const disabled = computed(() => Boolean(props.disabled) || props.modelOptions.length === 0);

const selectedModelOption = computed(() => props.modelOptions.find((option) => option.value === props.model) ?? null);
const modelLabel = computed(() => selectedModelOption.value?.label ?? props.model);
const effectiveReasoningEffort = computed(() => {
  const option = selectedModelOption.value;
  if (!option) return props.reasoningEffort;
  if (option.reasoningEfforts.some((effort) => effort.value === props.reasoningEffort)) {
    return props.reasoningEffort;
  }
  return option.defaultReasoningEffort || option.reasoningEfforts[0]?.value || props.reasoningEffort;
});

const activeModelOption = computed(
  () => props.modelOptions.find((option) => option.value === activeModel.value) ?? null
);
const activeModelLabel = computed(() => activeModelOption.value?.label ?? activeModel.value);
const activeReasoningEfforts = computed(() => activeModelOption.value?.reasoningEfforts ?? []);

const selectedReasoningLabel = computed(() => {
  const effort = effectiveReasoningEffort.value;
  if (!effort) return "";
  return reasoningEffortLabel(effort, t, te);
});

const modelPickerOptions = computed<VisibleOption[]>(() =>
  props.modelOptions.map((option) => ({
    value: option.value,
    label: option.label,
    toneClass: `composer-select--model is-${normalizeToneKey(option.value)}`,
    selected: option.value === props.model,
    active: option.value === activeModel.value,
  }))
);

const reasoningPickerOptions = computed<VisibleOption[]>(() =>
  activeReasoningEfforts.value.map((effort) => ({
    value: effort.value,
    label: reasoningEffortLabel(effort.value, t, te),
    toneClass: `composer-select--effort is-${normalizeToneKey(effort.value)}`,
    selected: activeModel.value === props.model && effort.value === effectiveReasoningEffort.value,
  }))
);

function measureModelPopoverContentWidth(popover: HTMLElement | null): number {
  if (!popover) return 0;
  const labels = Array.from(popover.querySelectorAll<HTMLElement>(".composer-model-reasoning-option-label"));
  if (labels.length === 0) return 0;

  const labelStyle = window.getComputedStyle(labels[0]);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  let maxLabelWidth = 0;
  if (context) {
    context.font = `${labelStyle.fontWeight || "700"} ${labelStyle.fontSize || "12px"} ${labelStyle.fontFamily || "monospace"}`;
    for (const label of labels) {
      maxLabelWidth = Math.max(maxLabelWidth, context.measureText(label.textContent ?? "").width);
    }
  }
  if (maxLabelWidth <= 0) {
    for (const label of labels) {
      maxLabelWidth = Math.max(maxLabelWidth, label.scrollWidth);
    }
  }
  if (!maxLabelWidth) return 0;

  let metaWidth = 32;
  popover.querySelectorAll<HTMLElement>(".composer-model-reasoning-option-meta").forEach((meta) => {
    metaWidth = Math.max(metaWidth, meta.getBoundingClientRect().width);
  });
  const computed = window.getComputedStyle(popover);
  const horizontalPadding =
    (Number.parseFloat(computed.paddingLeft) || 0) + (Number.parseFloat(computed.paddingRight) || 0);
  const rowPadding = 12;
  const rowGap = 8;
  return Math.ceil(maxLabelWidth + metaWidth + horizontalPadding + rowPadding + rowGap + 4);
}

function updatePopoverPosition() {
  const trigger = triggerRef.value;
  if (!trigger) return;
  const rect = trigger.getBoundingClientRect();
  const contentWidth = measureModelPopoverContentWidth(popoverRef.value);
  const viewportMaxWidth = Math.max(MODEL_POPOVER_MIN_WIDTH_PX, window.innerWidth - VIEWPORT_PADDING_PX * 2);
  const width = Math.min(viewportMaxWidth, Math.max(MODEL_POPOVER_MIN_WIDTH_PX, Math.round(rect.width), contentWidth));
  let left = Math.round(rect.left);
  left = Math.max(VIEWPORT_PADDING_PX, Math.min(left, window.innerWidth - width - VIEWPORT_PADDING_PX));

  const spaceBelow = Math.max(0, window.innerHeight - VIEWPORT_PADDING_PX - rect.bottom - POPOVER_GAP_PX);
  const spaceAbove = Math.max(0, rect.top - POPOVER_GAP_PX - VIEWPORT_PADDING_PX);
  const openBelow = spaceBelow >= 180 || spaceBelow >= spaceAbove;
  const maxHeight = Math.min(POPOVER_MAX_HEIGHT_PX, Math.max(140, openBelow ? spaceBelow : spaceAbove));
  const measuredHeight = Math.min(maxHeight, popoverRef.value?.scrollHeight || maxHeight);
  const top = openBelow
    ? rect.bottom + POPOVER_GAP_PX
    : Math.max(VIEWPORT_PADDING_PX, rect.top - POPOVER_GAP_PX - measuredHeight);

  popoverStyle.value = {
    position: "fixed",
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${Math.round(width)}px`,
    maxHeight: `${Math.round(maxHeight)}px`,
  };
  updateReasoningPopoverPosition();
}

function updateReasoningPopoverPosition() {
  const popover = popoverRef.value;
  if (!popover || !activeModel.value) return;

  const rect = popover.getBoundingClientRect();
  const row = popover.querySelector<HTMLElement>(
    `.composer-model-reasoning-option[data-value="${window.CSS?.escape?.(activeModel.value) ?? activeModel.value}"]`
  );
  const rowRect = row?.getBoundingClientRect() ?? rect;
  const width = REASONING_POPOVER_WIDTH_PX;
  const canOpenRight = rect.right + POPOVER_GAP_PX + width <= window.innerWidth - VIEWPORT_PADDING_PX;
  const left = canOpenRight
    ? rect.right + POPOVER_GAP_PX
    : Math.max(VIEWPORT_PADDING_PX, rect.left - width - POPOVER_GAP_PX);
  const desiredHeight = reasoningPopoverRef.value?.scrollHeight || 204;
  const height = Math.min(desiredHeight, window.innerHeight - VIEWPORT_PADDING_PX * 2);
  const top = Math.max(
    VIEWPORT_PADDING_PX,
    Math.min(Math.round(rowRect.top), Math.round(window.innerHeight - VIEWPORT_PADDING_PX - height))
  );

  reasoningPopoverStyle.value = {
    position: "fixed",
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${width}px`,
    height: `${Math.round(height)}px`,
  };
}

async function openPicker() {
  if (disabled.value) return;
  activeModel.value = props.model;
  open.value = true;
  await nextTick();
  updatePopoverPosition();
  window.requestAnimationFrame(() => {
    updatePopoverPosition();
    updateReasoningPopoverPosition();
  });
}

function closePicker() {
  open.value = false;
}

async function onTriggerClick() {
  if (disabled.value) return;
  if (open.value) {
    closePicker();
    return;
  }
  await openPicker();
}

async function showReasoningForModel(value: string) {
  activeModel.value = value;
  await nextTick();
  updateReasoningPopoverPosition();
}

async function onModelClick(value: string) {
  emit("update:model", value);
  const option = props.modelOptions.find((item) => item.value === value);
  if (
    option &&
    option.reasoningEfforts.length > 0 &&
    !option.reasoningEfforts.some((effort) => effort.value === props.reasoningEffort)
  ) {
    emit("update:reasoningEffort", option.defaultReasoningEffort || option.reasoningEfforts[0].value);
  }
  await showReasoningForModel(value);
}

function onReasoningClick(value: string) {
  if (activeModel.value && activeModel.value !== props.model) emit("update:model", activeModel.value);
  emit("update:reasoningEffort", value);
  closePicker();
}

async function onTriggerKeydown(event: KeyboardEvent) {
  if (disabled.value) return;
  if (event.key === "Escape") {
    closePicker();
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    await onTriggerClick();
  }
}

function onWindowPointerDownCapture(event: PointerEvent) {
  if (!open.value) return;
  const target = event.target as Node | null;
  if (!target) return;
  if (triggerRef.value?.contains(target)) return;
  if (popoverRef.value?.contains(target)) return;
  if (reasoningPopoverRef.value?.contains(target)) return;
  closePicker();
}

function onWindowResizeOrScroll() {
  if (open.value) updatePopoverPosition();
}

watch(open, (next) => {
  if (next) {
    window.addEventListener("pointerdown", onWindowPointerDownCapture, true);
    window.addEventListener("resize", onWindowResizeOrScroll, true);
    window.addEventListener("scroll", onWindowResizeOrScroll, true);
    return;
  }
  window.removeEventListener("pointerdown", onWindowPointerDownCapture, true);
  window.removeEventListener("resize", onWindowResizeOrScroll, true);
  window.removeEventListener("scroll", onWindowResizeOrScroll, true);
});

watch(disabled, (next) => {
  if (next) closePicker();
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onWindowPointerDownCapture, true);
  window.removeEventListener("resize", onWindowResizeOrScroll, true);
  window.removeEventListener("scroll", onWindowResizeOrScroll, true);
});
</script>
