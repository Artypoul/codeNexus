import { beforeEach, describe, expect, it, vi } from "vitest";
import { createThreadCreationRuntime, type ThreadCreationRuntimeDeps } from "./threadCreationRuntime";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("../../api/codexDesktopClient", () => ({
  codexDesktop: { codexServer: { rpc: rpcMock } },
}));

vi.mock("../../shared/debugLog", () => ({
  appendDebugLog: vi.fn(),
}));

const THREAD_ID = "01a1a1c9-5b37-7081-9af7-3f5c8ca3473f";

function createHarness(overrides?: Partial<ThreadCreationRuntimeDeps>) {
  const runtimeStore = {
    workspacePath: "C:\\repo",
    currentThreadId: "",
    model: "auto/model",
    reasoningEffort: "high",
    reasoningSummary: "auto",
    sandboxMode: "workspace-write",
    composeMode: "default",
    composeInput: "",
    composeAttachments: [],
    composeFileMentions: [],
    setCurrentThread: vi.fn(),
    seedThreadComposeStateFromSeed: vi.fn(),
    clearPendingThreadInitSendCount: vi.fn(),
    saveThreadComposeAttachments: vi.fn(),
    saveThreadComposeFileMentions: vi.fn(),
    moveThreadComposeState: vi.fn(),
  };
  const threadStore = {
    threadHistory: [],
    localThreads: [],
    runningThreadIds: new Set<string>(),
    upsertLocalThread: vi.fn(),
    setCurrentThread: vi.fn(),
    replaceThreadId: vi.fn(),
    replaceLocalThreadId: vi.fn(),
    patchThreadMetadata: vi.fn(),
  };
  const ensureProjectForWorkspace = vi.fn(async () => "project-1");
  const runtime = createThreadCreationRuntime({
    appTimelineId: "app",
    runtimeStore: runtimeStore as never,
    configStore: { draft: null } as never,
    threadStore: threadStore as never,
    timelineStore: { moveThread: vi.fn() } as never,
    messageQueueStore: {
      queueByThread: new Map(),
      moveThreadQueue: vi.fn(),
    } as never,
    normalizeWorkspacePath: (value) => String(value ?? "").trim(),
    getServerIdForWorkspace: () => "server-1",
    resolveModel: (value) => String(value || "auto/model"),
    resolveEffort: (_model, effort) => String(effort || ""),
    ensureModelCatalog: async () => undefined,
    ensureProjectForWorkspace,
    startServer: async () => true,
    clearThreadRuntimeState: vi.fn(),
    setThreadWorkspace: vi.fn(),
    clearThreadWorkspace: vi.fn(),
    buildThreadStartParamsForModel: ({ model, workspace }) => ({
      params: { model, cwd: workspace, sandbox: "workspace-write" },
      configOverrides: null,
    }),
    rememberThreadStartConfigOverrides: vi.fn(),
    markThreadResumed: vi.fn(),
    flushQueueForThread: async () => undefined,
    cloneUserTurnInputs: (values) => values,
    buildComposeAttachmentsFromUserTurnInputs: async () => ({
      attachments: [],
      failedLocalPaths: [],
    }),
    pushEvent: vi.fn(),
    translate: (key) => key,
    showToast: vi.fn(),
    ...overrides,
  });
  return { runtime, runtimeStore, threadStore, ensureProjectForWorkspace };
}

describe("thread creation project assignment", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ result: { thread: { id: THREAD_ID } } });
  });

  it("assigns the workspace project to a new thread", async () => {
    const harness = createHarness();

    await harness.runtime.createThread();

    expect(harness.ensureProjectForWorkspace).toHaveBeenCalledWith("C:\\repo");
    expect(rpcMock).toHaveBeenCalledWith({
      serverId: "server-1",
      method: "thread/start",
      params: expect.objectContaining({ projectId: "project-1" }),
    });
    expect(harness.threadStore.replaceLocalThreadId).toHaveBeenCalledWith(
      expect.any(String),
      THREAD_ID,
      expect.objectContaining({ projectId: "project-1" })
    );
    expect(harness.threadStore.patchThreadMetadata).toHaveBeenCalledWith(THREAD_ID, {
      projectId: "project-1",
    });
  });

  it("still creates the thread when project assignment fails", async () => {
    const harness = createHarness({
      ensureProjectForWorkspace: vi.fn(async () => {
        throw new Error("project service unavailable");
      }),
    });

    await expect(harness.runtime.createThread()).resolves.toBeUndefined();

    const startParams = rpcMock.mock.calls[0]?.[0]?.params;
    expect(startParams).not.toHaveProperty("projectId");
    expect(harness.threadStore.patchThreadMetadata).not.toHaveBeenCalled();
  });
});
