<template>
  <Transition name="goal-shutdown-overlay" appear>
    <section v-if="countdown" class="goal-shutdown-overlay" :aria-label="t('goalShutdown.aria')">
      <div class="goal-shutdown-backdrop"></div>
      <div class="goal-shutdown-panel" role="dialog" aria-modal="true" :aria-label="t('goalShutdown.title')">
        <div class="goal-shutdown-kicker mono">{{ t("goalShutdown.kicker") }}</div>
        <h2 class="goal-shutdown-title">{{ t("goalShutdown.title") }}</h2>
        <p class="goal-shutdown-message">{{ t("goalShutdown.message") }}</p>
        <div class="goal-shutdown-goal">{{ countdown.objective }}</div>
        <div class="goal-shutdown-count mono">
          {{ t("goalShutdown.remainingSeconds", { count: countdown.remainingSeconds }) }}
        </div>
        <button class="btn-mini danger goal-shutdown-cancel" type="button" @click="store.cancelCountdown">
          {{ t("goalShutdown.cancel") }}
        </button>
      </div>
    </section>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useGoalShutdownStore } from "../../../stores/goalShutdown.store";

const { t } = useI18n();
const store = useGoalShutdownStore();
const countdown = computed(() => store.countdown);
</script>

<style scoped>
.goal-shutdown-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  pointer-events: auto;
}

.goal-shutdown-backdrop {
  position: absolute;
  inset: 0;
  background: rgb(from var(--bg) r g b / 0.56);
  backdrop-filter: var(--frost-soft);
}

.goal-shutdown-panel {
  position: relative;
  width: min(440px, calc(100vw - 32px));
  border: 1px solid color-mix(in srgb, var(--danger) 28%, var(--border) 72%);
  border-radius: 8px;
  background: var(--surface-1);
  box-shadow: var(--shadow-floating);
  padding: 24px;
  color: var(--text);
}

.goal-shutdown-kicker {
  color: var(--danger);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.goal-shutdown-title {
  margin: 8px 0 0;
  font-size: 22px;
  font-weight: 800;
  line-height: 1.2;
}

.goal-shutdown-message {
  margin: 10px 0 0;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.goal-shutdown-goal {
  margin-top: 16px;
  max-height: 96px;
  overflow: hidden;
  border-radius: 8px;
  background: var(--surface-2);
  padding: 12px;
  font-size: 13px;
  line-height: 1.45;
}

.goal-shutdown-count {
  margin-top: 18px;
  font-size: 32px;
  font-weight: 800;
  color: var(--danger);
}

.goal-shutdown-cancel {
  margin-top: 18px;
  width: 100%;
  justify-content: center;
}

.goal-shutdown-overlay-enter-active,
.goal-shutdown-overlay-leave-active {
  transition: opacity 160ms ease;
}

.goal-shutdown-overlay-enter-from,
.goal-shutdown-overlay-leave-to {
  opacity: 0;
}
</style>
