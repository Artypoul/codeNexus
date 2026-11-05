<template>
  <svg
    class="execution-core-icon"
    :class="{ 'is-running': running }"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <g class="execution-core-icon__orbit execution-core-icon__orbit--outer">
      <ellipse cx="12" cy="12" rx="9" ry="4.5" stroke="currentColor" stroke-width="1.25" opacity="0.35" />
      <circle cx="21" cy="12" r="1.8" fill="currentColor" />
      <circle cx="3" cy="12" r="1" fill="currentColor" opacity="0.55" />
    </g>
    <g class="execution-core-icon__orbit execution-core-icon__orbit--inner">
      <ellipse cx="12" cy="12" rx="9" ry="4.5" stroke="currentColor" stroke-width="1.25" opacity="0.25" />
      <circle cx="3" cy="12" r="1.5" fill="currentColor" />
    </g>
    <path d="M12 8.5 15.5 12 12 15.5 8.5 12Z" fill="currentColor" />
  </svg>
</template>

<script setup lang="ts">
defineProps<{ running?: boolean }>();
</script>

<style scoped>
.execution-core-icon {
  display: block;
  width: var(--execution-core-size, 20px);
  height: var(--execution-core-size, 20px);
  flex: 0 0 auto;
}

.execution-core-icon__orbit {
  transform-box: view-box;
  transform-origin: center;
  transform: rotate(var(--execution-core-orbit-angle));
}

.execution-core-icon__orbit--outer {
  --execution-core-orbit-angle: -35deg;
}

.execution-core-icon__orbit--inner {
  --execution-core-orbit-angle: 35deg;
}

.execution-core-icon.is-running .execution-core-icon__orbit--outer {
  animation: execution-core-orbit-turn 3.2s linear infinite;
}

.execution-core-icon.is-running .execution-core-icon__orbit--inner {
  animation: execution-core-orbit-turn 4.8s linear infinite reverse;
}

@keyframes execution-core-orbit-turn {
  from {
    transform: rotate(var(--execution-core-orbit-angle));
  }
  to {
    transform: rotate(calc(var(--execution-core-orbit-angle) + 360deg));
  }
}
</style>
