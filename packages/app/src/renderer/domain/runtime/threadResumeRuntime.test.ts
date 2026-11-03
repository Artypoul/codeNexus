import { beforeEach, describe, expect, it, vi } from "vitest";
import { createThreadResumeRuntime } from "./threadResumeRuntime";

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

const DEVELOPER_INSTRUCTIONS = "Use the CodeNexus image generation tool.";

function createRuntime() {
  return createThreadResumeRuntime({
    resumedThreadIds: new Set<string>(),
    resumePromisesByThread: new Map(),
    getWorkspaceForThread: () => "D:\\projects\\jingcai-web",
    ensureServerForWorkspace: async () => "server-1",
    getDeveloperInstructions: () => DEVELOPER_INSTRUCTIONS,
    pushEvent: vi.fn(),
  });
}

describe("thread resume instructions", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ result: {} });
  });

  it("恢复线程时补回 thread 级自定义工具说明", async () => {
    const runtime = createRuntime();

    await expect(runtime.ensureThreadResumed("thread-1")).resolves.toBe(true);
    expect(rpcMock).toHaveBeenCalledWith({
      serverId: "server-1",
      method: "thread/resume",
      params: {
        threadId: "thread-1",
        developerInstructions: DEVELOPER_INSTRUCTIONS,
      },
    });

    await expect(runtime.ensureThreadResumed("thread-1")).resolves.toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});
