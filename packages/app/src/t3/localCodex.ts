import type { CodexDesktopApi } from "@codenexus/shared/ipc/contracts";
import type { CodexIncomingMessage, CodexRpcResponse } from "@codenexus/shared/codex-protocol";

type Session = { serverId: string; resumed: Map<string, Promise<void>> };

export function createLocalCodex(
  api: CodexDesktopApi,
  onEvent: (event: { serverId: string; cwd: string; msg: CodexIncomingMessage }) => void
) {
  const sessions = new Map<string, Promise<Session>>();
  const ownedServers = new Map<string, string>();
  let disposed = false;
  const unsubscribe = api.codexServer.onEvent((event) => {
    const workspace = ownedServers.get(event.serverId);
    if (disposed || !workspace) return;
    if (event.msg.kind === "local" && event.msg.method === "codex/exit") {
      ownedServers.delete(event.serverId);
      sessions.delete(workspace);
    }
    onEvent({ ...event, cwd: workspace });
  });
  const stop = (serverId: string) => {
    void api.codexServer.stop({ serverId }).catch(() => {});
  };
  const workspaceKey = (cwd: string) => {
    const value = cwd.trim();
    if (!value) throw new Error("Workspace is required");
    return value;
  };
  const sessionFor = (cwd: string): Promise<Session> => {
    if (disposed) return Promise.reject(new Error("Adapter is disposed"));
    const workspace = workspaceKey(cwd);
    const current = sessions.get(workspace);
    if (current) return current;
    const pending = api.codexServer
      .start({ cwd: workspace, experimentalApi: true })
      .then(({ serverId }) => {
        if (disposed) {
          stop(serverId);
          throw new Error("Adapter is disposed");
        }
        ownedServers.set(serverId, workspace);
        return { serverId, resumed: new Map() };
      })
      .catch((error: unknown) => {
        if (sessions.get(workspace) === pending) sessions.delete(workspace);
        throw error;
      });
    sessions.set(workspace, pending);
    return pending;
  };
  const read = async (cwd: string, id: string, includeTurns = true) => {
    const session = await sessionFor(cwd);
    const { result } = await api.codexServer.rpc({
      serverId: session.serverId,
      method: "thread/read",
      params: { threadId: id, includeTurns },
    });
    // Windows paths are case-insensitive; retain exact matching for other platforms.
    const normalize = (path: string) =>
      /^[a-z]:[\\/]/i.test(path)
        ? path
            .replaceAll("/", "\\")
            .replace(/[\\]+$/, "")
            .toLowerCase()
        : path.replace(/\/+$/, "");
    if (!result.thread?.cwd || normalize(result.thread.cwd) !== normalize(workspaceKey(cwd)))
      throw new Error("Thread does not belong to workspace");
    return result.thread;
  };
  const resume = async (session: Session, cwd: string, id: string) => {
    let pending = session.resumed.get(id);
    if (!pending) {
      pending = api.codexServer
        .rpc({
          serverId: session.serverId,
          method: "thread/resume",
          params: { threadId: id, cwd, approvalPolicy: "on-request", sandbox: "workspace-write" },
        })
        .then(() => {});
      session.resumed.set(id, pending);
      void pending.catch(() => {
        if (session.resumed.get(id) === pending) session.resumed.delete(id);
      });
    }
    await pending;
  };
  return {
    selectWorkspace: () => api.workspace.select(),
    async listThreads(cwd: string): Promise<unknown[]> {
      const workspace = workspaceKey(cwd);
      const { serverId } = await sessionFor(workspace);
      const data: unknown[] = [];
      const seen = new Set<string>();
      let cursor: string | null = null;
      do {
        const response: CodexRpcResponse<"thread/list"> = await api.codexServer.rpc({
          serverId,
          method: "thread/list",
          params: { cwd: workspace, cursor, limit: 100 },
        });
        data.push(...response.result.data);
        cursor = response.result.nextCursor ?? null;
        if (cursor && seen.has(cursor)) throw new Error("Repeated thread list cursor");
        if (cursor) seen.add(cursor);
      } while (cursor);
      return data;
    },
    readThread: read,
    async listModels(cwd: string): Promise<unknown[]> {
      const { serverId } = await sessionFor(cwd);
      const data: unknown[] = [];
      const seen = new Set<string>();
      let cursor: string | null = null;
      do {
        const response: CodexRpcResponse<"model/list"> = await api.codexServer.rpc({
          serverId,
          method: "model/list",
          params: { cursor, limit: 100 },
        });
        data.push(...response.result.data);
        cursor = response.result.nextCursor ?? null;
        if (cursor && seen.has(cursor)) throw new Error("Repeated model list cursor");
        if (cursor) seen.add(cursor);
      } while (cursor);
      return data;
    },
    async account(cwd: string): Promise<unknown> {
      const { serverId } = await sessionFor(cwd);
      return (await api.codexServer.rpc({ serverId, method: "account/read", params: { refreshToken: false } })).result;
    },
    async createThread(cwd: string, model?: string): Promise<{ id: string }> {
      const workspace = workspaceKey(cwd);
      const session = await sessionFor(workspace);
      const { result } = await api.codexServer.rpc({
        serverId: session.serverId,
        method: "thread/start",
        params: {
          cwd: workspace,
          ...(model ? { model } : {}),
          approvalPolicy: "on-request",
          sandbox: "workspace-write",
        },
      });
      const id = result.thread.id;
      if (!id) throw new Error("Thread start returned no id");
      session.resumed.set(id, Promise.resolve());
      return { id };
    },
    async send(cwd: string, id: string, text: string, model?: string): Promise<{ id: string }> {
      const workspace = workspaceKey(cwd);
      await read(workspace, id, false);
      const session = await sessionFor(workspace);
      await resume(session, workspace, id);
      const { result } = await api.codexServer.rpc({
        serverId: session.serverId,
        method: "turn/start",
        params: {
          threadId: id,
          cwd: workspace,
          input: [{ type: "text", text, text_elements: [] }],
          ...(model ? { model } : {}),
          approvalPolicy: "on-request",
          sandboxPolicy: {
            type: "workspaceWrite",
            writableRoots: [workspace],
            networkAccess: true,
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false,
          },
        },
      });
      if (!result.turn.id) throw new Error("Turn start returned no id");
      return { id: result.turn.id };
    },
    async interrupt(cwd: string, id: string, turnId: string): Promise<void> {
      await read(cwd, id, false);
      const { serverId } = await sessionFor(cwd);
      await api.codexServer.rpc({ serverId, method: "turn/interrupt", params: { threadId: id, turnId } });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      for (const serverId of ownedServers.keys()) stop(serverId);
      ownedServers.clear();
      sessions.clear();
    },
  };
}
