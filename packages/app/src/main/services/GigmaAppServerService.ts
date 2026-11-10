import type {
  CodexNotifyArgs,
  CodexRpcArgs,
  CodexRpcMethod,
  CodexRpcResult,
  CodexServerRespondArgs,
} from "@codenexus/shared/codex-protocol";
import { CodexServerManager } from "./CodexServerManager";
import { GigmaAuthClient } from "./GigmaAuthClient";
import { GigmaAuthProcessSupervisor } from "./GigmaAuthProcessSupervisor";

export class GigmaAppServerService {
  constructor(
    private readonly codex: CodexServerManager,
    private readonly auth: GigmaAuthClient,
    private readonly authProcess?: GigmaAuthProcessSupervisor
  ) {}

  async authStatus() {
    return this.auth.status();
  }

  async start(args: Parameters<CodexServerManager["start"]>[0]) {
    await this.authProcess?.ensure();
    const status = await this.auth.status();
    if (!status.available) throw new Error("Gigma CLI auth service is unavailable.");
    if (!status.loggedIn) throw new Error("Gigma account authentication is required before starting Codex.");
    return this.codex.start(args);
  }

  stop(serverId: string) {
    return this.codex.stop(serverId);
  }

  stopAll() {
    this.authProcess?.stop();
    return this.codex.stopAll();
  }

  request<M extends CodexRpcMethod>(args: CodexRpcArgs<M>): Promise<CodexRpcResult<M>> {
    return this.codex.request(args);
  }

  notify<M extends string>(args: CodexNotifyArgs<M>) {
    return this.codex.notify(args);
  }

  respond(args: CodexServerRespondArgs) {
    return this.codex.respond(args);
  }
}
