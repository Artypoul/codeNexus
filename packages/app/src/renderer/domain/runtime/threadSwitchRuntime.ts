import { nextTick } from "vue";
import { appendDebugLog } from "../../shared/debugLog";
import type { useRuntimeStore } from "../../stores/runtime.store";
import type { useThreadStore } from "../../stores/thread.store";
import type { useTimelineStore } from "../../stores/timeline.store";
import type { useWorkspaceFilesStore } from "../../stores/workspaceFiles.store";
import type { LocalThreadItem, ThreadHistoryItem } from "../types";

type RuntimeStore = ReturnType<typeof useRuntimeStore>;
type ThreadStore = ReturnType<typeof useThreadStore>;
type TimelineStore = ReturnType<typeof useTimelineStore>;
type WorkspaceFilesStore = ReturnType<typeof useWorkspaceFilesStore>;
type RuntimeEventLevel = "info" | "warn" | "error";
type PushEvent = (method: string, paramsText: string, opts?: { threadId?: string; level?: RuntimeEventLevel }) => void;

export type ThreadSwitchRuntimeDeps = {
  appTimelineId: string;
  runtimeStore: RuntimeStore;
  threadStore: ThreadStore;
  timelineStore: TimelineStore;
  workspaceFilesStore: WorkspaceFilesStore;
  normalizeWorkspacePath: (value: string) => string;
  findThreadListItem: (threadId: string) => ThreadHistoryItem | LocalThreadItem | undefined;
  getWorkspaceForThread: (threadId: string) => string;
  setThreadWorkspace: (threadId: string, workspacePath: string | undefined) => void;
  syncActiveServerByWorkspace: (workspacePath: string) => string;
  ensureServerForWorkspace: (workspacePath: string) => Promise<string>;
  applyCachedRightPanels: (workspacePath: string) => void;
  hasReplayCache: (threadId: string) => boolean;
  hydrateReplayFromCacheIfNeeded: (threadId: string) => boolean;
  loadHistoryMessages: (threadId: string, options?: { isCurrent?: () => boolean }) => Promise<boolean>;
  ensureThreadResumed: (threadId: string) => Promise<boolean>;
  refreshThreadGoal: (threadId: string) => Promise<unknown>;
  hydrateThreadHandoffDiagnostics: (threadId: string, opts?: { force?: boolean }) => Promise<unknown>;
  refreshRightPanels: () => Promise<void>;
  pushEvent: PushEvent;
};

export type ThreadSwitchRuntime = {
  switchThread: (threadId: string) => Promise<void>;
};

function perfNow() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
  return Date.now();
}

function elapsedMs(startedAt: number) {
  return Number((perfNow() - startedAt).toFixed(1));
}

export function createThreadSwitchRuntime(deps: ThreadSwitchRuntimeDeps): ThreadSwitchRuntime {
  const {
    appTimelineId,
    runtimeStore,
    threadStore,
    timelineStore,
    workspaceFilesStore,
    normalizeWorkspacePath,
    findThreadListItem,
    getWorkspaceForThread,
    setThreadWorkspace,
    syncActiveServerByWorkspace,
    ensureServerForWorkspace,
    applyCachedRightPanels,
    hasReplayCache,
    hydrateReplayFromCacheIfNeeded,
    loadHistoryMessages,
    ensureThreadResumed,
    refreshThreadGoal,
    hydrateThreadHandoffDiagnostics,
    refreshRightPanels,
    pushEvent,
  } = deps;
  // A switch can be cancelled or superseded. Only the switch that actually owns
  // the loading state may clear it, otherwise a cancelled navigation leaves the
  // previous thread spinning forever.
  const loadingOwnerSeqByThread = new Map<string, number>();

  const switchThread = async (threadId: string) => {
    const id = String(threadId ?? "").trim();
    if (!id) return;
    const switchSeq = ++runtimeStore.navigationRevision;
    const isActiveSwitch = () => switchSeq === runtimeStore.navigationRevision;
    const ownsLoading = () => loadingOwnerSeqByThread.get(id) === switchSeq;
    const clearOwnedLoading = () => {
      if (!ownsLoading()) return;
      loadingOwnerSeqByThread.delete(id);
      threadStore.clearLoadingThread(id);
    };
    const switchStartedAt = perfNow();
    const target = findThreadListItem(id);
    const targetRunning = threadStore.runningThreadIds.has(id);
    const existingTimelineEvents = timelineStore.eventsForThread(id);
    const canFastActivateRunningThread = targetRunning && existingTimelineEvents.length > 0;
    const prevWorkspace = normalizeWorkspacePath(runtimeStore.workspacePath);
    const nextCwd = normalizeWorkspacePath(String(target?.cwd ?? getWorkspaceForThread(id)));
    const didWorkspaceChange = Boolean(nextCwd && nextCwd !== prevWorkspace);
    if (didWorkspaceChange) {
      const confirmed = await workspaceFilesStore.confirmResetDirtyTabsForWorkspaceChange(nextCwd);
      if (!confirmed) return;
    }
    if (!isActiveSwitch()) return;
    appendDebugLog("thread.switch", "begin", {
      threadId: id,
      running: targetRunning,
      existingTimelineEventCount: existingTimelineEvents.length,
      hasReplayCache: hasReplayCache(id),
      fastActivate: canFastActivateRunningThread,
    });
    threadStore.setLoadingThread(id);
    loadingOwnerSeqByThread.set(id, switchSeq);
    runtimeStore.setCurrentThread(id);
    threadStore.setCurrentThread(id);
    const reusedReplayCache = hydrateReplayFromCacheIfNeeded(id);
    const shouldLoadHistory = !canFastActivateRunningThread && !reusedReplayCache;
    if (canFastActivateRunningThread) {
      appendDebugLog("thread.switch", "fast activate live timeline", {
        threadId: id,
        existingTimelineEventCount: existingTimelineEvents.length,
      });
    }
    const historyLoadPromise = shouldLoadHistory
      ? loadHistoryMessages(id, { isCurrent: () => runtimeStore.currentThreadId === id })
      : Promise.resolve(true);
    if (shouldLoadHistory) {
      void historyLoadPromise.finally(() => {
        clearOwnedLoading();
      });
    } else {
      clearOwnedLoading();
    }
    try {
      if (didWorkspaceChange) {
        runtimeStore.setWorkspace(nextCwd);
        threadStore.setWorkspace(nextCwd);
        void workspaceFilesStore.ensureReady(false);
        pushEvent("workspace:history", nextCwd, { threadId: appTimelineId });
        syncActiveServerByWorkspace(nextCwd);
      }
      const workspace = nextCwd || prevWorkspace;
      if (!workspace) {
        await historyLoadPromise;
        return;
      }
      const serverId = await ensureServerForWorkspace(workspace);
      if (!isActiveSwitch()) return;
      if (!serverId) return;

      setThreadWorkspace(id, workspace);
      applyCachedRightPanels(workspace);
      await historyLoadPromise;
      if (!isActiveSwitch()) return;
      appendDebugLog("thread.switch", "history loaded", { threadId: id, elapsedMs: elapsedMs(switchStartedAt) });

      void ensureThreadResumed(id);
      void refreshThreadGoal(id);
      void hydrateThreadHandoffDiagnostics(id);

      const mode = didWorkspaceChange ? "full" : "light";
      void nextTick().then(() => {
        if (!isActiveSwitch()) return;
        void workspaceFilesStore.reloadTreeForThreadSwitch({ mode });
      });

      void refreshRightPanels();
    } finally {
      clearOwnedLoading();
    }
  };

  return { switchThread };
}
