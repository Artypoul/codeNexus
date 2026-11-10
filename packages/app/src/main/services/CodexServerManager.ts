import { randomUUID } from "node:crypto";
import { CodexAppServer, type ServerMode } from "../codexAppServer";
import type {
  CodexIncomingMessage,
  CodexNotifyArgs,
  CodexRpcArgs,
  CodexRpcMethod,
  CodexRpcResult,
  CodexServerRespondArgs,
} from "@codenexus/shared/codex-protocol";

type ServerRecord = {
  server: CodexAppServer;
  cwd?: string;
};

export class CodexServerManager {
  private readonly servers = new Map<string, ServerRecord>();

  async start(args: {
    cwd?: string;
    experimentalApi?: boolean;
    codexPath?: string;
    serverPath?: string;
    onMessage: (payload: { serverId: string; msg: CodexIncomingMessage }) => void;
  }): Promise<{ serverId: string; capabilities: { experimentalApi: boolean } }> {
    const serverId = randomUUID();
    const onMessage = (msg: CodexIncomingMessage) => {
      args.onMessage({ serverId, msg });
    };

    const server = new CodexAppServer({
      id: serverId,
      mode: "native" as ServerMode,
      cwd: args.cwd,
      codexPath: args.codexPath,
      serverPath: args.serverPath,
      experimentalApiOptIn: Boolean(args.experimentalApi),
      onMessage,
    });
    await server.start();

    this.servers.set(serverId, { server, cwd: args.cwd });
    return { serverId, capabilities: server.capabilities };
  }

  stop(serverId: string): { ok: true } {
    const record = this.servers.get(serverId);
    record?.server.stop();
    this.servers.delete(serverId);
    return { ok: true };
  }

  stopAll(): void {
    let firstError: unknown = null;
    for (const [serverId, record] of this.servers.entries()) {
      try {
        record.server.stop();
      } catch (error) {
        firstError ??= error;
      } finally {
        this.servers.delete(serverId);
      }
    }
    if (firstError) throw firstError;
  }

  async request<M extends CodexRpcMethod>(args: CodexRpcArgs<M>): Promise<CodexRpcResult<M>> {
    const record = this.getServer(args.serverId);
    return await record.server.request(args.method, args.params);
  }

  notify<M extends string>(args: CodexNotifyArgs<M>): { ok: true } {
    const record = this.getServer(args.serverId);
    record.server.notify(args.method, args.params);
    return { ok: true };
  }

  respond(args: CodexServerRespondArgs): { ok: true } {
    const record = this.getServer(args.serverId);
    record.server.respond(args.id, args.result, args.error);
    return { ok: true };
  }

  private getServer(serverId: string): ServerRecord {
    const record = this.servers.get(serverId);
    if (!record) throw new Error("server not found");
    return record;
  }
}
