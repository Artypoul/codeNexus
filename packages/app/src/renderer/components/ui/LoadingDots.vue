<template>
  <component :is="as" :aria-label="labelText">
    <slot name="prefix"></slot>
    <span>{{ baseText }}</span
    ><span aria-hidden="true">...</span>
  </component>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    baseText: string;
    as?: "span" | "div";
    ariaLabel?: string;
  }>(),
  {
    as: "span",
    ariaLabel: "",
  }
);

const labelText = computed(() => String(props.ariaLabel ?? "").trim() || `${props.baseText}...`);
</script>
