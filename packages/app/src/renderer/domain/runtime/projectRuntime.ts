import { codexDesktop } from "../../api/codexDesktopClient";
import {
  ALL_THREAD_SOURCE_KINDS,
  buildHistoryThreadMetadataPatchFromServerThread,
} from "../../features/history/threadMetadata";
import {
  findProjectForWorkspace,
  projectAutoCreateKey,
  projectNameFromWorkspace,
} from "../../features/projects/projectWorkspaceMatch";
import type { useProjectStore } from "../../stores/project.store";
import type { useThreadStore } from "../../stores/thread.store";
import type { Project } from "@codenexus/generated/codex-app-server/v2/Project";
import type { ProjectCreateParams } from "@codenexus/generated/codex-app-server/v2/ProjectCreateParams";
import type { ProjectListParams } from "@codenexus/generated/codex-app-server/v2/ProjectListParams";
import type { Thread as ServerThread } from "@codenexus/generated/codex-app-server/v2/Thread";
import type { ThreadListParams } from "@codenexus/generated/codex-app-server/v2/ThreadListParams";
import type { ThreadSection } from "@codenexus/generated/codex-app-server/v2/ThreadSection";
import type { ThreadSectionListParams } from "@codenexus/generated/codex-app-server/v2/ThreadSectionListParams";
import type { HistoryThreadMetadataPatch } from "@codenexus/shared/ipc/contracts";

type ProjectStore = ReturnType<typeof useProjectStore>;
type ThreadStore = ReturnType<typeof useThreadStore>;

export type ProjectRuntimeDeps = {
  projectStore: ProjectStore;
  threadStore: ThreadStore;
  getActiveWorkspace: () => string;
  getServerIdForWorkspace: (workspacePath: string) => string;
  normalizeWorkspacePath: (value: string) => string;
  pageSize: number;
  ttlMs?: number;
  concurrency?: number;
};

export type ProjectRuntime = {
  ensureProjectForWorkspace: (workspacePathValue: string) => Promise<string | null>;
  refreshProjectTaskList: (workspacePath: string, options?: { force?: boolean }) => Promise<void>;
  handleProjectChangedNotification: (args: {
    workspacePath: string;
    projectId: string;
    changeType: "created" | "updated" | "deleted";
  }) => void;
  handleThreadProjectUpdatedNotification: (args: {
    workspacePath: string;
    threadId: string;
    projectId: string | null;
  }) => Promise<void>;
  dispose: () => void;
};

class StaleProjectRequestError extends Error {
  constructor() {
    super("stale project request");
    this.name = "StaleProjectRequestError";
  }
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error ?? "");
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<Array<PromiseSettledResult<R>>> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

export function createProjectRuntime(deps: ProjectRuntimeDeps): ProjectRuntime {
  const {
    projectStore,
    threadStore,
    getActiveWorkspace,
    getServerIdForWorkspace,
    normalizeWorkspacePath,
    pageSize,
    ttlMs = 60_000,
    concurrency = 4,
  } = deps;
  const loadedAtByWorkspace = new Map<string, number>();
  const loadPromiseByWorkspace = new Map<string, Promise<void>>();
  const ensureProjectPromiseByWorkspace = new Map<string, Promise<string | null>>();
  const refreshTimerByWorkspace = new Map<string, ReturnType<typeof setTimeout>>();

  const isActiveWorkspace = (workspace: string) =>
    normalizeWorkspacePath(getActiveWorkspace()) === normalizeWorkspacePath(workspace);

  const assertCurrentServer = (workspace: string, serverId: string) => {
    if (getServerIdForWorkspace(workspace) !== serverId) throw new StaleProjectRequestError();
  };

  const requestAllProjects = async (workspace: string, serverId: string): Promise<Project[]> => {
    const projects: Project[] = [];
    let cursor: string | null = null;
    while (true) {
      assertCurrentServer(workspace, serverId);
      const params: ProjectListParams = {
        cursor,
        limit: pageSize,
      };
      const { result } = await codexDesktop.codexServer.rpc({
        serverId,
        method: "project/list",
        params,
      });
      const pageProjects = Array.isArray(result?.data) ? result.data : [];
      projects.push(...pageProjects);
      const nextCursor = String(result?.nextCursor ?? "").trim();
      if (!nextCursor) break;
      cursor = nextCursor;
    }
    return projects;
  };

  const requestAllSections = async (workspace: string, serverId: string): Promise<ThreadSection[]> => {
    const sections: ThreadSection[] = [];
    let cursor: string | null = null;
    while (true) {
      assertCurrentServer(workspace, serverId);
      const params: ThreadSectionListParams = {
        cursor,
        limit: pageSize,
      };
      const { result } = await codexDesktop.codexServer.rpc({
        serverId,
        method: "threadSection/list",
        params,
      });
      const pageSections = Array.isArray(result?.data) ? result.data : [];
      sections.push(...pageSections);
      const nextCursor = String(result?.nextCursor ?? "").trim();
      if (!nextCursor) break;
      cursor = nextCursor;
    }
    return sections;
  };

  const requestThreadsForFilter = async (
    workspace: string,
    serverId: string,
    filters: { projectId?: string | null; currentWorkspaceOnly?: boolean }
  ): Promise<ServerThread[]> => {
    const deduped = new Map<string, ServerThread>();
    for (const archived of [false, true]) {
      let cursor: string | null = null;
      while (true) {
        assertCurrentServer(workspace, serverId);
        const params: ThreadListParams = {
          archived,
          cursor,
          limit: pageSize,
          sortKey: "updated_at",
          sourceKinds: ALL_THREAD_SOURCE_KINDS,
        };
        if (filters.currentWorkspaceOnly) params.cwd = workspace;
        if (Object.prototype.hasOwnProperty.call(filters, "projectId")) params.projectId = filters.projectId;
        const { result } = await codexDesktop.codexServer.rpc({
          serverId,
          method: "thread/list",
          params,
        });
        const threads = Array.isArray(result?.data) ? result.data : [];
        for (const thread of threads) {
          const threadId = String(thread?.id ?? "").trim();
          if (threadId) deduped.set(threadId, thread);
        }
        const nextCursor = String(result?.nextCursor ?? "").trim();
        if (!nextCursor) break;
        cursor = nextCursor;
      }
    }
    return [...deduped.values()];
  };

  const applyMetadataPatches = async (patches: HistoryThreadMetadataPatch[]) => {
    for (const patch of patches) {
      threadStore.patchThreadMetadata(patch.id, {
        projectId: patch.projectId,
        sectionId: patch.sectionId,
        sectionName: patch.sectionName,
      });
    }
    if (patches.length === 0) return;
    try {
      await codexDesktop.history.mergeThreadMetadata({ threads: patches });
    } catch (error: unknown) {
      console.warn("[runtimeOrchestrator] project thread metadata persistence failed", {
        message: readErrorMessage(error),
      });
    }
  };

  const canPublishProjectToStore = (workspace: string) => {
    const storeWorkspace = normalizeWorkspacePath(projectStore.workspacePath);
    return !storeWorkspace || storeWorkspace === workspace;
  };

  const ensureProjectForWorkspace: ProjectRuntime["ensureProjectForWorkspace"] = async (workspacePathValue) => {
    const workspace = normalizeWorkspacePath(workspacePathValue);
    if (!workspace) return null;
    const existingPromise = ensureProjectPromiseByWorkspace.get(workspace);
    if (existingPromise) return existingPromise;

    const task = (async () => {
      const serverId = getServerIdForWorkspace(workspace);
      if (!serverId) return null;

      const cachedProjects =
        normalizeWorkspacePath(projectStore.workspacePath) === workspace && projectStore.loadedAt > 0
          ? projectStore.projects
          : [];
      const cachedMatch = findProjectForWorkspace(cachedProjects, workspace);
      if (cachedMatch) return cachedMatch.id;

      const projects = await requestAllProjects(workspace, serverId);
      assertCurrentServer(workspace, serverId);
      const matched = findProjectForWorkspace(projects, workspace);
      if (matched) {
        if (canPublishProjectToStore(workspace)) projectStore.upsertProject(matched);
        return matched.id;
      }

      const params: ProjectCreateParams = {
        name: projectNameFromWorkspace(workspace),
        roots: [{ path: workspace }],
        idempotencyKey: projectAutoCreateKey(workspace),
      };
      const { result } = await codexDesktop.codexServer.rpc({
        serverId,
        method: "project/create",
        params,
      });
      assertCurrentServer(workspace, serverId);
      const project = (result as { project?: Project } | null | undefined)?.project;
      const projectId = String(project?.id ?? "").trim();
      if (!project || !projectId) throw new Error("project/create did not return project id");
      if (canPublishProjectToStore(workspace)) projectStore.upsertProject(project);
      return projectId;
    })();

    ensureProjectPromiseByWorkspace.set(workspace, task);
    try {
      return await task;
    } finally {
      ensureProjectPromiseByWorkspace.delete(workspace);
    }
  };

  const refreshProjectTaskList = async (workspacePathValue: string, options?: { force?: boolean }): Promise<void> => {
    const workspace = normalizeWorkspacePath(workspacePathValue);
    if (!workspace || !isActiveWorkspace(workspace)) return;
    const serverId = getServerIdForWorkspace(workspace);
    if (!serverId) return;
    const cacheKey = `${workspace}\u0000${serverId}`;
    const loadedAt = loadedAtByWorkspace.get(cacheKey);
    const hasCurrentSnapshot =
      normalizeWorkspacePath(projectStore.workspacePath) === workspace && projectStore.loadedAt > 0;
    if (!options?.force && hasCurrentSnapshot && loadedAt != null && Date.now() - loadedAt < ttlMs) return;
    const existing = loadPromiseByWorkspace.get(workspace);
    if (existing) return existing;

    const task = (async () => {
      projectStore.beginLoad(workspace, serverId);
      try {
        const projects = await requestAllProjects(workspace, serverId);
        assertCurrentServer(workspace, serverId);
        const sectionsPromise = requestAllSections(workspace, serverId).catch((error: unknown) => {
          console.warn("[runtimeOrchestrator] thread section list failed", {
            workspace,
            message: readErrorMessage(error),
          });
          return [] as ThreadSection[];
        });
        const [sections, projectThreadResults, unassignedThreads] = await Promise.all([
          sectionsPromise,
          mapWithConcurrency(projects, concurrency, (project) =>
            requestThreadsForFilter(workspace, serverId, { projectId: project.id })
          ),
          requestThreadsForFilter(workspace, serverId, {
            projectId: null,
            currentWorkspaceOnly: true,
          }),
        ]);
        assertCurrentServer(workspace, serverId);
        if (!isActiveWorkspace(workspace)) return;

        const dedupedThreads = new Map<string, ServerThread>();
        const fetchedThreads: ServerThread[] = [...unassignedThreads];
        for (const result of projectThreadResults) {
          if (result.status === "fulfilled") fetchedThreads.push(...result.value);
          else {
            console.warn("[runtimeOrchestrator] project thread list failed", {
              workspace,
              message: readErrorMessage(result.reason),
            });
          }
        }
        for (const thread of fetchedThreads) {
          const threadId = String(thread?.id ?? "").trim();
          if (threadId) dedupedThreads.set(threadId, thread);
        }
        const patches = [...dedupedThreads.values()].flatMap((thread) => {
          const patch = buildHistoryThreadMetadataPatchFromServerThread(thread);
          return patch ? [patch] : [];
        });

        projectStore.setSnapshot({
          workspacePath: workspace,
          serverId,
          projects,
          sections,
          loadedAt: Date.now(),
        });
        loadedAtByWorkspace.set(cacheKey, Date.now());
        await applyMetadataPatches(patches);
      } catch (error: unknown) {
        if (error instanceof StaleProjectRequestError) return;
        const message = readErrorMessage(error);
        console.warn("[runtimeOrchestrator] project task list load failed", { workspace, message });
        if (isActiveWorkspace(workspace)) projectStore.setError(workspace, serverId, message);
      } finally {
        loadPromiseByWorkspace.delete(workspace);
      }
    })();

    loadPromiseByWorkspace.set(workspace, task);
    return task;
  };

  const scheduleProjectRefresh = (workspace: string) => {
    const previous = refreshTimerByWorkspace.get(workspace);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      refreshTimerByWorkspace.delete(workspace);
      void refreshProjectTaskList(workspace, { force: true });
    }, 100);
    refreshTimerByWorkspace.set(workspace, timer);
  };

  const handleProjectChangedNotification: ProjectRuntime["handleProjectChangedNotification"] = (args) => {
    const workspace = normalizeWorkspacePath(args.workspacePath);
    const projectId = String(args.projectId ?? "").trim();
    if (!workspace || !projectId) return;
    const serverId = getServerIdForWorkspace(workspace);
    if (serverId) loadedAtByWorkspace.delete(`${workspace}\u0000${serverId}`);
    if (!isActiveWorkspace(workspace)) return;
    if (args.changeType === "deleted") projectStore.removeProject(projectId);
    scheduleProjectRefresh(workspace);
  };

  const handleThreadProjectUpdatedNotification: ProjectRuntime["handleThreadProjectUpdatedNotification"] = async (
    args
  ) => {
    const workspace = normalizeWorkspacePath(args.workspacePath);
    const threadId = String(args.threadId ?? "").trim();
    if (!threadId) return;
    const projectId = String(args.projectId ?? "").trim() || null;
    if (workspace && isActiveWorkspace(workspace)) threadStore.patchThreadMetadata(threadId, { projectId });
    try {
      await codexDesktop.history.mergeThreadMetadata({
        threads: [{ id: threadId, projectId }],
      });
    } catch (error: unknown) {
      console.warn("[runtimeOrchestrator] thread project update persistence failed", {
        threadId,
        message: readErrorMessage(error),
      });
    }
  };

  const dispose = () => {
    for (const timer of refreshTimerByWorkspace.values()) clearTimeout(timer);
    refreshTimerByWorkspace.clear();
  };

  return {
    ensureProjectForWorkspace,
    refreshProjectTaskList,
    handleProjectChangedNotification,
    handleThreadProjectUpdatedNotification,
    dispose,
  };
}
