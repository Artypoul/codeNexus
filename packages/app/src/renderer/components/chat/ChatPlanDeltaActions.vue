<template>
  <div class="plan-delta-actions flex flex-wrap items-center justify-end gap-2" :class="rootClass">
    <ComposerModelReasoningPicker
      :model="execState.model"
      :reasoningEffort="execState.reasoningEffort"
      :modelOptions="modelOptions"
      :disabled="disabled"
      @update:model="(value) => $emit('update:model', value)"
      @update:reasoningEffort="(value) => $emit('update:reasoning-effort', value)"
    />
    <ComposerSandboxPicker
      :modelValue="execState.sandboxMode"
      :options="normalizedSandboxModeOptions"
      tooltipText=""
      :disabled="disabled"
      @update:modelValue="(value) => $emit('update:sandbox-mode', value)"
    />
    <button
      class="plan-delta-execute-button !inline-flex !h-7 !items-center !justify-center !border !border-[color:var(--border-warning)] !bg-gradient-to-b !from-[color:var(--bg-warning-soft)] !to-[color:var(--button-bg)] !px-3 !tracking-[0.1px] !text-[color:var(--fg-warning)] !shadow-none transition-[border-color,background,box-shadow,color] duration-150 hover:!border-[color:var(--border-warning-hover)] hover:!to-[color:var(--button-bg-hover)] focus-visible:!outline-none focus-visible:!ring-2 focus-visible:!ring-[color:var(--bg-warning-soft)] active:!translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
      type="button"
      :disabled="disabled"
      @click="$emit('execute-plan')"
    >
      <span v-if="execState.executing">{{ t("chat.planActions.executing") }}</span>
      <span v-else>{{ t("chat.planActions.executePlan") }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import ComposerModelReasoningPicker from "../layout/composer/ComposerModelReasoningPicker.vue";
import ComposerSandboxPicker from "../layout/composer/ComposerSandboxPicker.vue";
import type { PlanDeltaExecUiState } from "../layout/types/chat.types";
import type { SandboxMode } from "../../stores/runtime.store";
import type { ModelPickerOption } from "@codenexus/shared/modelCatalog";

type OptionInput =
  | string
  | {
      value: string;
      label: string;
      disabled?: boolean;
    };

type SelectOption = {
  value: string;
  label: string;
};

const props = defineProps<{
  execState: PlanDeltaExecUiState;
  modelOptions: readonly ModelPickerOption[];
  sandboxModeOptions: readonly OptionInput[];
  disabled: boolean;
  embedded?: boolean;
  compact?: boolean;
}>();

const { t } = useI18n();
const rootClass = computed(() =>
  [
    props.embedded ? "mt-0 border-t-0 pt-0" : "mt-3 border-t border-[var(--border)] pt-2.5",
    props.compact ? "plan-delta-actions--compact" : "",
  ]
    .filter(Boolean)
    .join(" ")
);

const optionValue = (option: OptionInput): string => (typeof option === "string" ? option : option.value);
const optionLabel = (option: OptionInput): string => (typeof option === "string" ? option : option.label);

const normalizedSandboxModeOptions = computed<SelectOption[]>(() =>
  props.sandboxModeOptions
    .map((option) => ({ value: optionValue(option), label: optionLabel(option) }))
    .filter((option) => option.value)
);

defineEmits<{
  (e: "execute-plan"): void;
  (e: "update:model", value: string): void;
  (e: "update:reasoning-effort", value: string): void;
  (e: "update:sandbox-mode", value: SandboxMode): void;
}>();
</script>

<style scoped>
.plan-delta-actions--compact {
  gap: 6px;
  align-items: center;
  justify-content: flex-end;
}

.plan-delta-actions--compact :deep(.composer-model-reasoning-trigger) {
  width: clamp(138px, 18vw, 176px);
  min-width: 138px;
}

.plan-delta-actions--compact :deep(.composer-sandbox-trigger) {
  width: 76px;
  min-width: 76px;
}

.plan-delta-actions--compact .plan-delta-execute-button {
  min-width: 78px;
  padding-inline: 9px !important;
}
</style>
