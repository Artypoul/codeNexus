import { codexDesktop } from "../../api/codexDesktopClient";
import { toThreadHistoryItem as toThreadHistoryItemFromHistory } from "../../features/history/threadHistoryItem";
import { fallbackThreadTitle } from "../../features/history/threadTitle";
import { appendDebugLog } from "../../shared/debugLog";
import type { useThreadStore } from "../../stores/thread.store";
import type { HistoryThread } from "@codenexus/shared/ipc";
import { invalidateThreadContentCache, type ThreadContentCacheEntry } from "./rendererCacheRuntime";

type ThreadStore = ReturnType<typeof useThreadStore>;

export type HistoryListRuntimeDeps = {
  threadStore: ThreadStore;
  threadContentCacheByKey: Map<string, ThreadContentCacheEntry>;
  getWorkspacePath: () => string;
  setThreadWorkspace: (threadId: string, workspacePath: string | undefined) => void;
  refreshWorkspaceMetadata: (workspacePath: string, options?: { force?: boolean }) => Promise<void>;
};

export type HistoryListRuntime = {
  applyHistoryItems: (items: HistoryThread[], options?: { invalidateAllContent?: boolean }) => void;
  refreshHistory: (force?: boolean) => Promise<void>;
  subscribeHistoryUpdates: () => () => void;
};

const LOCAL_THREAD_TTL_MS = 10 * 60_000;
const THREAD_GROUPING_METADATA_KEYS = ["projectId", "sectionId", "sectionName"] as const;

function perfNow() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
  return Date.now();
}

function elapsedMs(startedAt: number) {
  return Number((perfNow() - startedAt).toFixed(1));
}

function readErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (message) return String(message);
  }
  return String(error);
}

export function createHistoryListRuntime(deps: HistoryListRuntimeDeps): HistoryListRuntime {
  const { threadStore, threadContentCacheByKey, getWorkspacePath, setThreadWorkspace, refreshWorkspaceMetadata } = deps;

  const collectContentChangedThreadIds = (incoming: HistoryThread[]): Set<string> => {
    const previousUpdatedAtById = new Map<string, number>();
    for (const item of [...threadStore.threadHistory, ...threadStore.localThreads]) {
      const threadId = String(item?.id ?? "").trim();
      if (threadId) previousUpdatedAtById.set(threadId, Number(item.updatedAt ?? 0));
    }
    const changed = new Set<string>();
    for (const item of incoming) {
      const threadId = String(item?.id ?? "").trim();
      if (!threadId) continue;
      const previousUpdatedAt = previousUpdatedAtById.get(threadId);
      if (previousUpdatedAt == null || previousUpdatedAt !== Number(item.updatedAt ?? 0)) {
        changed.add(threadId);
      }
    }
    return changed;
  };

  const applyHistoryItems = (items: HistoryThread[], options?: { invalidateAllContent?: boolean }) => {
    if (options?.invalidateAllContent) {
      invalidateThreadContentCache(threadContentCacheByKey);
    } else {
      // 元数据合并（项目/Section/来源）不会改变会话内容；只清理确实更新过的线程，
      // 避免每次 history:updated 都把当前对话重新加载一遍。
      for (const threadId of collectContentChangedThreadIds(items)) {
        invalidateThreadContentCache(threadContentCacheByKey, threadId);
      }
    }
    const now = Date.now();
    const incomingThreadIds = new Set<string>();
    for (const item of items) {
      const threadId = String(item?.id ?? "").trim();
      if (threadId) incomingThreadIds.add(threadId);
    }
    const previousThreadById = new Map<
      string,
      Pick<HistoryThread, "title" | "projectId" | "sectionId" | "sectionName">
    >();
    for (const item of [...threadStore.threadHistory, ...threadStore.localThreads]) {
      const threadId = String(item.id ?? "").trim();
      if (!threadId) continue;
      const metadata = {
        ...previousThreadById.get(threadId),
        title: String(item.title ?? "").trim(),
      };
      for (const key of THREAD_GROUPING_METADATA_KEYS) {
        if (item[key] !== undefined) metadata[key] = item[key];
      }
      previousThreadById.set(threadId, metadata);
    }
    threadStore.localThreads = threadStore.localThreads.filter((item) => {
      const threadId = String(item.id ?? "").trim();
      if (!threadId || incomingThreadIds.has(threadId)) return false;
      const createdAt = Number(item.createdAt ?? item.updatedAt ?? now);
      return now - createdAt <= LOCAL_THREAD_TTL_MS;
    });
    const historyItems = items
      .map((item) => {
        const historyItem = toThreadHistoryItemFromHistory(item);
        const threadId = String(historyItem.id ?? "").trim();
        const previousThread = previousThreadById.get(threadId);
        const placeholder = fallbackThreadTitle(threadId);
        const nextTitle = String(historyItem.title ?? "").trim();
        const previousTitle = String(previousThread?.title ?? "").trim();
        if ((!nextTitle || nextTitle === placeholder) && previousTitle && previousTitle !== placeholder) {
          historyItem.title = previousTitle;
        }
        for (const key of THREAD_GROUPING_METADATA_KEYS) {
          if (historyItem[key] === undefined) historyItem[key] = previousThread?.[key];
        }
        return historyItem;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);

    threadStore.threadHistory = historyItems;
    for (const item of items) {
      const threadId = String(item.id ?? "").trim();
      if (!threadId) continue;
      const running = Boolean(item.running);
      const activeTurnId = running ? String(item.activeTurnId ?? "").trim() : "";
      threadStore.setThreadRunning(threadId, running);
      threadStore.setActiveTurn(threadId, activeTurnId);
    }
    for (const item of [...historyItems, ...threadStore.localThreads]) {
      setThreadWorkspace(item.id, item.cwd);
    }
  };

  const refreshHistory = async (force = false) => {
    const startedAt = perfNow();
    appendDebugLog("history.refresh", "started", { force });
    try {
      const result = force ? await codexDesktop.history.refresh() : await codexDesktop.history.list();
      const items = Array.isArray(result?.items) ? result.items : [];
      applyHistoryItems(items, { invalidateAllContent: force });
      if (force) await refreshWorkspaceMetadata(getWorkspacePath(), { force: true });
      else void refreshWorkspaceMetadata(getWorkspacePath());
      appendDebugLog("history.refresh", "completed", {
        force,
        count: items.length,
        elapsedMs: elapsedMs(startedAt),
      });
    } catch (error: unknown) {
      const msg = readErrorMessage(error);
      appendDebugLog("history.refresh", "failed", {
        force,
        elapsedMs: elapsedMs(startedAt),
        message: msg,
      });
      console.warn("[runtimeOrchestrator] refreshHistory failed", msg);
    }
  };

  const subscribeHistoryUpdates = () => {
    return codexDesktop.history.onUpdated((payload) => {
      const items = Array.isArray(payload?.items) ? payload.items : [];
      applyHistoryItems(items);
    });
  };

  return { applyHistoryItems, refreshHistory, subscribeHistoryUpdates };
}
