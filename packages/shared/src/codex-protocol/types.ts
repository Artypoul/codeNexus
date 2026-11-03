/**
 * 协议总入口类型：用于获得官方 method 联合、params shape、通知和反向请求 envelope。
 * 这些类型足够推导请求参数，所以不需要逐个导入所有 params 类型。
 */
import type {
  ClientNotification,
  ClientRequest,
  InitializeResponse,
  ServerNotification,
  ServerRequest,
} from "@codenexus/generated/codex-app-server";
/**
 * Result 映射类型：官方生成包没有提供 method -> result 的总映射，
 * 因此这里按实际支持的 RPC / ServerRequest response 显式导入。
 */
import type { CancelLoginAccountResponse } from "@codenexus/generated/codex-app-server/v2/CancelLoginAccountResponse";
import type { ConfigReadResponse } from "@codenexus/generated/codex-app-server/v2/ConfigReadResponse";
import type { ConfigRequirementsReadResponse } from "@codenexus/generated/codex-app-server/v2/ConfigRequirementsReadResponse";
import type { ConfigWriteResponse } from "@codenexus/generated/codex-app-server/v2/ConfigWriteResponse";
import type { ExperimentalFeatureEnablementSetResponse } from "@codenexus/generated/codex-app-server/v2/ExperimentalFeatureEnablementSetResponse";
import type { EnvironmentAddResponse } from "@codenexus/generated/codex-app-server/v2/EnvironmentAddResponse";
import type { ListMcpServerStatusResponse } from "@codenexus/generated/codex-app-server/v2/ListMcpServerStatusResponse";
import type { AppsListResponse } from "@codenexus/generated/codex-app-server/v2/AppsListResponse";
import type { ApplyPatchApprovalResponse } from "@codenexus/generated/codex-app-server/ApplyPatchApprovalResponse";
import type { AttestationGenerateResponse } from "@codenexus/generated/codex-app-server/v2/AttestationGenerateResponse";
import type { ExecCommandApprovalResponse } from "@codenexus/generated/codex-app-server/ExecCommandApprovalResponse";
import type { ChatgptAuthTokensRefreshResponse } from "@codenexus/generated/codex-app-server/v2/ChatgptAuthTokensRefreshResponse";
import type { CollaborationModeListResponse } from "@codenexus/generated/codex-app-server/v2/CollaborationModeListResponse";
import type { CurrentTimeReadResponse } from "@codenexus/generated/codex-app-server/v2/CurrentTimeReadResponse";
import type { CommandExecutionRequestApprovalResponse } from "@codenexus/generated/codex-app-server/v2/CommandExecutionRequestApprovalResponse";
import type { CommandExecResponse } from "@codenexus/generated/codex-app-server/v2/CommandExecResponse";
import type { CommandExecResizeResponse } from "@codenexus/generated/codex-app-server/v2/CommandExecResizeResponse";
import type { CommandExecTerminateResponse } from "@codenexus/generated/codex-app-server/v2/CommandExecTerminateResponse";
import type { CommandExecWriteResponse } from "@codenexus/generated/codex-app-server/v2/CommandExecWriteResponse";
import type { ExperimentalFeatureListResponse } from "@codenexus/generated/codex-app-server/v2/ExperimentalFeatureListResponse";
import type { FsCopyResponse } from "@codenexus/generated/codex-app-server/v2/FsCopyResponse";
import type { FsCreateDirectoryResponse } from "@codenexus/generated/codex-app-server/v2/FsCreateDirectoryResponse";
import type { FsGetMetadataResponse } from "@codenexus/generated/codex-app-server/v2/FsGetMetadataResponse";
import type { FsReadDirectoryResponse } from "@codenexus/generated/codex-app-server/v2/FsReadDirectoryResponse";
import type { FsReadFileResponse } from "@codenexus/generated/codex-app-server/v2/FsReadFileResponse";
import type { FsRemoveResponse } from "@codenexus/generated/codex-app-server/v2/FsRemoveResponse";
import type { FsUnwatchResponse } from "@codenexus/generated/codex-app-server/v2/FsUnwatchResponse";
import type { FsWatchResponse } from "@codenexus/generated/codex-app-server/v2/FsWatchResponse";
import type { FsWriteFileResponse } from "@codenexus/generated/codex-app-server/v2/FsWriteFileResponse";
import type { ExternalAgentConfigDetectResponse } from "@codenexus/generated/codex-app-server/v2/ExternalAgentConfigDetectResponse";
import type { ExternalAgentConfigImportResponse } from "@codenexus/generated/codex-app-server/v2/ExternalAgentConfigImportResponse";
import type { FeedbackUploadResponse } from "@codenexus/generated/codex-app-server/v2/FeedbackUploadResponse";
import type { FileChangeRequestApprovalResponse } from "@codenexus/generated/codex-app-server/v2/FileChangeRequestApprovalResponse";
import type { GetAccountRateLimitsResponse } from "@codenexus/generated/codex-app-server/v2/GetAccountRateLimitsResponse";
import type { GetAccountResponse } from "@codenexus/generated/codex-app-server/v2/GetAccountResponse";
import type { HooksListResponse } from "@codenexus/generated/codex-app-server/v2/HooksListResponse";
import type { LoginAccountResponse } from "@codenexus/generated/codex-app-server/v2/LoginAccountResponse";
import type { LogoutAccountResponse } from "@codenexus/generated/codex-app-server/v2/LogoutAccountResponse";
import type { MarketplaceAddResponse } from "@codenexus/generated/codex-app-server/v2/MarketplaceAddResponse";
import type { MarketplaceRemoveResponse } from "@codenexus/generated/codex-app-server/v2/MarketplaceRemoveResponse";
import type { MarketplaceUpgradeResponse } from "@codenexus/generated/codex-app-server/v2/MarketplaceUpgradeResponse";
import type { MemoryResetResponse } from "@codenexus/generated/codex-app-server/v2/MemoryResetResponse";
import type { McpServerOauthLoginResponse } from "@codenexus/generated/codex-app-server/v2/McpServerOauthLoginResponse";
import type { McpResourceReadResponse } from "@codenexus/generated/codex-app-server/v2/McpResourceReadResponse";
import type { McpServerElicitationRequestResponse } from "@codenexus/generated/codex-app-server/v2/McpServerElicitationRequestResponse";
import type { McpServerRefreshResponse } from "@codenexus/generated/codex-app-server/v2/McpServerRefreshResponse";
import type { McpServerToolCallResponse } from "@codenexus/generated/codex-app-server/v2/McpServerToolCallResponse";
import type { DynamicToolCallResponse } from "@codenexus/generated/codex-app-server/v2/DynamicToolCallResponse";
import type { ModelListResponse } from "@codenexus/generated/codex-app-server/v2/ModelListResponse";
import type { ModelProviderCapabilitiesReadResponse } from "@codenexus/generated/codex-app-server/v2/ModelProviderCapabilitiesReadResponse";
import type { MockExperimentalMethodResponse } from "@codenexus/generated/codex-app-server/v2/MockExperimentalMethodResponse";
import type { PermissionsRequestApprovalResponse } from "@codenexus/generated/codex-app-server/v2/PermissionsRequestApprovalResponse";
import type { PermissionProfileListResponse } from "@codenexus/generated/codex-app-server/v2/PermissionProfileListResponse";
import type { PluginInstalledResponse } from "@codenexus/generated/codex-app-server/v2/PluginInstalledResponse";
import type { PluginInstallResponse } from "@codenexus/generated/codex-app-server/v2/PluginInstallResponse";
import type { PluginListResponse } from "@codenexus/generated/codex-app-server/v2/PluginListResponse";
import type { PluginReadResponse } from "@codenexus/generated/codex-app-server/v2/PluginReadResponse";
import type { PluginShareDeleteResponse } from "@codenexus/generated/codex-app-server/v2/PluginShareDeleteResponse";
import type { PluginShareCheckoutResponse } from "@codenexus/generated/codex-app-server/v2/PluginShareCheckoutResponse";
import type { PluginShareListResponse } from "@codenexus/generated/codex-app-server/v2/PluginShareListResponse";
import type { PluginShareSaveResponse } from "@codenexus/generated/codex-app-server/v2/PluginShareSaveResponse";
import type { PluginShareUpdateTargetsResponse } from "@codenexus/generated/codex-app-server/v2/PluginShareUpdateTargetsResponse";
import type { PluginSkillReadResponse } from "@codenexus/generated/codex-app-server/v2/PluginSkillReadResponse";
import type { PluginUninstallResponse } from "@codenexus/generated/codex-app-server/v2/PluginUninstallResponse";
import type { ProcessKillResponse } from "@codenexus/generated/codex-app-server/v2/ProcessKillResponse";
import type { ProcessResizePtyResponse } from "@codenexus/generated/codex-app-server/v2/ProcessResizePtyResponse";
import type { ProcessSpawnResponse } from "@codenexus/generated/codex-app-server/v2/ProcessSpawnResponse";
import type { ProcessWriteStdinResponse } from "@codenexus/generated/codex-app-server/v2/ProcessWriteStdinResponse";
import type { RemoteControlDisableResponse } from "@codenexus/generated/codex-app-server/v2/RemoteControlDisableResponse";
import type { RemoteControlEnableResponse } from "@codenexus/generated/codex-app-server/v2/RemoteControlEnableResponse";
import type { RemoteControlStatusReadResponse } from "@codenexus/generated/codex-app-server/v2/RemoteControlStatusReadResponse";
import type { ReviewStartResponse } from "@codenexus/generated/codex-app-server/v2/ReviewStartResponse";
import type { SendAddCreditsNudgeEmailResponse } from "@codenexus/generated/codex-app-server/v2/SendAddCreditsNudgeEmailResponse";
import type { SkillsConfigWriteResponse } from "@codenexus/generated/codex-app-server/v2/SkillsConfigWriteResponse";
import type { SkillsListResponse } from "@codenexus/generated/codex-app-server/v2/SkillsListResponse";
import type { ThreadApproveGuardianDeniedActionResponse } from "@codenexus/generated/codex-app-server/v2/ThreadApproveGuardianDeniedActionResponse";
import type { ThreadArchiveResponse } from "@codenexus/generated/codex-app-server/v2/ThreadArchiveResponse";
import type { ThreadBackgroundTerminalsCleanResponse } from "@codenexus/generated/codex-app-server/v2/ThreadBackgroundTerminalsCleanResponse";
import type { ThreadCompactStartResponse } from "@codenexus/generated/codex-app-server/v2/ThreadCompactStartResponse";
import type { ThreadDecrementElicitationResponse } from "@codenexus/generated/codex-app-server/v2/ThreadDecrementElicitationResponse";
import type { ThreadForkResponse } from "@codenexus/generated/codex-app-server/v2/ThreadForkResponse";
import type { ThreadGoalClearResponse } from "@codenexus/generated/codex-app-server/v2/ThreadGoalClearResponse";
import type { ThreadGoalGetResponse } from "@codenexus/generated/codex-app-server/v2/ThreadGoalGetResponse";
import type { ThreadGoalSetResponse } from "@codenexus/generated/codex-app-server/v2/ThreadGoalSetResponse";
import type { ThreadIncrementElicitationResponse } from "@codenexus/generated/codex-app-server/v2/ThreadIncrementElicitationResponse";
import type { ThreadInjectItemsResponse } from "@codenexus/generated/codex-app-server/v2/ThreadInjectItemsResponse";
import type { ThreadListResponse } from "@codenexus/generated/codex-app-server/v2/ThreadListResponse";
import type { ThreadLoadedListResponse } from "@codenexus/generated/codex-app-server/v2/ThreadLoadedListResponse";
import type { ThreadMemoryModeSetResponse } from "@codenexus/generated/codex-app-server/v2/ThreadMemoryModeSetResponse";
import type { ThreadMetadataUpdateResponse } from "@codenexus/generated/codex-app-server/v2/ThreadMetadataUpdateResponse";
import type { ThreadReadResponse } from "@codenexus/generated/codex-app-server/v2/ThreadReadResponse";
import type { ThreadRealtimeAppendAudioResponse } from "@codenexus/generated/codex-app-server/v2/ThreadRealtimeAppendAudioResponse";
import type { ThreadRealtimeAppendTextResponse } from "@codenexus/generated/codex-app-server/v2/ThreadRealtimeAppendTextResponse";
import type { ThreadRealtimeListVoicesResponse } from "@codenexus/generated/codex-app-server/v2/ThreadRealtimeListVoicesResponse";
import type { ThreadRealtimeStartResponse } from "@codenexus/generated/codex-app-server/v2/ThreadRealtimeStartResponse";
import type { ThreadRealtimeStopResponse } from "@codenexus/generated/codex-app-server/v2/ThreadRealtimeStopResponse";
import type { ThreadResumeResponse } from "@codenexus/generated/codex-app-server/v2/ThreadResumeResponse";
import type { ThreadRevertResponse } from "@codenexus/generated/codex-app-server/v2/ThreadRevertResponse";
import type { ThreadSearchResponse } from "@codenexus/generated/codex-app-server/v2/ThreadSearchResponse";
import type { ThreadSetNameResponse } from "@codenexus/generated/codex-app-server/v2/ThreadSetNameResponse";
import type { ThreadSettingsUpdateResponse } from "@codenexus/generated/codex-app-server/v2/ThreadSettingsUpdateResponse";
import type { ThreadShellCommandResponse } from "@codenexus/generated/codex-app-server/v2/ThreadShellCommandResponse";
import type { ThreadStartResponse } from "@codenexus/generated/codex-app-server/v2/ThreadStartResponse";
import type { ThreadTurnsListResponse } from "@codenexus/generated/codex-app-server/v2/ThreadTurnsListResponse";
import type { ThreadUnarchiveResponse } from "@codenexus/generated/codex-app-server/v2/ThreadUnarchiveResponse";
import type { ThreadUnsubscribeResponse } from "@codenexus/generated/codex-app-server/v2/ThreadUnsubscribeResponse";
import type { ToolRequestUserInputResponse } from "@codenexus/generated/codex-app-server/v2/ToolRequestUserInputResponse";
import type { TurnInterruptResponse } from "@codenexus/generated/codex-app-server/v2/TurnInterruptResponse";
import type { TurnStartResponse } from "@codenexus/generated/codex-app-server/v2/TurnStartResponse";
import type { TurnSteerResponse } from "@codenexus/generated/codex-app-server/v2/TurnSteerResponse";
import type { WindowsSandboxReadinessResponse } from "@codenexus/generated/codex-app-server/v2/WindowsSandboxReadinessResponse";
import type { WindowsSandboxSetupStartResponse } from "@codenexus/generated/codex-app-server/v2/WindowsSandboxSetupStartResponse";

export type JsonRpcId = number | string;

type AssertNever<T extends never> = T;

/**
 * ClientRequest -> result 的显式映射。
 *
 * 参数类型由官方 ClientRequest 联合推导；result 类型只能通过这里维护映射。
 * 只覆盖项目实际使用的方法，未列出的官方 method 结果类型回退为 unknown，
 * 避免每次升级 codex 都要补齐全部 method。
 */
type SupportedCodexRpcResultMap = {
  // 初始化与线程生命周期
  initialize: InitializeResponse;
  "thread/start": ThreadStartResponse;
  "thread/resume": ThreadResumeResponse;
  "thread/fork": ThreadForkResponse;
  "thread/archive": ThreadArchiveResponse;
  "thread/unsubscribe": ThreadUnsubscribeResponse;
  "thread/name/set": ThreadSetNameResponse;
  "thread/metadata/update": ThreadMetadataUpdateResponse;
  "thread/memoryMode/set": ThreadMemoryModeSetResponse;
  "memory/reset": MemoryResetResponse;
  "thread/unarchive": ThreadUnarchiveResponse;
  "thread/read": ThreadReadResponse;
  "thread/list": ThreadListResponse;
  "thread/search": ThreadSearchResponse;
  "thread/loaded/list": ThreadLoadedListResponse;
  "thread/increment_elicitation": ThreadIncrementElicitationResponse;
  "thread/decrement_elicitation": ThreadDecrementElicitationResponse;
  "thread/goal/set": ThreadGoalSetResponse;
  "thread/goal/get": ThreadGoalGetResponse;
  "thread/goal/clear": ThreadGoalClearResponse;
  "thread/revert": ThreadRevertResponse;
  "thread/settings/update": ThreadSettingsUpdateResponse;
  "thread/compact/start": ThreadCompactStartResponse;
  "thread/shellCommand": ThreadShellCommandResponse;
  "thread/approveGuardianDeniedAction": ThreadApproveGuardianDeniedActionResponse;
  "thread/backgroundTerminals/clean": ThreadBackgroundTerminalsCleanResponse;

  // 回合控制
  "turn/start": TurnStartResponse;
  "turn/steer": TurnSteerResponse;
  "turn/interrupt": TurnInterruptResponse;

  // realtime 会话
  "thread/realtime/start": ThreadRealtimeStartResponse;
  "thread/realtime/appendAudio": ThreadRealtimeAppendAudioResponse;
  "thread/realtime/appendText": ThreadRealtimeAppendTextResponse;
  "thread/realtime/stop": ThreadRealtimeStopResponse;
  "thread/realtime/listVoices": ThreadRealtimeListVoicesResponse;

  // 配置、技能、插件、市场和模型目录
  "config/read": ConfigReadResponse;
  "config/value/write": ConfigWriteResponse;
  "config/batchWrite": ConfigWriteResponse;
  "configRequirements/read": ConfigRequirementsReadResponse;
  "skills/list": SkillsListResponse;
  "hooks/list": HooksListResponse;
  "skills/config/write": SkillsConfigWriteResponse;
  "marketplace/add": MarketplaceAddResponse;
  "marketplace/remove": MarketplaceRemoveResponse;
  "marketplace/upgrade": MarketplaceUpgradeResponse;
  "plugin/list": PluginListResponse;
  "plugin/installed": PluginInstalledResponse;
  "plugin/read": PluginReadResponse;
  "plugin/skill/read": PluginSkillReadResponse;
  "plugin/share/save": PluginShareSaveResponse;
  "plugin/share/updateTargets": PluginShareUpdateTargetsResponse;
  "plugin/share/list": PluginShareListResponse;
  "plugin/share/delete": PluginShareDeleteResponse;
  "plugin/share/checkout": PluginShareCheckoutResponse;
  "plugin/install": PluginInstallResponse;
  "plugin/uninstall": PluginUninstallResponse;
  "app/list": AppsListResponse;
  "model/list": ModelListResponse;
  "modelProvider/capabilities/read": ModelProviderCapabilitiesReadResponse;
  "experimentalFeature/list": ExperimentalFeatureListResponse;
  "permissionProfile/list": PermissionProfileListResponse;
  "experimentalFeature/enablement/set": ExperimentalFeatureEnablementSetResponse;

  // 远控、环境和 MCP 资源/工具
  "remoteControl/enable": RemoteControlEnableResponse;
  "remoteControl/disable": RemoteControlDisableResponse;
  "remoteControl/status/read": RemoteControlStatusReadResponse;
  "collaborationMode/list": CollaborationModeListResponse;
  "environment/add": EnvironmentAddResponse;
  "mcpServerStatus/list": ListMcpServerStatusResponse;
  "config/mcpServer/reload": McpServerRefreshResponse;
  "mcpServer/oauth/login": McpServerOauthLoginResponse;
  "mcpServer/resource/read": McpResourceReadResponse;
  "mcpServer/tool/call": McpServerToolCallResponse;

  // 审查、外部配置和反馈
  "review/start": ReviewStartResponse;
  "externalAgentConfig/detect": ExternalAgentConfigDetectResponse;
  "externalAgentConfig/import": ExternalAgentConfigImportResponse;
  "feedback/upload": FeedbackUploadResponse;

  // 命令、进程和文件系统
  "command/exec": CommandExecResponse;
  "command/exec/write": CommandExecWriteResponse;
  "command/exec/terminate": CommandExecTerminateResponse;
  "command/exec/resize": CommandExecResizeResponse;
  "process/spawn": ProcessSpawnResponse;
  "process/writeStdin": ProcessWriteStdinResponse;
  "process/kill": ProcessKillResponse;
  "process/resizePty": ProcessResizePtyResponse;
  "fs/readFile": FsReadFileResponse;
  "fs/writeFile": FsWriteFileResponse;
  "fs/createDirectory": FsCreateDirectoryResponse;
  "fs/getMetadata": FsGetMetadataResponse;
  "fs/readDirectory": FsReadDirectoryResponse;
  "fs/remove": FsRemoveResponse;
  "fs/copy": FsCopyResponse;
  "fs/watch": FsWatchResponse;
  "fs/unwatch": FsUnwatchResponse;

  // 调试、Windows sandbox、账号和线程查询
  "mock/experimentalMethod": MockExperimentalMethodResponse;
  "windowsSandbox/setupStart": WindowsSandboxSetupStartResponse;
  "windowsSandbox/readiness": WindowsSandboxReadinessResponse;
  "account/login/start": LoginAccountResponse;
  "account/login/cancel": CancelLoginAccountResponse;
  "account/logout": LogoutAccountResponse;
  "account/rateLimits/read": GetAccountRateLimitsResponse;
  "account/sendAddCreditsNudgeEmail": SendAddCreditsNudgeEmailResponse;
  "account/read": GetAccountResponse;
  "thread/turns/list": ThreadTurnsListResponse;
  "thread/inject_items": ThreadInjectItemsResponse;
};

/**
 * ServerRequest -> result 的显式映射。
 *
 * 这是 app-server 反向请求客户端时，客户端 respond 需要返回的 result 类型。
 */
type SupportedCodexServerRequestResultMap = {
  // 用户审批与用户输入类反向请求
  "item/commandExecution/requestApproval": CommandExecutionRequestApprovalResponse;
  "item/fileChange/requestApproval": FileChangeRequestApprovalResponse;
  "item/tool/requestUserInput": ToolRequestUserInputResponse;
  "mcpServer/elicitation/request": McpServerElicitationRequestResponse;
  "item/permissions/requestApproval": PermissionsRequestApprovalResponse;

  // 工具调用、账号刷新和 attestation 类反向请求
  "item/tool/call": DynamicToolCallResponse;
  "account/chatgptAuthTokens/refresh": ChatgptAuthTokensRefreshResponse;
  "attestation/generate": AttestationGenerateResponse;
  "currentTime/read": CurrentTimeReadResponse;
  applyPatchApproval: ApplyPatchApprovalResponse;
  execCommandApproval: ExecCommandApprovalResponse;
};

/** 官方 method 集合。 */
export type CodexOfficialRpcMethod = ClientRequest["method"];
export type CodexRpcMethod = CodexOfficialRpcMethod;
export type CodexClientNotificationMethod = ClientNotification["method"];
export type CodexServerRequestMethod = ServerRequest["method"];
export type SupportedCodexServerRequestMethod = CodexServerRequestMethod;
export type CodexServerNotificationMethod = ServerNotification["method"];
export type OfficialCodexServerRequest = ServerRequest;
export type OfficialCodexServerNotification = ServerNotification;

/** app-server 输入流统一转成带 kind 的 envelope，方便运行时分流。 */
export type CodexServerRequestMessage = { kind: "request" } & ServerRequest;
export type CodexServerNotificationMessage = {
  kind: "notification";
} & ServerNotification;

/**
 * 协议漂移断言：官方新增/删除 method 时，这里会迫使 result map 同步更新。
 */
type ExtraCodexRpcResultMethods = Exclude<
  keyof SupportedCodexRpcResultMap,
  CodexRpcMethod
>;
type MissingCodexServerRequestResultMethods = Exclude<
  SupportedCodexServerRequestMethod,
  keyof SupportedCodexServerRequestResultMap
>;
type ExtraCodexServerRequestResultMethods = Exclude<
  keyof SupportedCodexServerRequestResultMap,
  SupportedCodexServerRequestMethod
>;
type _AssertNoExtraCodexRpcResultMethods =
  AssertNever<ExtraCodexRpcResultMethods>;
type _AssertNoMissingCodexServerRequestResultMethods =
  AssertNever<MissingCodexServerRequestResultMethods>;
type _AssertNoExtraCodexServerRequestResultMethods =
  AssertNever<ExtraCodexServerRequestResultMethods>;
export type _CodexProtocolTypeAssertions = [
  _AssertNoExtraCodexRpcResultMethods,
  _AssertNoMissingCodexServerRequestResultMethods,
  _AssertNoExtraCodexServerRequestResultMethods,
];

/** 调用侧公开类型：从官方请求 union 中推导 params，再结合显式 result map 输出强类型 RPC 参数。 */
export type CodexRpcParams<M extends CodexRpcMethod> = M extends CodexRpcMethod
  ? Extract<ClientRequest, { method: M }> extends { params: infer P }
    ? P
    : undefined
  : unknown;

export type CodexRpcResult<M extends CodexRpcMethod> =
  M extends keyof SupportedCodexRpcResultMap
    ? SupportedCodexRpcResultMap[M]
    : unknown;

/** ServerRequest 的 params/result/response args，用于约束客户端 respond 必须带 method。 */
export type CodexServerRequestParams<
  M extends SupportedCodexServerRequestMethod,
> = M extends SupportedCodexServerRequestMethod
  ? Extract<ServerRequest, { method: M }> extends { params: infer P }
    ? P
    : undefined
  : unknown;

export type CodexServerRequestResult<
  M extends SupportedCodexServerRequestMethod,
> = M extends keyof SupportedCodexServerRequestResultMap
  ? SupportedCodexServerRequestResultMap[M]
  : unknown;

export type CodexServerRespondArgs<
  M extends SupportedCodexServerRequestMethod =
    SupportedCodexServerRequestMethod,
> = {
  serverId: string;
  id: JsonRpcId;
  method: M;
} & (
  | { result: CodexServerRequestResult<M>; error?: undefined }
  | { result?: undefined; error: unknown }
);

/** 通知只需要 params 推导，不需要 result 映射。 */
export type CodexNotifyParams<M extends string> =
  M extends ClientNotification["method"]
    ? Extract<ClientNotification, { method: M }> extends { params: infer P }
      ? P
      : undefined
    : unknown;

export type CodexRpcArgs<M extends CodexRpcMethod = CodexRpcMethod> =
  CodexRpcParams<M> extends undefined
    ? { serverId: string; method: M; params?: undefined }
    : { serverId: string; method: M; params: CodexRpcParams<M> };

export type CodexRpcResponse<M extends CodexRpcMethod = CodexRpcMethod> = {
  result: CodexRpcResult<M>;
};

export type CodexNotifyArgs<M extends string = string> =
  CodexNotifyParams<M> extends undefined
    ? { serverId: string; method: M; params?: undefined }
    : { serverId: string; method: M; params: CodexNotifyParams<M> };

/** Codex 进程本地事件：不来自 app-server 协议，但会进入同一条消息分流链路。 */
export type CodexLocalEvent =
  | {
      kind: "local";
      method: "codex/exit";
      params: { code: number | null; signal: string | null; expected: boolean };
    }
  | { kind: "local"; method: "codex/stderr"; params: { text: string } }
  | { kind: "local"; method: "codex/parseError"; params: { line: string } }
  | {
      kind: "local";
      method: "codex/unmatchedResponse";
      params: CodexJsonRpcResponse;
    }
  | {
      kind: "local";
      method: "codex/protocolError";
      params: { reason: string; message: unknown };
    };

export type CodexJsonRpcResponse = {
  id: JsonRpcId;
  result?: unknown;
  error?: unknown;
};

export type CodexJsonRpcResponseMessage = {
  kind: "response";
} & CodexJsonRpcResponse;

/** Codex app-server manager 对外广播的统一消息入口。 */
export type CodexIncomingMessage =
  | CodexServerNotificationMessage
  | CodexServerRequestMessage
  | CodexJsonRpcResponseMessage
  | CodexLocalEvent;

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** 运行时守卫只检查分流所需的最小 envelope，不在这里完整校验 params。 */
export function isCodexServerNotificationMessage(
  value: unknown,
): value is CodexServerNotificationMessage {
  const record = toRecord(value);
  return record?.kind === "notification" && typeof record.method === "string";
}

export function isCodexServerRequestMessage(
  value: unknown,
): value is CodexServerRequestMessage {
  const record = toRecord(value);
  return record?.kind === "request" && typeof record.method === "string";
}

export function isCodexJsonRpcResponseMessage(
  value: unknown,
): value is CodexJsonRpcResponseMessage {
  const record = toRecord(value);
  return (
    record?.kind === "response" &&
    (typeof record.id === "string" || typeof record.id === "number")
  );
}

export function isCodexLocalEventMessage(
  value: unknown,
): value is CodexLocalEvent {
  const record = toRecord(value);
  return record?.kind === "local" && typeof record.method === "string";
}
