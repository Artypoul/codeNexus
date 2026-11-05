<template>
  <div class="ui-waterball-progress" :class="levelClass" :style="rootStyle" role="img" :aria-label="ariaLabelText">
    <span class="ui-waterball-progress__ring" aria-hidden="true">
      <span class="ui-waterball-progress__value">{{ displayPercent }}</span>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

type ProgressLevel = "normal" | "warn" | "high" | "critical";

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const toFinite = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const props = withDefaults(
  defineProps<{
    percent: number;
    size?: number;
    level?: string;
    ariaLabel?: string;
  }>(),
  {
    size: undefined,
    level: "",
  }
);

const { t } = useI18n();
const clampedPercent = computed(() => clamp(toFinite(props.percent, 0), 0, 100));
const level = computed<ProgressLevel>(() => {
  const raw = String(props.level ?? "")
    .trim()
    .toLowerCase();
  if (raw === "warn" || raw === "high" || raw === "critical") return raw;
  return "normal";
});

const sizeValue = computed(() => {
  if (props.size == null) return 32;
  return Math.round(Math.max(16, toFinite(props.size, 32)));
});

const rootStyle = computed(
  () =>
    ({
      "--progress-size": `${sizeValue.value}px`,
      "--progress-value": `${clampedPercent.value}%`,
      "--progress-font-size": `${clamp(Math.round(sizeValue.value * 0.25), 7, 12)}px`,
    }) as Record<string, string>
);

const displayPercent = computed(() => `${Math.round(clampedPercent.value)}`);
const levelClass = computed(() => `is-${level.value}`);
const ariaLabelText = computed(() => {
  if (props.ariaLabel) return String(props.ariaLabel);
  return t("progress.aria", { percent: Math.round(clampedPercent.value) });
});
</script>

<style scoped>
.ui-waterball-progress {
  width: var(--progress-size, 32px);
  height: var(--progress-size, 32px);
  flex: 0 0 auto;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  --progress-color: var(--accent);
  --progress-bg: color-mix(in srgb, var(--accent) 12%, transparent);
  --progress-border: color-mix(in srgb, var(--border) 84%, var(--accent) 16%);
  --progress-center: color-mix(in srgb, var(--surface-1) 88%, var(--bg) 12%);
  --progress-value-color: color-mix(in srgb, var(--text-muted) 84%, var(--progress-color) 16%);
  --progress-shadow: color-mix(in srgb, var(--accent) 8%, transparent);
}

.ui-waterball-progress.is-warn {
  --progress-color: var(--warning);
  --progress-bg: color-mix(in srgb, var(--warning) 14%, transparent);
  --progress-border: color-mix(in srgb, var(--border-warning) 72%, var(--border) 28%);
  --progress-value-color: color-mix(in srgb, var(--text-muted) 58%, var(--warning) 42%);
  --progress-shadow: color-mix(in srgb, var(--warning) 10%, transparent);
}

.ui-waterball-progress.is-high {
  --progress-color: var(--warning);
  --progress-bg: color-mix(in srgb, var(--warning) 17%, transparent);
  --progress-border: var(--border-warning-hover);
  --progress-value-color: var(--fg-warning, var(--warning));
  --progress-shadow: color-mix(in srgb, var(--warning) 14%, transparent);
}

.ui-waterball-progress.is-critical {
  --progress-color: var(--danger);
  --progress-bg: color-mix(in srgb, var(--danger) 18%, transparent);
  --progress-border: var(--border-danger-hover);
  --progress-value-color: var(--fg-danger, var(--danger));
  --progress-shadow: color-mix(in srgb, var(--danger) 18%, transparent);
}

.ui-waterball-progress__ring {
  width: 100%;
  height: 100%;
  display: inline-grid;
  place-items: center;
  border-radius: inherit;
  border: 1px solid var(--progress-border);
  background:
    radial-gradient(circle at 50% 50%, var(--progress-center) 0 56%, transparent 57%),
    conic-gradient(var(--progress-color) var(--progress-value), var(--progress-bg) 0);
  box-shadow:
    inset 0 0 0 1px rgb(from var(--progress-color) r g b / 0.04),
    0 0 6px var(--progress-shadow);
  transition:
    background 180ms ease,
    border-color 180ms ease,
    box-shadow 180ms ease;
}

.ui-waterball-progress__value {
  min-width: 0;
  color: var(--progress-value-color);
  font-size: var(--progress-font-size, 8px);
  font-weight: 680;
  line-height: 1;
  letter-spacing: 0;
  font-variant-numeric: tabular-nums;
}
</style>
