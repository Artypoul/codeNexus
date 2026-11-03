import { resolveCodexInstructionProfileForMainView } from "../../features/registry";
import { sandboxKebabFromUi } from "../../shared/sandboxPolicy";
import type { ThreadStartParams } from "@codenexus/generated/codex-app-server/v2/ThreadStartParams";
import type { MainView } from "@codenexus/shared/localSettings";
import {
  buildThreadStartConfigOverridesForModel,
  type ThreadStartConfigOverrides,
} from "@codenexus/shared/modelToolFeatureOverrides";
import { dynamicToolRegistry } from "@codenexus/shared/dynamicTools";
import {
  buildDeveloperInstructionsForProfile,
  buildDynamicToolNamesForInstructionProfile,
  type CodexInstructionProfile,
} from "@codenexus/shared/codexInstructionProfiles";
import {
  normalizeApprovalPolicy,
  normalizeApprovalsReviewer,
  normalizeModelName,
  normalizeSandboxMode,
} from "../serverInterop";

export type ThreadStartParamsRuntimeDeps = {
  getMainView: () => MainView;
  getApprovalPolicy: () => unknown;
  getApprovalsReviewer: () => unknown;
  normalizeWorkspacePath: (value: string) => string;
};

export type ThreadStartParamsRuntime = {
  resolveCurrentInstructionProfile: () => CodexInstructionProfile;
  resolveCurrentDeveloperInstructions: () => string | null;
  buildThreadStartParamsForModel: (args: { model: string; workspace: string; sandboxMode: string }) => {
    params: ThreadStartParams;
    configOverrides: ThreadStartConfigOverrides | null;
  };
};

export function createThreadStartParamsRuntime(deps: ThreadStartParamsRuntimeDeps): ThreadStartParamsRuntime {
  const resolveCurrentInstructionProfile = (): CodexInstructionProfile => {
    return resolveCodexInstructionProfileForMainView(deps.getMainView());
  };

  const resolveCurrentDeveloperInstructions = (): string | null => {
    return buildDeveloperInstructionsForProfile(resolveCurrentInstructionProfile());
  };

  const buildThreadStartParamsForModel: ThreadStartParamsRuntime["buildThreadStartParamsForModel"] = (args) => {
    const model = normalizeModelName(args.model);
    const workspace = deps.normalizeWorkspacePath(args.workspace);
    const configOverrides = buildThreadStartConfigOverridesForModel(model);
    const approvalPolicy = normalizeApprovalPolicy(deps.getApprovalPolicy());
    const approvalsReviewer = normalizeApprovalsReviewer(deps.getApprovalsReviewer());
    const instructionProfile = resolveCurrentInstructionProfile();
    const dynamicTools = dynamicToolRegistry.buildSpecsForNames(
      buildDynamicToolNamesForInstructionProfile(instructionProfile)
    ) as ThreadStartParams["dynamicTools"];
    const developerInstructions = resolveCurrentDeveloperInstructions();

    return {
      configOverrides,
      params: {
        model,
        cwd: workspace,
        approvalPolicy: approvalPolicy as ThreadStartParams["approvalPolicy"],
        approvalsReviewer: approvalsReviewer as ThreadStartParams["approvalsReviewer"],
        sandbox: sandboxKebabFromUi(normalizeSandboxMode(args.sandboxMode)),
        ...(configOverrides ? { config: configOverrides } : {}),
        ...(dynamicTools && dynamicTools.length > 0 ? { dynamicTools } : {}),
        ...(developerInstructions ? { developerInstructions } : {}),
        experimentalRawEvents: false,
      },
    };
  };

  return { resolveCurrentInstructionProfile, resolveCurrentDeveloperInstructions, buildThreadStartParamsForModel };
}
