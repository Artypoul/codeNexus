import type { useThreadStore } from "../../stores/thread.store";
import type { LocalThreadItem, ThreadHistoryItem } from "../types";

type ThreadStore = ReturnType<typeof useThreadStore>;

export type ThreadListLookupRuntimeDeps = {
  threadStore: ThreadStore;
};

export type ThreadListLookupRuntime = {
  findThreadListItem: (threadId: string) => ThreadHistoryItem | LocalThreadItem | undefined;
};

export function createThreadListLookupRuntime(deps: ThreadListLookupRuntimeDeps): ThreadListLookupRuntime {
  const findThreadListItem = (threadIdValue: string) => {
    const threadId = String(threadIdValue ?? "").trim();
    if (!threadId) return undefined;
    return deps.threadStore.threadHistory.find((item) => item.id === threadId);
  };

  return { findThreadListItem };
}
