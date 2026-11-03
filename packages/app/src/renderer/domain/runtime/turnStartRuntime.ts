import { codexDesktop } from "../../api/codexDesktopClient";
import { sandboxPolicyFromUi } from "../../shared/sandboxPolicy";
import type { TurnStartParams } from "@codenexus/generated/codex-app-server/v2/TurnStartParams";
import type { UserInput as CodexUserInput } from "@codenexus/generated/codex-app-server/v2/UserInput";
import type { AskForApproval } from "@codenexus/generated/codex-app-server/v2/AskForApproval";
import type { UserTurnInput } from "../types";
import {
  normalizeApprovalPolicy,
  normalizeApprovalsReviewer,
  normalizeReasoningSummary,
  normalizeSandboxMode,
} from "../serverInterop";

type ComposeMode = "default" | "plan";

export type TurnStartRuntimeDeps = {
  getComposeMode: () => ComposeMode;
  getModel: () => string;
  getReasoningEffort: () => string;
  getReasoningSummary: () => string;
  getSandboxMode: () => string;
  resolveModel: (value: string) => string;
  resolveEffort: (modelValue: string, effort: string) => string;
  getApprovalPolicy: () => AskForApproval;
  getApprovalsReviewer: () => unknown;
  toCodexUserInputs: (values: UserTurnInput[]) => CodexUserInput[];
};

export type TurnStartRuntime = {
  startTurnWithInput: (params: {
    threadId: string;
    threadWorkspace: string;
    threadServerId: string;
    input: UserTurnInput[];
    model?: string;
    effort?: string;
    summary?: string;
    approvalPolicy?: TurnStartParams["approvalPolicy"];
    approvalsReviewer?: TurnStartParams["approvalsReviewer"];
    sandboxMode?: string;
    composeModeOverride?: ComposeMode;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
};

export function createTurnStartRuntime(deps: TurnStartRuntimeDeps): TurnStartRuntime {
  const startTurnWithInput: TurnStartRuntime["startTurnWithInput"] = async (params) => {
    const composeMode = params.composeModeOverride ?? deps.getComposeMode();
    const requestedModel = deps.resolveModel(String(params.model ?? deps.getModel()).trim());
    if (!requestedModel) {
      return { ok: false as const, error: "no model available" };
    }
    const requestedEffort = deps.resolveEffort(
      requestedModel,
      String(params.effort ?? deps.getReasoningEffort()).trim()
    );
    const requestedSummary = normalizeReasoningSummary(params.summary ?? deps.getReasoningSummary());
    const hasApprovalPolicyOverride = params.approvalPolicy != null;
    const requestedApprovalPolicy = normalizeApprovalPolicy(
      hasApprovalPolicyOverride ? params.approvalPolicy : deps.getApprovalPolicy()
    );
    const hasApprovalsReviewerOverride = params.approvalsReviewer != null;
    const requestedApprovalsReviewer = hasApprovalsReviewerOverride
      ? normalizeApprovalsReviewer(params.approvalsReviewer)
      : normalizeApprovalsReviewer(deps.getApprovalsReviewer());
    const requestedSandboxMode = normalizeSandboxMode(params.sandboxMode ?? deps.getSandboxMode());

    // collaborationMode 会影响“本回合及后续回合”的行为，因此即使切回 Agent 也要显式发送 default。
    // 自定义工具说明由 thread 级 developerInstructions 注入；这里保持 null 以使用 App Server 内置模式指令。
    const collaborationMode = {
      mode: composeMode,
      settings: {
        model: requestedModel,
        reasoning_effort: requestedEffort || null,
        developer_instructions: null,
      },
    };

    const buildTurnStartParams = (): TurnStartParams => {
      const sandboxPolicy = sandboxPolicyFromUi(requestedSandboxMode, params.threadWorkspace, "camel");
      const input = deps.toCodexUserInputs(params.input);
      return {
        threadId: params.threadId,
        input,
        cwd: params.threadWorkspace,
        approvalPolicy: requestedApprovalPolicy as TurnStartParams["approvalPolicy"],
        approvalsReviewer: requestedApprovalsReviewer as TurnStartParams["approvalsReviewer"],
        sandboxPolicy: sandboxPolicy as TurnStartParams["sandboxPolicy"],
        model: requestedModel,
        ...(requestedEffort ? { effort: requestedEffort } : {}),
        ...(requestedSummary !== "auto" ? { summary: requestedSummary } : {}),
      };
    };

    try {
      const baseParams = buildTurnStartParams();
      await codexDesktop.codexServer.rpc({
        serverId: params.threadServerId,
        method: "turn/start",
        params: { ...baseParams, collaborationMode },
      });
      return { ok: true as const };
    } catch (error: any) {
      const msg = error?.message ? String(error.message) : String(error);
      return { ok: false as const, error: msg || "turn/start failed" };
    }
  };

  return { startTurnWithInput };
}
