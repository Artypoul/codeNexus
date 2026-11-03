import { codexDesktop } from "../../api/codexDesktopClient";
import type { useRuntimeStore } from "../../stores/runtime.store";
import type { useThreadStore } from "../../stores/thread.store";
import type { useTimelineStore } from "../../stores/timeline.store";
import { resolveHistoryRewriteRollback } from "../historyRewriteRollback";
import type { TimelineEventItem } from "../types";

type RuntimeStore = ReturnType<typeof useRuntimeStore>;
type ThreadStore = ReturnType<typeof useThreadStore>;
type TimelineStore = ReturnType<typeof useTimelineStore>;
type RuntimeEventLevel = "info" | "warn" | "error";
type ToastKind = "info" | "success" | "warn" | "error";

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;
type PushEvent = (method: string, paramsText: string, opts?: { threadId?: string; level?: RuntimeEventLevel }) => void;
type ShowToast = (options: { kind?: ToastKind; title?: string; message: string }) => void;

type TurnInterruptRequest = (threadId: string, turnId: string, opts?: { silentSuccess?: boolean }) => Promise<boolean>;

export type HistoryRewriteRuntimeDeps = {
  runtimeStore: RuntimeStore;
  threadStore: ThreadStore;
  timelineStore: TimelineStore;
  normalizeWorkspacePath: (value: string) => string;
  getWorkspaceForThread: (threadId: string) => string;
  getServerIdForThread: (threadId: string) => string;
  ensureThreadResumed: (threadId: string) => Promise<boolean>;
  requestThreadRollback: (threadId: string, beforeTurnId: string) => Promise<boolean>;
  requestTurnInterrupt: TurnInterruptRequest;
  pushEvent: PushEvent;
  translate: TranslateFn;
  showToast: ShowToast;
};

export type HistoryRewriteRuntime = {
  rollbackHistoryRewriteBeforeSend: (
    threadId: string,
    opts?: { anchorTurnId?: string; force?: boolean }
  ) => Promise<boolean>;
};

async function confirmModalLazy(options: Parameters<(typeof import("../../ui/modal"))["confirmModal"]>[0]) {
  const { confirmModal } = await import("../../ui/modal");
  return confirmModal(options);
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error ?? "");
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createHistoryRewriteRuntime(deps: HistoryRewriteRuntimeDeps): HistoryRewriteRuntime {
  const {
    runtimeStore,
    threadStore,
    timelineStore,
    normalizeWorkspacePath,
    getWorkspaceForThread,
    getServerIdForThread,
    ensureThreadResumed,
    requestThreadRollback,
    requestTurnInterrupt,
    pushEvent,
    translate,
    showToast,
  } = deps;

  const resolveHistoryRewriteAnchorTurnId = (threadIdValue: string): string => {
    const directTurnId = String(runtimeStore.historyRewriteAnchorTurnId ?? "").trim();
    if (directTurnId) return directTurnId;

    const anchorEventId = String(runtimeStore.historyRewriteAnchorEventId ?? "").trim();
    if (!anchorEventId) return "";
    const anchorEvent = timelineStore
      .eventsForThread(threadIdValue)
      .find((event) => String(event?.id ?? "").trim() === anchorEventId);
    return String(anchorEvent?.turnId ?? "").trim();
  };

  const isHistoryRewriteAnchorUserEvent = (event: TimelineEventItem, anchorTurnId: string): boolean => {
    if (String(event?.turnId ?? "").trim() !== anchorTurnId) return false;
    return event.localKind === "user" || event.method === "user";
  };

  const isOutputAfterHistoryRewriteAnchor = (event: TimelineEventItem): boolean => {
    if (event.hidden) return false;
    if (event.localKind === "thinking" || event.method === "local/thinking") return false;
    if (
      event.method === "turn/started" ||
      event.method === "turn/completed" ||
      event.method === "turn/diff/updated" ||
      event.method === "thread/tokenUsage/updated" ||
      event.method === "local/contextCompaction"
    ) {
      return false;
    }
    return true;
  };

  const hasOutputBelowHistoryRewriteAnchor = (threadIdValue: string, anchorTurnIdValue: string): boolean | null => {
    const anchorTurnId = String(anchorTurnIdValue ?? "").trim();
    if (!anchorTurnId) return null;
    const events = timelineStore.eventsForThread(threadIdValue);
    const anchorIndex = events.findIndex((event) => isHistoryRewriteAnchorUserEvent(event, anchorTurnId));
    if (anchorIndex < 0) return null;
    return events.slice(anchorIndex + 1).some(isOutputAfterHistoryRewriteAnchor);
  };

  const waitForHistoryRewriteRunningTurnToStop = async (
    threadIdValue: string,
    anchorTurnIdValue: string
  ): Promise<"stopped" | "output" | "timeout"> => {
    const threadId = String(threadIdValue ?? "").trim();
    const anchorTurnId = String(anchorTurnIdValue ?? "").trim();
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      if (hasOutputBelowHistoryRewriteAnchor(threadId, anchorTurnId) === true) return "output";
      if (!threadStore.runningThreadIds.has(threadId)) return "stopped";
      const activeTurnId = String(threadStore.activeTurnIdByThread.get(threadId) ?? "").trim();
      if (activeTurnId && activeTurnId !== anchorTurnId) return "stopped";
      await sleep(100);
    }
    return threadStore.runningThreadIds.has(threadId) ? "timeout" : "stopped";
  };

  const rollbackHistoryRewriteBeforeSend = async (
    threadIdValue: string,
    opts?: { anchorTurnId?: string; force?: boolean }
  ): Promise<boolean> => {
    const forcedAnchorTurnId = String(opts?.anchorTurnId ?? "").trim();
    const forceRewrite = Boolean(opts?.force || forcedAnchorTurnId);
    if (!forceRewrite && (!runtimeStore.historyRewriteActive || runtimeStore.historyRewriteSource !== "history")) {
      return true;
    }

    const tid = String(threadIdValue ?? "").trim();
    if (!tid) {
      showToast({
        kind: "info",
        title: translate("runtime.rewriteUnavailableTitle"),
        message: translate("runtime.noThreadSelected"),
      });
      return false;
    }

    const workspace = normalizeWorkspacePath(getWorkspaceForThread(tid) || runtimeStore.workspacePath);
    const serverId = getServerIdForThread(tid);
    if (!workspace) {
      showToast({
        kind: "error",
        title: translate("runtime.rewriteUnavailableTitle"),
        message: translate("runtime.workspaceUnavailable"),
      });
      return false;
    }
    if (!serverId) {
      showToast({
        kind: "error",
        title: translate("runtime.rewriteUnavailableTitle"),
        message: translate("runtime.serviceUnavailable"),
      });
      return false;
    }

    const anchorTurnId = forcedAnchorTurnId || resolveHistoryRewriteAnchorTurnId(tid);
    let noVisibleOutputBelowAnchor = hasOutputBelowHistoryRewriteAnchor(tid, anchorTurnId) === false;
    if (threadStore.runningThreadIds.has(tid)) {
      const activeTurnId = String(threadStore.activeTurnIdByThread.get(tid) ?? "").trim();
      if (!noVisibleOutputBelowAnchor || !activeTurnId || activeTurnId !== anchorTurnId) {
        showToast({
          kind: "warn",
          title: translate("runtime.threadRunningTitle"),
          message: translate("runtime.waitBeforeSendingEditedMessage"),
        });
        return false;
      }
      const interrupted = await requestTurnInterrupt(tid, anchorTurnId, { silentSuccess: true });
      if (!interrupted) {
        showToast({
          kind: "error",
          title: translate("runtime.rewriteFailedTitle"),
          message: translate("runtime.stopTurnFailed"),
        });
        return false;
      }
      const stopped = await waitForHistoryRewriteRunningTurnToStop(tid, anchorTurnId);
      if (stopped === "timeout") {
        showToast({
          kind: "warn",
          title: translate("runtime.rewriteWaitTimeoutTitle"),
          message: translate("runtime.turnStillRunningRetry"),
        });
        return false;
      }
      if (threadStore.runningThreadIds.has(tid)) {
        showToast({
          kind: "warn",
          title: translate("runtime.threadRunningTitle"),
          message: translate("runtime.turnStillRunningRetry"),
        });
        return false;
      }
      noVisibleOutputBelowAnchor = hasOutputBelowHistoryRewriteAnchor(tid, anchorTurnId) === false;
    }

    const rollback = resolveHistoryRewriteRollback(threadStore.completedTurnsByThread.get(tid) ?? [], anchorTurnId);
    if (!rollback) {
      if (noVisibleOutputBelowAnchor) {
        timelineStore.removeTurnEvents(tid, [anchorTurnId]);
        return true;
      }
      showToast({
        kind: "error",
        title: translate("runtime.rewriteUnavailableTitle"),
        message: translate("runtime.rewriteRollbackNotFound"),
      });
      return false;
    }

    if (!noVisibleOutputBelowAnchor) {
      let confirmed = false;
      try {
        confirmed = await confirmModalLazy({
          title: translate("runtime.sendEditedHistoryTitle"),
          message: translate("runtime.sendEditedHistoryMessage", { count: rollback.count }),
          detail: translate("runtime.rollbackDetail"),
          confirmText: translate("runtime.rollbackAndSend"),
          cancelText: translate("common.cancel"),
          danger: true,
        });
      } catch (e: unknown) {
        const msg = readErrorMessage(e);
        const isBusy = msg.includes("another modal is already open");
        showToast({
          kind: isBusy ? "warn" : "error",
          title: translate("runtime.confirmModalOpenFailedTitle"),
          message: isBusy ? translate("runtime.modalAlreadyOpen") : translate("runtime.modalOpenFailed"),
        });
        return false;
      }
      if (!confirmed) return false;
    }

    if (rollback.combinedDiff.trim()) {
      const dry = await codexDesktop.workspace.dryRunApplyReverseDiff({
        cwd: workspace,
        diffText: rollback.combinedDiff,
      });
      if (!dry.ok) {
        pushEvent("rollback:error", translate("runtime.rollbackFilesFailed", { error: dry.error }), {
          threadId: tid,
          level: "error",
        });
        showToast({
          kind: "error",
          title: translate("runtime.rewriteFailedTitle"),
          message: translate("runtime.fileRollbackPrecheckFailed"),
        });
        return false;
      }
    }

    const resumed = await ensureThreadResumed(tid);
    if (!resumed) return false;
    const beforeTurnId = String(rollback.turnIds[0] ?? "").trim();
    if (!beforeTurnId) return false;
    const ok = await requestThreadRollback(tid, beforeTurnId);
    if (!ok) return false;

    if (rollback.combinedDiff.trim()) {
      const applied = await codexDesktop.workspace.applyReverseDiff({
        cwd: workspace,
        diffText: rollback.combinedDiff,
      });
      if (!applied.ok) {
        timelineStore.removeTurnEvents(tid, rollback.turnIds);
        threadStore.removeTurnsFromState(tid, rollback.turnIds);
        runtimeStore.endHistoryRewrite();
        pushEvent("rollback:error", translate("runtime.contextRolledBackFilesFailed", { error: applied.error }), {
          threadId: tid,
          level: "error",
        });
        showToast({
          kind: "error",
          title: translate("runtime.partialFailureTitle"),
          message: translate("runtime.contextRolledBackFilesFailedCheckWorkspace"),
        });
        return false;
      }
      if (!noVisibleOutputBelowAnchor) {
        pushEvent("rollback", `history rewrite files reverted: ${(applied.files ?? []).join(", ")}`, { threadId: tid });
      }
    } else {
      if (!noVisibleOutputBelowAnchor) {
        pushEvent("rollback", "history rewrite has no file diff; context only", { threadId: tid });
      }
    }

    timelineStore.removeTurnEvents(tid, rollback.turnIds);
    threadStore.removeTurnsFromState(tid, rollback.turnIds);
    if (!noVisibleOutputBelowAnchor) {
      showToast({
        kind: "success",
        title: translate("runtime.historyRolledBackTitle"),
        message: translate("runtime.historyRolledBackMessage", { count: rollback.count }),
      });
    }
    return true;
  };

  return { rollbackHistoryRewriteBeforeSend };
}
