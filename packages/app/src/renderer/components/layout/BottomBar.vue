<template>
  <footer class="bottom-bar" role="navigation" :aria-label="t('bottomBar.aria')">
    <div class="bottom-bar__left">
      <CodexProfileSwitch class="bottom-bar__profile-switch" />
    </div>

    <div class="bottom-bar__right">
      <div class="bottom-bar__conn mono" :class="connectionStateClass">
        <span class="bottom-bar__conn-icon" aria-hidden="true">
          <span class="bottom-bar__conn-dot"></span>
        </span>
        <span class="bottom-bar__conn-text">{{ connectionLabel }}</span>
      </div>

      <div class="bottom-bar__clock mono dim" :aria-label="t('bottomBar.currentTime', { time: timeText })">
        {{ timeText }}
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import CodexProfileSwitch from "./controls/CodexProfileSwitch.vue";
import { useAppShellStore } from "../../stores/appShell.store";

const appShellStore = useAppShellStore();
const { t } = useI18n();

const now = ref(Date.now());

const timeText = computed(() => {
  const dt = new Date(now.value);
  const yyyy = String(dt.getFullYear());
  const MM = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${yyyy}-${MM}-${dd} ${hh}:${mm}`;
});

let timerId: number | null = null;

function clearTimer() {
  if (timerId == null) return;
  window.clearTimeout(timerId);
  timerId = null;
}

function scheduleNextTick() {
  clearTimer();
  const delay = Math.max(16, 60_000 - (Date.now() % 60_000) + 16);
  timerId = window.setTimeout(() => {
    now.value = Date.now();
    scheduleNextTick();
  }, delay);
}

const connectionStateClass = computed(() => `is-${appShellStore.serverConnState}`);
const connectionLabel = computed(() => {
  if (appShellStore.serverConnState === "connected") return t("bottomBar.connected");
  if (appShellStore.serverConnState === "connecting") return t("bottomBar.connecting");
  if (appShellStore.serverConnState === "failed") return t("bottomBar.failed");
  return t("bottomBar.offline");
});
onMounted(() => {
  now.value = Date.now();
  scheduleNextTick();
});

onBeforeUnmount(() => {
  clearTimer();
});
</script>

<style scoped>
.bottom-bar {
  height: var(--bottombar-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0;
  border-top: 1px solid var(--panel-border, var(--border));
  background: var(--shell-chrome-bg, var(--topbar-bg, var(--panel-bg)));
  backdrop-filter: var(--shell-backdrop-filter, none);
  -webkit-backdrop-filter: var(--shell-backdrop-filter, none);
}

.bottom-bar__left,
.bottom-bar__right {
  min-width: 0;
  height: 100%;
  display: inline-flex;
  align-items: center;
}

.bottom-bar__right {
  justify-content: flex-end;
}

.bottom-bar .bottom-bar__profile-switch {
  flex: 0 1 auto;
  width: fit-content;
  max-width: min(230px, 42vw);
  height: 26px;
  margin-left: 6px;
  margin-right: 4px;
}

.bottom-bar .bottom-bar__profile-switch :deep(.codex-profile-switch__select) {
  width: clamp(148px, 18vw, 220px);
  height: 24px;
}

.bottom-bar__clock {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 0 10px 0 8px;
  font-size: 12px;
  line-height: 1;
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  user-select: none;
}

.bottom-bar__conn {
  height: 100%;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px 0 10px;
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.04em;
  color: color-mix(in srgb, var(--text-muted) 74%, transparent);
  user-select: none;
}

.bottom-bar__conn-icon {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--border) 74%, transparent);
  background: color-mix(in srgb, var(--surface-2) 62%, transparent);
}

.bottom-bar__conn-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--text-muted) 70%, transparent);
}

.bottom-bar__conn.is-connected .bottom-bar__conn-icon {
  border-color: var(--border-success);
  background: var(--bg-success-soft);
}

.bottom-bar__conn.is-connected .bottom-bar__conn-dot {
  background: var(--success);
}

.bottom-bar__conn.is-connecting .bottom-bar__conn-icon {
  border-color: var(--border-accent);
  background: var(--bg-accent-soft);
}

.bottom-bar__conn.is-connecting .bottom-bar__conn-dot {
  background: var(--accent);
  animation: connPulse 1.2s ease-in-out infinite;
}

.bottom-bar__conn.is-failed .bottom-bar__conn-icon {
  border-color: var(--border-danger);
  background: var(--bg-danger-soft);
}

.bottom-bar__conn.is-failed .bottom-bar__conn-dot {
  background: var(--danger);
}

@keyframes connPulse {
  0% {
    transform: scale(0.82);
    opacity: 0.62;
  }
  100% {
    transform: scale(1.12);
    opacity: 1;
  }
}
</style>
