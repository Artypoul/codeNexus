import type {
  UserLocalSettings,
  UserLocalSettingsPatch,
} from "../localSettings";
import type {
  CodexProviderKind,
  CodexProviderProfileInput,
  CodexProviderProfilesState,
} from "../codexProfiles";
import type { CodexSkillRootsState } from "../codexSkillRoots";
import type {
  CodexConfigSwitcherActivateResult,
  CodexConfigSwitcherImportArgs,
  CodexConfigSwitcherMutationResult,
  CodexConfigSwitcherSnapshot,
  CodexConfigSwitcherState,
} from "../codexConfigSwitcher";
import type { ThreadSourceKind } from "@codenexus/generated/codex-app-server/v2/ThreadSourceKind";

/*
 * IPC 契约类型定义
 * ─────────────────────────────────────────────────────────────
 * 作用域：跨进程边界（Main ↔ Preload ↔ Renderer）
 * 角色：单一事实来源，定义所有通过 preload 暴露的 API 形态与数据结构
 * 修改约束：任何改动需同步 main / preload / renderer 三层实现
 * 数据流：Renderer 调用 → Preload 转发 → Main 处理 → 返回结构化结果
 */

// IPC 契约类型：定义 renderer 可通过 preload 调用的桌面 API 形态与数据结构。
// 该文件作为跨层协议边界，修改时需同步 main/preload/renderer 三层调用。
export type CodexEnsureInstalledResult = {
  native: { ok: boolean; details?: string };
};

export type CodexDiagnosticsResult = {
  codex: { ok: boolean; details?: string };
  node: { ok: boolean; details?: string };
  npm: { ok: boolean; details?: string };
};

/*
 * 历史会话与消息契约
 * ─────────────────────────────────────────────────────────────
 * 作用域：History 模块（线程列表、消息、事件、任务、产物）
 * 数据结构演变：
 *   HistoryThread → 列表项（支持 cache/disk/runtime 来源）
 *   HistoryMessage / HistoryThreadEvent → 内容分页
 *   HistoryThreadTask / Artifact → 任务与产物管理
 * 用途：renderer 通过 history API 获取、更新、删除会话数据
 */

// 会话历史列表项（来自 runtime/cache/disk 的统一结构）。
export type HistoryThread = {
  id: string;
  title: string;
  cwd?: string;
  modelProvider?: string;
  updatedAt: number;
  sessionPath: string;
  source: "cache" | "disk" | "runtime";
  running?: boolean;
  activeTurnId?: string;
  threadSourceKind?: ThreadSourceKind;
  forkedFromId?: string;
  agentNickname?: string;
  agentRole?: string;
  agentPath?: string;
  gitInfoSummary?: string;
};

export type HistoryThreadMetadataPatch = {
  id: string;
  threadSourceKind?: ThreadSourceKind | null;
  forkedFromId?: string | null;
  agentNickname?: string | null;
  agentRole?: string | null;
  agentPath?: string | null;
  gitInfoSummary?: string | null;
};

export type HistoryThreadTitleOverridesResult = {
  overrides: Record<string, string>;
};

export type HistoryThreadTitleOverrideSetArgs = {
  threadId: string;
  title: string;
};

export type HistoryThreadTitleOverrideClearArgs = {
  threadId: string;
};

// 历史消息的最小展示结构。
export type HistoryMessage = {
  role: "user" | "assistant";
  text: string;
  timestamp?: string;
};

// 历史事件分页条目（用于调试回放）。
export type HistoryThreadEvent = {
  lineNo: number;
  timestamp?: string;
  type: string;
  payload?: unknown;
};

export type HistoryThreadEventsPage = {
  entries: HistoryThreadEvent[];
  total: number;
  loaded: number;
  hasMore: boolean;
};

export type HistoryThreadContentArgs = {
  threadId: string;
  messageLimit?: number;
  eventLimit?: number;
  eventBefore?: number;
  includeAux?: boolean;
};

export type HistoryThreadContentResult = {
  found: boolean;
  threadId: string;
  thread: HistoryThread | null;
  messages: HistoryMessage[];
  eventsPage: HistoryThreadEventsPage;
};

export type HistoryThreadRunningStateArgs = {
  threadId: string;
};

export type HistoryThreadRunningStateResult = {
  threadId: string;
  running: boolean;
  activeTurnId: string | null;
  checkedAt: number;
};

export type HistoryThreadLastSummaryArgs = {
  threadId: string;
  messageLimit?: number;
};

export type HistoryThreadLastSummaryReasonCode =
  | "INVALID_THREAD_ID"
  | "THREAD_RUNNING"
  | "THREAD_NOT_FOUND"
  | "SUMMARY_NOT_FOUND";

export type HistoryThreadLastSummaryResult =
  | {
      found: true;
      threadId: string;
      summaryText: string;
      summaryRole: "assistant" | "user";
      source: "cache" | "disk";
      timestamp?: string;
    }
  | {
      found: false;
      threadId: string;
      reasonCode: HistoryThreadLastSummaryReasonCode;
      reasonMessage: string;
      source?: "cache" | "disk";
    };

export type HistoryThreadTaskStatus =
  | "todo"
  | "in_progress"
  | "done"
  | "blocked";

export type HistoryThreadTask = {
  taskId: string;
  threadId: string;
  title: string;
  description: string;
  status: HistoryThreadTaskStatus;
  createdAt: number;
  updatedAt: number;
};

export type HistoryThreadTaskCreateArgs = {
  threadId: string;
  title: string;
  description: string;
  status?: HistoryThreadTaskStatus;
};

export type HistoryThreadTaskCreateFailureCode =
  | "INVALID_THREAD_ID"
  | "INVALID_TITLE"
  | "INVALID_DESCRIPTION"
  | "INVALID_STATUS"
  | "TASK_STORE_CORRUPTED"
  | "TASK_STORE_READ_FAILED"
  | "TASK_STORE_WRITE_FAILED";

export type HistoryThreadTaskCreateResult =
  | {
      ok: true;
      task: HistoryThreadTask;
    }
  | {
      ok: false;
      errorCode: HistoryThreadTaskCreateFailureCode;
      errorMessage: string;
    };

export type HistoryThreadTaskPatch = {
  title?: string;
  description?: string;
  status?: HistoryThreadTaskStatus;
};

export type HistoryThreadTaskUpdateArgs = {
  threadId: string;
  taskId: string;
  patch?: HistoryThreadTaskPatch;
};

export type HistoryThreadTaskUpdateFailureCode =
  | "INVALID_THREAD_ID"
  | "INVALID_TASK_ID"
  | "INVALID_PATCH"
  | "INVALID_TITLE"
  | "INVALID_DESCRIPTION"
  | "INVALID_STATUS"
  | "TASK_STORE_CORRUPTED"
  | "TASK_STORE_READ_FAILED"
  | "TASK_STORE_WRITE_FAILED";

export type HistoryThreadTaskUpdateResult =
  | {
      ok: true;
      task: HistoryThreadTask;
      upserted: boolean;
    }
  | {
      ok: false;
      errorCode: HistoryThreadTaskUpdateFailureCode;
      errorMessage: string;
    };

export type HistoryThreadTaskListArgs = {
  threadId: string;
  limit?: number;
  statusIn?: HistoryThreadTaskStatus[];
  includeDone?: boolean;
};

export type HistoryThreadTaskListFailureCode =
  | "INVALID_THREAD_ID"
  | "TASK_STORE_CORRUPTED"
  | "TASK_STORE_READ_FAILED";

export type HistoryThreadTaskListResult =
  | {
      ok: true;
      tasks: HistoryThreadTask[];
    }
  | {
      ok: false;
      errorCode: HistoryThreadTaskListFailureCode;
      errorMessage: string;
    };

export type HistoryThreadArtifactKind = "text" | "file" | "link" | "json";

export type HistoryThreadArtifactPayload = {
  text?: string;
  path?: string;
  url?: string;
  value?: unknown;
};

export type HistoryThreadArtifact = {
  artifactId: string;
  threadId: string;
  title: string;
  kind: HistoryThreadArtifactKind;
  description: string;
  payload: HistoryThreadArtifactPayload;
  createdAt: number;
};

export type HistoryThreadArtifactPublishArgs = {
  threadId: string;
  title: string;
  kind: HistoryThreadArtifactKind;
  description?: string;
  payload: HistoryThreadArtifactPayload;
};

export type HistoryThreadArtifactPublishFailureCode =
  | "INVALID_THREAD_ID"
  | "INVALID_TITLE"
  | "INVALID_KIND"
  | "INVALID_PAYLOAD"
  | "ARTIFACT_TOO_LARGE"
  | "ARTIFACT_STORE_CORRUPTED"
  | "ARTIFACT_STORE_READ_FAILED"
  | "ARTIFACT_STORE_WRITE_FAILED";

export type HistoryThreadArtifactPublishResult =
  | {
      ok: true;
      artifact: HistoryThreadArtifact;
    }
  | {
      ok: false;
      errorCode: HistoryThreadArtifactPublishFailureCode;
      errorMessage: string;
    };

export type HistoryThreadArtifactListArgs = {
  threadId: string;
  limit?: number;
};

export type HistoryThreadArtifactListFailureCode =
  | "INVALID_THREAD_ID"
  | "ARTIFACT_STORE_CORRUPTED"
  | "ARTIFACT_STORE_READ_FAILED";

export type HistoryThreadArtifactListResult =
  | {
      ok: true;
      artifacts: HistoryThreadArtifact[];
    }
  | {
      ok: false;
      errorCode: HistoryThreadArtifactListFailureCode;
      errorMessage: string;
    };

export type HistoryThreadArtifactGetArgs = {
  artifactId: string;
};

export type HistoryThreadArtifactGetFailureCode =
  | "INVALID_ARTIFACT_ID"
  | "ARTIFACT_NOT_FOUND"
  | "ARTIFACT_STORE_CORRUPTED"
  | "ARTIFACT_STORE_READ_FAILED";

export type HistoryThreadArtifactGetResult =
  | {
      ok: true;
      artifact: HistoryThreadArtifact;
    }
  | {
      ok: false;
      errorCode: HistoryThreadArtifactGetFailureCode;
      errorMessage: string;
    };

// app-server 通知透传到 renderer 的统一包裹结构。
export type CodexEventPayload = {
  serverId: string;
  msg: CodexIncomingMessage;
};

export type HistoryUpdatedPayload = {
  items: HistoryThread[];
};

/*
 * 工作区与 Git 契约
 * ─────────────────────────────────────────────────────────────
 * 作用域：Workspace 模块
 * 数据结构：
 *   WorkspaceReverseDiffResult → 反向 diff 的 dry-run / apply 结果
 *   WorkspaceGitStatus* → Git 状态查询结果
 * 用途：renderer 调用 workspace API 进行文件选择、反向应用、状态检查
 */

// 反向补丁 dry-run/apply 的统一返回结构。
export type WorkspaceReverseDiffResult =
  | { ok: true; files: string[] }
  | { ok: false; error: string; files?: string[] };

export type WorkspaceGitStatusCode = "M" | "A" | "D" | "R" | "C" | "U" | "?";

export type WorkspaceGitStatusEntry = {
  path: string;
  relativePath: string;
  code: WorkspaceGitStatusCode;
  raw: string;
};

export type WorkspaceGitStatusResult =
  | {
      ok: true;
      root: string;
      entries: WorkspaceGitStatusEntry[];
    }
  | {
      ok: false;
      root: string;
      entries: [];
      reason: "not_git" | "failed";
      message: string;
    };

/*
 * 窗口与应用生命周期状态
 * ─────────────────────────────────────────────────────────────
 * 作用域：Window / App 模块
 * 数据结构：
 *   AppWindowState / AppWindowClosingState → 窗口状态与关闭流程
 *   AppClosingStep → 关闭阶段状态机
 * 用途：renderer 监听窗口状态变化、关闭确认流程
 */
export type AppWindowState = {
  isMaximized: boolean;
  isMinimized: boolean;
  isFullScreen: boolean;
};

export type AppClosingStep = {
  id: "prepareUi" | "stopTasks" | "exitApp";
  label: string;
  status: "pending" | "inProgress" | "completed";
};

export type AppWindowClosingState = {
  visible: boolean;
  phase: "idle" | "starting" | "preparing" | "stopping" | "finalizing";
  startedAt: number;
  steps: AppClosingStep[];
};

/*
 * 缓存管理契约
 * ─────────────────────────────────────────────────────────────
 * 作用域：Cache 模块（main / renderer）
 * 数据结构：
 *   CacheStatsItem / CacheListResult → 缓存统计
 *   CacheClear* → 清理请求与结果
 * 用途：诊断与手动清理缓存
 */
export type CacheScope = "main" | "renderer";

export type CacheStatsItem = {
  namespace: string;
  scope: CacheScope;
  clearable: boolean;
  items: number;
  bytes: number;
  updatedAt: number;
  note?: string;
};

export type CacheListResult = {
  items: CacheStatsItem[];
  generatedAt: number;
};

export type CacheClearArgs = {
  namespaces?: string[];
  clearAll?: boolean;
};

export type CacheClearSkipped = {
  namespace: string;
  reason: string;
};

export type CacheClearResult = {
  ok: true;
  cleared: string[];
  skipped: CacheClearSkipped[];
  items: CacheStatsItem[];
  generatedAt: number;
};

/*
 * 通知、电源与更新契约
 * ─────────────────────────────────────────────────────────────
 * 作用域：System / Update 模块
 * 数据结构：
 *   NotificationSoundItem → 通知音效
 *   SystemNotification* / SystemPower* → 系统通知与关机
 *   AppUpdate* → 自动更新状态机（idle → checking → available → downloading → downloaded）
 * 用途：renderer 触发系统通知、检查更新、安装更新
 */
export type NotificationSoundItem = {
  // 文件名（含扩展名），作为跨层稳定 ID（不使用绝对路径）。
  id: string;
  // 展示名（默认去掉扩展名），用于 UI 下拉选项。
  label: string;
};

export type SystemNotificationShowArgs = {
  title?: string;
  body?: string;
  silent?: boolean;
};

export type SystemNotificationShowResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "failed"; message?: string };

export type SystemPowerShutdownResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "failed"; message?: string };

export type AppUpdateStatus =
  | "unsupported"
  | "idle"
  | "checking"
  | "available"
  | "not_available"
  | "downloading"
  | "downloaded"
  | "error";

export type AppUpdateProgress = {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
};

export type AppUpdateSnapshot = {
  status: AppUpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  updateAvailable: boolean;
  downloaded: boolean;
  progress: AppUpdateProgress | null;
  errorMessage: string | null;
  checkedAt: number | null;
  isPackaged: boolean;
};

/*
 * 应用文件、设置、配置与认证契约
 * ─────────────────────────────────────────────────────────────
 * 作用域：App / LocalState / CodexProfiles / Auth / SkillRoots / ConfigSwitcher
 * 数据结构：
 *   AppDirectoryEntry / AppFileMetadata → 文件系统元数据
 *   LocalSettingsSnapshot / Patched... → 用户本地设置
 *   CodexProviderProfiles* / CodexAuth* / CodexSkillRoots* → Codex 配置
 *   CodexConfigSwitcher* → 多配置切换器
 * 用途：renderer 读写设置、切换 Codex provider、配置 skill roots
 */
export type AppDirectoryEntry = {
  fileName: string;
  isDirectory: boolean;
  isFile: boolean;
};

export type AppTextEncoding = "UTF-8" | "UTF-8 BOM";
export type AppTextLineEnding = "LF" | "CRLF" | "CR";

export type AppFileMetadata = {
  isDirectory: boolean;
  isFile: boolean;
  createdAtMs: number;
  modifiedAtMs: number;
};

export type LocalSettingsSnapshot = {
  path: string;
  exists: boolean;
  settings: UserLocalSettings;
};

export type PatchedLocalSettingsSnapshot = {
  path: string;
  exists: true;
  settings: UserLocalSettings;
};

export type CodexProviderProfilesSnapshot = {
  path: string;
  exists: boolean;
  state: CodexProviderProfilesState;
};

export type CodexProviderProfilesMutationResult = {
  path: string;
  exists: true;
  state: CodexProviderProfilesState;
};

export type CodexAuthWriteApiKeyResult = {
  ok: true;
  path: string;
};

export type CodexAuthReadApiKeyResult = {
  ok: true;
  path: string;
  exists: boolean;
  apiKey: string | null;
  maskedApiKey: string | null;
};

export type CodexProviderTestResult = {
  ok: boolean;
  status: number | null;
  message: string;
  modelCount: number | null;
  models: string[];
  elapsedMs: number | null;
};

export type CodexSkillRootsSnapshot = {
  path: string;
  exists: boolean;
  state: CodexSkillRootsState;
};

export type CodexSkillRootsMutationResult = {
  path: string;
  exists: true;
  state: CodexSkillRootsState;
};

export type CodexDesktopAppApi = {
  openExternal(args: { url: string }): Promise<{ ok: true }>;
  readTextFile(args: { path: string }): Promise<{
    ok: true;
    content: string;
    encoding: AppTextEncoding;
    lineEnding?: AppTextLineEnding | null;
  }>;
  writeTextFile(args: {
    path: string;
    content: string;
    encoding?: AppTextEncoding;
  }): Promise<{ ok: true }>;
  deleteFile(args: { path: string }): Promise<{ ok: true }>;
  readDirectory(args: {
    path: string;
  }): Promise<{ ok: true; entries: AppDirectoryEntry[] }>;
  getFileMetadata(args: {
    path: string;
  }): Promise<{ ok: true; metadata: AppFileMetadata }>;
  listNotificationSounds(): Promise<{ items: NotificationSoundItem[] }>;
  readNotificationSoundDataUrl(args: {
    id: string;
  }): Promise<{ ok: true; dataUrl: string }>;
  showSystemNotification(
    args: SystemNotificationShowArgs,
  ): Promise<SystemNotificationShowResult>;
  shutdownSystemNow(): Promise<SystemPowerShutdownResult>;
  getUpdateState(): Promise<AppUpdateSnapshot>;
  checkForUpdates(): Promise<AppUpdateSnapshot>;
  downloadUpdate(): Promise<AppUpdateSnapshot>;
  installUpdate(): Promise<{ ok: true }>;
  onUpdateState(cb: (payload: AppUpdateSnapshot) => void): () => void;
  appendFileChangeLog(args: {
    record: unknown;
  }): Promise<{ ok: true; path: string }>;
  readClipboardImageDataUrl(): Promise<{ ok: true; dataUrl: string | null }>;
  writeClipboardImageFromPath(args: { path: string }): Promise<{ ok: true }>;
  readImageFileDataUrl(args: {
    path: string;
  }): Promise<{ ok: true; dataUrl: string }>;
  readCodexProfiles(): Promise<CodexProviderProfilesSnapshot>;
  upsertCodexProfile(args: {
    profile: CodexProviderProfileInput;
  }): Promise<CodexProviderProfilesMutationResult>;
  deleteCodexProfile(args: {
    id: string;
  }): Promise<CodexProviderProfilesMutationResult>;
  setActiveCodexProfile(args: {
    id: string | null;
  }): Promise<CodexProviderProfilesMutationResult>;
  readCodexAuthApiKey(): Promise<CodexAuthReadApiKeyResult>;
  writeCodexAuthApiKey(args: {
    apiKey: string;
    filePath?: string | null;
  }): Promise<CodexAuthWriteApiKeyResult>;
  testCodexProvider(args: {
    providerKind?: CodexProviderKind;
    baseUrl: string;
    apiKey: string;
    timeoutMs?: number;
  }): Promise<CodexProviderTestResult>;
  prepareDeepSeekProxy(args: {
    upstreamBaseUrl: string;
  }): Promise<{ ok: true; baseUrl: string }>;
  readCodexSkillRoots(): Promise<CodexSkillRootsSnapshot>;
  setCodexSkillRootsForWorkspace(args: {
    workspacePath: string;
    roots: string[];
  }): Promise<CodexSkillRootsMutationResult>;
  readCodexConfigSwitcher(): Promise<CodexConfigSwitcherSnapshot>;
  saveCodexConfigSwitcher(args: {
    state: CodexConfigSwitcherState;
  }): Promise<CodexConfigSwitcherMutationResult>;
  activateCodexConfigSwitcherProfile(args: {
    profileId: string;
  }): Promise<CodexConfigSwitcherActivateResult>;
  importCurrentCodexConfigSwitcher(
    args: CodexConfigSwitcherImportArgs,
  ): Promise<CodexConfigSwitcherMutationResult>;
  restoreCodexConfigSwitcherBackup(args: {
    backupId: string;
  }): Promise<CodexConfigSwitcherMutationResult>;
};

export type CodexDesktopWindowApi = {
  getState(): Promise<AppWindowState>;
  minimize(): Promise<{ ok: true }>;
  toggleMaximize(): Promise<{ ok: true }>;
  close(): Promise<{ ok: true }>;
  onState(cb: (payload: AppWindowState) => void): () => void;
  onClosingState(cb: (payload: AppWindowClosingState) => void): () => void;
};

export type CodexDesktopLocalStateApi = {
  initialSettingsSnapshot: LocalSettingsSnapshot;
  readSettings(): Promise<LocalSettingsSnapshot>;
  patchSettings(args: {
    patch: UserLocalSettingsPatch;
  }): Promise<PatchedLocalSettingsSnapshot>;
};

export type CodexDesktopCacheApi = {
  list(args?: { scope?: CacheScope | "all" }): Promise<CacheListResult>;
  clear(args?: CacheClearArgs): Promise<CacheClearResult>;
};

export type CodexDesktopCodexServerApi = {
  ensureInstalled(): Promise<CodexEnsureInstalledResult>;
  getDiagnostics(): Promise<CodexDiagnosticsResult>;
  start(args: { cwd?: string; experimentalApi?: boolean }): Promise<{
    serverId: string;
    capabilities?: { experimentalApi?: boolean };
  }>;
  stop(args: { serverId: string }): Promise<{ ok: true }>;
  rpc<M extends CodexRpcMethod>(
    args: CodexRpcArgs<M>,
  ): Promise<CodexRpcResponse<M>>;
  notify<M extends string>(args: CodexNotifyArgs<M>): Promise<{ ok: true }>;
  respond<M extends SupportedCodexServerRequestMethod>(
    args: CodexServerRespondArgs<M>,
  ): Promise<{ ok: true }>;
  onEvent(cb: (payload: CodexEventPayload) => void): () => void;
};

export type CodexDesktopWorkspaceApi = {
  select(): Promise<string | null>;
  dryRunApplyReverseDiff(args: {
    cwd: string;
    diffText: string;
  }): Promise<WorkspaceReverseDiffResult>;
  applyReverseDiff(args: {
    cwd: string;
    diffText: string;
  }): Promise<WorkspaceReverseDiffResult>;
  readGitStatus(args: { cwd: string }): Promise<WorkspaceGitStatusResult>;
};

export type CodexDesktopHistoryApi = {
  list(): Promise<{ items: HistoryThread[] }>;
  refresh(): Promise<{ items: HistoryThread[] }>;
  mergeThreadMetadata(args: {
    threads: HistoryThreadMetadataPatch[];
  }): Promise<{ items: HistoryThread[] }>;
  deleteThread(args: { threadId: string }): Promise<{ ok: true }>;
  getThreadTitleOverrides(): Promise<HistoryThreadTitleOverridesResult>;
  setThreadTitleOverride(
    args: HistoryThreadTitleOverrideSetArgs,
  ): Promise<{ ok: true }>;
  clearThreadTitleOverride(
    args: HistoryThreadTitleOverrideClearArgs,
  ): Promise<{ ok: true }>;
  getThreadContent(
    args: HistoryThreadContentArgs,
  ): Promise<HistoryThreadContentResult>;
  getThreadMessages(args: {
    threadId: string;
    limit?: number;
  }): Promise<{ messages: HistoryMessage[] }>;
  getThreadEvents(args: {
    threadId: string;
    limit?: number;
    before?: number;
    includeAux?: boolean;
  }): Promise<HistoryThreadEventsPage>;
  createThreadTask(
    args: HistoryThreadTaskCreateArgs,
  ): Promise<HistoryThreadTaskCreateResult>;
  updateThreadTask(
    args: HistoryThreadTaskUpdateArgs,
  ): Promise<HistoryThreadTaskUpdateResult>;
  listThreadTasks(
    args: HistoryThreadTaskListArgs,
  ): Promise<HistoryThreadTaskListResult>;
  publishThreadArtifact(
    args: HistoryThreadArtifactPublishArgs,
  ): Promise<HistoryThreadArtifactPublishResult>;
  listThreadArtifacts(
    args: HistoryThreadArtifactListArgs,
  ): Promise<HistoryThreadArtifactListResult>;
  getThreadArtifact(
    args: HistoryThreadArtifactGetArgs,
  ): Promise<HistoryThreadArtifactGetResult>;
  onUpdated(cb: (payload: HistoryUpdatedPayload) => void): () => void;
};

/*
 * 桌面 API 聚合接口
 * ─────────────────────────────────────────────────────────────
 * 作用域：CodexDesktopApi（通过 preload 暴露给 renderer）
 * 模块关系：
 *   app → 文件、通知、更新、Codex 配置
 *   window → 窗口控制与状态
 *   localState → 设置快照与 patch
 *   cache → 缓存统计与清理
 *   codexServer → Codex 进程生命周期 + RPC/Notify/Event
 *   workspace → 工作区选择、Git、反向 diff
 *   history → 会话列表、消息、任务、产物
 * 数据流：renderer 调用这些方法 → preload 转发 → main 实现
 */

// 通过 preload 暴露给 renderer 的桌面 API 契约。
export type CodexDesktopApi = {
  app: CodexDesktopAppApi;
  window: CodexDesktopWindowApi;
  localState: CodexDesktopLocalStateApi;
  cache: CodexDesktopCacheApi;
  codexServer: CodexDesktopCodexServerApi;
  workspace: CodexDesktopWorkspaceApi;
  history: CodexDesktopHistoryApi;
};

import type {
  CodexIncomingMessage,
  CodexNotifyArgs,
  CodexRpcArgs,
  CodexRpcMethod,
  CodexRpcResponse,
  CodexServerRespondArgs,
  SupportedCodexServerRequestMethod,
} from "../codex-protocol/index";
