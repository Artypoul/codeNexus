import { describe, expect, it, vi } from "vitest";
import type { UserTurnInput } from "../types";
import { createMessageQueueRuntime, type MessageQueueRuntimeDeps } from "./messageQueueRuntime";

function createHarness(opts: { model: string; compatibilityModel: string }) {
  const queued = {
    id: "queue-1",
    threadId: "thread-1",
    text: "hello",
    displayText: "hello",
    inputs: [{ type: "text", text: "hello" } as UserTurnInput],
    status: "queued",
    localEventId: "local-user-1",
  };
  const runtimeStore = {
    model: opts.model,
    currentThreadId: "thread-1",
    workspacePath: "D:\\workspace",
    requestScrollTimelineToBottom: vi.fn(),
    saveThreadComposeState: vi.fn(),
  };
  const messageQueueStore = {
    peekNextQueued: vi.fn(() => queued),
    setLocalEventId: vi.fn(),
    markStatus: vi.fn(),
    remove: vi.fn(),
  };
  const startTurnWithInput = vi.fn(async () => ({ ok: true as const }));
  const ensureThreadModelToolCompatibility = vi.fn(async () => ({
    ok: true as const,
    threadId: "thread-1",
    model: opts.compatibilityModel,
  }));
  const deps: MessageQueueRuntimeDeps = {
    runtimeStore: runtimeStore as never,
    threadStore: {
      runningThreadIds: new Set<string>(),
      activeTurnIdByThread: new Map<string, string>(),
      hasLocalThread: () => true,
    } as never,
    timelineStore: {
      appendEvent: vi.fn(),
      patchEvent: vi.fn(),
      removeEvent: vi.fn(),
    } as never,
    messageQueueStore: messageQueueStore as never,
    normalizeWorkspacePath: (value) => String(value ?? "").trim(),
    getWorkspaceForThread: () => "D:\\workspace",
    resolveModel: (value) => value || "default-model",
    ensureServerForWorkspace: async () => "server-1",
    ensureThreadResumed: async () => true,
    ensureThreadModelToolCompatibility,
    requestTurnSteer: async () => false,
    startTurnWithInput,
    clearThreadPreparingEvent: vi.fn(),
    upsertThreadPreparingEvent: vi.fn(),
    cloneUserTurnInputs: (items) => items,
    buildComposeAttachmentsFromUserTurnInputs: async () => ({ attachments: [], failedLocalPaths: [] }),
    buildTimelineUserMessagePayload: () => ({ displayText: "hello", payload: {} }),
    fileNameFromPathLike: (value) => value,
    pushEvent: vi.fn(),
    translate: (key) => key,
    showToast: vi.fn(),
  };
  return {
    runtime: createMessageQueueRuntime(deps),
    runtimeStore,
    startTurnWithInput,
    ensureThreadModelToolCompatibility,
  };
}

describe("flushQueueForThread model selection", () => {
  it("保留用户显式选择的模型，不采用线程旧模型", async () => {
    const harness = createHarness({ model: "model-explicit", compatibilityModel: "model-from-thread" });

    await harness.runtime.flushQueueForThread("thread-1");

    expect(harness.ensureThreadModelToolCompatibility).toHaveBeenCalledWith(
      expect.objectContaining({ model: "model-explicit" })
    );
    expect(harness.startTurnWithInput).toHaveBeenCalledWith(expect.objectContaining({ model: "model-explicit" }));
    expect(harness.runtimeStore.model).toBe("model-explicit");
    expect(harness.runtimeStore.saveThreadComposeState).not.toHaveBeenCalled();
  });

  it("没有显式模型时采用线程实际模型并回写当前线程状态", async () => {
    const harness = createHarness({ model: "", compatibilityModel: "model-from-thread" });

    await harness.runtime.flushQueueForThread("thread-1");

    expect(harness.startTurnWithInput).toHaveBeenCalledWith(expect.objectContaining({ model: "model-from-thread" }));
    expect(harness.runtimeStore.model).toBe("model-from-thread");
    expect(harness.runtimeStore.saveThreadComposeState).toHaveBeenCalledWith("thread-1", { save: true });
  });
});
