import { defineAsyncComponent } from "vue";

export const DebugTimelineSidebar = defineAsyncComponent(() => import("./layout/debug/DebugTimelineSidebar.vue"));
export const GoalShutdownCountdownOverlay = defineAsyncComponent(
  () => import("./layout/overlays/GoalShutdownCountdownOverlay.vue")
);
export const LeftSidebar = defineAsyncComponent(() => import("./layout/LeftSidebar.vue"));
export const SettingsPage = defineAsyncComponent(() => import("./layout/SettingsPage.vue"));
export const WorkspaceEditorPane = defineAsyncComponent(() => import("./layout/workspace/WorkspaceEditorPane.vue"));
export const WorkspaceFilesSidebar = defineAsyncComponent(() => import("./layout/workspace/WorkspaceFilesSidebar.vue"));
export const ComposerQueueList = defineAsyncComponent(() => import("./layout/composer/ComposerQueueList.vue"));
export const ComposerSlashCommandList = defineAsyncComponent(
  () => import("./layout/composer/ComposerSlashCommandList.vue")
);
export const SkillsManagerOverlay = defineAsyncComponent(() => import("./layout/skills/SkillsManagerOverlay.vue"));
export const UsageStatsDrawer = defineAsyncComponent(() => import("./layout/overlays/UsageStatsDrawer.vue"));
export const ChatPane = defineAsyncComponent(() => import("./layout/chat/ChatPane.vue"));
