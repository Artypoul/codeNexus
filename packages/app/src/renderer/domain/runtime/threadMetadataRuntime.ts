import { codexDesktop } from "../../api/codexDesktopClient";
import { createLruCache } from "../../shared/lruCache";
import {
  ALL_THREAD_SOURCE_KINDS,
  buildHistoryThreadMetadataPatchFromServerThread,
  normalizeOptionalText,
  resolveThreadParentIdForGraph,
} from "../../features/history/threadMetadata";
import type { useThreadStore } from "../../stores/thread.store";
import type { LocalThreadItem, ThreadHistoryItem } from "../types";
import type { Thread as ServerThread } from "@codenexus/generated/codex-app-server/v2/Thread";
import type { ThreadListParams } from "@codenexus/generated/codex-app-server/v2/ThreadListParams";
import type { ThreadListResponse } from "@codenexus/generated/codex-app-server/v2/ThreadListResponse";

type ThreadStore = ReturnType<typeof useThreadStore>;

type ThreadListItem = ThreadHistoryItem | LocalThreadItem;

export type ThreadMetadataRuntimeDeps = {
  appTimelineId: string;
  threadStore: ThreadStore;
  threadMetadataHydrationPromiseByWorkspace: Map<string, Promise<void>>;
  handoffDiagnosticsPromiseByThread: Map<string, Promise<void>>;
  threadMetadataPageSize: number;
  normalizeWorkspacePath: (value: string) => string;
  getServerIdForWorkspace: (workspacePath: string) => string;
  findThreadListItem: (threadId: string) => ThreadListItem | undefined;
  requestThreadRead: (threadId: string) => Promise<ServerThread>;
};

export type ThreadMetadataRuntime = {
  hydrateThreadMetadataForWorkspace: (workspacePath: string, options?: { force?: boolean }) => Promise<void>;
  hydrateThreadHandoffDiagnostics: (threadId: string, options?: { force?: boolean }) => Promise<void>;
};

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error ?? "");
}

export function createThreadMetadataRuntime(deps: ThreadMetadataRuntimeDeps): ThreadMetadataRuntime {
  const {
    appTimelineId,
    threadStore,
    threadMetadataHydrationPromiseByWorkspace,
    handoffDiagnosticsPromiseByThread,
    threadMetadataPageSize,
    normalizeWorkspacePath,
    getServerIdForWorkspace,
    findThreadListItem,
    requestThreadRead,
  } = deps;
  const hydratedAtByServer = createLruCache<string, number>(8);
  const hydrationTtlMs = 60_000;

  const requestThreadListPage = async (
    workspacePathValue: string,
    archived: boolean,
    cursor: string | null,
    serverId: string
  ): Promise<ThreadListResponse> => {
    const workspace = normalizeWorkspacePath(workspacePathValue);
    if (!workspace || !serverId) {
      return { data: [], readStates: null, nextCursor: null, backwardsCursor: null };
    }
    const params: ThreadListParams = {
      cwd: workspace,
      archived,
      cursor: cursor ?? null,
      limit: threadMetadataPageSize,
      sortKey: "updated_at",
      sourceKinds: ALL_THREAD_SOURCE_KINDS,
    };
    const { result } = await codexDesktop.codexServer.rpc({
      serverId,
      method: "thread/list",
      params,
    });
    return result;
  };

  const requestAllThreadsForWorkspace = async (
    workspacePathValue: string,
    serverId: string
  ): Promise<ServerThread[]> => {
    const workspace = normalizeWorkspacePath(workspacePathValue);
    if (!workspace) return [];
    const deduped = new Map<string, ServerThread>();

    for (const archived of [false, true]) {
      let cursor: string | null = null;
      while (true) {
        if (getServerIdForWorkspace(workspace) !== serverId) return [];
        const page = await requestThreadListPage(workspace, archived, cursor, serverId);
        const threads = Array.isArray(page?.data) ? page.data : [];
        for (const thread of threads) {
          const threadId = normalizeOptionalText(thread?.id);
          if (!threadId) continue;
          deduped.set(threadId, thread);
        }
        const nextCursor = normalizeOptionalText(page?.nextCursor);
        if (!nextCursor) break;
        cursor = nextCursor;
      }
    }

    return [...deduped.values()];
  };

  const hydrateThreadMetadataForWorkspace = async (
    workspacePathValue: string,
    options?: { force?: boolean }
  ): Promise<void> => {
    const workspace = normalizeWorkspacePath(workspacePathValue);
    const serverId = getServerIdForWorkspace(workspace);
    if (!workspace || !serverId) return;
    const cacheKey = `${workspace}\u0000${serverId}`;
    const hydratedAt = hydratedAtByServer.get(cacheKey);
    if (!options?.force && hydratedAt != null && Date.now() - hydratedAt < hydrationTtlMs) return;

    const existing = threadMetadataHydrationPromiseByWorkspace.get(workspace);
    if (existing) return existing;

    const task = (async () => {
      try {
        const threads = await requestAllThreadsForWorkspace(workspace, serverId);
        if (getServerIdForWorkspace(workspace) !== serverId) return;
        const patches = threads.flatMap((thread) => {
          const patch = buildHistoryThreadMetadataPatchFromServerThread(thread);
          if (!patch) return [];
          // 这里按 cwd 全量读取，不能把缺失的 projectId 当成“显式取消归属”。
          // 项目/Section 归属由 projectRuntime 通过 projectId 过滤后的权威结果维护。
          const metadataOnly = { ...patch };
          delete metadataOnly.projectId;
          delete metadataOnly.sectionId;
          delete metadataOnly.sectionName;
          return [metadataOnly];
        });
        if (patches.length > 0) await codexDesktop.history.mergeThreadMetadata({ threads: patches });
        if (getServerIdForWorkspace(workspace) === serverId) hydratedAtByServer.set(cacheKey, Date.now());
      } catch (e: unknown) {
        const msg = readErrorMessage(e);
        console.warn("[runtimeOrchestrator] thread metadata hydration failed", { workspace, msg });
      } finally {
        threadMetadataHydrationPromiseByWorkspace.delete(workspace);
      }
    })();

    threadMetadataHydrationPromiseByWorkspace.set(workspace, task);
    return task;
  };

  const hydrateThreadHandoffDiagnostics = async (
    threadIdValue: string,
    options?: { force?: boolean }
  ): Promise<void> => {
    const threadId = String(threadIdValue ?? "").trim();
    if (!threadId || threadId === appTimelineId) return;

    const historyItem = findThreadListItem(threadId);
    const parentThreadId = historyItem ? resolveThreadParentIdForGraph(historyItem) : "";
    if (!parentThreadId) {
      threadStore.clearThreadHandoffDiagnostics(threadId);
      return;
    }

    if (!options?.force && threadStore.handoffDiagnosticsByThread.has(threadId)) return;
    const existing = handoffDiagnosticsPromiseByThread.get(threadId);
    if (existing) return existing;

    const task = (async () => {
      threadStore.setThreadHandoffDiagnosticsLoading(threadId, true);
      try {
        const [currentResult, parentResult] = await Promise.allSettled([
          requestThreadRead(threadId),
          requestThreadRead(parentThreadId),
        ]);
        if (currentResult.status !== "fulfilled") throw currentResult.reason;

        const { buildThreadHandoffDiagnostics } = await import("../../features/history/threadHandoffDiagnostics");
        const diagnostics = buildThreadHandoffDiagnostics({
          threadId,
          parentThreadId,
          currentThread: currentResult.value,
          parentThread: parentResult.status === "fulfilled" ? parentResult.value : null,
        });
        threadStore.setThreadHandoffDiagnostics(threadId, diagnostics);

        if (parentResult.status !== "fulfilled") {
          const parentMsg = readErrorMessage(parentResult.reason);
          console.warn("[runtimeOrchestrator] parent thread handoff diagnostics degraded", {
            threadId,
            parentThreadId,
            msg: parentMsg,
          });
        }
      } catch (e: unknown) {
        const msg = readErrorMessage(e);
        console.warn("[runtimeOrchestrator] thread handoff diagnostics failed", { threadId, parentThreadId, msg });
        threadStore.clearThreadHandoffDiagnostics(threadId);
      } finally {
        threadStore.setThreadHandoffDiagnosticsLoading(threadId, false);
        handoffDiagnosticsPromiseByThread.delete(threadId);
      }
    })();

    handoffDiagnosticsPromiseByThread.set(threadId, task);
    return task;
  };

  return {
    hydrateThreadMetadataForWorkspace,
    hydrateThreadHandoffDiagnostics,
  };
}
