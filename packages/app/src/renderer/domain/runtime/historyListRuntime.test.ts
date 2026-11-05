import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildThreadHistoryGroups } from "../../features/history/projectThreadGroups";
import { useProjectStore } from "../../stores/project.store";
import { useThreadStore } from "../../stores/thread.store";
import { createHistoryListRuntime } from "./historyListRuntime";
import { createProjectRuntime } from "./projectRuntime";
import { toThreadContentCacheKey, type ThreadContentCacheEntry } from "./rendererCacheRuntime";
import type { HistoryThread } from "@codenexus/shared/ipc";

const { list, refresh, onUpdated, rpc, mergeThreadMetadata } = vi.hoisted(() => ({
  list: vi.fn(),
  refresh: vi.fn(),
  onUpdated: vi.fn(),
  rpc: vi.fn(),
  mergeThreadMetadata: vi.fn(),
}));
vi.mock("../../api/codexDesktopClient", () => ({
  codexDesktop: {
    localState: { initialSettingsSnapshot: undefined },
    codexServer: { rpc },
    history: {
      list,
      refresh,
      onUpdated,
      mergeThreadMetadata,
    },
  },
}));

function historyThread(overrides: Partial<HistoryThread> & Pick<HistoryThread, "id">): HistoryThread {
  return {
    title: overrides.id,
    cwd: "C:\\repo",
    updatedAt: 1,
    sessionPath: `C:\\sessions\\${overrides.id}.jsonl`,
    source: "cache",
    projectId: null,
    ...overrides,
  };
}

function cacheEntry(threadId: string): ThreadContentCacheEntry {
  return {
    threadId,
    expiresAt: Date.now() + 60_000,
    result: {
      found: true,
      threadId,
      thread: null,
      messages: [],
      eventsPage: { entries: [], total: 0, loaded: 0, hasMore: false },
    },
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  list.mockReset();
  refresh.mockReset();
  onUpdated.mockReset().mockReturnValue(vi.fn());
  rpc.mockReset();
  mergeThreadMetadata.mockReset().mockResolvedValue({});
});

function setup() {
  const threadStore = useThreadStore();
  const cache = new Map<string, ThreadContentCacheEntry>();
  const refreshWorkspaceMetadata = vi.fn(async () => {});
  const runtime = createHistoryListRuntime({
    threadStore,
    threadContentCacheByKey: cache,
    getWorkspacePath: () => "C:\\repo",
    setThreadWorkspace: vi.fn(),
    refreshWorkspaceMetadata,
  });
  return { runtime, threadStore, cache, refreshWorkspaceMetadata };
}

describe("history list runtime", () => {
  it("preserves project and section metadata when a local thread enters disk history", () => {
    const { runtime, threadStore } = setup();
    threadStore.upsertLocalThread({
      id: "t1",
      title: "New thread",
      meta: "repo",
      cwd: "C:\\repo",
      createdAt: Date.now(),
      updatedAt: 1,
      status: "ready",
      projectId: "p1",
      sectionId: "s1",
      sectionName: "In progress",
    });
    const incoming = historyThread({ id: "t1", source: "disk" });
    delete incoming.projectId;

    runtime.applyHistoryItems([incoming]);

    expect(threadStore.localThreads).toEqual([]);
    expect(threadStore.threadHistory[0]).toMatchObject({
      id: "t1",
      projectId: "p1",
      sectionId: "s1",
      sectionName: "In progress",
    });
    expect(incoming).not.toHaveProperty("projectId");
  });

  it("preserves known history metadata across repeated updates with undefined fields", () => {
    const { runtime, threadStore } = setup();
    runtime.applyHistoryItems([
      historyThread({ id: "t1", projectId: "p1", sectionId: "s1", sectionName: "In progress" }),
    ]);

    for (const updatedAt of [2, 3]) {
      runtime.applyHistoryItems([
        historyThread({
          id: "t1",
          updatedAt,
          projectId: undefined,
          sectionId: undefined,
          sectionName: undefined,
        }),
      ]);
    }

    expect(threadStore.threadHistory[0]).toMatchObject({
      updatedAt: 3,
      projectId: "p1",
      sectionId: "s1",
      sectionName: "In progress",
    });
  });

  it("keeps known history metadata when a duplicate local thread lacks it", () => {
    const { runtime, threadStore } = setup();
    runtime.applyHistoryItems([
      historyThread({ id: "t1", projectId: "p1", sectionId: "s1", sectionName: "In progress" }),
    ]);
    threadStore.upsertLocalThread({
      id: "t1",
      title: "Local thread",
      meta: "repo",
      createdAt: Date.now(),
      updatedAt: 1,
      status: "ready",
    });

    runtime.applyHistoryItems([historyThread({ id: "t1", projectId: undefined })]);

    expect(threadStore.threadHistory[0]).toMatchObject({
      projectId: "p1",
      sectionId: "s1",
      sectionName: "In progress",
    });
  });

  it("applies explicit reassignment and clearing without restoring stale metadata", () => {
    const { runtime, threadStore } = setup();
    runtime.applyHistoryItems([
      historyThread({ id: "t1", projectId: "p1", sectionId: "s1", sectionName: "In progress" }),
    ]);

    runtime.applyHistoryItems([historyThread({ id: "t1", projectId: "p2", sectionId: "s2", sectionName: "Done" })]);
    expect(threadStore.threadHistory[0]).toMatchObject({
      projectId: "p2",
      sectionId: "s2",
      sectionName: "Done",
    });

    runtime.applyHistoryItems([historyThread({ id: "t1", projectId: null, sectionId: null, sectionName: null })]);
    runtime.applyHistoryItems([historyThread({ id: "t1", projectId: undefined })]);

    expect(threadStore.threadHistory[0]).toMatchObject({
      projectId: null,
      sectionId: null,
      sectionName: null,
    });
  });

  it("keeps threads in their projects during history notifications within the project cache TTL", async () => {
    const { runtime, threadStore } = setup();
    const projectStore = useProjectStore();
    rpc.mockImplementation(async ({ method }: { method: string }) => ({
      result: {
        data: method === "project/list" ? [{ id: "p1", name: "Repo", position: 0, roots: [{ path: "C:\\repo" }] }] : [],
        nextCursor: null,
      },
    }));
    const projectRuntime = createProjectRuntime({
      projectStore,
      threadStore,
      getActiveWorkspace: () => "C:\\repo",
      getServerIdForWorkspace: () => "server-1",
      normalizeWorkspacePath: (value) => value,
      pageSize: 50,
    });
    await projectRuntime.refreshProjectTaskList("C:\\repo");
    const rpcCallCount = rpc.mock.calls.length;
    threadStore.upsertLocalThread({
      id: "t1",
      title: "New thread",
      meta: "repo",
      cwd: "C:\\repo",
      createdAt: Date.now(),
      updatedAt: 1,
      projectId: "p1",
      status: "ready",
    });
    const unsubscribe = runtime.subscribeHistoryUpdates();
    const notifyHistoryUpdated = onUpdated.mock.calls[0][0];

    notifyHistoryUpdated({ items: [historyThread({ id: "t1", projectId: undefined })] });
    await projectRuntime.refreshProjectTaskList("C:\\repo");

    const grouping = buildThreadHistoryGroups({
      mode: "project",
      items: threadStore.threadHistory,
      projects: projectStore.projects,
      sections: projectStore.sections,
      currentWorkspace: "C:\\repo",
      labels: { unassigned: "Unassigned", noWorkspace: "No workspace" },
    });
    expect(rpc).toHaveBeenCalledTimes(rpcCallCount);
    expect(grouping.primaryGroups.map((group) => group.key)).toEqual(["project:p1"]);
    expect(grouping.primaryGroups[0].rows.map((row) => row.item.id)).toEqual(["t1"]);
    unsubscribe();
    projectRuntime.dispose();
  });

  it("keeps cached content when only project or section metadata changes", () => {
    const { runtime, cache } = setup();
    runtime.applyHistoryItems([historyThread({ id: "t1" })]);
    cache.set(toThreadContentCacheKey({ threadId: "t1" }), cacheEntry("t1"));

    runtime.applyHistoryItems([
      historyThread({ id: "t1", projectId: "p1", sectionId: "s1", sectionName: "In progress" }),
    ]);

    expect(cache.has(toThreadContentCacheKey({ threadId: "t1" }))).toBe(true);
  });

  it("invalidates only the thread whose updatedAt changed", () => {
    const { runtime, cache } = setup();
    runtime.applyHistoryItems([historyThread({ id: "t1" }), historyThread({ id: "t2" })]);
    const t1Key = toThreadContentCacheKey({ threadId: "t1" });
    const t2Key = toThreadContentCacheKey({ threadId: "t2" });
    cache.set(t1Key, cacheEntry("t1"));
    cache.set(t2Key, cacheEntry("t2"));

    runtime.applyHistoryItems([historyThread({ id: "t1" }), historyThread({ id: "t2", updatedAt: 2 })]);

    expect(cache.has(t1Key)).toBe(true);
    expect(cache.has(t2Key)).toBe(false);
  });

  it("clears all cached content on an explicit forced refresh", async () => {
    const { runtime, cache } = setup();
    cache.set(toThreadContentCacheKey({ threadId: "t1" }), cacheEntry("t1"));
    cache.set(toThreadContentCacheKey({ threadId: "t2" }), cacheEntry("t2"));
    refresh.mockResolvedValue({
      items: [historyThread({ id: "t1" }), historyThread({ id: "t2" })],
    });

    await runtime.refreshHistory(true);

    expect(cache.size).toBe(0);
  });
});
