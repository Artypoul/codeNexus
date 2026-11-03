<template>
  <div class="topbar-wrap">
    <header class="topbar">
      <div class="topbar-left row">
        <TopBarWorkspaceButton />
        <div
          class="topbar-mainview-switch"
          :class="{
            'is-chat': appShellStore.mainView === 'chat',
            'is-image': appShellStore.mainView === 'image',
          }"
          :aria-label="t('topbar.mainView')"
        >
          <button
            class="topbar-mainview-btn"
            :class="{ 'is-active': appShellStore.mainView === 'chat' }"
            type="button"
            :aria-label="t('topbar.chat')"
            @click="onSetMainView('chat')"
          >
            <MessageSquare class="topbar-mainview-icon" aria-hidden="true" />
            <span>{{ t("topbar.chat") }}</span>
          </button>
          <button
            class="topbar-mainview-btn"
            :class="{ 'is-active': appShellStore.mainView === 'image' }"
            type="button"
            :aria-label="t('topbar.image')"
            @click="onSetMainView('image')"
          >
            <ImageIcon class="topbar-mainview-icon" aria-hidden="true" />
            <span>{{ t("topbar.image") }}</span>
          </button>
        </div>
      </div>

      <div class="topbar-center-stack">
        <TopBarGoalSummary />
        <TopBarPlanSummary />
      </div>

      <div ref="rightStackRef" class="topbar-right-stack">
        <div class="row topbar-controls topbar-controls--sleek">
          <div class="control-group control-group-panes" :aria-label="t('topbar.panels')">
            <button
              id="btn-toggle-thread-pane"
              class="btn-icon"
              :class="{ 'is-active': appShellStore.leftSidebarVisible }"
              type="button"
              :disabled="appShellStore.settingsOpen"
              :aria-label="threadPaneTitle"
              :aria-pressed="appShellStore.leftSidebarVisible ? 'true' : 'false'"
              @click="onToggleThreadPane"
            >
              <PanelLeftClose v-if="appShellStore.leftSidebarVisible" aria-hidden="true" />
              <PanelLeftOpen v-else aria-hidden="true" />
            </button>
            <button
              id="btn-toggle-files-pane"
              class="btn-icon"
              :class="{ 'is-active': filesPaneVisible }"
              type="button"
              :disabled="!hasWorkspace || appShellStore.settingsOpen"
              :aria-label="filesPaneTitle"
              :aria-pressed="filesPaneVisible ? 'true' : 'false'"
              @click="onToggleFilesPane"
            >
              <PanelRightClose v-if="filesPaneVisible" aria-hidden="true" />
              <PanelRightOpen v-else aria-hidden="true" />
            </button>
            <button
              id="btn-open-settings"
              class="btn-icon"
              :class="{ 'is-active': appShellStore.settingsOpen }"
              type="button"
              :aria-label="t('topbar.openSettings')"
              :aria-pressed="appShellStore.settingsOpen ? 'true' : 'false'"
              @click="onOpenSettings"
            >
              <Settings aria-hidden="true" />
            </button>
          </div>
          <div class="topbar-control-divider" aria-hidden="true"></div>
          <div class="control-group control-group-actions">
            <TopBarUpdateNotice />
            <TopBarThemeSwitch />
          </div>

          <div class="control-group control-group-window">
            <TopBarWindowControls />
          </div>
        </div>
      </div>
    </header>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  Image as ImageIcon,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Settings,
} from "lucide-vue-next";
import TopBarWorkspaceButton from "./topbar/TopBarWorkspaceButton.vue";
import TopBarGoalSummary from "./topbar/TopBarGoalSummary.vue";
import TopBarPlanSummary from "./topbar/TopBarPlanSummary.vue";
import TopBarThemeSwitch from "./topbar/TopBarThemeSwitch.vue";
import TopBarUpdateNotice from "./topbar/TopBarUpdateNotice.vue";
import TopBarWindowControls from "./topbar/TopBarWindowControls.vue";
import { useAppShellStore } from "../../stores/appShell.store";
import { useRuntimeStore } from "../../stores/runtime.store";
import { useWorkspaceFilesStore } from "../../stores/workspaceFiles.store";
import { isFeatureMainView } from "../../features/registry";
import "./topbar/topbar.css";
import type { MainView } from "@codenexus/shared/localSettings";

const appShellStore = useAppShellStore();
const { t } = useI18n();
const runtimeStore = useRuntimeStore();
const workspaceFilesStore = useWorkspaceFilesStore();
const rightStackRef = ref<HTMLElement | null>(null);

const reducedMotionQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
let rightStackAnimationFrame = 0;
let rightStackAnimationTimer = 0;

const hasWorkspace = computed(() => Boolean(String(runtimeStore.workspacePath ?? "").trim()));
const filesPaneVisible = computed(
  () =>
    hasWorkspace.value &&
    !appShellStore.settingsOpen &&
    appShellStore.mainView === "chat" &&
    appShellStore.filesSidebarVisible
);
const threadPaneTitle = computed(() => {
  if (appShellStore.settingsOpen) return t("topbar.threadPanelHiddenInSettings");
  if (appShellStore.mainView === "image") {
    return appShellStore.leftSidebarVisible
      ? t("topbar.closeImageWorkspacePanel")
      : t("topbar.openImageWorkspacePanel");
  }
  return appShellStore.leftSidebarVisible ? t("topbar.closeThreadPanel") : t("topbar.openThreadPanel");
});
const filesPaneTitle = computed(() => {
  if (!hasWorkspace.value) return t("topbar.chooseWorkspaceBeforeFiles");
  if (appShellStore.settingsOpen) return t("topbar.filesPanelHiddenInSettings");
  if (appShellStore.mainView === "image") return t("topbar.filesPanelHiddenInImage");
  return filesPaneVisible.value ? t("topbar.closeFilesPanel") : t("topbar.openFilesPanel");
});

function prefersReducedMotion() {
  return Boolean(reducedMotionQuery?.matches);
}

function clearRightStackLayoutAnimation() {
  if (rightStackAnimationFrame) {
    window.cancelAnimationFrame(rightStackAnimationFrame);
    rightStackAnimationFrame = 0;
  }
  if (rightStackAnimationTimer) {
    window.clearTimeout(rightStackAnimationTimer);
    rightStackAnimationTimer = 0;
  }

  const rightStack = rightStackRef.value;
  if (!rightStack) return;
  rightStack.classList.remove("is-layout-animating");
  rightStack.style.transition = "";
  rightStack.style.transform = "";
}

watch(
  () => runtimeStore.workspacePath,
  async () => {
    const rightStack = rightStackRef.value;
    if (!rightStack || prefersReducedMotion()) return;

    const previousLeft = rightStack.getBoundingClientRect().left;
    await nextTick();

    const updatedRightStack = rightStackRef.value;
    if (!updatedRightStack) return;

    const nextLeft = updatedRightStack.getBoundingClientRect().left;
    const deltaX = previousLeft - nextLeft;
    if (Math.abs(deltaX) < 1) return;

    clearRightStackLayoutAnimation();
    updatedRightStack.style.transition = "none";
    updatedRightStack.style.transform = `translateX(${deltaX}px)`;
    void updatedRightStack.offsetWidth;

    rightStackAnimationFrame = window.requestAnimationFrame(() => {
      rightStackAnimationFrame = 0;
      updatedRightStack.classList.add("is-layout-animating");
      updatedRightStack.style.transition = "";
      updatedRightStack.style.transform = "translateX(0)";
      rightStackAnimationTimer = window.setTimeout(() => {
        rightStackAnimationTimer = 0;
        updatedRightStack.classList.remove("is-layout-animating");
        updatedRightStack.style.transition = "";
        updatedRightStack.style.transform = "";
      }, 240);
    });
  },
  { flush: "pre" }
);

onBeforeUnmount(() => {
  clearRightStackLayoutAnimation();
});

function onSetMainView(next: MainView) {
  if (isFeatureMainView(next)) {
    appShellStore.openFeatureWorkbench(next);
    return;
  }
  appShellStore.setMainView(next);
  if (appShellStore.settingsOpen) appShellStore.closeSettings();
}

function onToggleThreadPane() {
  if (appShellStore.settingsOpen) return;
  appShellStore.toggleLeftSidebarVisible();
}

async function onToggleFilesPane() {
  if (!hasWorkspace.value || appShellStore.settingsOpen || appShellStore.mainView !== "chat") return;
  if (filesPaneVisible.value) {
    const confirmed = await workspaceFilesStore.prepareToHidePane();
    if (!confirmed) return;
    appShellStore.setFilesSidebarVisible(false);
    return;
  }
  appShellStore.setFilesSidebarVisible(true);
}

function onOpenSettings() {
  appShellStore.openSettings("global");
}
</script>
