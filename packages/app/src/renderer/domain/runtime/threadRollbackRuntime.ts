import { codexDesktop } from "../../api/codexDesktopClient";
import type { useRuntimeStore } from "../../stores/runtime.store";
import type { useThreadStore } from "../../stores/thread.store";
import type { useTimelineStore } from "../../stores/timeline.store";

type RuntimeStore = ReturnType<typeof useRuntimeStore>;
type ThreadStore = ReturnType<typeof useThreadStore>;
type TimelineStore = ReturnType<typeof useTimelineStore>;
type RuntimeEventLevel = "info" | "warn" | "error";
type ToastKind = "info" | "success" | "warn" | "error";

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;
type PushEvent = (method: string, paramsText: string, opts?: { threadId?: string; level?: RuntimeEventLevel }) => void;
type ShowToast = (options: { kind?: ToastKind; title?: string; message: string }) => void;

export type ThreadRollbackRuntimeDeps = {
  runtimeStore: RuntimeStore;
  threadStore: ThreadStore;
  timelineStore: TimelineStore;
  normalizeWorkspacePath: (value: string) => string;
  getWorkspaceForThread: (threadId: string) => string;
  getServerIdForThread: (threadId: string) => string;
  ensureThreadResumed: (threadId: string) => Promise<boolean>;
  pushEvent: PushEvent;
  translate: TranslateFn;
  showToast: ShowToast;
};

export type ThreadRollbackRuntime = {
  requestThreadRollback: (threadId: string, beforeTurnId: string) => Promise<boolean>;
  rollbackTurns: () => Promise<void>;
};

async function promptNumberModalLazy(options: Parameters<(typeof import("../../ui/modal"))["promptNumberModal"]>[0]) {
  const { promptNumberModal } = await import("../../ui/modal");
  return promptNumberModal(options);
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error ?? "");
}

export function createThreadRollbackRuntime(deps: ThreadRollbackRuntimeDeps): ThreadRollbackRuntime {
  const {
    runtimeStore,
    threadStore,
    timelineStore,
    normalizeWorkspacePath,
    getWorkspaceForThread,
    getServerIdForThread,
    ensureThreadResumed,
    pushEvent,
    translate,
    showToast,
  } = deps;

  const requestThreadRollback = async (threadIdValue: string, beforeTurnIdValue: string): Promise<boolean> => {
    const tid = String(threadIdValue ?? "").trim();
    const beforeTurnId = String(beforeTurnIdValue ?? "").trim();
    if (!tid || !beforeTurnId) return false;
    const serverId = getServerIdForThread(tid);
    if (!serverId) return false;
    try {
      await codexDesktop.codexServer.rpc({
        serverId,
        method: "thread/revert",
        params: { threadId: tid, beforeTurnId },
      });
      return true;
    } catch (e: unknown) {
      const msg = readErrorMessage(e);
      pushEvent("rollback:error", msg || "thread/revert failed", { threadId: tid, level: "error" });
      showToast({ kind: "error", title: translate("runtime.rollbackFailedTitle"), message: "thread/revert failed" });
      return false;
    }
  };

  const rollbackTurns = async () => {
    if (!runtimeStore.currentThreadId) {
      showToast({
        kind: "info",
        title: translate("runtime.rollbackUnavailableTitle"),
        message: translate("runtime.noThreadSelected"),
      });
      return;
    }
    const tid = String(runtimeStore.currentThreadId ?? "").trim();
    if (!tid) {
      showToast({
        kind: "info",
        title: translate("runtime.rollbackUnavailableTitle"),
        message: translate("runtime.noThreadSelected"),
      });
      return;
    }
    const workspace = normalizeWorkspacePath(getWorkspaceForThread(tid) || runtimeStore.workspacePath);
    const serverId = getServerIdForThread(tid);
    if (!workspace) {
      showToast({
        kind: "error",
        title: translate("runtime.rollbackUnavailableTitle"),
        message: translate("runtime.workspaceUnavailable"),
      });
      return;
    }
    if (!serverId) {
      showToast({
        kind: "error",
        title: translate("runtime.rollbackUnavailableTitle"),
        message: translate("runtime.serviceUnavailable"),
      });
      return;
    }
    if (threadStore.runningThreadIds.has(tid)) {
      showToast({
        kind: "warn",
        title: translate("runtime.threadRunningTitle"),
        message: translate("runtime.waitBeforeRollback"),
      });
      return;
    }
    const stack = threadStore.completedTurnsByThread.get(tid) ?? [];
    if (stack.length === 0) {
      showToast({
        kind: "info",
        title: translate("runtime.noRollbackTurnsTitle"),
        message: translate("runtime.noCompletedTurns"),
      });
      return;
    }
    let n: number | null = null;
    try {
      n = await promptNumberModalLazy({
        title: translate("topbarExtra.rollbackRecent"),
        message: translate("runtime.rollbackDetail"),
        detail: translate("runtime.rollbackRange", { count: stack.length }),
        confirmText: translate("runtime.rollback"),
        cancelText: translate("common.cancel"),
        danger: true,
        defaultValue: 1,
        min: 1,
        max: stack.length,
      });
    } catch (e: unknown) {
      const msg = readErrorMessage(e);
      const isBusy = msg.includes("another modal is already open");
      showToast({
        kind: isBusy ? "warn" : "error",
        title: translate("runtime.rollbackModalOpenFailedTitle"),
        message: isBusy ? translate("runtime.modalAlreadyOpen") : translate("runtime.modalOpenFailed"),
      });
      return;
    }
    if (n == null) return;

    const selected = stack.slice(-n);
    const selectedTurnIds = selected.map((entry) => entry.turnId);
    const beforeTurnId = String(selectedTurnIds[0] ?? "").trim();
    if (!beforeTurnId) return;
    const diffParts = [...selected]
      .reverse()
      .map((entry) => entry.diffText)
      .filter((text) => String(text ?? "").trim().length > 0);
    const combinedDiff = diffParts.join("\n\n");

    if (combinedDiff.trim()) {
      const dry = await codexDesktop.workspace.dryRunApplyReverseDiff({ cwd: workspace, diffText: combinedDiff });
      if (!dry.ok) {
        pushEvent("rollback:error", translate("runtime.rollbackFilesFailed", { error: dry.error }), {
          threadId: tid,
          level: "error",
        });
        showToast({
          kind: "error",
          title: translate("runtime.rollbackFailedTitle"),
          message: translate("runtime.fileRollbackPrecheckFailed"),
        });
        return;
      }
    }

    const resumed = await ensureThreadResumed(tid);
    if (!resumed) return;
    const ok = await requestThreadRollback(tid, beforeTurnId);
    if (!ok) return;

    if (combinedDiff.trim()) {
      const applied = await codexDesktop.workspace.applyReverseDiff({ cwd: workspace, diffText: combinedDiff });
      if (!applied.ok) {
        timelineStore.removeTurnEvents(tid, selectedTurnIds);
        threadStore.removeTurnsFromState(tid, selectedTurnIds);
        pushEvent("rollback:error", translate("runtime.contextRolledBackFilesFailed", { error: applied.error }), {
          threadId: tid,
          level: "error",
        });
        showToast({
          kind: "error",
          title: translate("runtime.partialFailureTitle"),
          message: translate("runtime.contextRolledBackFilesFailedCheckWorkspace"),
        });
        return;
      }
      pushEvent("rollback", `files reverted: ${(applied.files ?? []).join(", ")}`, { threadId: tid });
    } else {
      pushEvent("rollback", "no file diff in selected turns; context only", { threadId: tid });
    }

    timelineStore.removeTurnEvents(tid, selectedTurnIds);
    threadStore.removeTurnsFromState(tid, selectedTurnIds);
    showToast({
      kind: "success",
      title: translate("runtime.rollbackCompletedTitle"),
      message: translate("runtime.rollbackCompletedMessage", { count: n }),
    });
  };

  return { requestThreadRollback, rollbackTurns };
}
