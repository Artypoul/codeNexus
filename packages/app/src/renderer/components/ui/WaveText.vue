<template>
  <component
    :is="as"
    class="wave-text break-words whitespace-pre-wrap text-[color:var(--wave-color)]"
    :class="{ 'wave-text--animated': animated }"
    :style="rootStyle"
    :aria-label="text"
    >{{ text }}</component
  >
</template>

<script setup lang="ts">
// 波浪文字动画：单个文本节点 + CSS 遮罩扫光。
// 早期实现把每个字符渲染成一个 span 并各自挂动画，多卡片同时 running 时节点与动画数量会线性膨胀。
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    text: string;
    enabled?: boolean;
    color?: string;
    charDelaySec?: number;
    charAnimDurationSec?: number;
    pauseSec?: number;
    cycleMaxChars?: number;
    minOpacity?: number;
    maxOpacity?: number;
    as?: "span" | "div";
  }>(),
  {
    enabled: true,
    color: "var(--accent)",
    charDelaySec: 0.12,
    charAnimDurationSec: 1,
    pauseSec: 0,
    cycleMaxChars: 0,
    minOpacity: 0.25,
    maxOpacity: 1,
    as: "span",
  }
);

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const animated = computed(() => Boolean(props.enabled) && String(props.text ?? "").trim().length > 0);

// 把逐字符节奏换算成一次完整扫光的总时长，保持原有的“从暗到亮再回落”观感。
const rootStyle = computed(() => {
  const minOpacity = clamp01(Number(props.minOpacity));
  const maxOpacity = clamp01(Number(props.maxOpacity));
  const animSec = Math.max(0.1, Number(props.charAnimDurationSec) || 1);
  const delaySec = Math.max(0, Number(props.charDelaySec) || 0);
  const pauseSec = Math.max(0, Number(props.pauseSec) || 0);
  const charCount = Array.from(String(props.text ?? "")).length;
  const maxChars = Math.floor(Number(props.cycleMaxChars) || 0);
  const cycleChars = maxChars > 0 ? Math.min(charCount, Math.max(1, maxChars)) : Math.max(1, charCount);
  const sweepSec = Math.max(0.6, (cycleChars - 1) * delaySec + animSec + pauseSec);
  return {
    "--wave-color": String(props.color ?? "var(--accent)"),
    "--wave-min-op": String(Number.isFinite(minOpacity) ? minOpacity : 0.25),
    "--wave-max-op": String(Number.isFinite(maxOpacity) ? maxOpacity : 1),
    "--wave-dur": `${Math.round(sweepSec * 100) / 100}s`,
  } as Record<string, string>;
});
</script>
