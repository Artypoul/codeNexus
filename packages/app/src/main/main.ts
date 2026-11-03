import { app, BrowserWindow, Menu } from "electron";
import { readFile, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { installContentSecurityPolicy } from "./security/contentSecurityPolicy";
import { logger } from "./utils/logger";
import {
  IPC_APP_CHANNELS,
  IPC_EVENT_CHANNELS,
  type AppClosingStep,
  type AppWindowClosingState,
} from "@codenexus/shared/ipc";
import { HistoryStore, type HistoryThread } from "./historyStore";
import { registerAllHandlers } from "./ipc/handlers";
import { generateImagesWithSettings } from "./ipc/handlers/image-generation.handlers";
import { RuntimeThreadStateTracker } from "./runtimeThreadStateTracker";
import { HistoryService } from "./services/HistoryService";
import { CodexServerManager } from "./services/CodexServerManager";
import { CodexProfileService } from "./services/CodexProfileService";
import { CodexSkillRootsService } from "./services/CodexSkillRootsService";
import { CodexConfigSwitcherService } from "./services/CodexConfigSwitcherService";
import { ImageGenerationHistoryService } from "@codenexus/feature-imagegen/main/ImageGenerationHistoryService";
import { ImageGenerationTaskService } from "@codenexus/feature-imagegen/main/ImageGenerationTaskService";
import { LocalSettingsService } from "./services/LocalSettingsService";
import { CacheRegistryService } from "./services/CacheRegistryService";
import { ThreadArtifactService } from "./services/ThreadArtifactService";
import { ThreadTaskService } from "./services/ThreadTaskService";
import { ThreadTitleOverrideService } from "./services/ThreadTitleOverrideService";
import { UpdateService } from "./services/UpdateService";
import { WorkspacePatchService } from "./services/WorkspacePatchService";
import { DeepSeekResponsesProxyService } from "./services/DeepSeekResponsesProxyService";
import { createMainWindow } from "./windows/mainWindow";

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

app.setName("CodeNexus");
if (process.platform === "win32") {
  app.setAppUserModelId("com.codenexus.desktop");
}

let mainWindow: BrowserWindow | null = null;
let appCloseFlowPromise: Promise<void> | null = null;
let allowMainWindowClose = false;
let closeCleanupFinished = false;
let appCloseFlowStartedAt = 0;
let appCloseForceExitTimer: NodeJS.Timeout | null = null;

const codexServerManager = new CodexServerManager();
const workspacePatchService = new WorkspacePatchService();
const runtimeThreadStateTracker = new RuntimeThreadStateTracker();
const cacheRegistryService = new CacheRegistryService();
const deepSeekResponsesProxyService = new DeepSeekResponsesProxyService();

const APP_CLOSE_OVERLAY_BOOT_MS = 56;
const APP_CLOSE_PREPARE_MS = 200;
const APP_CLOSE_MIN_VISIBLE_MS = 300;
const APP_CLOSE_FINALIZE_MS = 48;
const APP_CLOSE_FORCE_EXIT_MS = 5_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Math.round(ms)));
  });
}

function sendToRenderer(channel: string, payload: unknown) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send(channel, payload);
  } catch (error) {
    logger.warn("ipc", `sendToRenderer failed on channel '${channel}'`, error);
  }
}

const updateService = new UpdateService((payload) => {
  sendToRenderer(IPC_APP_CHANNELS.appUpdateState, payload);
});

function pushHistoryUpdate(items: HistoryThread[]) {
  sendToRenderer(IPC_EVENT_CHANNELS.historyUpdated, { items: runtimeThreadStateTracker.decorateHistoryItems(items) });
}

function buildClosingSteps(phase: AppWindowClosingState["phase"]): AppClosingStep[] {
  const prepareUiStatus: AppClosingStep["status"] =
    phase === "idle" ? "pending" : phase === "starting" || phase === "preparing" ? "inProgress" : "completed";
  const stopTasksStatus: AppClosingStep["status"] =
    phase === "stopping" ? "inProgress" : phase === "finalizing" ? "completed" : "pending";
  const exitAppStatus: AppClosingStep["status"] = phase === "finalizing" ? "inProgress" : "pending";

  return [
    { id: "prepareUi", label: "Preparing interface", status: prepareUiStatus },
    { id: "stopTasks", label: "Stopping background tasks", status: stopTasksStatus },
    { id: "exitApp", label: "Exiting application", status: exitAppStatus },
  ];
}

function pushWindowClosingState(phase: AppWindowClosingState["phase"]) {
  const payload: AppWindowClosingState = {
    visible: phase !== "idle",
    phase,
    startedAt: phase === "idle" ? 0 : appCloseFlowStartedAt || Date.now(),
    steps: buildClosingSteps(phase),
  };
  sendToRenderer(IPC_APP_CHANNELS.appWindowClosingState, payload);
}

function stopCodexServersForClose(_reason: string) {
  if (closeCleanupFinished) return;
  closeCleanupFinished = true;
  try {
    codexServerManager.stopAll();
  } catch (error) {
    logger.warn("app-close", "stop codex servers failed", error);
  }
  try {
    deepSeekResponsesProxyService.stop();
  } catch (error) {
    logger.warn("app-close", "stop DeepSeek proxy failed", error);
  }
}

function clearAppCloseForceExitWatchdog() {
  if (!appCloseForceExitTimer) return;
  clearTimeout(appCloseForceExitTimer);
  appCloseForceExitTimer = null;
}

function armAppCloseForceExitWatchdog() {
  clearAppCloseForceExitWatchdog();
  appCloseForceExitTimer = setTimeout(() => {
    logger.warn("app-close", "force exiting after close watchdog timeout");
    stopCodexServersForClose("force-exit-watchdog");
    app.exit(0);
  }, APP_CLOSE_FORCE_EXIT_MS);
  appCloseForceExitTimer.unref?.();
}

async function runAppCloseFlow(win: BrowserWindow): Promise<void> {
  if (allowMainWindowClose || win.isDestroyed()) return;
  if (appCloseFlowPromise) return appCloseFlowPromise;

  appCloseFlowStartedAt = Date.now();
  armAppCloseForceExitWatchdog();
  appCloseFlowPromise = (async () => {
    pushWindowClosingState("starting");
    await wait(APP_CLOSE_OVERLAY_BOOT_MS);

    pushWindowClosingState("preparing");
    await wait(APP_CLOSE_PREPARE_MS);

    pushWindowClosingState("stopping");
    stopCodexServersForClose("window-close");

    const remainingVisibleMs = APP_CLOSE_MIN_VISIBLE_MS - (Date.now() - appCloseFlowStartedAt);
    if (remainingVisibleMs > 0) await wait(remainingVisibleMs);

    pushWindowClosingState("finalizing");
    await wait(APP_CLOSE_FINALIZE_MS);

    allowMainWindowClose = true;
    if (!win.isDestroyed()) win.close();
  })()
    .catch((error) => {
      logger.error("app-close", "flow failed", error);
      allowMainWindowClose = true;
      if (!win.isDestroyed()) win.close();
    })
    .finally(() => {
      appCloseFlowPromise = null;
    });

  return appCloseFlowPromise;
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopCodexServersForClose("before-quit");
});

(app as any).on("before-quit-for-update", () => {
  allowMainWindowClose = true;
  stopCodexServersForClose("before-quit-for-update");
});

app
  .whenReady()
  .then(async () => {
    if (process.platform !== "darwin") {
      Menu.setApplicationMenu(null);
    }

    if (!isDev) {
      installContentSecurityPolicy();
    }

    const historyCachePath = join(app.getPath("userData"), "thread-history-cache.json");
    const historyStore = new HistoryStore(historyCachePath);
    const historyService = new HistoryService(historyStore);
    const localSettingsService = new LocalSettingsService(join(app.getPath("userData"), "user-settings.json"));
    const codexProfileService = new CodexProfileService(join(app.getPath("userData"), "codex-profiles.json"));
    const codexSkillRootsService = new CodexSkillRootsService(join(app.getPath("userData"), "codex-skill-roots.json"));
    const codexConfigSwitcherService = new CodexConfigSwitcherService(
      join(app.getPath("userData"), "codex-config-switcher.json"),
      join(homedir(), ".codex", "config.toml"),
      join(app.getPath("userData"), "backups", "codex-config"),
      join(homedir(), ".cc-switch"),
      join(homedir(), ".cc-switch", "cc-switch.db")
    );
    const imageGenerationHistoryService = new ImageGenerationHistoryService(
      join(app.getPath("userData"), "image-generation-history.json")
    );
    const imageGenerationTaskService = new ImageGenerationTaskService(
      join(app.getPath("userData"), "image-generation-tasks.json"),
      (args, signal) => generateImagesWithSettings(localSettingsService, imageGenerationHistoryService, args, signal),
      2
    );
    const threadTaskService = new ThreadTaskService(join(app.getPath("userData"), "thread-tasks.json"));
    const threadArtifactService = new ThreadArtifactService(join(app.getPath("userData"), "thread-artifacts.json"));
    const threadTitleOverrideService = new ThreadTitleOverrideService(
      join(app.getPath("userData"), "thread-title-overrides.json")
    );
    const initialLocalSettings = await localSettingsService.read();

    cacheRegistryService.registerProvider({
      namespace: "main.history.disk",
      getStats: async () => {
        let bytes = 0;
        let items = 0;
        try {
          const metadata = await stat(historyCachePath);
          if (metadata.isFile()) bytes = Math.max(0, Math.round(metadata.size));
          const raw = await readFile(historyCachePath, "utf8");
          const parsed = JSON.parse(raw);
          items = Array.isArray(parsed?.items) ? parsed.items.length : 0;
        } catch (error) {
          logger.warn("cache", "failed to read history cache stats", error);
        }
        return {
          items,
          bytes,
          note: "History thread cache file",
          updatedAt: Date.now(),
        };
      },
      clear: async () => {
        await rm(historyCachePath, { force: true }).catch(() => undefined);
        historyStore.clearMemoryCaches();
      },
    });
    cacheRegistryService.registerProvider({
      namespace: "main.history.memory",
      getStats: () => ({
        ...historyStore.getMemoryCacheStats(),
        note: "History thread memory cache",
      }),
      clear: () => {
        historyStore.clearMemoryCaches();
      },
    });
    registerAllHandlers({
      getMainWindow: () => mainWindow,
      serverManager: codexServerManager,
      sendCodexEvent: (payload) => {
        runtimeThreadStateTracker.observeEvent(payload);
        sendToRenderer(IPC_EVENT_CHANNELS.codexEvent, payload);
      },
      historyService,
      threadTaskService,
      threadArtifactService,
      threadTitleOverrideService,
      onHistoryUpdated: (items: HistoryThread[]) => {
        pushHistoryUpdate(items);
      },
      decorateHistoryItems: (items: HistoryThread[]) => runtimeThreadStateTracker.decorateHistoryItems(items),
      onHistoryThreadDeleted: (threadId: string) => {
        runtimeThreadStateTracker.clearThread(threadId);
      },
      getThreadRunningState: (threadId: string) => runtimeThreadStateTracker.getThreadRunningState(threadId),
      workspacePatchService,
      localSettingsService,
      codexProfileService,
      codexSkillRootsService,
      codexConfigSwitcherService,
      imageGenerationHistoryService,
      imageGenerationTaskService,
      updateService,
      deepSeekResponsesProxyService,
      cacheRegistryService,
    });

    mainWindow = await createMainWindow({
      isDev,
      devServerUrl: process.env.VITE_DEV_SERVER_URL,
      initialLocalSettingsSnapshot: {
        path: localSettingsService.path,
        exists: initialLocalSettings.exists,
        settings: initialLocalSettings.settings,
      },
    });

    mainWindow.webContents.once("did-finish-load", () => {
      pushWindowClosingState("idle");
      updateService.scheduleStartupCheck();
    });

    mainWindow.on("close", (event) => {
      if (allowMainWindowClose) return;
      event.preventDefault();
      void runAppCloseFlow(mainWindow!);
    });

    mainWindow.on("closed", () => {
      clearAppCloseForceExitWatchdog();
      mainWindow = null;
      allowMainWindowClose = false;
      closeCleanupFinished = false;
      appCloseFlowStartedAt = 0;
      appCloseFlowPromise = null;
    });
  })
  .catch((error) => {
    logger.error("main", "app bootstrap failed", error);
    app.exit(1);
  });
