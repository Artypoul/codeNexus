// 领域类型定义：跨组件/Store 复用的状态与数据结构。
import type { ApprovalsReviewer } from "@codenexus/generated/codex-app-server/v2/ApprovalsReviewer";
import type { AskForApproval } from "@codenexus/generated/codex-app-server/v2/AskForApproval";
import type { SandboxMode } from "@codenexus/generated/codex-app-server/v2/SandboxMode";
import type { ThreadGoalStatus } from "@codenexus/generated/codex-app-server/v2/ThreadGoalStatus";
import type { ThreadSourceKind } from "@codenexus/generated/codex-app-server/v2/ThreadSourceKind";
import type { TextElement } from "@codenexus/generated/codex-app-server/v2/TextElement";
import type { AppTextEncoding, AppTextLineEnding } from "@codenexus/shared/ipc/contracts";

export type ServerConnState = "disconnected" | "connecting" | "connected" | "failed";
export type CollaborationModeKind = "default" | "plan";

export type TextUserInput = {
  type: "text";
  text: string;
  text_elements?: TextElement[];
};

export type ImageUserInput = {
  type: "image";
  url: string;
};

export type LocalImageUserInput = {
  type: "localImage";
  path: string;
};

export type SkillUserInput = {
  type: "skill";
  name: string;
  path: string;
};

export type MentionUserInput = {
  type: "mention";
  name: string;
  path: string;
};

export type UserTurnInput = TextUserInput | ImageUserInput | LocalImageUserInput | SkillUserInput | MentionUserInput;

export type TimelineUserMessageParams = {
  role: "user";
  text: string;
  text_elements?: TextElement[];
  images?: string[] | null;
  local_images?: string[];
  content?: UserTurnInput[];
  skills?: Array<{ name: string; path: string }>;
};

export type ComposeImageAttachment = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  previewUrl: string;
  revokePreviewUrlOnDispose?: boolean;
  input: ImageUserInput | LocalImageUserInput;
};

export type ComposeWorkspaceFileMention = {
  id: string;
  path: string;
  kind?: "file" | "directory" | "skill" | "mention";
  name?: string;
  displayName?: string;
  iconUrl?: string;
};

export type ThreadHistoryItem = {
  id: string;
  title: string;
  meta: string;
  updatedAt: number;
  cwd?: string;
  modelProvider?: string;
  running?: boolean;
  threadSourceKind?: ThreadSourceKind;
  forkedFromId?: string;
  agentNickname?: string;
  agentRole?: string;
  agentPath?: string;
  gitInfoSummary?: string;
  projectId?: string | null;
  sectionId?: string | null;
  sectionName?: string | null;
};

export type ThreadGoalState = {
  threadId: string;
  objective: string;
  status: ThreadGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
};

export type LocalThreadStatus = "creating" | "ready";

export type LocalThreadItem = {
  id: string;
  title: string;
  meta: string;
  createdAt: number;
  updatedAt: number;
  status: LocalThreadStatus;
  cwd?: string;
  modelProvider?: string;
  running?: boolean;
  threadSourceKind?: ThreadSourceKind;
  forkedFromId?: string;
  agentNickname?: string;
  agentRole?: string;
  agentPath?: string;
  gitInfoSummary?: string;
  projectId?: string | null;
  sectionId?: string | null;
  sectionName?: string | null;
};

export type TimelineEventLevel = "info" | "warn" | "error";

export type TimelineEventItem = {
  id: string;
  method: string;
  paramsText: string;
  params?: unknown;
  createdAt: number;
  threadId?: string;
  turnId?: string;
  level: TimelineEventLevel;
  localKind?: "user" | "thinking";
  localState?: "pending" | "queued" | "sending" | "sent" | "failed";
  thinkingPhase?: "queued" | "preparing" | "reasoning" | "streaming" | "waiting_more" | "completed" | "failed";
  localMessageId?: string;
  hidden?: boolean;
};

export type TokenUsageBreakdownState = {
  totalTokens: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningOutputTokens: number | null;
};

export type TokenUsageState = {
  usedTokens: number | null;
  contextWindow: number | null;
  last: TokenUsageBreakdownState;
  total: TokenUsageBreakdownState;
  modelContextWindow: number | null;
  updatedAt: number | null;
};

export type ThreadTurnDiagnostics = {
  totalTurns: number;
  completedTurns: number;
  lastTurnStartedAt: number | null;
  lastTurnCompletedAt: number | null;
  lastTurnDurationMs: number | null;
};

export type ThreadHandoffDiagnosticsState = {
  threadId: string;
  parentThreadId: string | null;
  fetchedAt: number;
  current: ThreadTurnDiagnostics;
  parent: ThreadTurnDiagnostics | null;
  inheritedTurns: number | null;
  postHandoffTurns: number | null;
};

export type GlobalConfigDraft = {
  model: string;
  fastModeEnabled: boolean;
  modelContextWindow: number | null;
  modelAutoCompactTokenLimit: number | null;
  modelReasoningEffort: string;
  modelReasoningSummary: string;
  approvalPolicy: AskForApproval;
  approvalsReviewer: ApprovalsReviewer;
  sandboxMode: SandboxMode;
  windowsElevatedSandboxEnabled: boolean;
  unifiedExecEnabled: boolean;
  applyPatchStreamingEventsEnabled: boolean;
};

export type McpResourceEntry = {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
};

export type McpResourceTemplateEntry = {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
};

export type McpToolDefinitionState = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  annotations?: unknown;
  _meta?: unknown;
};

export type McpResourceContentState =
  | {
      uri: string;
      mimeType?: string;
      text: string;
    }
  | {
      uri: string;
      mimeType?: string;
      blob: string;
    };

export type McpServerState = {
  id: string;
  enabled: boolean;
  state: "connected" | "connecting" | "error" | "disabled" | "unknown";
  type?: "stdio" | "http" | "sse";
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  headers?: Record<string, string>;
  authenticated?: boolean;
  authStatus?: string;
  message?: string;
  tools: McpToolDefinitionState[];
  resources: McpResourceEntry[];
  resourceTemplates: McpResourceTemplateEntry[];
};

export type McpResourceViewerTab = "resources" | "templates";

export type McpResourceParameterEntry = {
  key: string;
  value: string;
};

export type McpResourceReadLoadState = "idle" | "loading" | "ready" | "error";

export type McpResourceReadResultState = {
  threadId: string;
  serverId: string;
  uri: string;
  contents: McpResourceContentState[];
  fetchedAt: number;
  resourceLabel: string;
  toolNames: string[];
  parameterEntries: McpResourceParameterEntry[];
};

export type McpResourceTemplateDraftState = {
  values: Record<string, string>;
  manualUri: string;
};

export type SkillState = {
  path: string | null;
  name: string;
  description?: string;
  displayName?: string;
  shortDescription?: string;
  defaultPrompt?: string;
  iconSmall?: string;
  iconLarge?: string;
  iconSmallUrl?: string;
  iconLargeUrl?: string;
  brandColor?: string;
  enabled: boolean;
  configurable: boolean;
};

export type WorkspaceFileSource = "local";

export type WorkspaceDirectoryEntryState = {
  path: string;
  fileName: string;
  isDirectory: boolean;
  isFile: boolean;
  source: WorkspaceFileSource;
};

export type WorkspaceDirectoryReadResult = {
  path: string;
  entries: WorkspaceDirectoryEntryState[];
  source: WorkspaceFileSource;
};

export type WorkspaceFileMetadataState = {
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  createdAtMs: number;
  modifiedAtMs: number;
  source: WorkspaceFileSource;
};

export type WorkspaceTextFileReadResult = {
  path: string;
  content: string;
  source: WorkspaceFileSource;
  encoding: AppTextEncoding;
  lineEnding: AppTextLineEnding;
};

export type WorkspaceTextFileWriteResult = {
  path: string;
  source: WorkspaceFileSource;
  encoding: AppTextEncoding;
  lineEnding: AppTextLineEnding;
};

export type UserInputOption = {
  label: string;
  description?: string;
};

export type UserInputQuestion = {
  id: string;
  header: string;
  question: string;
  options: UserInputOption[];
  isOther: boolean;
  isSecret: boolean;
};

type BaseUserInputPrompt = {
  serverId: string;
  requestId: number | string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  questions: UserInputQuestion[];
};

export type UserInputPrompt = BaseUserInputPrompt & {
  kind: "questions" | "elicitationForm" | "elicitationUrl";
  method: "item/tool/requestUserInput" | "mcpServer/elicitation/request";
  serverName?: string;
  message?: string;
  requestedSchema?: unknown;
  url?: string;
  elicitationId?: string;
};

export type PlanStepState = {
  step: string;
  status: "pending" | "inProgress" | "completed";
};

export type TurnPlanState = {
  threadId: string;
  turnId: string;
  explanation: string | null;
  plan: PlanStepState[];
  updatedAt: number;
};

export type CompletedTurnState = {
  turnId: string;
  diffText: string;
  completedAt: number;
  durationMs?: number | null;
};
