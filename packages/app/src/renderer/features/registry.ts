import { defineAsyncComponent, type Component } from "vue";
import type { MainView } from "@codenexus/shared/localSettings";
import {
  codexInstructionProfileForMainView,
  type CodexInstructionProfile,
} from "@codenexus/shared/codexInstructionProfiles";
import {
  installImagegenRuntimeBridge,
  setImagegenWorkspacePath,
} from "@codenexus/feature-imagegen/renderer/runtimeBridge";

export type FeatureMainView = Exclude<MainView, "chat">;
export type CoreSettingsTab = "global" | "sound" | "env" | "integrations" | "update";
export type FeatureSettingsTab = "image";
export type AppSettingsTab = CoreSettingsTab | FeatureSettingsTab;

type RuntimeBridgeDisposer = () => void;

type FeatureRuntimeBridgeContext = {
  translate?: (key: string, params?: Record<string, unknown>) => string;
  getWorkspacePath?: () => string | null | undefined;
  watchWorkspacePath?: (listener: (workspacePath: string) => void) => RuntimeBridgeDisposer;
};

export type FeatureRegistryEntry = {
  id: FeatureMainView;
  mainView: FeatureMainView;
  order: number;
  workbenchComponent: Component;
  workspaceSidebarComponent?: Component;
  settingsSidebarComponent?: Component;
  settings?: {
    tab: FeatureSettingsTab;
    labelKey: string;
    descKey: string;
    icon: "image" | "workflow";
    component: Component;
  };
  layout: {
    hideDefaultLeftSidebar?: boolean;
    forceLeftSidebarVisible?: boolean;
    showWorkspaceFilesSidebar?: boolean;
  };
  installRuntimeBridge?: (context: FeatureRuntimeBridgeContext) => RuntimeBridgeDisposer | void;
  resolveInstructionProfile?: () => CodexInstructionProfile;
};

const ImageWorkbench = defineAsyncComponent(
  () => import("@codenexus/feature-imagegen/renderer/components/ImageWorkbench")
);
const ImageWorkspaceSidebar = defineAsyncComponent(
  () => import("@codenexus/feature-imagegen/renderer/components/ImageWorkspaceSidebar")
);
const ImageSettingsSidebar = defineAsyncComponent(
  () => import("@codenexus/feature-imagegen/renderer/components/ImageSettingsSidebar")
);
const SettingsImageGenerationTab = defineAsyncComponent(
  () => import("../components/layout/settings/SettingsImageGenerationTab.vue")
);

export const FEATURE_REGISTRY: FeatureRegistryEntry[] = [
  {
    id: "image",
    mainView: "image",
    order: 1,
    workbenchComponent: ImageWorkbench,
    workspaceSidebarComponent: ImageWorkspaceSidebar,
    settingsSidebarComponent: ImageSettingsSidebar,
    settings: {
      tab: "image",
      labelKey: "settings.tabs.image",
      descKey: "settings.tabs.imageDesc",
      icon: "image",
      component: SettingsImageGenerationTab,
    },
    layout: {
      forceLeftSidebarVisible: true,
    },
    installRuntimeBridge: (context) => {
      installImagegenRuntimeBridge({
        translate: context.translate,
        workspacePath: context.getWorkspacePath?.(),
      });
      return context.watchWorkspacePath?.((workspacePath) => {
        setImagegenWorkspacePath(workspacePath);
      });
    },
    resolveInstructionProfile: () => codexInstructionProfileForMainView(),
  },
];

const featureByMainView = new Map<FeatureMainView, FeatureRegistryEntry>(
  FEATURE_REGISTRY.map((feature) => [feature.mainView, feature])
);
const featureSettingsByTab = new Map<FeatureSettingsTab, NonNullable<FeatureRegistryEntry["settings"]>>(
  FEATURE_REGISTRY.flatMap((feature) => (feature.settings ? [[feature.settings.tab, feature.settings] as const] : []))
);

export const FEATURE_MAIN_VIEWS = FEATURE_REGISTRY.map((feature) => feature.mainView);
export const FEATURE_SETTINGS_TABS = FEATURE_REGISTRY.flatMap((feature) =>
  feature.settings ? [feature.settings] : []
);
export const FEATURE_SETTINGS_TAB_KEYS = FEATURE_SETTINGS_TABS.map((tab) => tab.tab);

export function isFeatureMainView(value: unknown): value is FeatureMainView {
  return featureByMainView.has(String(value ?? "").trim() as FeatureMainView);
}

export function normalizeRegisteredMainView(value: unknown): MainView {
  const text = String(value ?? "").trim();
  if (text === "chat" || isFeatureMainView(text)) return text as MainView;
  return "chat";
}

export function getFeatureByMainView(value: MainView): FeatureRegistryEntry | null {
  return isFeatureMainView(value) ? (featureByMainView.get(value) ?? null) : null;
}

export function getFeatureSettingsByTab(value: unknown): NonNullable<FeatureRegistryEntry["settings"]> | null {
  const tab = String(value ?? "").trim() as FeatureSettingsTab;
  return featureSettingsByTab.get(tab) ?? null;
}

export function isFeatureSettingsTab(value: unknown): value is FeatureSettingsTab {
  return Boolean(getFeatureSettingsByTab(value));
}

export function shouldShowDefaultLeftSidebar(mainView: MainView): boolean {
  const feature = getFeatureByMainView(mainView);
  return !feature?.layout.hideDefaultLeftSidebar && !feature?.workspaceSidebarComponent;
}

export function shouldForceLeftSidebarVisible(mainView: MainView): boolean {
  return Boolean(getFeatureByMainView(mainView)?.layout.forceLeftSidebarVisible);
}

export function allowsWorkspaceFilesSidebar(mainView: MainView): boolean {
  const feature = getFeatureByMainView(mainView);
  if (!feature) return mainView === "chat";
  return Boolean(feature.layout.showWorkspaceFilesSidebar);
}

export function mainViewTransitionOrder(mainView: MainView): number {
  return mainView === "chat" ? 0 : (getFeatureByMainView(mainView)?.order ?? 0);
}

export function resolveCodexInstructionProfileForMainView(mainView: MainView): CodexInstructionProfile {
  const feature = getFeatureByMainView(mainView);
  return feature?.resolveInstructionProfile?.() ?? codexInstructionProfileForMainView();
}

export function installFeatureRuntimeBridges(context: FeatureRuntimeBridgeContext): RuntimeBridgeDisposer {
  const disposers = FEATURE_REGISTRY.flatMap((feature) => {
    const dispose = feature.installRuntimeBridge?.(context);
    return dispose ? [dispose] : [];
  });
  return () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose();
      } catch {}
    }
  };
}
