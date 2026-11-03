import "./tailwind.css";
import "./styles/index.css";

import { createApp, nextTick, watch } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { initRuntimeOrchestrator } from "./domain/runtimeOrchestrator";
import { installDomI18nFallback } from "./i18n/domFallback";
import { i18n } from "./i18n";
import { translate } from "./i18n/translate";
import { installFeatureRuntimeBridges, FEATURE_SETTINGS_TAB_KEYS, type AppSettingsTab } from "./features/registry";
import { loadUserLocalSettings } from "./domain/localSettings";
import { loadLocalDraftState } from "./domain/localDraftState";
import { loadLocalMessageOutbox } from "./domain/localMessageOutbox";
import { useThemeStore } from "./stores/theme.store";
import { useTypographyStore } from "./stores/typography.store";
import { useAppShellStore } from "./stores/appShell.store";
import { useRuntimeStore } from "./stores/runtime.store";
import { useMessageQueueStore } from "./stores/messageQueue.store";
import { useCodexSkillRootsStore } from "./stores/codexSkillRoots.store";
import { installTooltipDirective } from "./directives/tooltip";
import { showToast, type ToastKind } from "./ui/toast";

async function bootstrap() {
  const pinia = createPinia();
  try {
    await loadUserLocalSettings();
  } catch (error) {
    console.warn("[bootstrap] loadUserLocalSettings failed", error);
  }
  useThemeStore(pinia).initTheme();
  useTypographyStore(pinia).initTypography();

  const runtimeStore = useRuntimeStore(pinia);
  const disposeFeatureRuntimeBridges = installFeatureRuntimeBridges({
    translate,
    getWorkspacePath: () => runtimeStore.workspacePath,
    watchWorkspacePath: (listener) => {
      const stop = watch(
        () => runtimeStore.workspacePath,
        (workspacePath) => listener(String(workspacePath ?? "")),
        { immediate: true }
      );
      return stop;
    },
  });
  const messageQueueStore = useMessageQueueStore(pinia);

  const [draftState, messageOutbox] = await Promise.all([loadLocalDraftState(), loadLocalMessageOutbox()]);

  runtimeStore.hydrateFromLocalDraftState(draftState);
  messageQueueStore.hydrateFromLocalMessageOutbox(messageOutbox);
  void useCodexSkillRootsStore(pinia).refresh();

  const runtime = initRuntimeOrchestrator(pinia);
  const app = createApp(App);
  app.use(pinia);
  app.use(i18n);
  installTooltipDirective(app);
  app.mount("#app");
  const appShellStore = useAppShellStore(pinia);
  const handleFeatureToast = (evt: Event) => {
    const detail = (evt as CustomEvent<{ kind?: ToastKind; title?: string; message?: string }>).detail;
    const message = String(detail?.message ?? "").trim();
    if (!message) return;
    showToast({ kind: detail?.kind, title: detail?.title, message });
  };
  window.addEventListener("codenexus:toast", handleFeatureToast);
  const openSettingsTabs = new Set<AppSettingsTab>([
    "global",
    "sound",
    "env",
    "integrations",
    "update",
    ...FEATURE_SETTINGS_TAB_KEYS,
  ]);
  const toOpenSettingsTab = (value: unknown): AppSettingsTab | undefined => {
    const tab = String(value ?? "").trim();
    return openSettingsTabs.has(tab as AppSettingsTab) ? (tab as AppSettingsTab) : undefined;
  };
  const handleFeatureOpenSettings = (evt: Event) => {
    const tab = toOpenSettingsTab((evt as CustomEvent<{ tab?: string }>).detail?.tab);
    appShellStore.openSettings(tab);
  };
  window.addEventListener("codenexus:open-settings", handleFeatureOpenSettings);
  const disposeDomI18nFallback = installDomI18nFallback(() => appShellStore.language);

  const windowControlsOverlay = (navigator as any).windowControlsOverlay as
    | {
        visible?: boolean;
        getTitlebarAreaRect?: () => DOMRect;
        addEventListener?: (type: string, cb: (evt?: any) => void) => void;
      }
    | undefined;

  if (windowControlsOverlay?.addEventListener) {
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRetry = () => {
      if (retryTimer != null) return;
      if (retryCount >= 8) return;
      retryCount += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        applyWindowControlsPadding();
      }, 180);
    };

    const applyWindowControlsPadding = (evt?: any) => {
      if (windowControlsOverlay.visible === false) {
        document.documentElement.style.setProperty("--window-controls-pad", "0px");
        return;
      }

      const rect: DOMRect | undefined = evt?.titlebarAreaRect ?? windowControlsOverlay.getTitlebarAreaRect?.();
      if (!rect) {
        document.documentElement.style.setProperty("--window-controls-pad", "200px");
        scheduleRetry();
        return;
      }

      retryCount = 0;
      const rightPadPx = Math.max(0, Math.round(window.innerWidth - (rect.x + rect.width)));
      document.documentElement.style.setProperty("--window-controls-pad", `${rightPadPx}px`);
      if (rect.height > 0) {
        document.documentElement.style.setProperty("--topbar-h", `${Math.round(rect.height)}px`);
      }
    };

    windowControlsOverlay.addEventListener("geometrychange", applyWindowControlsPadding);
    window.addEventListener("resize", applyWindowControlsPadding);
    applyWindowControlsPadding();
  }

  window.addEventListener(
    "unload",
    () => {
      window.removeEventListener("codenexus:toast", handleFeatureToast);
      window.removeEventListener("codenexus:open-settings", handleFeatureOpenSettings);
      disposeFeatureRuntimeBridges();
      runtime.dispose();
      disposeDomI18nFallback();
    },
    { once: true }
  );

  await nextTick();
}

void bootstrap();
