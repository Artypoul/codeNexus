<template>
  <div class="app-shell">
    <TopBar key="topbar" />
    <main ref="mainRef" class="main" :class="mainClass" :style="mainStyle">
      <Transition :name="leftPaneTransitionName" mode="out-in">
        <component
          :is="featureWorkspaceSidebar"
          v-if="featureWorkspaceSidebar"
          :key="`${mainView}-workspace`"
          class="tasks-pane-host"
        />
        <LeftSidebar v-else-if="showLeftSidebar" key="threads" class="tasks-pane-host" />
      </Transition>

      <Transition :name="mainViewTransitionName" mode="out-in">
        <div v-if="settingsOpen" key="settings" class="center-content-host">
          <SettingsPage />
        </div>
        <div v-else-if="activeFeature" :key="activeFeature.mainView" class="center-content-host">
          <component :is="activeFeature.workbenchComponent" />
        </div>
        <div v-else key="chat" class="center-content-host">
          <CenterPane />
        </div>
      </Transition>
      <div
        v-if="!settingsOpen && showEditorPane"
        class="center-workbench-sash"
        role="separator"
        aria-orientation="vertical"
        :aria-label="t('appShell.resizeEditor')"
        :aria-valuenow="String(Math.round(effectiveEditorWidthPx))"
        tabindex="0"
        @pointerdown="onEditorSashPointerDown"
        @keydown="onEditorSashKeydown"
      ></div>
      <WorkspaceEditorPane
        v-if="!settingsOpen && showEditorPane"
        class="workspace-editor-pane-host"
        :class="{ 'is-compact': isEditorCompact }"
      />
      <Transition name="side-pane-switch" mode="out-in">
        <component
          :is="featureSettingsSidebar"
          v-if="featureSettingsSidebar"
          :key="`${mainView}-settings`"
          class="files-pane-host"
        />
        <DebugTimelineSidebar v-else-if="showDebugSidebar" key="debug" class="files-pane-host" />
        <WorkspaceFilesSidebar v-else-if="showFilesSidebar" key="files" class="files-pane-host" />
      </Transition>
    </main>
    <BottomBar />
    <div class="app-overlays">
      <AppClosingOverlay v-if="showAppClosingOverlay" />
      <GoalShutdownCountdownOverlay v-if="showGoalShutdownOverlay" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import TopBar from "./components/layout/TopBar.vue";
import CenterPane from "./components/layout/CenterPane.vue";
import BottomBar from "./components/layout/BottomBar.vue";
import {
  AppClosingOverlay,
  DebugTimelineSidebar,
  GoalShutdownCountdownOverlay,
  LeftSidebar,
  SettingsPage,
  WorkspaceEditorPane,
  WorkspaceFilesSidebar,
} from "./components/asyncViews";
import {
  allowsWorkspaceFilesSidebar,
  getFeatureByMainView,
  mainViewTransitionOrder,
  shouldShowDefaultLeftSidebar,
} from "./features/registry";
import { codexDesktop } from "./api/codexDesktopClient";
import { useAppClosingStore } from "./stores/appClosing.store";
import { useAppShellStore } from "./stores/appShell.store";
import { useGoalShutdownStore } from "./stores/goalShutdown.store";
import { useNotificationSoundStore } from "./stores/notificationSound.store";
import { useRuntimeStore } from "./stores/runtime.store";
import { useWorkspaceFilesStore } from "./stores/workspaceFiles.store";
import type { AppWindowState } from "@codenexus/shared/ipc/contracts";
import {
  CENTER_BASE_MIN_WIDTH_PX,
  CENTER_EDITOR_HARD_MIN_WIDTH_PX,
  CENTER_EDITOR_SASH_WIDTH_PX,
  CENTER_EDITOR_SOFT_MIN_WIDTH_PX,
  CENTER_WITH_EDITOR_HARD_MIN_WIDTH_PX,
  CENTER_TIMELINE_HARD_MIN_WIDTH_PX,
  resolveCenterWidths,
  resolveShellWidths,
} from "./domain/layoutWidthBudget";

const appShellStore = useAppShellStore();
const { t } = useI18n();
const appClosingStore = useAppClosingStore();
const goalShutdownStore = useGoalShutdownStore();
const runtimeStore = useRuntimeStore();
const notificationSoundStore = useNotificationSoundStore();
const workspaceFilesStore = useWorkspaceFilesStore();
appShellStore.initLocalSettings();
runtimeStore.initLocalDraftState();
notificationSoundStore.initLocalSettings();
goalShutdownStore.initLocalSettings();
appClosingStore.initBridge();
void notificationSoundStore.refreshAvailable();

const settingsOpen = computed(() => appShellStore.settingsOpen);
const showAppClosingOverlay = computed(() => appClosingStore.visible);
const showGoalShutdownOverlay = computed(() => goalShutdownStore.visible);
const mainView = computed(() => appShellStore.mainView);
const activeFeature = computed(() => getFeatureByMainView(mainView.value));
const featureWorkspaceSidebar = computed(() => {
  if (settingsOpen.value || !appShellStore.leftSidebarVisible) return null;
  return activeFeature.value?.workspaceSidebarComponent ?? null;
});
const featureSettingsSidebar = computed(() => {
  if (settingsOpen.value) return null;
  return activeFeature.value?.settingsSidebarComponent ?? null;
});
const showLeftSidebar = computed(
  () =>
    !settingsOpen.value &&
    appShellStore.leftSidebarVisible &&
    !featureWorkspaceSidebar.value &&
    shouldShowDefaultLeftSidebar(mainView.value)
);
const showLeftPane = computed(() => Boolean(featureWorkspaceSidebar.value) || showLeftSidebar.value);
const showDebugSidebar = computed(
  () => !settingsOpen.value && mainView.value === "chat" && runtimeStore.timelineDebugEnabled
);
const showFilesSidebar = computed(() => {
  return (
    !settingsOpen.value &&
    allowsWorkspaceFilesSidebar(mainView.value) &&
    Boolean(String(runtimeStore.workspacePath ?? "").trim()) &&
    appShellStore.filesSidebarVisible &&
    !showDebugSidebar.value
  );
});

let stopWindowStateListener: (() => void) | null = null;
const applyWindowStateToDocument = (state: AppWindowState) => {
  const windowMode = state.isFullScreen ? "fullscreen" : state.isMaximized ? "maximized" : "normal";
  try {
    document.documentElement.dataset.window = windowMode;
  } catch {}
};

onMounted(() => {
  void (async () => {
    try {
      const state = await codexDesktop.window.getState();
      applyWindowStateToDocument(state);
    } catch {}
  })();

  try {
    stopWindowStateListener = codexDesktop.window.onState((payload) => {
      applyWindowStateToDocument(payload);
    });
  } catch {}
});

watch(
  () => appClosingStore.phase,
  (phase, previousPhase) => {
    if (phase !== "preparing" || previousPhase === "preparing") return;
    void runtimeStore.flushPendingComposeStateSaves().catch((error) => {
      console.warn("[App] flush pending compose state saves failed", error);
    });
  }
);

const UNIFIED_SIDEBAR_WIDTH_PX = 300;
const CENTER_EDITOR_KEYBOARD_STEP_PX = 20;

const mainRef = ref<HTMLElement | null>(null);
const mainViewTransitionName = ref("main-view-fade");
const leftPaneTransitionName = ref("left-pane-switch-forward");
const editorResizeState = ref<{
  startClientX: number;
  startWidthPx: number;
  previewWidthPx: number;
} | null>(null);

watch(
  () => [appShellStore.mainView, appShellStore.settingsOpen] as const,
  ([nextView, nextSettingsOpen], [previousView, previousSettingsOpen]) => {
    if (nextSettingsOpen || previousSettingsOpen) {
      mainViewTransitionName.value = "main-view-fade";
      leftPaneTransitionName.value = "left-pane-switch-fade";
      return;
    }

    const nextOrder = mainViewTransitionOrder(nextView);
    const previousOrder = mainViewTransitionOrder(previousView);
    const isForward = nextOrder > previousOrder;
    const isBack = nextOrder < previousOrder;
    if (!isForward && !isBack) return;

    const direction = isForward ? "forward" : "back";
    mainViewTransitionName.value = `main-view-${direction}`;
    leftPaneTransitionName.value = `left-pane-switch-${direction}`;
  }
);

const showEditorPane = computed(
  () => !settingsOpen.value && mainView.value === "chat" && workspaceFilesStore.hasOpenTabs
);

const centerHardMinWidthPx = computed(() => {
  return showEditorPane.value ? CENTER_WITH_EDITOR_HARD_MIN_WIDTH_PX : CENTER_BASE_MIN_WIDTH_PX;
});

const resolvedShellWidths = computed(() => {
  return resolveShellWidths({
    containerWidth: getMainWidthPx(),
    leftVisible: showLeftPane.value,
    filesVisible: showFilesSidebar.value || showDebugSidebar.value || Boolean(featureSettingsSidebar.value),
    rightVisible: false,
    leftPreferredWidth: UNIFIED_SIDEBAR_WIDTH_PX,
    filesPreferredWidth: UNIFIED_SIDEBAR_WIDTH_PX,
    rightPreferredWidth: 0,
    centerHardMinWidth: centerHardMinWidthPx.value,
    prioritySide: "left",
  });
});

const effectiveLeftSidebarWidthPx = computed(() => {
  return resolvedShellWidths.value.leftWidth;
});

const effectiveFilesSidebarWidthPx = computed(() => {
  return resolvedShellWidths.value.filesWidth;
});

const resolvedCenterWidths = computed(() => {
  return resolveCenterWidths({
    containerWidth: resolvedShellWidths.value.centerWidth,
    editorVisible: showEditorPane.value,
    editorPreferredWidth: editorResizeState.value?.previewWidthPx ?? appShellStore.centerEditorWidthPx,
  });
});

const effectiveEditorWidthPx = computed(() => {
  return resolvedCenterWidths.value.editorWidth;
});

const isEditorCompact = computed(() => {
  return showEditorPane.value && effectiveEditorWidthPx.value < CENTER_EDITOR_SOFT_MIN_WIDTH_PX;
});

watch(
  showEditorPane,
  (visible) => {
    if (visible) return;
    editorResizeState.value = null;
    teardownEditorResizeListeners();
  },
  { flush: "post" }
);

const mainClass = computed(() => ({
  "has-editor": !settingsOpen.value && showEditorPane.value,
  "has-files-sidebar": showFilesSidebar.value || showDebugSidebar.value || Boolean(featureSettingsSidebar.value),
  "has-image-sidebar": mainView.value === "image" && Boolean(featureSettingsSidebar.value),
  "has-settings": settingsOpen.value,
}));

const mainStyle = computed(
  () =>
    ({
      "--left-sidebar-w": `${Math.max(0, Math.round(effectiveLeftSidebarWidthPx.value))}px`,
      "--files-sidebar-w": `${Math.max(0, Math.round(effectiveFilesSidebarWidthPx.value))}px`,
      "--center-editor-w": `${Math.max(0, Math.round(effectiveEditorWidthPx.value))}px`,
      "--center-editor-sash-w": `${CENTER_EDITOR_SASH_WIDTH_PX}px`,
    }) as Record<string, string>
);

const getMainWidthPx = () => mainRef.value?.getBoundingClientRect().width ?? window.innerWidth;

const clampEditorPreferredWidthPx = (value: number) => {
  const totalWidth = resolvedShellWidths.value.centerWidth;
  const maxWidth = Math.max(
    CENTER_EDITOR_HARD_MIN_WIDTH_PX,
    totalWidth - CENTER_EDITOR_SASH_WIDTH_PX - CENTER_TIMELINE_HARD_MIN_WIDTH_PX
  );
  return Math.max(CENTER_EDITOR_HARD_MIN_WIDTH_PX, Math.min(Math.round(value), maxWidth));
};

const setEditorResizeGlobalStyles = (enabled: boolean) => {
  try {
    document.body.style.cursor = enabled ? "col-resize" : "";
    document.body.style.userSelect = enabled ? "none" : "";
    document.body.classList.toggle("is-resizing", enabled);
  } catch {}
};

const teardownEditorResizeListeners = () => {
  window.removeEventListener("pointermove", onEditorSashPointerMove);
  window.removeEventListener("pointerup", onEditorSashPointerUp);
  window.removeEventListener("pointercancel", onEditorSashPointerUp);
  setEditorResizeGlobalStyles(false);
};

const onEditorSashPointerDown = (event: PointerEvent) => {
  if (!showEditorPane.value || event.button !== 0) return;
  editorResizeState.value = {
    startClientX: event.clientX,
    startWidthPx: effectiveEditorWidthPx.value,
    previewWidthPx: effectiveEditorWidthPx.value,
  };

  setEditorResizeGlobalStyles(true);
  try {
    (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
  } catch {}

  window.addEventListener("pointermove", onEditorSashPointerMove);
  window.addEventListener("pointerup", onEditorSashPointerUp);
  window.addEventListener("pointercancel", onEditorSashPointerUp);
  event.preventDefault();
};

const onEditorSashPointerMove = (event: PointerEvent) => {
  const state = editorResizeState.value;
  if (!state) return;
  const deltaX = state.startClientX - event.clientX;
  state.previewWidthPx = clampEditorPreferredWidthPx(state.startWidthPx + deltaX);
};

const onEditorSashPointerUp = () => {
  const state = editorResizeState.value;
  editorResizeState.value = null;
  teardownEditorResizeListeners();
  if (!state) return;
  appShellStore.setCenterEditorWidthPx(clampEditorPreferredWidthPx(state.previewWidthPx), { save: true });
};

const onEditorSashKeydown = (event: KeyboardEvent) => {
  if (!showEditorPane.value) return;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  const delta = event.key === "ArrowLeft" ? CENTER_EDITOR_KEYBOARD_STEP_PX : -CENTER_EDITOR_KEYBOARD_STEP_PX;
  appShellStore.setCenterEditorWidthPx(clampEditorPreferredWidthPx(effectiveEditorWidthPx.value + delta), {
    save: true,
  });
  event.preventDefault();
};

onBeforeUnmount(() => {
  try {
    stopWindowStateListener?.();
  } catch {}
  stopWindowStateListener = null;

  teardownEditorResizeListeners();
});
</script>
