<template>
  <button
    id="btn-window-minimize"
    class="btn-icon"
    type="button"
    :aria-label="t('topbarExtra.minimize')"
    :title="t('topbarExtra.minimize')"
    @click="onWindowMinimize"
  >
    <Minus aria-hidden="true" />
  </button>
  <button
    id="btn-window-maximize"
    class="btn-icon"
    type="button"
    :aria-label="windowExpanded ? t('topbarExtra.restore') : t('topbarExtra.maximize')"
    :title="windowExpanded ? t('topbarExtra.restore') : t('topbarExtra.maximize')"
    @click="onWindowToggleMaximize"
  >
    <Copy v-if="windowExpanded" aria-hidden="true" />
    <Square v-else aria-hidden="true" />
  </button>
  <button
    id="btn-window-close"
    class="btn-icon danger"
    type="button"
    :aria-label="t('topbarExtra.close')"
    :title="t('topbarExtra.close')"
    @click="onWindowClose"
  >
    <X aria-hidden="true" />
  </button>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Copy, Minus, Square, X } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { codexDesktop } from "../../../api/codexDesktopClient";
import type { AppWindowState } from "@codenexus/shared/ipc/contracts";

const { t } = useI18n();

const windowState = ref<AppWindowState>({
  isMaximized: false,
  isMinimized: false,
  isFullScreen: false,
});

const windowExpanded = computed(() => windowState.value.isMaximized || windowState.value.isFullScreen);

let stopWindowStateListener: (() => void) | null = null;

function onWindowMinimize() {
  void codexDesktop.window.minimize().catch((error) => {
    console.warn("[TopBarWindowControls] window minimize failed", error);
  });
}

function onWindowToggleMaximize() {
  void codexDesktop.window.toggleMaximize().catch((error) => {
    console.warn("[TopBarWindowControls] window maximize toggle failed", error);
  });
}

function onWindowClose() {
  void codexDesktop.window.close().catch((error) => {
    console.warn("[TopBarWindowControls] window close failed", error);
  });
}

onMounted(() => {
  void (async () => {
    try {
      windowState.value = await codexDesktop.window.getState();
    } catch {}
  })();

  try {
    stopWindowStateListener = codexDesktop.window.onState((payload) => {
      windowState.value = payload;
    });
  } catch {}
});

onBeforeUnmount(() => {
  try {
    stopWindowStateListener?.();
  } catch {}
  stopWindowStateListener = null;
});
</script>
