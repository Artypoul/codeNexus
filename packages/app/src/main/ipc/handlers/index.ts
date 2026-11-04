import { BrowserWindow } from "electron";
import type { CodexIncomingMessage } from "@codenexus/shared/codex-protocol";
import { CodexServerManager } from "../../services/CodexServerManager";
import { type HistoryThread } from "../../historyStore";
import { HistoryService } from "../../services/HistoryService";
import type { LocalSettingsService } from "../../services/LocalSettingsService";
import type { CodexSkillRootsService } from "../../services/CodexSkillRootsService";
import type { CodexConfigSwitcherService } from "../../services/CodexConfigSwitcherService";
import type { ImageGenerationHistoryService } from "@codenexus/feature-imagegen/main/ImageGenerationHistoryService";
import type { ImageGenerationTaskService } from "@codenexus/feature-imagegen/main/ImageGenerationTaskService";
import type { ThreadArtifactService } from "../../services/ThreadArtifactService";
import type { ThreadTaskService } from "../../services/ThreadTaskService";
import type { ThreadTitleOverrideService } from "../../services/ThreadTitleOverrideService";
import type { UpdateService } from "../../services/UpdateService";
import { WorkspacePatchService } from "../../services/WorkspacePatchService";
import { registerAppHandlers } from "./app.handlers";
import { registerCacheHandlers } from "./cache.handlers";
import { registerCodexHandlers } from "./codex.handlers";
import { registerHistoryHandlers } from "./history.handlers";
import { registerImageGenerationHandlers } from "./image-generation.handlers";
import { registerUsageHandlers } from "./usage.handlers";
import { registerWorkspaceHandlers } from "./workspace.handlers";
import { registerWindowHandlers } from "./window.handlers";
import { CacheRegistryService } from "../../services/CacheRegistryService";
import type { UsageStatsService } from "../../services/UsageStatsService";
import type { HistoryThreadRunningStateResult } from "@codenexus/shared/ipc/contracts";

export type IpcHandlersDeps = {
  getMainWindow: () => BrowserWindow | null;
  serverManager: CodexServerManager;
  sendCodexEvent: (payload: { serverId: string; msg: CodexIncomingMessage }) => void;
  historyService: HistoryService;
  threadTaskService: ThreadTaskService;
  threadArtifactService: ThreadArtifactService;
  threadTitleOverrideService: ThreadTitleOverrideService;
  onHistoryUpdated: (items: HistoryThread[]) => void;
  decorateHistoryItems: (items: HistoryThread[]) => HistoryThread[];
  onHistoryThreadDeleted: (threadId: string) => void;
  getThreadRunningState: (threadId: string) => HistoryThreadRunningStateResult;
  workspacePatchService: WorkspacePatchService;
  localSettingsService: LocalSettingsService;
  codexSkillRootsService: CodexSkillRootsService;
  codexConfigSwitcherService: CodexConfigSwitcherService;
  imageGenerationHistoryService: ImageGenerationHistoryService;
  imageGenerationTaskService: ImageGenerationTaskService;
  usageStatsService: UsageStatsService;
  updateService: UpdateService;
  cacheRegistryService: CacheRegistryService;
};

export function registerAllHandlers(deps: IpcHandlersDeps) {
  registerAppHandlers({
    getMainWindow: deps.getMainWindow,
    localSettingsService: deps.localSettingsService,
    codexSkillRootsService: deps.codexSkillRootsService,
    codexConfigSwitcherService: deps.codexConfigSwitcherService,
    updateService: deps.updateService,
  });
  registerImageGenerationHandlers({
    localSettingsService: deps.localSettingsService,
    imageGenerationHistoryService: deps.imageGenerationHistoryService,
    imageGenerationTaskService: deps.imageGenerationTaskService,
  });
  registerWindowHandlers({ getMainWindow: deps.getMainWindow });
  registerCodexHandlers({ serverManager: deps.serverManager, sendEvent: deps.sendCodexEvent });
  registerCacheHandlers({ cacheRegistryService: deps.cacheRegistryService });
  registerUsageHandlers({ usageStatsService: deps.usageStatsService });
  registerHistoryHandlers({
    historyService: deps.historyService,
    threadTaskService: deps.threadTaskService,
    threadArtifactService: deps.threadArtifactService,
    threadTitleOverrideService: deps.threadTitleOverrideService,
    onUpdated: deps.onHistoryUpdated,
    decorateItems: deps.decorateHistoryItems,
    onThreadDeleted: deps.onHistoryThreadDeleted,
  });
  registerWorkspaceHandlers({ workspacePatchService: deps.workspacePatchService });
}
