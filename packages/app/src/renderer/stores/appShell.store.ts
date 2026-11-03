// UI 壳层 Store：管理侧栏开合、布局偏好等应用外壳状态。
import { defineStore } from "pinia";
import type { ServerConnState } from "../domain/types";
import { getCachedUserLocalSettings, patchUserLocalSettings } from "../domain/localSettings";
import {
  DEFAULT_UI_WORKSPACE_FILE_ICON_THEME,
  normalizeUiLanguage,
  normalizeUiWorkspaceFileIconTheme,
  type UiLanguage,
  type UiWorkspaceFileIconTheme,
  type MainView,
} from "@codenexus/shared/localSettings";
import { refreshDomI18nFallback } from "../i18n/domFallback";
import { setUiI18nLanguage } from "../i18n";
import { normalizeRegisteredMainView, shouldForceLeftSidebarVisible, type FeatureMainView } from "../features/registry";

export type IntegrationsDrawerTab = "skills" | "mcp";
export type SettingsTab = "global" | "profiles" | "sound" | "image" | "env" | "integrations" | "update";
export type SettingsIntegrationsTab = "skills" | "mcp";

const DEFAULT_LEFT_SIDEBAR_WIDTH_PX = 300;
const DEFAULT_FILES_SIDEBAR_WIDTH_PX = 300;
const DEFAULT_CENTER_EDITOR_WIDTH_PX = 460;
export const MIN_SIDEBAR_WIDTH_PX = 240;
export const MIN_CENTER_EDITOR_WIDTH_PX = 320;
const DEFAULT_MAIN_VIEW: MainView = "chat";

function clampSidebarWidthPx(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(MIN_SIDEBAR_WIDTH_PX, Math.round(n));
}

function clampCenterEditorWidthPx(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(MIN_CENTER_EDITOR_WIDTH_PX, Math.round(n));
}

function normalizeThreadWorkspaceGroupKey(value: unknown): string {
  return String(value ?? "").trim();
}

function cloneThreadWorkspaceGroupsCollapsedState(value: unknown): Record<string, boolean> {
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const next: Record<string, boolean> = {};
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = normalizeThreadWorkspaceGroupKey(rawKey);
    if (!key || rawValue !== true) continue;
    next[key] = true;
  }
  return next;
}

export const useAppShellStore = defineStore("appShell", {
  state: () => ({
    serverConnState: "disconnected" as ServerConnState,
    serverError: "" as string,
    language: "zh-CN" as UiLanguage,
    mainView: DEFAULT_MAIN_VIEW as MainView,
    globalConfigDrawerOpen: false,
    envSetupDrawerOpen: false,
    integrationsDrawerOpen: false,
    integrationsDrawerTab: "skills" as IntegrationsDrawerTab,

    settingsOpen: false,
    settingsActiveTab: "global" as SettingsTab,
    settingsIntegrationsTab: "skills" as SettingsIntegrationsTab,
    leftSidebarVisible: true,
    leftSidebarWidthPx: DEFAULT_LEFT_SIDEBAR_WIDTH_PX,
    filesSidebarVisible: true,
    filesSidebarWidthPx: DEFAULT_FILES_SIDEBAR_WIDTH_PX,
    centerEditorWidthPx: DEFAULT_CENTER_EDITOR_WIDTH_PX,
    workspaceFileIconTheme: DEFAULT_UI_WORKSPACE_FILE_ICON_THEME as UiWorkspaceFileIconTheme,
    threadWorkspaceGroupsCollapsed: {} as Record<string, boolean>,
  }),
  actions: {
    // 统一维护服务连接状态与错误文案。
    setServerConnState(next: ServerConnState, error = "") {
      this.serverConnState = next;
      this.serverError = error;
    },
    // 从本地缓存恢复布局偏好。
    initLocalSettings() {
      const cached = getCachedUserLocalSettings();
      this.language = normalizeUiLanguage(cached.settings.ui.language);
      setUiI18nLanguage(this.language);
      this.mainView = cached.settings.ui.mainView;
      this.workspaceFileIconTheme = normalizeUiWorkspaceFileIconTheme(cached.settings.ui.workspaceFileIconTheme);
      this.leftSidebarVisible = cached.settings.ui.leftSidebarVisible;
      this.leftSidebarWidthPx = clampSidebarWidthPx(
        cached.settings.ui.leftSidebarWidthPx,
        DEFAULT_LEFT_SIDEBAR_WIDTH_PX
      );
      this.filesSidebarVisible = cached.settings.ui.filesSidebarVisible;
      this.filesSidebarWidthPx = clampSidebarWidthPx(
        cached.settings.ui.filesSidebarWidthPx,
        DEFAULT_FILES_SIDEBAR_WIDTH_PX
      );
      this.centerEditorWidthPx = clampCenterEditorWidthPx(
        cached.settings.ui.centerEditorWidthPx,
        DEFAULT_CENTER_EDITOR_WIDTH_PX
      );
      this.threadWorkspaceGroupsCollapsed = cloneThreadWorkspaceGroupsCollapsedState(
        cached.settings.ui.threadWorkspaceGroupsCollapsed
      );
      if (!cached.exists) {
        void patchUserLocalSettings({
          ui: {
            mainView: this.mainView,
            language: this.language,
            leftSidebarVisible: this.leftSidebarVisible,
            leftSidebarWidthPx: this.leftSidebarWidthPx,
            filesSidebarVisible: this.filesSidebarVisible,
            filesSidebarWidthPx: this.filesSidebarWidthPx,
            centerEditorWidthPx: this.centerEditorWidthPx,
            workspaceFileIconTheme: this.workspaceFileIconTheme,
            threadWorkspaceGroupsCollapsed: { ...this.threadWorkspaceGroupsCollapsed },
          },
        });
      }
    },
    setLanguage(next: UiLanguage, opts?: { save?: boolean }) {
      const shouldSave = opts?.save ?? true;
      const normalized = normalizeUiLanguage(next);
      this.language = normalized;
      setUiI18nLanguage(normalized);
      refreshDomI18nFallback(normalized);
      if (!shouldSave) return;
      void patchUserLocalSettings({ ui: { language: normalized } });
    },
    setMainView(next: MainView, opts?: { save?: boolean }) {
      const shouldSave = opts?.save ?? true;
      const normalized = normalizeRegisteredMainView(next);
      this.mainView = normalized;
      if (!shouldSave) return;
      void patchUserLocalSettings({ ui: { mainView: normalized } });
    },
    openFeatureWorkbench(next: FeatureMainView, opts?: { save?: boolean }) {
      this.setMainView(next, opts);
      if (shouldForceLeftSidebarVisible(next)) {
        this.setLeftSidebarVisible(true, { save: false });
      }
      this.closeSettings();
    },
    openImageWorkbench(opts?: { save?: boolean }) {
      this.openFeatureWorkbench("image", opts);
    },
    setGlobalConfigDrawerOpen(next: boolean) {
      this.globalConfigDrawerOpen = Boolean(next);
    },
    toggleGlobalConfigDrawerOpen() {
      this.setGlobalConfigDrawerOpen(!this.globalConfigDrawerOpen);
    },
    openSettings(tab?: SettingsTab, opts?: { integrationsTab?: SettingsIntegrationsTab }) {
      if (tab) this.settingsActiveTab = tab;
      if (opts?.integrationsTab) this.settingsIntegrationsTab = opts.integrationsTab;
      this.settingsOpen = true;
      // 进入设置页后，关闭旧的抽屉状态，避免出现“状态为 open 但 UI 不显示”的混乱。
      this.globalConfigDrawerOpen = false;
      this.envSetupDrawerOpen = false;
      this.integrationsDrawerOpen = false;
    },
    closeSettings() {
      this.settingsOpen = false;
    },
    setSettingsTab(tab: SettingsTab) {
      this.settingsActiveTab = tab;
    },
    setSettingsIntegrationsTab(tab: SettingsIntegrationsTab) {
      this.settingsIntegrationsTab = tab;
    },
    setEnvSetupDrawerOpen(next: boolean) {
      this.envSetupDrawerOpen = Boolean(next);
    },
    toggleEnvSetupDrawerOpen() {
      this.setEnvSetupDrawerOpen(!this.envSetupDrawerOpen);
    },
    setIntegrationsDrawerTab(next: IntegrationsDrawerTab) {
      this.integrationsDrawerTab = next === "mcp" ? "mcp" : "skills";
    },
    openIntegrationsDrawer(tab?: IntegrationsDrawerTab) {
      if (tab) this.setIntegrationsDrawerTab(tab);
      this.integrationsDrawerOpen = true;
    },
    setIntegrationsDrawerOpen(next: boolean, opts?: { tab?: IntegrationsDrawerTab }) {
      if (next && opts?.tab) this.setIntegrationsDrawerTab(opts.tab);
      this.integrationsDrawerOpen = Boolean(next);
    },
    toggleIntegrationsDrawerOpen(tab?: IntegrationsDrawerTab) {
      if (this.integrationsDrawerOpen) {
        this.setIntegrationsDrawerOpen(false);
        return;
      }
      this.openIntegrationsDrawer(tab);
    },
    setLeftSidebarWidthPx(next: number, opts?: { save?: boolean }) {
      const shouldSave = opts?.save ?? true;
      const clamped = clampSidebarWidthPx(next, DEFAULT_LEFT_SIDEBAR_WIDTH_PX);
      this.leftSidebarWidthPx = clamped;
      if (!shouldSave) return;
      void patchUserLocalSettings({ ui: { leftSidebarWidthPx: clamped } });
    },
    setLeftSidebarVisible(next: boolean, opts?: { save?: boolean }) {
      const shouldSave = opts?.save ?? true;
      const normalized = Boolean(next);
      this.leftSidebarVisible = normalized;
      if (!shouldSave) return;
      void patchUserLocalSettings({ ui: { leftSidebarVisible: normalized } });
    },
    toggleLeftSidebarVisible(opts?: { save?: boolean }) {
      this.setLeftSidebarVisible(!this.leftSidebarVisible, opts);
    },
    setFilesSidebarVisible(next: boolean, opts?: { save?: boolean }) {
      const shouldSave = opts?.save ?? true;
      const normalized = Boolean(next);
      this.filesSidebarVisible = normalized;
      if (!shouldSave) return;
      void patchUserLocalSettings({ ui: { filesSidebarVisible: normalized } });
    },
    toggleFilesSidebarVisible(opts?: { save?: boolean }) {
      this.setFilesSidebarVisible(!this.filesSidebarVisible, opts);
    },
    setFilesSidebarWidthPx(next: number, opts?: { save?: boolean }) {
      const shouldSave = opts?.save ?? true;
      const clamped = clampSidebarWidthPx(next, DEFAULT_FILES_SIDEBAR_WIDTH_PX);
      this.filesSidebarWidthPx = clamped;
      if (!shouldSave) return;
      void patchUserLocalSettings({ ui: { filesSidebarWidthPx: clamped } });
    },
    setCenterEditorWidthPx(next: number, opts?: { save?: boolean }) {
      const shouldSave = opts?.save ?? true;
      const clamped = clampCenterEditorWidthPx(next, DEFAULT_CENTER_EDITOR_WIDTH_PX);
      this.centerEditorWidthPx = clamped;
      if (!shouldSave) return;
      void patchUserLocalSettings({ ui: { centerEditorWidthPx: clamped } });
    },
    isThreadWorkspaceGroupCollapsed(groupKeyValue: string): boolean {
      const key = normalizeThreadWorkspaceGroupKey(groupKeyValue);
      return Boolean(key && this.threadWorkspaceGroupsCollapsed[key]);
    },
    setThreadWorkspaceGroupCollapsed(groupKeyValue: string, collapsed: boolean, opts?: { save?: boolean }) {
      const key = normalizeThreadWorkspaceGroupKey(groupKeyValue);
      if (!key) return;
      const shouldSave = opts?.save ?? true;
      const next = { ...this.threadWorkspaceGroupsCollapsed };
      if (collapsed) next[key] = true;
      else delete next[key];
      this.threadWorkspaceGroupsCollapsed = cloneThreadWorkspaceGroupsCollapsedState(next);
      if (!shouldSave) return;
      void patchUserLocalSettings({
        ui: {
          threadWorkspaceGroupsCollapsed: { ...this.threadWorkspaceGroupsCollapsed },
        },
      });
    },
    toggleThreadWorkspaceGroupCollapsed(groupKeyValue: string, opts?: { save?: boolean }) {
      this.setThreadWorkspaceGroupCollapsed(groupKeyValue, !this.isThreadWorkspaceGroupCollapsed(groupKeyValue), opts);
    },
    ensureThreadWorkspaceGroupExpanded(groupKeyValue: string, opts?: { save?: boolean }) {
      if (!this.isThreadWorkspaceGroupCollapsed(groupKeyValue)) return;
      this.setThreadWorkspaceGroupCollapsed(groupKeyValue, false, opts);
    },
  },
});
