import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceSessionRuntime, type WorkspaceSessionRuntimeDeps } from "./workspaceSessionRuntime";
import { createThreadSwitchRuntime, type ThreadSwitchRuntimeDeps } from "./threadSwitchRuntime";

const { start } = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("../../api/codexDesktopClient", () => ({ codexDesktop: { codexServer: { start } } }));
vi.mock("../../shared/debugLog", () => ({ appendDebugLog: vi.fn() }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function settle() {
  for (let step = 0; step < 12; step += 1) await Promise.resolve();
}
beforeEach(() => {
  start.mockReset().mockImplementation(async ({ cwd }: { cwd: string }) => ({
    serverId: `server-${cwd}`,
    capabilities: { experimentalApi: true },
  }));
});

function setup() {
  const runtime = {
    workspacePath: "A",
    serverId: "",
    currentThreadId: "",
    navigationRevision: 0,
    setWorkspace: vi.fn((path: string) => {
      runtime.workspacePath = path;
    }),
    setCurrentThread: vi.fn((id: string) => {
      runtime.currentThreadId = id;
    }),
    setServer: vi.fn((id: string) => {
      runtime.serverId = id;
    }),
    clearServer: vi.fn(() => {
      runtime.serverId = "";
    }),
  };
  const thread = {
    runningThreadIds: new Set<string>(),
    loadingThreadId: "",
    setWorkspace: vi.fn(),
    setCurrentThread: vi.fn(),
    setLoadingThread: vi.fn((id: string) => {
      thread.loadingThreadId = id;
    }),
    clearLoadingThread: vi.fn((id?: string) => {
      if (!id || id === thread.loadingThreadId) thread.loadingThreadId = "";
    }),
  };
  const files = {
    confirmResetDirtyTabsForWorkspaceChange: vi.fn(async () => true),
    ensureReady: vi.fn(async () => {}),
    reloadTreeForThreadSwitch: vi.fn(async () => true),
  };
  const shared = {
    appTimelineId: "app",
    runtimeStore: runtime,
    threadStore: thread,
    workspaceFilesStore: files,
    normalizeWorkspacePath: (value: string) => value,
    findThreadListItem: (id: string) => ({ id, cwd: id[0] }),
    applyCachedRightPanels: vi.fn(),
    refreshRightPanels: vi.fn(async () => {}),
    pushEvent: vi.fn(),
  };
  const workspace = createWorkspaceSessionRuntime({
    ...shared,
    appShellStore: { setServerConnState: vi.fn() },
    resetSidePanelStores: vi.fn(),
    refreshHistory: vi.fn(async () => {}),
    hydrateThreadMetadataForWorkspace: vi.fn(async () => {}),
    translate: (key: string) => key,
    showToast: vi.fn(),
  } as unknown as WorkspaceSessionRuntimeDeps);
  const history = vi.fn<ThreadSwitchRuntimeDeps["loadHistoryMessages"]>(async () => true);
  const resumed = vi.fn(async () => true);
  const threads = createThreadSwitchRuntime({
    ...shared,
    timelineStore: { eventsForThread: () => [] },
    getWorkspaceForThread: (id: string) => id[0],
    setThreadWorkspace: workspace.setThreadWorkspace,
    syncActiveServerByWorkspace: workspace.syncActiveServerByWorkspace,
    ensureServerForWorkspace: workspace.ensureServerForWorkspace,
    hasReplayCache: () => false,
    hydrateReplayFromCacheIfNeeded: () => false,
    loadHistoryMessages: history,
    ensureThreadResumed: resumed,
    refreshThreadGoal: vi.fn(async () => {}),
    hydrateThreadHandoffDiagnostics: vi.fn(async () => {}),
  } as unknown as ThreadSwitchRuntimeDeps);
  return { runtime, thread, files, workspace, threads, history, resumed };
}

describe("rapid workspace navigation", () => {
  it("shares server startup across A → B → A and keeps the final workspace active", async () => {
    const a = deferred<{ serverId: string; capabilities: { experimentalApi: boolean } }>();
    start.mockImplementation(({ cwd }: { cwd: string }) =>
      cwd === "A" ? a.promise : Promise.resolve({ serverId: "server-B", capabilities: { experimentalApi: true } })
    );
    const { workspace, runtime } = setup();
    const firstA = workspace.switchWorkspace("A");
    await settle();
    const b = workspace.switchWorkspace("B");
    await settle();
    const secondA = workspace.switchWorkspace("A");
    await settle();
    expect(start).toHaveBeenCalledTimes(2);
    a.resolve({ serverId: "server-A", capabilities: { experimentalApi: true } });
    await Promise.all([firstA, b, secondA]);
    expect(runtime.workspacePath).toBe("A");
    expect(runtime.serverId).toBe("server-A");
  });

  it("does not let an earlier confirmation replace the latest selection", async () => {
    const confirmation = deferred<boolean>();
    const { workspace, runtime, files } = setup();
    files.confirmResetDirtyTabsForWorkspaceChange.mockReturnValueOnce(confirmation.promise);
    const b = workspace.switchWorkspace("B");
    await workspace.switchWorkspace("C");
    confirmation.resolve(true);
    expect(await b).toBe(false);
    expect(runtime.workspacePath).toBe("C");
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("clears loading owned by a thread switch when the following workspace change is cancelled", async () => {
    const replay = deferred<boolean>();
    const { workspace, threads, history, thread, files } = setup();
    files.confirmResetDirtyTabsForWorkspaceChange.mockResolvedValueOnce(false);
    history.mockReturnValueOnce(replay.promise);
    const switching = threads.switchThread("A1");
    await settle();
    expect(thread.loadingThreadId).toBe("A1");
    expect(await workspace.switchWorkspace("B")).toBe(false);
    replay.resolve(true);
    await switching;
    expect(thread.loadingThreadId).toBe("");
  });

  it("stops a superseded thread switch while preserving history for the still displayed thread", async () => {
    const replay = deferred<boolean>();
    const { workspace, threads, history, resumed, thread } = setup();
    history.mockReturnValueOnce(replay.promise);
    const a = threads.switchThread("A1");
    await settle();
    expect(history.mock.calls[0][1]!.isCurrent!()).toBe(true);
    await workspace.switchWorkspace("B");
    expect(history.mock.calls[0][1]!.isCurrent!()).toBe(true);
    replay.resolve(true);
    await a;
    expect(resumed).not.toHaveBeenCalled();
    expect(thread.loadingThreadId).toBe("");
  });

  it("does not clear the new A loading indicator when the old A switch completes", async () => {
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    const { threads, history, thread } = setup();
    let aRequests = 0;
    history.mockImplementation((id) =>
      id === "A1" ? (++aRequests === 1 ? first.promise : second.promise) : Promise.resolve(true)
    );
    const oldA = threads.switchThread("A1");
    await settle();
    await threads.switchThread("B1");
    expect(history.mock.calls[0][1]!.isCurrent!()).toBe(false);
    const newA = threads.switchThread("A1");
    await settle();
    first.resolve(true);
    await oldA;
    expect(thread.loadingThreadId).toBe("A1");
    second.resolve(true);
    await newA;
    expect(thread.loadingThreadId).toBe("");
  });
});
