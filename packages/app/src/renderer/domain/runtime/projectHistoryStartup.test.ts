import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPinia, setActivePinia } from "pinia";
import { expect, it, vi } from "vitest";
import { HistoryStore } from "../../../main/historyStore";
import { HistoryService } from "../../../main/services/HistoryService";
import { buildThreadHistoryGroups } from "../../features/history/projectThreadGroups";
import { useProjectStore } from "../../stores/project.store";
import { useThreadStore } from "../../stores/thread.store";
import { createHistoryListRuntime } from "./historyListRuntime";
import { createProjectRuntime } from "./projectRuntime";

const { rpc, merge } = vi.hoisted(() => ({ rpc: vi.fn(), merge: vi.fn() }));
vi.mock("../../api/codexDesktopClient", () => ({
  codexDesktop: {
    localState: { initialSettingsSnapshot: undefined },
    codexServer: { rpc },
    history: { mergeThreadMetadata: merge },
  },
}));

it("keeps a late-arriving history thread in its project while the project snapshot is cached", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codenexus-project-startup-"));
  const sessionsRoot = join(dir, "sessions");
  await mkdir(sessionsRoot);
  setActivePinia(createPinia());
  const threadStore = useThreadStore();
  const projectStore = useProjectStore();
  const historyService = new HistoryService(new HistoryStore(join(dir, "history-cache.json"), sessionsRoot));
  const projectRuntime = createProjectRuntime({
    projectStore,
    threadStore,
    getActiveWorkspace: () => "C:\\repo",
    getServerIdForWorkspace: () => "server-1",
    normalizeWorkspacePath: (value) => value,
    pageSize: 50,
  });
  const historyRuntime = createHistoryListRuntime({
    threadStore,
    threadContentCacheByKey: new Map(),
    getWorkspacePath: () => "C:\\repo",
    setThreadWorkspace: vi.fn(),
    refreshWorkspaceMetadata: projectRuntime.refreshProjectTaskList,
  });
  merge.mockImplementation(async ({ threads }) => ({
    items: await historyService.mergeThreadMetadata({ threads }, historyRuntime.applyHistoryItems),
  }));
  rpc.mockImplementation(async ({ method, params }) => ({
    result: {
      data:
        method === "project/list"
          ? [{ id: "p1", name: "Repo", position: 0, roots: [{ path: "C:\\repo" }] }]
          : method === "thread/list" && params.projectId === "p1" && !params.archived
            ? [{ id: "thread-1", projectId: "p1", section: null }]
            : [],
      nextCursor: null,
    },
  }));

  try {
    await projectRuntime.refreshProjectTaskList("C:\\repo");
    expect(projectStore.status).toBe("ready");
    expect(threadStore.threadHistory).toEqual([]);
    const rpcCallCount = rpc.mock.calls.length;

    await writeFile(
      join(sessionsRoot, "thread-1.jsonl"),
      `${JSON.stringify({
        type: "session_meta",
        timestamp: "2026-11-07T04:00:00.000Z",
        payload: { id: "thread-1", cwd: "C:\\repo" },
      })}\n`,
      "utf8"
    );
    await historyService.refresh(historyRuntime.applyHistoryItems);
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
    expect(grouping.primaryGroups[0].rows.map((row) => row.item.id)).toEqual(["thread-1"]);
  } finally {
    projectRuntime.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
