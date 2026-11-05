<template>
  <component
    :is="as"
    class="wave-text break-words whitespace-pre-wrap text-[color:var(--wave-color)]"
    :style="rootStyle"
    :aria-label="text"
    >{{ text }}</component
  >
</template>

<script setup lang="ts">
// 执行状态文字：保留统一入口和颜色参数，不再做波浪扫光动画。
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

const rootStyle = computed(
  () =>
    ({
      "--wave-color": String(props.color ?? "var(--accent)"),
    }) as Record<string, string>
);
</script>
