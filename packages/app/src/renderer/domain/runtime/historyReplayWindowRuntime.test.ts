import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHistoryReplayWindowRuntime, type HistoryReplayWindowRuntimeDeps } from "./historyReplayWindowRuntime";

const { getEvents, parse } = vi.hoisted(() => ({ getEvents: vi.fn(), parse: vi.fn() }));
vi.mock("../../api/codexDesktopClient", () => ({ codexDesktop: { history: { getThreadEvents: getEvents } } }));
vi.mock("../../features/history/replayParsers", () => ({ parseSessionReplayEvents: parse }));
beforeEach(() => {
  getEvents.mockReset();
  parse
    .mockReset()
    .mockReturnValue([
      { id: "event", method: "item/agentMessage/delta", paramsText: "reply", turnId: "turn", createdAt: 1 },
    ]);
});
function setup() {
  const timelineStore = {
    eventsForThread: vi.fn(() => []),
    replaceThreadEvents: vi.fn(),
    clearThread: vi.fn(),
    appendEvent: vi.fn(),
    flushPendingAppends: vi.fn(),
  };
  const deps: HistoryReplayWindowRuntimeDeps = {
    runtimeStore: { navigationRevision: 0, timelineKey: "A" } as HistoryReplayWindowRuntimeDeps["runtimeStore"],
    threadStore: { replaceRollbackState: vi.fn() } as unknown as HistoryReplayWindowRuntimeDeps["threadStore"],
    timelineStore: timelineStore as unknown as HistoryReplayWindowRuntimeDeps["timelineStore"],
    replayCacheByThread: new Map(),
    replayWindowStateByThread: new Map(),
    replayRequestSeqByThread: new Map(),
    olderHistoryLoadPromiseByThread: new Map(),
    historyReplayBatch: 100,
    historyReplayTurnSegments: 10,
    timelineMaxVisibleTurns: 60,
    translate: (key) => key,
  };
  return { runtime: createHistoryReplayWindowRuntime(deps), timelineStore, deps };
}

describe("history replay during navigation", () => {
  it("does not parse, request more pages or write timeline state after navigation is superseded", async () => {
    let current = true;
    let resolve!: (value: unknown) => void;
    getEvents.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    const { runtime, timelineStore, deps } = setup();
    const task = runtime.loadHistoryMessages("A", { isCurrent: () => current });
    current = false;
    resolve({ entries: [{ raw: "large payload" }], loaded: 100, hasMore: true });
    expect(await task).toBe(false);
    expect(parse).not.toHaveBeenCalled();
    expect(getEvents).toHaveBeenCalledTimes(1);
    expect(timelineStore.replaceThreadEvents).not.toHaveBeenCalled();
    expect(deps.replayCacheByThread.size).toBe(0);
  });

  it("retains a valid new A replay when an older A request finishes later", async () => {
    let resolve!: (value: unknown) => void;
    getEvents.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    getEvents.mockResolvedValue({ entries: [{}], loaded: 1, hasMore: false });
    const { runtime, timelineStore, deps } = setup();
    const old = runtime.loadHistoryMessages("A");
    expect(await runtime.loadHistoryMessages("A")).toBe(true);
    resolve({ entries: [{}], loaded: 100, hasMore: true });
    expect(await old).toBe(false);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(timelineStore.replaceThreadEvents).toHaveBeenCalledTimes(1);
    expect(deps.replayCacheByThread.has("A")).toBe(true);
    expect(runtime.hydrateReplayFromCacheIfNeeded("A")).toBe(true);
  });

  it("stops loading older pages after leaving the thread", async () => {
    let resolve!: (value: unknown) => void;
    getEvents.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    const { runtime, timelineStore, deps } = setup();
    deps.replayWindowStateByThread.set("A", { nextBefore: 100, hasMorePages: true, bufferedOlderEvents: [] });
    const task = runtime.loadOlderHistoryTurns("A");
    deps.runtimeStore.navigationRevision += 1;
    Object.assign(deps.runtimeStore, { timelineKey: "B" });
    resolve({ entries: [{}], loaded: 200, hasMore: true });
    expect(await task).toBe(false);
    expect(parse).not.toHaveBeenCalled();
    expect(timelineStore.replaceThreadEvents).not.toHaveBeenCalled();
    expect(deps.olderHistoryLoadPromiseByThread.size).toBe(0);
  });
});
