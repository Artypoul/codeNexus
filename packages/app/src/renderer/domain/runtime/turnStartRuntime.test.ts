import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTurnStartRuntime } from "./turnStartRuntime";

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock("../../api/codexDesktopClient", () => ({
  codexDesktop: {
    codexServer: {
      rpc: rpcMock,
    },
  },
}));

function createRuntime() {
  return createTurnStartRuntime({
    getComposeMode: () => "default",
    getModel: () => "auto/deepseek-v4.1-flash",
    getReasoningEffort: () => "high",
    getReasoningSummary: () => "auto",
    getSandboxMode: () => "danger-full-access",
    resolveModel: (value) => value,
    resolveEffort: (_model, effort) => effort,
    getApprovalPolicy: () => "never",
    getApprovalsReviewer: () => "user",
    toCodexUserInputs: (values) => values as never,
  });
}

describe("turn start collaboration mode", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ result: {} });
  });

  it("默认模式使用 App Server 内置指令", async () => {
    const runtime = createRuntime();

    await expect(
      runtime.startTurnWithInput({
        threadId: "thread-1",
        threadWorkspace: "D:\\projects\\jingcai-web",
        threadServerId: "server-1",
        input: [{ type: "text", text: "执行计划中" }],
        composeModeOverride: "default",
      })
    ).resolves.toEqual({ ok: true });

    const params = rpcMock.mock.calls[0][0].params;
    expect(params.collaborationMode.mode).toBe("default");
    expect(params.collaborationMode.settings.developer_instructions).toBeNull();
  });

  it("计划模式继续使用 App Server 内置指令", async () => {
    const runtime = createRuntime();

    await runtime.startTurnWithInput({
      threadId: "thread-1",
      threadWorkspace: "D:\\projects\\jingcai-web",
      threadServerId: "server-1",
      input: [{ type: "text", text: "制定计划" }],
      composeModeOverride: "plan",
    });

    const params = rpcMock.mock.calls[0][0].params;
    expect(params.collaborationMode.mode).toBe("plan");
    expect(params.collaborationMode.settings.developer_instructions).toBeNull();
  });
});
