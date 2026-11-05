import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectAutoCreateKey } from "../../features/projects/projectWorkspaceMatch";
import { useProjectStore } from "../../stores/project.store";
import { useThreadStore } from "../../stores/thread.store";
import { createProjectRuntime, type ProjectRuntimeDeps } from "./projectRuntime";

const { rpc, merge } = vi.hoisted(() => ({ rpc: vi.fn(), merge: vi.fn() }));
vi.mock("../../api/codexDesktopClient", () => ({
  codexDesktop: { codexServer: { rpc }, history: { mergeThreadMetadata: merge } },
}));

function serverThread(args: {
  id: string;
  projectId: string | null;
  section?: { id: string; name: string; appearance: null } | null;
}) {
  return {
    id: args.id,
    projectId: args.projectId,
    section: args.section ?? null,
    source: null,
    forkedFromId: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
  } as any;
}

function historyItem(id: string, projectId?: string | null) {
  return {
    id,
    title: id,
    meta: "C:\\repo",
    updatedAt: 1,
    cwd: "C:\\repo",
    projectId,
  };
}

function projectRecord(id: string, roots: string[] = []) {
  return {
    id,
    name: id,
    roots: roots.map((path) => ({ path })),
    metadata: {},
    position: 0,
    createdAt: 1,
    updatedAt: 1,
    recencyAt: null,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  rpc.mockReset();
  merge.mockReset().mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(overrides?: Partial<ProjectRuntimeDeps>) {
  const projectStore = useProjectStore();
  const threadStore = useThreadStore();
  threadStore.threadHistory = [historyItem("thread-p1"), historyItem("thread-p2"), historyItem("thread-unassigned")];
  let activeWorkspace = "C:\\repo";
  const servers = new Map([["C:\\repo", "server-1"]]);
  const runtime = createProjectRuntime({
    projectStore,
    threadStore,
    getActiveWorkspace: () => activeWorkspace,
    getServerIdForWorkspace: (workspace) => servers.get(workspace) ?? "",
    normalizeWorkspacePath: (value) => value,
    pageSize: 50,
    ...overrides,
  });
  return {
    runtime,
    projectStore,
    threadStore,
    servers,
    setActiveWorkspace: (workspace: string) => {
      activeWorkspace = workspace;
    },
  };
}

describe("project runtime", () => {
  it("reuses the project whose root contains the workspace", async () => {
    rpc.mockImplementation(async ({ method }: { method: string }) => {
      if (method === "project/list") {
        return {
          result: { data: [projectRecord("p-root", ["C:\\repo"])], nextCursor: null },
        };
      }
      throw new Error(`unexpected rpc: ${method}`);
    });
    const { runtime } = setup({ getServerIdForWorkspace: () => "server-1" });

    await expect(runtime.ensureProjectForWorkspace("C:\\repo\\packages\\app")).resolves.toBe("p-root");
    expect(rpc.mock.calls.some(([call]) => call.method === "project/create")).toBe(false);
  });

  it("creates a workspace-rooted project when no project matches", async () => {
    rpc.mockImplementation(async ({ method, params }: { method: string; params: any }) => {
      if (method === "project/list") return { result: { data: [], nextCursor: null } };
      if (method === "project/create") {
        return {
          result: {
            project: {
              ...projectRecord(
                "p-created",
                params.roots.map((root: { path: string }) => root.path)
              ),
              name: params.name,
            },
          },
        };
      }
      throw new Error(`unexpected rpc: ${method}`);
    });
    const { runtime, projectStore } = setup();

    await expect(runtime.ensureProjectForWorkspace("C:\\repo")).resolves.toBe("p-created");
    expect(rpc).toHaveBeenCalledWith({
      serverId: "server-1",
      method: "project/create",
      params: {
        name: "repo",
        roots: [{ path: "C:\\repo" }],
        idempotencyKey: projectAutoCreateKey("C:\\repo"),
      },
    });
    expect(projectStore.projects.map((project) => project.id)).toEqual(["p-created"]);
  });

  it("coalesces concurrent project creation for the same workspace", async () => {
    let resolveList: ((value: unknown) => void) | null = null;
    rpc.mockImplementation(async ({ method }: { method: string }) => {
      if (method === "project/list") {
        return new Promise((resolve) => {
          resolveList = resolve;
        });
      }
      if (method === "project/create") {
        return { result: { project: projectRecord("p-created", ["C:\\repo"]) } };
      }
      throw new Error(`unexpected rpc: ${method}`);
    });
    const { runtime } = setup();

    const first = runtime.ensureProjectForWorkspace("C:\\repo");
    const second = runtime.ensureProjectForWorkspace("C:\\repo");
    await vi.waitFor(() => expect(resolveList).not.toBeNull());
    resolveList!({ result: { data: [], nextCursor: null } });

    await expect(Promise.all([first, second])).resolves.toEqual(["p-created", "p-created"]);
    expect(rpc.mock.calls.filter(([call]) => call.method === "project/list")).toHaveLength(1);
    expect(rpc.mock.calls.filter(([call]) => call.method === "project/create")).toHaveLength(1);
  });

  it("returns null when the workspace has no running server", async () => {
    const { runtime } = setup({
      getServerIdForWorkspace: () => "",
    });
    await expect(runtime.ensureProjectForWorkspace("C:\\repo")).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("loads projects, sections, project threads, and current workspace unassigned threads", async () => {
    rpc.mockImplementation(async ({ method, params }: { method: string; params: any }) => {
      if (method === "project/list") {
        return {
          result: {
            data: [
              {
                id: "p1",
                name: "Project 1",
                roots: [],
                metadata: {},
                position: 0,
                createdAt: 1,
                updatedAt: 1,
                recencyAt: 1,
              },
              {
                id: "p2",
                name: "Project 2",
                roots: [],
                metadata: {},
                position: 1,
                createdAt: 1,
                updatedAt: 1,
                recencyAt: 1,
              },
            ],
            nextCursor: null,
          },
        };
      }
      if (method === "threadSection/list") {
        return { result: { data: [{ id: "s1", name: "In progress", appearance: null }], nextCursor: null } };
      }
      if (method === "thread/list") {
        if (params.archived) return { result: { data: [], nextCursor: null } };
        if (params.projectId === "p1") {
          return {
            result: {
              data: [
                serverThread({
                  id: "thread-p1",
                  projectId: "p1",
                  section: { id: "s1", name: "In progress", appearance: null },
                }),
              ],
              nextCursor: null,
            },
          };
        }
        if (params.projectId === "p2") {
          return { result: { data: [serverThread({ id: "thread-p2", projectId: "p2" })], nextCursor: null } };
        }
        if (params.projectId === null && params.cwd === "C:\\repo") {
          return { result: { data: [serverThread({ id: "thread-unassigned", projectId: null })], nextCursor: null } };
        }
      }
      throw new Error(`unexpected rpc: ${method}`);
    });

    const { runtime, projectStore, threadStore } = setup();
    await runtime.refreshProjectTaskList("C:\\repo", { force: true });

    expect(projectStore.status).toBe("ready");
    expect(projectStore.projects.map((project) => project.name)).toEqual(["Project 1", "Project 2"]);
    expect(projectStore.sections.map((section) => section.name)).toEqual(["In progress"]);
    expect(threadStore.threadHistory.map((item) => [item.id, item.projectId, item.sectionId])).toEqual([
      ["thread-p1", "p1", "s1"],
      ["thread-p2", "p2", null],
      ["thread-unassigned", null, null],
    ]);
    expect(merge).toHaveBeenCalledWith({
      threads: expect.arrayContaining([
        expect.objectContaining({ id: "thread-p1", projectId: "p1", sectionId: "s1" }),
        expect.objectContaining({ id: "thread-p2", projectId: "p2", sectionId: null }),
        expect.objectContaining({ id: "thread-unassigned", projectId: null }),
      ]),
    });

    const projectThreadCall = rpc.mock.calls.find(
      ([call]) => call.method === "thread/list" && call.params.projectId === "p1"
    )?.[0];
    expect(projectThreadCall.params.cwd).toBeUndefined();
    expect(projectThreadCall.params.sourceKinds).toContain("appServer");
  });

  it("caches a completed snapshot unless a forced refresh is requested", async () => {
    rpc.mockImplementation(async ({ method }: { method: string }) => {
      if (method === "project/list") return { result: { data: [], nextCursor: null } };
      if (method === "threadSection/list") return { result: { data: [], nextCursor: null } };
      if (method === "thread/list") return { result: { data: [], nextCursor: null } };
      throw new Error(method);
    });
    const { runtime } = setup();
    await runtime.refreshProjectTaskList("C:\\repo");
    const callCount = rpc.mock.calls.length;
    await runtime.refreshProjectTaskList("C:\\repo");
    expect(rpc).toHaveBeenCalledTimes(callCount);
    await runtime.refreshProjectTaskList("C:\\repo", { force: true });
    expect(rpc.mock.calls.length).toBeGreaterThan(callCount);
  });

  it("applies project deletion and thread assignment notifications", async () => {
    vi.useFakeTimers();
    rpc.mockImplementation(async ({ method }: { method: string }) => {
      if (method === "project/list") {
        return {
          result: {
            data: [
              {
                id: "p1",
                name: "Project 1",
                roots: [],
                metadata: {},
                position: 0,
                createdAt: 1,
                updatedAt: 1,
                recencyAt: 1,
              },
            ],
            nextCursor: null,
          },
        };
      }
      if (method === "threadSection/list") return { result: { data: [], nextCursor: null } };
      if (method === "thread/list") {
        return {
          result: {
            data:
              method === "thread/list"
                ? [
                    serverThread({
                      id: "thread-p1",
                      projectId: "p1",
                    }),
                  ]
                : [],
            nextCursor: null,
          },
        };
      }
      throw new Error(method);
    });
    const { runtime, projectStore, threadStore } = setup();
    await runtime.refreshProjectTaskList("C:\\repo", { force: true });
    expect(projectStore.projects).toHaveLength(1);

    runtime.handleProjectChangedNotification({
      workspacePath: "C:\\repo",
      projectId: "p1",
      changeType: "deleted",
    });
    expect(projectStore.projects).toHaveLength(0);

    await runtime.handleThreadProjectUpdatedNotification({
      workspacePath: "C:\\repo",
      threadId: "thread-p1",
      projectId: null,
    });
    expect(threadStore.threadHistory[0]?.projectId).toBeNull();
    expect(merge).toHaveBeenCalledWith({ threads: [{ id: "thread-p1", projectId: null }] });
    runtime.dispose();
  });

  it("reports project load failure without publishing a partial snapshot", async () => {
    rpc.mockRejectedValue(new Error("project service unavailable"));
    const { runtime, projectStore } = setup();
    await runtime.refreshProjectTaskList("C:\\repo", { force: true });
    expect(projectStore.status).toBe("error");
    expect(projectStore.loadedAt).toBe(0);
    expect(projectStore.projects).toEqual([]);
    expect(projectStore.error).toContain("project service unavailable");
  });
});
