<template>
  <WaveText
    v-bind="$attrs"
    :as="as"
    :text="text"
    :enabled="enabled"
    :color="color"
    :char-delay-sec="charDelaySec"
    :char-anim-duration-sec="charAnimDurationSec"
    :pause-sec="pauseSec"
    :cycle-max-chars="cycleMaxChars"
    :min-opacity="minOpacity"
    :max-opacity="maxOpacity"
  />
</template>

<script setup lang="ts">
// 执行中状态文案：统一工具调用、网页搜索、文件操作等 running 状态的文本入口。
import WaveText from "./WaveText.vue";

defineOptions({
  inheritAttrs: false,
});

withDefaults(
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
</script>
