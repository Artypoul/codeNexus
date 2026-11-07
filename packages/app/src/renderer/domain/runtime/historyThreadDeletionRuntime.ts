import { codexDesktop } from "../../api/codexDesktopClient";
import type { useThreadStore } from "../../stores/thread.store";
import { invalidateThreadContentCache, type ThreadContentCacheEntry } from "./rendererCacheRuntime";

type ThreadStore = ReturnType<typeof useThreadStore>;
type RuntimeEventLevel = "info" | "warn" | "error";
type ToastKind = "info" | "success" | "warn" | "error";
type TranslateFn = (key: string, params?: Record<string, unknown>) => string;
type PushEvent = (method: string, paramsText: string, opts?: { threadId?: string; level?: RuntimeEventLevel }) => void;
type ShowToast = (options: { kind?: ToastKind; title?: string; message: string }) => void;

export type HistoryThreadDeletionRuntimeDeps = {
  appTimelineId: string;
  threadStore: ThreadStore;
  threadContentCacheByKey: Map<string, ThreadContentCacheEntry>;
  clearThreadRuntimeState: (threadId: string) => void;
  pushEvent: PushEvent;
  translate: TranslateFn;
  showToast: ShowToast;
};

export type HistoryThreadDeletionRuntime = {
  deleteHistoryThread: (threadId: string) => Promise<void>;
};

function readErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (message) return String(message);
  }
  return String(error);
}

export function createHistoryThreadDeletionRuntime(
  deps: HistoryThreadDeletionRuntimeDeps
): HistoryThreadDeletionRuntime {
  const {
    appTimelineId,
    threadStore,
    threadContentCacheByKey,
    clearThreadRuntimeState,
    pushEvent,
    translate,
    showToast,
  } = deps;

  const deleteHistoryThread = async (threadId: string) => {
    const id = String(threadId ?? "").trim();
    if (!id) return;
    if (threadStore.hasLocalThread(id)) {
      invalidateThreadContentCache(threadContentCacheByKey, id);
      clearThreadRuntimeState(id);
      pushEvent("history", translate("runtime.localSessionRemoved"), { threadId: appTimelineId });
      return;
    }
    try {
      await codexDesktop.history.deleteThread({ threadId: id });
      invalidateThreadContentCache(threadContentCacheByKey, id);
      clearThreadRuntimeState(id);
      pushEvent("history", translate("runtime.sessionDeleted"), { threadId: appTimelineId });
    } catch (error: unknown) {
      const msg = readErrorMessage(error);
      showToast({ kind: "error", title: translate("runtime.deleteFailedTitle"), message: msg });
      pushEvent("history:error", msg, { threadId: appTimelineId, level: "error" });
    }
  };

  return { deleteHistoryThread };
}
