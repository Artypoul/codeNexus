import type { Pinia } from "pinia";
import { watch } from "vue";
import { codexDesktop } from "../api/codexDesktopClient";
import { showToast } from "../ui/toast";
import { translate } from "../i18n/translate";
import { appendDebugLog } from "../shared/debugLog";
import { isPendingThreadId } from "../shared/threadCreateDebug";
import { useRuntimeStore } from "../stores/runtime.store";
import { useTimelineStore } from "../stores/timeline.store";
import { useThreadStore } from "../stores/thread.store";
import { useGoalShutdownStore } from "../stores/goalShutdown.store";
import { useAppShellStore } from "../stores/appShell.store";
import { useConfigStore } from "../stores/config.store";
import { useConfigRequirementsStore } from "../stores/configRequirements.store";
import { useModelCatalogStore } from "../stores/modelCatalog.store";
import { useSkillsStore } from "../stores/skills.store";
import { useMcpStore } from "../stores/mcp.store";
import { useMcpResourceStore } from "../stores/mcpResource.store";
import { useUserInputStore } from "../stores/userInput.store";
import { useMessageQueueStore } from "../stores/messageQueue.store";
import { useCodexProfilesStore } from "../stores/codexProfiles.store";
import { useCodexSkillRootsStore } from "../stores/codexSkillRoots.store";
import { useCodexConfigSwitcherStore } from "../stores/codexConfigSwitcher.store";
import { useApprovalStore } from "../stores/approval.store";
import { useWorkspaceFilesStore } from "../stores/workspaceFiles.store";
import { type ThreadReplayCache } from "./runtime/historyReplayRuntime";
import { createHistoryListRuntime } from "./runtime/historyListRuntime";
import { createCodexServerEventRuntime } from "./runtime/codexServerEventRuntime";
import { createHistoryReplayWindowRuntime, type ThreadReplayWindowState } from "./runtime/historyReplayWindowRuntime";
import { createHistoryThreadRuntime } from "./runtime/historyThreadRuntime";
import { createThreadReadRuntime } from "./runtime/threadReadRuntime";
import { createThreadListLookupRuntime } from "./runtime/threadListLookupRuntime";
import { createHistoryThreadDeletionRuntime } from "./runtime/historyThreadDeletionRuntime";
import { createConfigRuntime } from "./runtime/configRuntime";
import { createMcpRuntime } from "./runtime/mcpRuntime";
import { createMcpResourceReadRuntime } from "./runtime/mcpResourceRuntime";
import { createSkillsRuntime } from "./runtime/skillsRuntime";
import { createTurnInputRuntime } from "./runtime/turnInputRuntime";
import { createThreadCreationRuntime } from "./runtime/threadCreationRuntime";
import { createThreadModelCompatibilityRuntime } from "./runtime/threadModelCompatibilityRuntime";
import { createTurnStartRuntime } from "./runtime/turnStartRuntime";
import { createTurnSendDraftRuntime, type TurnSendDraft } from "./runtime/turnSendDraftRuntime";
import { createTurnSteerRuntime } from "./runtime/turnSteerRuntime";
import { createWorkspaceFileRuntime, createWorkspacePathResolver } from "./runtime/workspaceFileRuntime";
import { createWorkspaceSessionRuntime } from "./runtime/workspaceSessionRuntime";
import { createPromptResponseRuntime } from "./runtime/promptResponseRuntime";
import { createMessageQueueRuntime } from "./runtime/messageQueueRuntime";
import { createThreadPreparingRuntime } from "./runtime/threadPreparingRuntime";
import { createThreadGoalRuntime } from "./runtime/threadGoalRuntime";
import { createThreadMemoryRuntime } from "./runtime/threadMemoryRuntime";
import { createThreadTurnControlRuntime } from "./runtime/threadTurnControlRuntime";
import { createThreadTitleUpdateRuntime } from "./runtime/threadTitleUpdateRuntime";
import { createThreadSwitchRuntime } from "./runtime/threadSwitchRuntime";
import { createThreadRollbackRuntime } from "./runtime/threadRollbackRuntime";
import { createHistoryRewriteRuntime } from "./runtime/historyRewriteRuntime";
import { createThreadResumeRuntime } from "./runtime/threadResumeRuntime";
import { createThreadRuntimeCleanupRuntime } from "./runtime/threadRuntimeCleanupRuntime";
import { createThreadStartParamsRuntime } from "./runtime/threadStartParamsRuntime";
import { createThreadMetadataRuntime } from "./runtime/threadMetadataRuntime";
import { createCodexProfileRuntime } from "./runtime/codexProfileRuntime";
import { createCodexConfigSwitcherRuntime } from "./runtime/codexConfigSwitcherRuntime";
import { createMcpManagementRuntime } from "./runtime/mcpManagementRuntime";
import { createSkillsManagementRuntime } from "./runtime/skillsManagementRuntime";
import { createGlobalConfigManagementRuntime } from "./runtime/globalConfigManagementRuntime";
import { createEnvironmentRuntime } from "./runtime/environmentRuntime";
import { createExternalUrlRuntime } from "./runtime/externalUrlRuntime";
import { createCompletedTurnNotificationRuntime } from "./runtime/completedTurnNotificationRuntime";
import { createRightPanelRuntime, type McpSnapshot, type SkillsSnapshot } from "./runtime/rightPanelRuntime";
import { createRightPanelRefreshRuntime } from "./runtime/rightPanelRefreshRuntime";
import { createRendererCacheManagementRuntime } from "./runtime/rendererCacheManagementRuntime";
import { createRuntimeTimelineEventRuntime } from "./runtime/runtimeTimelineEventRuntime";
import { createRuntimeDisposeRuntime } from "./runtime/runtimeDisposeRuntime";
import { createRuntimeStartupRuntime } from "./runtime/runtimeStartupRuntime";
import type { ThreadContentCacheEntry } from "./runtime/rendererCacheRuntime";
import type { ThreadMemoryMode } from "@codenexus/generated/codex-app-server/ThreadMemoryMode";
import { resolveModelSelectionValue, resolveReasoningEffort } from "@codenexus/shared/modelCatalog";
import type {
  ComposeImageAttachment,
  ComposeWorkspaceFileMention,
  McpResourceContentState,
  McpResourceParameterEntry,
  ThreadGoalState,
  WorkspaceDirectoryReadResult,
  WorkspaceFileMetadataState,
  WorkspaceTextFileReadResult,
  WorkspaceTextFileWriteResult,
} from "./types";
import type {
  AppTextEncoding,
  AppTextLineEnding,
  CacheClearArgs,
  CacheClearResult,
  CacheListResult,
  HistoryThreadContentResult,
  HistoryThreadTaskCreateArgs,
  HistoryThreadTaskCreateResult,
  HistoryThreadTaskUpdateArgs,
  HistoryThreadTaskUpdateResult,
} from "@codenexus/shared/ipc/contracts";

const APP_TIMELINE_ID = "__app__";
const HISTORY_REPLAY_BATCH = 1000;
const HISTORY_REPLAY_TURN_SEGMENTS = 4;
const TIMELINE_MAX_VISIBLE_TURNS = 16;
const THREAD_METADATA_PAGE_SIZE = 200;
const THREAD_CONTENT_CACHE_TTL_MS = 2000;
const MCP_STATUS_REFRESH_DEBOUNCE_MS = 250;
const SKILLS_REFRESH_DEBOUNCE_MS = 250;

export type RuntimeOrchestrator = {
  dispose: () => void;
  checkEnvironment: () => Promise<void>;
  selectWorkspace: () => Promise<void>;
  switchWorkspace: (workspacePath: string) => Promise<boolean>;
  refreshHistory: (force?: boolean) => Promise<void>;
  createThread: () => Promise<void>;
  switchThread: (threadId: string) => Promise<void>;
  loadOlderHistoryTurns: (threadId?: string) => Promise<boolean>;
  deleteHistoryThread: (threadId: string) => Promise<void>;
  send: () => Promise<boolean>;
  sendHistoryRewriteDraft: (draft: {
    anchorTurnId: string;
    composeInput: string;
    composeAttachments: ComposeImageAttachment[];
    composeFileMentions: ComposeWorkspaceFileMention[];
    model: string;
    reasoningEffort: string;
    sandboxMode: string;
    composeMode: "default" | "plan";
  }) => Promise<boolean>;
  steerNow: () => Promise<void>;
  sendQueuedMessageNow: (messageId: string) => Promise<void>;
  editQueuedMessage: (messageId: string) => Promise<void>;
  removeQueuedMessage: (messageId: string) => Promise<void>;
  interruptTurn: () => Promise<void>;
  compactThread: () => Promise<void>;
  resetCodexMemory: () => Promise<void>;
  setCurrentThreadMemoryMode: (mode: ThreadMemoryMode) => Promise<void>;
  refreshThreadGoal: (threadId?: string) => Promise<ThreadGoalState | null>;
  promptAndSetCurrentThreadGoal: () => Promise<ThreadGoalState | null>;
  setCurrentThreadGoal: (args: {
    objective: string;
    tokenBudget?: number | null;
    shutdownOnComplete?: boolean;
  }) => Promise<ThreadGoalState | null>;
  completeCurrentThreadGoal: () => Promise<ThreadGoalState | null>;
  clearCurrentThreadGoal: () => Promise<boolean>;
  refreshGlobalConfig: () => Promise<void>;
  saveGlobalConfig: (options?: { source?: "manual" | "auto"; silentSuccessToast?: boolean }) => Promise<void>;
  resetGlobalConfig: () => void;
  applyCodexProfile: (profileId: string) => Promise<void>;
  openExternalUrl: (url: string) => Promise<void>;
  readTextFile: (path: string) => Promise<string>;
  writeTextFile: (path: string, content: string) => Promise<void>;
  readWorkspaceDirectory: (path?: string) => Promise<WorkspaceDirectoryReadResult>;
  getWorkspaceMetadata: (path: string) => Promise<WorkspaceFileMetadataState>;
  readWorkspaceTextFile: (path: string) => Promise<WorkspaceTextFileReadResult>;
  deleteWorkspaceFile: (path: string) => Promise<void>;
  writeWorkspaceTextFile: (
    path: string,
    content: string,
    options?: { encoding?: AppTextEncoding; lineEnding?: AppTextLineEnding }
  ) => Promise<WorkspaceTextFileWriteResult>;
  refreshSkills: (forceReload?: boolean) => Promise<void>;
  toggleSkill: (skillPath: string, enabled: boolean) => Promise<void>;
  addSkillRoot: (root: string) => Promise<void>;
  removeSkillRoot: (root: string) => Promise<void>;
  refreshCodexConfigSwitcher: () => Promise<void>;
  importCurrentCodexConfigProfile: () => Promise<void>;
  activateCodexConfigProfile: (profileId: string) => Promise<void>;
  refreshMcp: () => Promise<void>;
  reloadMcpConfig: () => Promise<void>;
  toggleMcpEnabled: (serverKey: string, enabled: boolean) => Promise<void>;
  deleteMcpServer: (serverId: string) => Promise<void>;
  importMcpServersFromJson: (text: string) => Promise<{ imported: number; errors: string[] }>;
  startMcpOAuthLogin: (serverKey: string) => Promise<void>;
  readThreadContent: (params?: {
    threadId?: string;
    messageLimit?: number;
    eventLimit?: number;
    eventBefore?: number;
    includeAux?: boolean;
  }) => Promise<HistoryThreadContentResult>;
  createThreadTask: (args: HistoryThreadTaskCreateArgs) => Promise<HistoryThreadTaskCreateResult>;
  updateThreadTask: (args: HistoryThreadTaskUpdateArgs) => Promise<HistoryThreadTaskUpdateResult>;
  listRendererCaches: () => Promise<CacheListResult>;
  clearRendererCaches: (args?: CacheClearArgs) => Promise<CacheClearResult>;
  readMcpResource: (params: {
    threadId: string;
    serverKey: string;
    uri: string;
    sourceTab?: "resources" | "templates";
    templateKey?: string;
  }) => Promise<{
    contents: McpResourceContentState[];
    resourceLabel: string;
    toolNames: string[];
    parameterEntries: McpResourceParameterEntry[];
  }>;
  rollbackTurns: () => Promise<void>;
  submitUserInputPromptForThread: (threadId: string) => Promise<void>;
  cancelUserInputPromptForThread: (threadId: string) => Promise<void>;
  submitActiveUserInputPrompt: () => Promise<void>;
  cancelActiveUserInputPrompt: () => Promise<void>;
  submitActiveApprovalPrompt: (decision: unknown) => Promise<void>;
  dismissActiveApprovalPrompt: () => void;
};

let runtimeOrchestrator: RuntimeOrchestrator | null = null;

export function initRuntimeOrchestrator(pinia: Pinia): RuntimeOrchestrator {
  if (runtimeOrchestrator) return runtimeOrchestrator;

  const runtimeStore = useRuntimeStore(pinia);
  const threadStore = useThreadStore(pinia);
  const goalShutdownStore = useGoalShutdownStore(pinia);
  const timelineStore = useTimelineStore(pinia);
  const appShellStore = useAppShellStore(pinia);
  const configStore = useConfigStore(pinia);
  const configRequirementsStore = useConfigRequirementsStore(pinia);
  const modelCatalogStore = useModelCatalogStore(pinia);
  const skillsStore = useSkillsStore(pinia);
  const mcpStore = useMcpStore(pinia);
  const mcpResourceStore = useMcpResourceStore(pinia);
  const userInputStore = useUserInputStore(pinia);
  const approvalStore = useApprovalStore(pinia);
  const messageQueueStore = useMessageQueueStore(pinia);
  const workspaceFilesStore = useWorkspaceFilesStore(pinia);
  const codexProfilesStore = useCodexProfilesStore(pinia);
  const codexSkillRootsStore = useCodexSkillRootsStore(pinia);
  const codexConfigSwitcherStore = useCodexConfigSwitcherStore(pinia);

  // 运行期缓存：会话恢复、历史分页、右侧面板快照。
  const resumedThreadIds = new Set<string>();
  const resumePromisesByThread = new Map<string, Promise<boolean>>();
  const replayCacheByThread = new Map<string, ThreadReplayCache>();
  const replayWindowStateByThread = new Map<string, ThreadReplayWindowState>();
  const replayRequestSeqByThread = new Map<string, number>();
  const olderHistoryLoadPromiseByThread = new Map<string, Promise<boolean>>();
  const threadContentCacheByKey = new Map<string, ThreadContentCacheEntry>();
  const threadMetadataHydrationPromiseByWorkspace = new Map<string, Promise<void>>();
  const handoffDiagnosticsPromiseByThread = new Map<string, Promise<void>>();
  const skillsSnapshotByWorkspace = new Map<string, SkillsSnapshot>();
  const mcpSnapshotByWorkspace = new Map<string, McpSnapshot>();
  const disposers: Array<() => void> = [];

  const normalizeWorkspacePath = (value: string) => String(value ?? "").trim();

  const preferredModelValue = () =>
    String(configRequirementsStore.requirements?.models?.newThread?.model ?? "").trim() || null;
  const preferredModelEffort = () =>
    String(configRequirementsStore.requirements?.models?.newThread?.modelReasoningEffort ?? "").trim() || null;
  const resolveModelValue = (value: unknown) =>
    resolveModelSelectionValue(modelCatalogStore.models, value, preferredModelValue());
  const resolveEffortValue = (modelValue: unknown, effort: unknown) =>
    resolveReasoningEffort(modelCatalogStore.models, modelValue, effort, preferredModelEffort());

  const runtimeTimelineEventRuntime = createRuntimeTimelineEventRuntime({
    appTimelineId: APP_TIMELINE_ID,
    timelineStore,
  });
  const { pushEvent } = runtimeTimelineEventRuntime;

  const threadPreparingRuntime = createThreadPreparingRuntime({
    appTimelineId: APP_TIMELINE_ID,
    timelineStore,
    translate,
  });
  const { upsertThreadPreparingEvent, clearThreadPreparingEvent } = threadPreparingRuntime;

  const threadStartParamsRuntime = createThreadStartParamsRuntime({
    getMainView: () => appShellStore.mainView,
    getApprovalPolicy: () => configStore.draft.approvalPolicy,
    getApprovalsReviewer: () => configStore.draft.approvalsReviewer,
    normalizeWorkspacePath,
  });
  const { resolveCurrentInstructionProfile, buildThreadStartParamsForModel } = threadStartParamsRuntime;

  const rendererCacheManagementRuntime = createRendererCacheManagementRuntime({
    threadContentCacheByKey,
    replayCacheByThread,
    replayWindowStateByThread,
    replayRequestSeqByThread,
    olderHistoryLoadPromiseByThread,
    skillsSnapshotByWorkspace,
    mcpSnapshotByWorkspace,
    mcpResourceStore,
    workspaceFilesStore,
  });
  const { listRendererCaches, clearRendererCaches } = rendererCacheManagementRuntime;

  const workspaceFileRuntime = createWorkspaceFileRuntime(
    createWorkspacePathResolver({
      getWorkspacePath: () => runtimeStore.workspacePath,
      normalizeWorkspacePath,
    })
  );
  const rightPanelRuntime = createRightPanelRuntime({
    configStore,
    configRequirementsStore,
    skillsStore,
    mcpStore,
    mcpResourceStore,
    userInputStore,
    skillsSnapshotByWorkspace,
    mcpSnapshotByWorkspace,
    normalizeWorkspacePath,
    translate,
  });
  const {
    saveSkillsSnapshot,
    invalidateSkillsSnapshot,
    hasSkillsSnapshot,
    saveMcpSnapshot,
    invalidateMcpSnapshot,
    hasMcpSnapshot,
    applyCachedRightPanels,
    resetSidePanelStores,
  } = rightPanelRuntime;

  const threadListLookupRuntime = createThreadListLookupRuntime({ threadStore });
  const { findThreadListItem } = threadListLookupRuntime;

  const threadTitleUpdateRuntime = createThreadTitleUpdateRuntime({
    threadStore,
    findThreadListItem,
    translate,
  });
  const { seedThreadTitleFromDraft } = threadTitleUpdateRuntime;

  const workspaceSessionRuntime = createWorkspaceSessionRuntime({
    appTimelineId: APP_TIMELINE_ID,
    runtimeStore,
    threadStore,
    appShellStore,
    workspaceFilesStore,
    normalizeWorkspacePath,
    findThreadListItem,
    resetSidePanelStores,
    applyCachedRightPanels,
    refreshRightPanels: (opts) => refreshRightPanels(opts),
    refreshHistory: (force) => refreshHistory(force),
    hydrateThreadMetadataForWorkspace: (workspace) => hydrateThreadMetadataForWorkspace(workspace),
    pushEvent,
    translate,
    showToast,
  });
  const {
    setThreadWorkspace,
    clearThreadWorkspace,
    getWorkspaceForThread,
    getWorkspaceForServerId,
    getThreadWorkspaceEntries,
    getServerIdForWorkspace,
    getServerIdForThread,
    requireActiveWorkspaceServerId,
    syncActiveServerByWorkspace,
    clearServerById,
    ensureServerForWorkspace,
    startServer,
    ensureWorkspaceForSend,
    selectWorkspace,
    switchWorkspace,
  } = workspaceSessionRuntime;

  const threadModelCompatibilityRuntime = createThreadModelCompatibilityRuntime({
    runtimeStore,
    threadStore,
    timelineStore,
    messageQueueStore,
    resumedThreadIds,
    resumePromisesByThread,
    threadScopedCaches: [
      replayCacheByThread,
      replayWindowStateByThread,
      replayRequestSeqByThread,
      olderHistoryLoadPromiseByThread,
    ],
    normalizeWorkspacePath,
    buildThreadStartParamsForModel,
    findThreadListItem,
    setThreadWorkspace,
    clearThreadWorkspace,
    pushEvent,
    translate,
  });
  const { rememberThreadStartConfigOverrides, clearThreadStartConfigOverrides, ensureThreadModelToolCompatibility } =
    threadModelCompatibilityRuntime;

  const configRuntime = createConfigRuntime({
    requireActiveWorkspaceServerId,
    getWorkspacePath: () => String(runtimeStore.workspacePath ?? "").trim(),
  });
  const { requestConfigRead, requestConfigRequirementsRead, requestConfigBatchWrite } = configRuntime;

  const threadReadRuntime = createThreadReadRuntime({
    getWorkspaceForThread,
    ensureServerForWorkspace,
  });
  const { requestThreadRead, ensureServerForThread } = threadReadRuntime;

  const threadGoalRuntime = createThreadGoalRuntime({
    appTimelineId: APP_TIMELINE_ID,
    runtimeStore,
    threadStore,
    goalShutdownStore,
    ensureServerForThread,
    translate,
    showToast,
  });
  const {
    refreshThreadGoal,
    promptAndSetCurrentThreadGoal,
    setCurrentThreadGoal,
    completeCurrentThreadGoal,
    clearCurrentThreadGoal,
  } = threadGoalRuntime;

  const skillsRuntime = createSkillsRuntime({
    requireActiveWorkspaceServerId,
    getServerIdForWorkspace,
    getWorkspacePath: () => String(runtimeStore.workspacePath ?? "").trim(),
    getExtraSkillRootsForWorkspace: (workspacePath) => codexSkillRootsStore.rootsForWorkspace(workspacePath),
  });
  const { requestSkillsList, writeSkillConfig } = skillsRuntime;

  const mcpRuntime = createMcpRuntime({
    requireActiveWorkspaceServerId,
    getWorkspacePath: () => String(runtimeStore.workspacePath ?? "").trim(),
    getWorkspaceForThread,
    ensureServerForWorkspace: (workspace) => ensureServerForWorkspace(workspace),
  });
  const { requestMcpStatusList, requestReloadMcpConfig, requestStartMcpOAuthLogin, requestMcpResourceRead } =
    mcpRuntime;

  const threadTurnControlRuntime = createThreadTurnControlRuntime({
    getCurrentThreadId: () => String(runtimeStore.currentThreadId ?? "").trim(),
    getActiveTurnId: (threadId) => String(threadStore.activeTurnIdByThread.get(threadId) ?? "").trim(),
    getServerIdForThread,
    pushEvent,
    translate,
  });
  const { requestTurnInterrupt, interruptTurn, compactThread } = threadTurnControlRuntime;

  const historyReplayWindowRuntime = createHistoryReplayWindowRuntime({
    runtimeStore,
    threadStore,
    timelineStore,
    replayCacheByThread,
    replayWindowStateByThread,
    replayRequestSeqByThread,
    olderHistoryLoadPromiseByThread,
    historyReplayBatch: HISTORY_REPLAY_BATCH,
    historyReplayTurnSegments: HISTORY_REPLAY_TURN_SEGMENTS,
    timelineMaxVisibleTurns: TIMELINE_MAX_VISIBLE_TURNS,
    translate,
  });
  const { hydrateReplayFromCacheIfNeeded, loadHistoryMessages, loadOlderHistoryTurns } = historyReplayWindowRuntime;

  const threadMetadataRuntime = createThreadMetadataRuntime({
    appTimelineId: APP_TIMELINE_ID,
    threadStore,
    threadMetadataHydrationPromiseByWorkspace,
    handoffDiagnosticsPromiseByThread,
    threadMetadataPageSize: THREAD_METADATA_PAGE_SIZE,
    normalizeWorkspacePath,
    getServerIdForWorkspace,
    findThreadListItem,
    requestThreadRead,
  });
  const { hydrateThreadMetadataForWorkspace, hydrateThreadHandoffDiagnostics } = threadMetadataRuntime;

  const historyListRuntime = createHistoryListRuntime({
    threadStore,
    threadContentCacheByKey,
    getWorkspacePath: () => String(runtimeStore.workspacePath ?? "").trim(),
    setThreadWorkspace,
    hydrateThreadMetadataForWorkspace,
  });
  const { refreshHistory, subscribeHistoryUpdates } = historyListRuntime;

  const globalConfigManagementRuntime = createGlobalConfigManagementRuntime({
    appTimelineId: APP_TIMELINE_ID,
    configStore,
    configRequirementsStore,
    getWorkspacePath: () => String(runtimeStore.workspacePath ?? "").trim(),
    getServerIdForWorkspace,
    requestConfigRead,
    requestConfigRequirementsRead,
    requestConfigBatchWrite,
    pushEvent,
    translate,
    showToast,
  });
  const { refreshGlobalConfig, ensureGlobalConfigLoadedOnce, saveGlobalConfig, resetGlobalConfig } =
    globalConfigManagementRuntime;

  const codexProfileRuntime = createCodexProfileRuntime({
    appTimelineId: APP_TIMELINE_ID,
    codexProfilesStore,
    getWorkspacePath: () => String(runtimeStore.workspacePath ?? "").trim(),
    getServerIdForWorkspace,
    requestConfigBatchWrite,
    refreshGlobalConfig,
    pushEvent,
    translate,
    showToast,
  });
  const { applyCodexProfile: applyCodexProfileBase } = codexProfileRuntime;
  const applyCodexProfile = async (profileId: string) => {
    await applyCodexProfileBase(profileId);
    void modelCatalogStore.refreshModels();
  };

  const externalUrlRuntime = createExternalUrlRuntime({ translate });
  const { openExternalUrl } = externalUrlRuntime;

  const {
    readTextFile,
    writeTextFile,
    readWorkspaceDirectory,
    getWorkspaceMetadata,
    readWorkspaceTextFile,
    deleteWorkspaceFile,
    writeWorkspaceTextFile,
  } = workspaceFileRuntime;

  const skillsManagementRuntime = createSkillsManagementRuntime({
    appTimelineId: APP_TIMELINE_ID,
    skillsStore,
    codexSkillRootsStore,
    skillsRefreshDebounceMs: SKILLS_REFRESH_DEBOUNCE_MS,
    getWorkspacePath: () => String(runtimeStore.workspacePath ?? "").trim(),
    getServerIdForWorkspace,
    requestSkillsList,
    writeSkillConfig,
    saveSkillsSnapshot,
    invalidateSkillsSnapshot,
    pushEvent,
    translate,
    showToast,
  });
  const { refreshSkills, scheduleSkillsRefresh, toggleSkill, addSkillRoot, removeSkillRoot } = skillsManagementRuntime;

  const codexConfigSwitcherRuntime = createCodexConfigSwitcherRuntime({
    codexConfigSwitcherStore,
    skillsStore,
    requestConfigRead,
    requestConfigBatchWrite,
    requestReloadMcpConfig,
    writeSkillConfig,
    refreshSkills,
    refreshMcp: () => refreshMcp(),
    invalidateMcpSnapshot,
    getWorkspacePath: () => String(runtimeStore.workspacePath ?? "").trim(),
    translate,
    showToast,
  });
  const {
    refreshCodexConfigSwitcher,
    importCurrentCodexConfigProfile,
    activateCodexConfigProfile,
    getRequiredActiveSwitcherProfile,
    writeCodexConfigSwitcherState,
    syncSwitcherProfileToCodex,
    upsertActiveSwitcherMcpServers,
  } = codexConfigSwitcherRuntime;

  const mcpManagementRuntime = createMcpManagementRuntime({
    appTimelineId: APP_TIMELINE_ID,
    mcpStore,
    codexConfigSwitcherStore,
    mcpStatusRefreshDebounceMs: MCP_STATUS_REFRESH_DEBOUNCE_MS,
    getWorkspacePath: () => String(runtimeStore.workspacePath ?? "").trim(),
    getServerIdForWorkspace,
    requestConfigRead,
    requestMcpStatusList,
    requestReloadMcpConfig,
    requestStartMcpOAuthLogin,
    openExternalUrl,
    getRequiredActiveSwitcherProfile,
    writeCodexConfigSwitcherState,
    syncSwitcherProfileToCodex,
    upsertActiveSwitcherMcpServers,
    saveMcpSnapshot,
    invalidateMcpSnapshot,
    pushEvent,
    translate,
    showToast,
  });
  const {
    refreshMcp,
    scheduleMcpStatusRefresh,
    applyMcpStartupStatusNotification,
    reloadMcpConfig,
    toggleMcpEnabled,
    deleteMcpServer,
    importMcpServersFromJson,
    startMcpOAuthLogin,
  } = mcpManagementRuntime;

  const historyThreadRuntime = createHistoryThreadRuntime({
    getCurrentThreadId: () => String(runtimeStore.currentThreadId ?? "").trim(),
    threadContentCacheByKey,
    threadContentCacheTtlMs: THREAD_CONTENT_CACHE_TTL_MS,
  });
  const { readThreadContent, createThreadTask, updateThreadTask } = historyThreadRuntime;

  const mcpResourceReadRuntime = createMcpResourceReadRuntime({
    getServers: () => mcpStore.servers,
    getTemplateDraft: (templateKey) => mcpResourceStore.getTemplateDraft(templateKey),
    requestMcpResourceRead,
    upsertTimelineEvent: (params) => timelineStore.upsertEvent(params),
  });
  const { readMcpResource } = mcpResourceReadRuntime;

  const rightPanelRefreshRuntime = createRightPanelRefreshRuntime({
    getWorkspacePath: () => runtimeStore.workspacePath,
    normalizeWorkspacePath,
    getServerIdForWorkspace,
    hasSkillsSnapshot,
    hasMcpSnapshot,
    ensureGlobalConfigLoadedOnce,
    ensureModelCatalog: () => modelCatalogStore.ensureModels({ maxAgeMs: 5 * 60_000 }),
    refreshSkills,
    refreshMcp,
  });
  const { refreshRightPanels } = rightPanelRefreshRuntime;

  const threadResumeRuntime = createThreadResumeRuntime({
    resumedThreadIds,
    resumePromisesByThread,
    getWorkspaceForThread,
    ensureServerForWorkspace,
    pushEvent,
  });
  const { ensureThreadResumed, markThreadResumed, clearThreadResumeState } = threadResumeRuntime;

  const threadRuntimeCleanupRuntime = createThreadRuntimeCleanupRuntime({
    runtimeStore,
    threadStore,
    timelineStore,
    messageQueueStore,
    threadScopedCaches: [
      replayCacheByThread,
      replayWindowStateByThread,
      replayRequestSeqByThread,
      olderHistoryLoadPromiseByThread,
    ],
    clearThreadResumeState,
    clearThreadStartConfigOverrides,
    clearThreadWorkspace,
  });
  const { clearThreadRuntimeState, clearThreadLocalContextCompactionEvents } = threadRuntimeCleanupRuntime;

  const threadRollbackRuntime = createThreadRollbackRuntime({
    runtimeStore,
    threadStore,
    timelineStore,
    normalizeWorkspacePath,
    getWorkspaceForThread,
    getServerIdForThread,
    ensureThreadResumed,
    pushEvent,
    translate,
    showToast,
  });
  const { requestThreadRollback, rollbackTurns } = threadRollbackRuntime;

  const historyRewriteRuntime = createHistoryRewriteRuntime({
    runtimeStore,
    threadStore,
    timelineStore,
    normalizeWorkspacePath,
    getWorkspaceForThread,
    getServerIdForThread,
    ensureThreadResumed,
    requestThreadRollback,
    requestTurnInterrupt,
    pushEvent,
    translate,
    showToast,
  });
  const { rollbackHistoryRewriteBeforeSend } = historyRewriteRuntime;

  const environmentRuntime = createEnvironmentRuntime({
    appTimelineId: APP_TIMELINE_ID,
    appShellStore,
    pushEvent,
    translate,
    showToast,
  });
  const { checkEnvironment } = environmentRuntime;

  const threadSwitchRuntime = createThreadSwitchRuntime({
    appTimelineId: APP_TIMELINE_ID,
    runtimeStore,
    threadStore,
    timelineStore,
    workspaceFilesStore,
    normalizeWorkspacePath,
    findThreadListItem,
    getWorkspaceForThread,
    setThreadWorkspace,
    syncActiveServerByWorkspace,
    ensureServerForWorkspace,
    applyCachedRightPanels,
    hasReplayCache: (threadId) => replayCacheByThread.has(threadId),
    hydrateReplayFromCacheIfNeeded,
    loadHistoryMessages,
    ensureThreadResumed,
    refreshThreadGoal: (threadId) => refreshThreadGoal(threadId),
    hydrateThreadHandoffDiagnostics: (threadId, opts) => hydrateThreadHandoffDiagnostics(threadId, opts),
    refreshRightPanels: () => refreshRightPanels(),
    pushEvent,
  });
  const { switchThread } = threadSwitchRuntime;

  const historyThreadDeletionRuntime = createHistoryThreadDeletionRuntime({
    appTimelineId: APP_TIMELINE_ID,
    threadStore,
    threadContentCacheByKey,
    clearThreadRuntimeState,
    pushEvent,
    translate,
    showToast,
  });
  const { deleteHistoryThread } = historyThreadDeletionRuntime;

  const turnInputRuntime = createTurnInputRuntime();
  const {
    cloneUserTurnInputs,
    toCodexUserInputs,
    fileNameFromPathLike,
    buildComposeAttachmentsFromUserTurnInputs,
    buildTimelineUserMessagePayload,
    buildUserTurnInput,
    summarizeLocalUserMessage,
  } = turnInputRuntime;

  const threadCreationRuntime = createThreadCreationRuntime({
    appTimelineId: APP_TIMELINE_ID,
    runtimeStore,
    configStore,
    threadStore,
    timelineStore,
    messageQueueStore,
    normalizeWorkspacePath,
    getServerIdForWorkspace,
    resolveModel: (value) => resolveModelValue(value),
    resolveEffort: (modelValue, effort) => resolveEffortValue(modelValue, effort),
    ensureModelCatalog: () => modelCatalogStore.ensureModels({ maxAgeMs: 60_000 }),
    startServer,
    clearThreadRuntimeState,
    setThreadWorkspace,
    clearThreadWorkspace,
    buildThreadStartParamsForModel,
    rememberThreadStartConfigOverrides,
    markThreadResumed,
    flushQueueForThread: (threadId) => flushQueueForThread(threadId),
    cloneUserTurnInputs,
    buildComposeAttachmentsFromUserTurnInputs,
    pushEvent,
    translate,
    showToast,
  });
  const { createThread } = threadCreationRuntime;

  const turnSteerRuntime = createTurnSteerRuntime({
    getServerIdForThread,
    toCodexUserInputs,
    pushEvent,
    translate,
  });
  const { requestTurnSteer } = turnSteerRuntime;

  const turnStartRuntime = createTurnStartRuntime({
    getComposeMode: () => runtimeStore.composeMode,
    getModel: () => runtimeStore.model,
    getReasoningEffort: () => runtimeStore.reasoningEffort,
    getReasoningSummary: () => runtimeStore.reasoningSummary,
    getSandboxMode: () => runtimeStore.sandboxMode,
    resolveModel: (value) => resolveModelValue(value),
    resolveEffort: (modelValue, effort) => resolveEffortValue(modelValue, effort),
    getApprovalPolicy: () => configStore.draft.approvalPolicy,
    getApprovalsReviewer: () => configStore.draft.approvalsReviewer,
    getInstructionProfile: resolveCurrentInstructionProfile,
    toCodexUserInputs,
  });
  const { startTurnWithInput } = turnStartRuntime;

  const turnSendDraftRuntime = createTurnSendDraftRuntime({ runtimeStore });
  const {
    cloneComposeAttachmentsForSend,
    cloneComposeMentionsForSend,
    runtimeStoreSendDraft,
    clearRuntimeStoreDraftAfterSend,
  } = turnSendDraftRuntime;

  const sendOrQueueDraft = async (
    mode: "auto" | "steer",
    draft: TurnSendDraft,
    opts?: { clearRuntimeDraftOnAccept?: boolean }
  ): Promise<boolean> => {
    const clearRuntimeDraftOnAccept = opts?.clearRuntimeDraftOnAccept ?? false;
    const composeInput = String(draft.composeInput ?? "");
    const composeAttachments = cloneComposeAttachmentsForSend(draft.composeAttachments);
    const composeFileMentions = cloneComposeMentionsForSend(draft.composeFileMentions);
    const rawModel = String(draft.model ?? runtimeStore.model ?? "").trim();
    const rawReasoningEffort = String(draft.reasoningEffort ?? runtimeStore.reasoningEffort ?? "").trim();
    const requestedSandboxMode = String(draft.sandboxMode ?? runtimeStore.sandboxMode ?? "").trim();
    const requestedComposeMode = draft.composeMode ?? runtimeStore.composeMode;
    const input = buildUserTurnInput(composeInput, composeAttachments, composeFileMentions);
    if (input.length === 0) return false;
    const localUserMessage = summarizeLocalUserMessage(input);
    const visibleText = String(localUserMessage.payload.text ?? "").trim();
    const queueText = String(localUserMessage.payload.text ?? "");

    const workspaceReady = await ensureWorkspaceForSend();
    if (!workspaceReady) {
      showToast({
        kind: "error",
        title: translate("runtime.cannotSendTitle"),
        message: translate("runtime.workspaceUnavailable"),
      });
      return false;
    }
    const activeWorkspace = normalizeWorkspacePath(runtimeStore.workspacePath);
    const activeServerId = await ensureServerForWorkspace(activeWorkspace);
    if (!activeServerId) {
      showToast({
        kind: "error",
        title: translate("runtime.cannotSendTitle"),
        message: translate("runtime.serviceUnavailable"),
      });
      return false;
    }
    await modelCatalogStore.ensureModels({ maxAgeMs: 60_000 });
    const requestedModel = resolveModelValue(rawModel);
    if (!requestedModel) {
      showToast({
        kind: "error",
        title: translate("runtime.cannotSendTitle"),
        message: translate("runtime.noModelAvailable"),
      });
      return false;
    }
    const requestedReasoningEffort = resolveEffortValue(requestedModel, rawReasoningEffort);
    if (!runtimeStore.currentThreadId) {
      void createThread();
    }
    let threadId = String(runtimeStore.currentThreadId ?? "").trim();
    if (!threadId) {
      showToast({
        kind: "error",
        title: translate("runtime.cannotSendTitle"),
        message: translate("runtime.threadNotReadyRetry"),
      });
      return false;
    }
    if (isPendingThreadId(threadId)) {
      const prevCount = runtimeStore.pendingThreadInitSendCountByThread.get(threadId) ?? 0;
      const nextCount = Number.isFinite(prevCount) ? Math.max(0, Math.round(prevCount)) + 1 : 1;
      runtimeStore.setPendingThreadInitSendCount(threadId, nextCount);

      if (clearRuntimeDraftOnAccept) clearRuntimeStoreDraftAfterSend();

      const localUserEventId = `local:user:${Date.now()}:${Math.random().toString(16).slice(2)}`;
      const localUserMessageId = `local-user-msg:${Date.now()}:${Math.random().toString(16).slice(2)}`;
      timelineStore.appendEvent({
        threadId,
        id: localUserEventId,
        method: "user",
        paramsText: localUserMessage.displayText,
        params: localUserMessage.payload,
        level: "warn",
        localKind: "user",
        localState: "queued",
        localMessageId: localUserMessageId,
      });
      upsertThreadPreparingEvent(threadId);
      runtimeStore.requestScrollTimelineToBottom();
      messageQueueStore.enqueue({
        threadId,
        text: queueText,
        inputs: input,
        localEventId: localUserEventId,
        displayText: localUserMessage.displayText,
      });

      appendDebugLog("thread.create", "pending send queued", {
        threadId,
        queuedCount: nextCount,
      });
      return true;
    }
    let threadWorkspace = normalizeWorkspacePath(getWorkspaceForThread(threadId) || runtimeStore.workspacePath);
    let threadServerId = await ensureServerForWorkspace(threadWorkspace);
    if (!threadServerId) {
      showToast({
        kind: "error",
        title: translate("runtime.cannotSendTitle"),
        message: translate("runtime.threadServiceUnavailable"),
      });
      return false;
    }
    setThreadWorkspace(threadId, threadWorkspace);

    const compatibility = await ensureThreadModelToolCompatibility({
      threadId,
      threadWorkspace,
      threadServerId,
      model: requestedModel,
    });
    if (!compatibility.ok) {
      showToast({ kind: "warn", title: translate("runtime.threadMustBeRecreatedTitle"), message: compatibility.error });
      pushEvent("turn:error", compatibility.error, { threadId, level: "error" });
      return false;
    }
    if (compatibility.threadId !== threadId) {
      threadId = compatibility.threadId;
      threadWorkspace = normalizeWorkspacePath(getWorkspaceForThread(threadId) || threadWorkspace);
      threadServerId = await ensureServerForWorkspace(threadWorkspace);
      if (!threadServerId) {
        showToast({
          kind: "error",
          title: translate("runtime.cannotSendTitle"),
          message: translate("runtime.threadServiceUnavailable"),
        });
        return false;
      }
      setThreadWorkspace(threadId, threadWorkspace);
    }

    seedThreadTitleFromDraft({
      threadId,
      threadWorkspace,
      visibleText,
      composeFileMentionCount: composeFileMentions.length,
      composeAttachmentCount: composeAttachments.length,
    });

    const overrideAnchorTurnId = String(draft.anchorTurnId ?? "").trim();
    const rewroteHistoryBeforeSend =
      Boolean(overrideAnchorTurnId) ||
      (runtimeStore.historyRewriteActive && runtimeStore.historyRewriteSource === "history");
    const historyRewriteReady = await rollbackHistoryRewriteBeforeSend(threadId, {
      anchorTurnId: overrideAnchorTurnId,
      force: Boolean(overrideAnchorTurnId),
    });
    if (!historyRewriteReady) return false;
    if (!rewroteHistoryBeforeSend) {
      const resumed = await ensureThreadResumed(threadId);
      if (!resumed) {
        showToast({
          kind: "error",
          title: translate("runtime.cannotSendTitle"),
          message: translate("runtime.threadResumeFailed"),
        });
        return false;
      }
    }

    clearThreadLocalContextCompactionEvents(threadId);

    if (clearRuntimeDraftOnAccept) clearRuntimeStoreDraftAfterSend();

    const running = threadStore.runningThreadIds.has(threadId);
    if (running && mode === "auto") {
      messageQueueStore.enqueue({
        threadId,
        text: queueText,
        inputs: input,
        displayText: localUserMessage.displayText,
      });
      return true;
    }

    const localUserEventId = `local:user:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const localUserMessageId = `local-user-msg:${Date.now()}:${Math.random().toString(16).slice(2)}`;

    timelineStore.appendEvent({
      threadId,
      id: localUserEventId,
      method: "user",
      paramsText: localUserMessage.displayText,
      params: localUserMessage.payload,
      level: "info",
      localKind: "user",
      localState: "pending",
      localMessageId: localUserMessageId,
    });
    runtimeStore.requestScrollTimelineToBottom();

    const setLocalUserEventState = (
      state: "pending" | "queued" | "sending" | "sent" | "failed",
      level?: "info" | "warn" | "error",
      turnIdValue?: string
    ) => {
      timelineStore.patchEvent({
        threadId,
        id: localUserEventId,
        patch: {
          localState: state,
          ...(level ? { level } : {}),
          ...(turnIdValue ? { turnId: turnIdValue } : {}),
        },
      });
    };

    if (running && mode === "steer") {
      const turnIdValue = String(threadStore.activeTurnIdByThread.get(threadId) ?? "").trim();
      const steerOk = await requestTurnSteer(threadId, input, turnIdValue);
      if (!steerOk) {
        setLocalUserEventState("failed", "error", turnIdValue || undefined);
        return false;
      }
      setLocalUserEventState("sent", "info", turnIdValue || undefined);
      return true;
    }

    setLocalUserEventState("sending", "info");
    if (threadStore.hasLocalThread(threadId)) {
      upsertThreadPreparingEvent(threadId);
    }
    const started = await startTurnWithInput({
      threadId,
      threadWorkspace,
      threadServerId,
      input,
      model: requestedModel,
      effort: requestedReasoningEffort,
      sandboxMode: requestedSandboxMode,
      composeModeOverride: requestedComposeMode,
    });
    if (started.ok) {
      setLocalUserEventState("sent", "info");
      return true;
    }
    clearThreadPreparingEvent(threadId);
    pushEvent("turn:error", started.error, { threadId, level: "error" });
    threadStore.setThreadRunning(threadId, false);
    setLocalUserEventState("failed", "error");
    return false;
  };

  const messageQueueRuntime = createMessageQueueRuntime({
    runtimeStore,
    threadStore,
    timelineStore,
    messageQueueStore,
    normalizeWorkspacePath,
    getWorkspaceForThread,
    resolveModel: (value) => resolveModelValue(value),
    ensureServerForWorkspace,
    ensureThreadResumed,
    ensureThreadModelToolCompatibility,
    requestTurnSteer,
    startTurnWithInput,
    clearThreadPreparingEvent,
    upsertThreadPreparingEvent,
    cloneUserTurnInputs,
    buildComposeAttachmentsFromUserTurnInputs,
    buildTimelineUserMessagePayload,
    fileNameFromPathLike,
    pushEvent,
    translate,
    showToast,
  });
  const { flushQueueForThread, sendQueuedMessageNow, editQueuedMessage, removeQueuedMessage } = messageQueueRuntime;

  const completedTurnNotificationRuntime = createCompletedTurnNotificationRuntime({
    getThreadTitle: (threadId) => {
      const historyItem = findThreadListItem(threadId);
      return threadStore.displayThreadTitle(threadId, historyItem?.title ?? threadId);
    },
  });
  const { notifyCompletedTurnIfBackground } = completedTurnNotificationRuntime;

  const send = async () => {
    return await sendOrQueueDraft("auto", runtimeStoreSendDraft(), { clearRuntimeDraftOnAccept: true });
  };

  const sendHistoryRewriteDraft: RuntimeOrchestrator["sendHistoryRewriteDraft"] = async (draft) => {
    const anchorTurnId = String(draft?.anchorTurnId ?? "").trim();
    if (!anchorTurnId) {
      showToast({
        kind: "error",
        title: translate("runtime.rewriteUnavailableTitle"),
        message: translate("runtime.rewriteTurnNotFound"),
      });
      return false;
    }
    return await sendOrQueueDraft("auto", {
      anchorTurnId,
      composeInput: String(draft?.composeInput ?? ""),
      composeAttachments: Array.isArray(draft?.composeAttachments) ? draft.composeAttachments : [],
      composeFileMentions: Array.isArray(draft?.composeFileMentions) ? draft.composeFileMentions : [],
      model: String(draft?.model ?? ""),
      reasoningEffort: String(draft?.reasoningEffort ?? ""),
      sandboxMode: String(draft?.sandboxMode ?? ""),
      composeMode: draft?.composeMode === "plan" ? "plan" : "default",
    });
  };

  const steerNow = async () => {
    await sendOrQueueDraft("steer", runtimeStoreSendDraft(), { clearRuntimeDraftOnAccept: true });
  };

  const threadMemoryRuntime = createThreadMemoryRuntime({
    appTimelineId: APP_TIMELINE_ID,
    runtimeStore,
    getServerIdForWorkspace,
    getServerIdForThread,
    pushEvent,
    translate,
    showToast,
  });
  const { resetCodexMemory, setCurrentThreadMemoryMode } = threadMemoryRuntime;

  const promptResponseRuntime = createPromptResponseRuntime({
    appTimelineId: APP_TIMELINE_ID,
    runtimeStore,
    approvalStore,
    userInputStore,
    respond: (args) => codexDesktop.codexServer.respond(args as Parameters<typeof codexDesktop.codexServer.respond>[0]),
    pushEvent,
    translate,
    showToast,
  });
  const {
    submitUserInputPromptForThread,
    cancelUserInputPromptForThread,
    submitActiveUserInputPrompt,
    cancelActiveUserInputPrompt,
    submitActiveApprovalPrompt,
    dismissActiveApprovalPrompt,
  } = promptResponseRuntime;

  const codexServerEventRuntime = createCodexServerEventRuntime({
    runtimeStore,
    threadStore,
    approvalStore,
    userInputStore,
    appShellStore,
    workspaceFilesStore,
    threadScopedCaches: [
      replayCacheByThread,
      replayWindowStateByThread,
      replayRequestSeqByThread,
      olderHistoryLoadPromiseByThread,
    ],
    normalizeWorkspacePath,
    getWorkspaceForServerId,
    getThreadWorkspaceEntries,
    clearServerById,
    syncActiveServerByWorkspace,
    clearThreadResumeState,
    resetSidePanelStores,
    invalidateSkillsSnapshot,
    scheduleSkillsRefresh,
    invalidateMcpSnapshot,
    applyMcpStartupStatusNotification,
    scheduleMcpStatusRefresh,
    refreshMcp,
    hydrateThreadHandoffDiagnostics,
    notifyCompletedTurnIfBackground,
    flushQueueForThread,
    translate,
  });
  const runtimeStartupRuntime = createRuntimeStartupRuntime({
    pinia,
    threadStore,
    subscribeHistoryUpdates,
    subscribeCodexServerEvents: codexServerEventRuntime.subscribeCodexServerEvents,
    refreshHistory,
    resetSidePanelStores,
    translate,
  });
  disposers.push(...runtimeStartupRuntime.startRuntime());
  disposers.push(
    watch(
      () => runtimeStore.serverId,
      (serverId) => {
        const id = String(serverId ?? "").trim();
        if (!id) {
          modelCatalogStore.resetCatalog();
          return;
        }
        void modelCatalogStore.ensureModels({ maxAgeMs: 5 * 60_000, serverId: id });
      },
      { immediate: true, flush: "post" }
    )
  );

  const runtimeDisposeRuntime = createRuntimeDisposeRuntime({
    flushPendingComposeStateSaves: () => runtimeStore.flushPendingComposeStateSaves(),
    disposeSkillsManagement: () => skillsManagementRuntime.dispose(),
    disposeMcpManagement: () => mcpManagementRuntime.dispose(),
    disposers,
    clearRuntimeOrchestrator: () => {
      runtimeOrchestrator = null;
    },
  });
  const { dispose } = runtimeDisposeRuntime;

  runtimeOrchestrator = {
    dispose,
    checkEnvironment,
    selectWorkspace,
    switchWorkspace,
    refreshHistory,
    createThread,
    switchThread,
    loadOlderHistoryTurns,
    deleteHistoryThread,
    send,
    sendHistoryRewriteDraft,
    steerNow,
    sendQueuedMessageNow,
    editQueuedMessage,
    removeQueuedMessage,
    interruptTurn,
    compactThread,
    resetCodexMemory,
    setCurrentThreadMemoryMode,
    refreshThreadGoal,
    promptAndSetCurrentThreadGoal,
    setCurrentThreadGoal,
    completeCurrentThreadGoal,
    clearCurrentThreadGoal,
    refreshGlobalConfig,
    saveGlobalConfig,
    resetGlobalConfig,
    applyCodexProfile,
    openExternalUrl,
    readTextFile,
    writeTextFile,
    readWorkspaceDirectory,
    getWorkspaceMetadata,
    readWorkspaceTextFile,
    deleteWorkspaceFile,
    writeWorkspaceTextFile,
    refreshSkills,
    toggleSkill,
    addSkillRoot,
    removeSkillRoot,
    refreshCodexConfigSwitcher,
    importCurrentCodexConfigProfile,
    activateCodexConfigProfile,
    refreshMcp,
    reloadMcpConfig,
    toggleMcpEnabled,
    deleteMcpServer,
    importMcpServersFromJson,
    startMcpOAuthLogin,
    readThreadContent,
    createThreadTask,
    updateThreadTask,
    listRendererCaches,
    clearRendererCaches,
    readMcpResource,
    rollbackTurns,
    submitUserInputPromptForThread,
    cancelUserInputPromptForThread,
    submitActiveUserInputPrompt,
    cancelActiveUserInputPrompt,
    submitActiveApprovalPrompt,
    dismissActiveApprovalPrompt,
  };
  return runtimeOrchestrator;
}

export function getRuntimeOrchestrator(): RuntimeOrchestrator {
  if (!runtimeOrchestrator) throw new Error("runtime orchestrator not initialized");
  return runtimeOrchestrator;
}
