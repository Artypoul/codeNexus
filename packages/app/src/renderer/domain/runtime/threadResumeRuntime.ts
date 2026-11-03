import { codexDesktop } from "../../api/codexDesktopClient";
import type { ThreadResumeParams } from "@codenexus/generated/codex-app-server/v2/ThreadResumeParams";

type RuntimeEventLevel = "info" | "warn" | "error";
type PushEvent = (method: string, paramsText: string, opts?: { threadId?: string; level?: RuntimeEventLevel }) => void;

export type ThreadResumeRuntimeDeps = {
  resumedThreadIds: Set<string>;
  resumePromisesByThread: Map<string, Promise<boolean>>;
  getWorkspaceForThread: (threadId: string) => string;
  ensureServerForWorkspace: (workspacePath: string) => Promise<string>;
  pushEvent: PushEvent;
};

export type ThreadResumeRuntime = {
  ensureThreadResumed: (threadId: string) => Promise<boolean>;
  markThreadResumed: (threadId: string) => void;
  clearThreadResumeState: (threadId: string) => void;
};

function readErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (message) return String(message);
  }
  return String(error);
}

export function createThreadResumeRuntime(deps: ThreadResumeRuntimeDeps): ThreadResumeRuntime {
  const { resumedThreadIds, resumePromisesByThread, getWorkspaceForThread, ensureServerForWorkspace, pushEvent } = deps;

  const markThreadResumed = (threadIdValue: string) => {
    const threadId = String(threadIdValue ?? "").trim();
    if (!threadId) return;
    resumedThreadIds.add(threadId);
  };

  const clearThreadResumeState = (threadIdValue: string) => {
    const threadId = String(threadIdValue ?? "").trim();
    if (!threadId) return;
    resumedThreadIds.delete(threadId);
    resumePromisesByThread.delete(threadId);
  };

  const ensureThreadResumed = async (threadId: string): Promise<boolean> => {
    const tid = String(threadId ?? "").trim();
    if (!tid) return false;
    if (resumedThreadIds.has(tid)) return true;
    const existing = resumePromisesByThread.get(tid);
    if (existing) return existing;
    const task = (async (): Promise<boolean> => {
      try {
        const workspace = getWorkspaceForThread(tid);
        const serverId = await ensureServerForWorkspace(workspace);
        if (!serverId) return false;
        const resumeParams: ThreadResumeParams = { threadId: tid };
        await codexDesktop.codexServer.rpc({ serverId, method: "thread/resume", params: resumeParams });
        resumedThreadIds.add(tid);
        return true;
      } catch (error: unknown) {
        const msg = readErrorMessage(error);
        pushEvent("thread:resume:error", msg, { threadId, level: "error" });
        return false;
      } finally {
        resumePromisesByThread.delete(tid);
      }
    })();
    resumePromisesByThread.set(tid, task);
    return task;
  };

  return { ensureThreadResumed, markThreadResumed, clearThreadResumeState };
}
