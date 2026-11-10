import { app, BrowserWindow, Menu } from "electron";
import { readFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { installContentSecurityPolicy } from "./security/contentSecurityPolicy";
import { logger } from "./utils/logger";
import { IPC_APP_CHANNELS, IPC_EVENT_CHANNELS } from "@codenexus/shared/ipc";
import { HistoryStore, type HistoryThread } from "./historyStore";
import { registerAllHandlers } from "./ipc/handlers";
import { generateImagesWithSettings } from "./ipc/handlers/image-generation.handlers";
import { RuntimeThreadStateTracker } from "./runtimeThreadStateTracker";
import { HistoryService } from "./services/HistoryService";
import { CodexServerManager } from "./services/CodexServerManager";
import { GigmaAppServerService } from "./services/GigmaAppServerService";
import { GigmaAuthClient } from "./services/GigmaAuthClient";
import { GigmaAuthProcessSupervisor } from "./services/GigmaAuthProcessSupervisor";
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
import { UsageStatsService } from "./services/UsageStatsService";
import { WorkspacePatchService } from "./services/WorkspacePatchService";
import { createMainWindow } from "./windows/mainWindow";
import { installT3Protocol, registerT3Scheme } from "./t3/t3Protocol";

registerT3Scheme();

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

app.setName("CodeNexus");
if (process.platform === "win32") {
  app.setAppUserModelId("com.codenexus.desktop");
}

let mainWindow: BrowserWindow | null = null;
let closeCleanupFinished = false;

const gigmaAuthClient = new GigmaAuthClient();
const gigmaAuthProcess = new GigmaAuthProcessSupervisor(gigmaAuthClient);
const gigmaAppServer = new GigmaAppServerService(new CodexServerManager(), gigmaAuthClient, gigmaAuthProcess);
const workspacePatchService = new WorkspacePatchService();
const runtimeThreadStateTracker = new RuntimeThreadStateTracker();
const cacheRegistryService = new CacheRegistryService();

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

function stopCodexServersForClose(_reason: string) {
  if (closeCleanupFinished) return;
  closeCleanupFinished = true;
  try {
    gigmaAppServer.stopAll();
  } catch (error) {
    logger.warn("app-close", "stop codex servers failed", error);
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopCodexServersForClose("before-quit");
});

(app as any).on("before-quit-for-update", () => {
  stopCodexServersForClose("before-quit-for-update");
});

app
  .whenReady()
  .then(async () => {
    installT3Protocol(join(app.getAppPath(), "dist/t3-client"));
    if (process.platform !== "darwin") {
      Menu.setApplicationMenu(null);
    }

    const hasT3Client = existsSync(join(app.getAppPath(), "dist/t3-client/index.html"));
    if (!isDev && !hasT3Client) {
      installContentSecurityPolicy();
    }

    const historyCachePath = join(app.getPath("userData"), "thread-history-cache.json");
    const historyStore = new HistoryStore(historyCachePath);
    const historyService = new HistoryService(historyStore);
    const localSettingsService = new LocalSettingsService(join(app.getPath("userData"), "user-settings.json"));
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
    const usageStatsService = new UsageStatsService(join(app.getPath("userData"), "token-usage-stats-cache.json"));
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
      serverManager: gigmaAppServer,
      gigmaAuth: gigmaAuthClient,
      gigmaAuthProcess,
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
      codexSkillRootsService,
      codexConfigSwitcherService,
      imageGenerationHistoryService,
      imageGenerationTaskService,
      usageStatsService,
      updateService,
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
      updateService.scheduleStartupCheck();
    });

    mainWindow.on("closed", () => {
      mainWindow = null;
      closeCleanupFinished = false;
    });
  })
  .catch((error) => {
    logger.error("main", "app bootstrap failed", error);
    app.exit(1);
  });
