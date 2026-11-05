import { codexDesktop } from "../../api/codexDesktopClient";
import { isCodexLocalEventMessage, isCodexServerNotificationMessage } from "@codenexus/shared/codex-protocol";
import type { useAppShellStore } from "../../stores/appShell.store";
import type { useApprovalStore } from "../../stores/approval.store";
import type { useRuntimeStore } from "../../stores/runtime.store";
import type { useThreadStore } from "../../stores/thread.store";
import type { useUserInputStore } from "../../stores/userInput.store";
import type { useWorkspaceFilesStore } from "../../stores/workspaceFiles.store";

type AppShellStore = ReturnType<typeof useAppShellStore>;
type ApprovalStore = ReturnType<typeof useApprovalStore>;
type RuntimeStore = ReturnType<typeof useRuntimeStore>;
type ThreadStore = ReturnType<typeof useThreadStore>;
type UserInputStore = ReturnType<typeof useUserInputStore>;
type WorkspaceFilesStore = ReturnType<typeof useWorkspaceFilesStore>;
type TranslateFn = (key: string, params?: Record<string, unknown>) => string;
type ThreadScopedState = {
  delete: (threadId: string) => unknown;
};

export type CodexServerEventRuntimeDeps = {
  runtimeStore: RuntimeStore;
  threadStore: ThreadStore;
  approvalStore: ApprovalStore;
  userInputStore: UserInputStore;
  appShellStore: AppShellStore;
  workspaceFilesStore: WorkspaceFilesStore;
  threadScopedCaches: ThreadScopedState[];
  normalizeWorkspacePath: (value: string) => string;
  getWorkspaceForServerId: (serverId: string) => string | undefined;
  getThreadWorkspaceEntries: () => Iterable<[string, string]>;
  clearServerById: (serverId: string) => string | undefined;
  syncActiveServerByWorkspace: (workspacePath: string) => string;
  clearThreadResumeState: (threadId: string) => void;
  resetSidePanelStores: (statusText?: string) => void;
  invalidateSkillsSnapshot: (workspacePath?: string) => void;
  scheduleSkillsRefresh: (workspacePath: string) => void;
  invalidateMcpSnapshot: (workspacePath?: string) => void;
  applyMcpStartupStatusNotification: (args: { workspace: string; name: string; status: string; error: string }) => void;
  scheduleMcpStatusRefresh: (workspacePath: string) => void;
  refreshMcp: () => Promise<void>;
  hydrateThreadHandoffDiagnostics: (threadId: string, opts?: { force?: boolean }) => Promise<void>;
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
  notifyCompletedTurnIfBackground: (threadId: string) => Promise<void>;
  flushQueueForThread: (threadId: string) => Promise<void>;
  translate: TranslateFn;
};

export type CodexServerEventRuntime = {
  subscribeCodexServerEvents: () => () => void;
};

export function createCodexServerEventRuntime(deps: CodexServerEventRuntimeDeps): CodexServerEventRuntime {
  const subscribeCodexServerEvents = () => {
    return codexDesktop.codexServer.onEvent((payload) => {
      const msg = payload?.msg;
      if (isCodexServerNotificationMessage(msg)) {
        if (msg.method === "serverRequest/resolved") {
          const resolvedThreadId = String(msg.params?.threadId ?? "").trim();
          const requestId = msg.params?.requestId;
          if (resolvedThreadId && (typeof requestId === "string" || typeof requestId === "number")) {
            deps.approvalStore.removeResolved(resolvedThreadId, requestId);
            deps.userInputStore.removePrompt(resolvedThreadId, requestId);
          }
        }

        if (msg.method === "turn/completed") {
          const threadId = String(msg.params?.threadId ?? "").trim();
          if (threadId) {
            void deps.hydrateThreadHandoffDiagnostics(threadId, { force: true });
            void deps.notifyCompletedTurnIfBackground(threadId);
            deps.workspaceFilesStore.scheduleGitStatusRefresh(500);
            setTimeout(() => {
              if (!deps.threadStore.runningThreadIds.has(threadId)) void deps.flushQueueForThread(threadId);
            }, 120);
          }
          return;
        }

        if (msg.method === "turn/started") {
          return;
        }

        if (msg.method === "project/changed" || msg.method === "thread/project/updated") {
          const eventServerId = deps.normalizeWorkspacePath(payload?.serverId ?? "");
          const workspace = deps.normalizeWorkspacePath(
            deps.getWorkspaceForServerId(eventServerId) ||
              (eventServerId && eventServerId === deps.runtimeStore.serverId ? deps.runtimeStore.workspacePath : "")
          );
          if (workspace && msg.method === "project/changed") {
            deps.handleProjectChangedNotification({
              workspacePath: workspace,
              projectId: msg.params.projectId,
              changeType: msg.params.changeType,
            });
          } else if (workspace && msg.method === "thread/project/updated") {
            void deps.handleThreadProjectUpdatedNotification({
              workspacePath: workspace,
              threadId: msg.params.threadId,
              projectId: msg.params.projectId,
            });
          }
          return;
        }

        if (msg.method === "skills/changed") {
          const eventServerId = deps.normalizeWorkspacePath(payload?.serverId ?? "");
          const workspace = deps.normalizeWorkspacePath(
            deps.getWorkspaceForServerId(eventServerId) ||
              (eventServerId && eventServerId === deps.runtimeStore.serverId ? deps.runtimeStore.workspacePath : "")
          );
          if (workspace) deps.invalidateSkillsSnapshot(workspace);
          if (workspace && deps.normalizeWorkspacePath(deps.runtimeStore.workspacePath) === workspace)
            deps.scheduleSkillsRefresh(workspace);
          return;
        }

        if (msg.method === "mcpServer/startupStatus/updated") {
          const eventServerId = deps.normalizeWorkspacePath(payload?.serverId ?? "");
          const workspace = deps.normalizeWorkspacePath(
            deps.getWorkspaceForServerId(eventServerId) ||
              (eventServerId && eventServerId === deps.runtimeStore.serverId ? deps.runtimeStore.workspacePath : "")
          );
          const params = (msg.params ?? {}) as Record<string, unknown>;
          const name = String(params.name ?? "").trim();
          const status = String(params.status ?? "").trim();
          const error = String(params.error ?? "").trim();
          if (workspace) {
            deps.invalidateMcpSnapshot(workspace);
            deps.applyMcpStartupStatusNotification({ workspace, name, status, error });
            if (status === "ready" || status === "failed" || status === "cancelled") {
              deps.scheduleMcpStatusRefresh(workspace);
            }
          }
          return;
        }

        if (msg.method === "mcpServer/oauthLogin/completed") {
          const eventServerId = deps.normalizeWorkspacePath(payload?.serverId ?? "");
          const workspace = deps.normalizeWorkspacePath(deps.getWorkspaceForServerId(eventServerId) ?? "");
          if (workspace) deps.invalidateMcpSnapshot(workspace);
          if (!eventServerId || eventServerId === deps.runtimeStore.serverId) void deps.refreshMcp();
          return;
        }

        return;
      }

      if (!isCodexLocalEventMessage(msg)) return;

      if (msg.method === "codex/exit") {
        const serverId = deps.normalizeWorkspacePath(payload?.serverId ?? "");
        const expected = Boolean(msg?.params?.expected);
        const stoppedWorkspace = deps.clearServerById(serverId);
        if (stoppedWorkspace) {
          for (const [threadId, workspace] of deps.getThreadWorkspaceEntries()) {
            if (workspace !== stoppedWorkspace) continue;
            deps.threadStore.setThreadRunning(threadId, false);
            deps.threadStore.setActiveTurn(threadId, "");
            deps.clearThreadResumeState(threadId);
            for (const cache of deps.threadScopedCaches) cache.delete(threadId);
          }
        }
        const activeWorkspace = deps.normalizeWorkspacePath(deps.runtimeStore.workspacePath);
        if (stoppedWorkspace && activeWorkspace === stoppedWorkspace) {
          const activeServerId = deps.syncActiveServerByWorkspace(activeWorkspace);
          if (!activeServerId && !expected) {
            deps.appShellStore.setServerConnState("failed", "codex app-server exited");
          }
        } else if (deps.runtimeStore.serverId === serverId) {
          deps.runtimeStore.clearServer();
          if (!expected) deps.appShellStore.setServerConnState("failed", "codex app-server exited");
          else deps.appShellStore.setServerConnState("disconnected");
          deps.resetSidePanelStores(deps.translate("runtime.noService"));
        }
        return;
      }
      if (msg.method === "codex/protocolError") {
        console.warn("[runtimeOrchestrator] protocol error", msg?.params ?? msg);
      }
    });
  };

  return { subscribeCodexServerEvents };
}
