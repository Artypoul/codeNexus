import { beforeEach, describe, expect, it, vi } from "vitest";
import { createThreadModelCompatibilityRuntime } from "./threadModelCompatibilityRuntime";

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

vi.mock("../../shared/debugLog", () => ({
  appendDebugLog: vi.fn(),
}));

const THREAD_ID = "01a1a1c9-5b37-7081-9af7-3f5c8ca3473f";
const THREAD_MODEL = "workbuddy/deepseek-v4.1-flash";
const DEFAULT_MODEL = "auto/deepseek-v4.1-flash";
const DEVELOPER_INSTRUCTIONS = "Use the CodeNexus image generation tool.";

function createRuntime() {
  return createThreadModelCompatibilityRuntime({
    runtimeStore: { sandboxMode: "danger-full-access" } as never,
    threadStore: {
      hasLocalThread: () => false,
      runningThreadIds: new Set<string>(),
      localThreads: [],
    } as never,
    timelineStore: { eventsForThread: () => [] } as never,
    messageQueueStore: {} as never,
    resumedThreadIds: new Set<string>(),
    resumePromisesByThread: new Map(),
    threadScopedCaches: [],
    normalizeWorkspacePath: (value) => String(value ?? "").trim(),
    buildThreadStartParamsForModel: () => {
      throw new Error("thread/start is not expected in this test");
    },
    getDeveloperInstructions: () => DEVELOPER_INSTRUCTIONS,
    findThreadListItem: () => undefined,
    setThreadWorkspace: () => undefined,
    clearThreadWorkspace: () => undefined,
    pushEvent: vi.fn(),
    translate: (key) => key,
  });
}

describe("thread model tool compatibility", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("旧线程恢复时保留服务端实际模型，并复用于后续发送", async () => {
    rpcMock.mockResolvedValueOnce({
      result: {
        model: THREAD_MODEL,
        thread: { model: THREAD_MODEL },
      },
    });
    const runtime = createRuntime();

    await expect(
      runtime.ensureThreadModelToolCompatibility({
        threadId: THREAD_ID,
        threadWorkspace: "D:\\projects\\jingcai-web",
        threadServerId: "server-1",
        model: DEFAULT_MODEL,
      })
    ).resolves.toEqual({
      ok: true,
      threadId: THREAD_ID,
      model: THREAD_MODEL,
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0][0]).toEqual({
      serverId: "server-1",
      method: "thread/resume",
      params: {
        threadId: THREAD_ID,
        cwd: "D:\\projects\\jingcai-web",
        config: { "features.image_generation": false },
        developerInstructions: DEVELOPER_INSTRUCTIONS,
      },
    });

    await expect(
      runtime.ensureThreadModelToolCompatibility({
        threadId: THREAD_ID,
        threadWorkspace: "D:\\projects\\jingcai-web",
        threadServerId: "server-1",
        model: DEFAULT_MODEL,
      })
    ).resolves.toEqual({
      ok: true,
      threadId: THREAD_ID,
      model: THREAD_MODEL,
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});
