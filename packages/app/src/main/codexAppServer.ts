import { spawn } from "node:child_process";
import * as readline from "node:readline";
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import { discoverExistingCodexPaths } from "./codexNativeDiscovery";
import { logger } from "./utils/logger";
import type {
  CodexIncomingMessage,
  CodexNotifyParams,
  CodexRpcMethod,
  CodexRpcParams,
  CodexRpcResult,
  JsonRpcId as ProtocolJsonRpcId,
} from "@codenexus/shared/codex-protocol";
import { isStandaloneCodexAppsMethod, standaloneCodexAppsError } from "@codenexus/shared/codex-protocol";

export type ServerMode = "native";

export type JsonRpcId = ProtocolJsonRpcId;

export type JsonRpcRequest = {
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcNotification = {
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  id: JsonRpcId;
  result?: unknown;
  error?: unknown;
};

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout?: NodeJS.Timeout;
};

function isJsonRpcId(value: unknown): value is JsonRpcId {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return false;
}

function isValidMethod(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidParams(value: unknown): boolean {
  if (value === undefined) return true;
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export class CodexAppServer {
  readonly id: string;
  private experimentalApiEnabled = false;
  private readonly experimentalApiOptIn: boolean;
  private readonly mode: ServerMode;
  private readonly cwd?: string;
  private readonly codexPath?: string;
  private readonly serverPath?: string;
  private proc?: ReturnType<typeof spawn>;
  private rl?: readline.Interface;
  private stopping = false;
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, Pending>();
  private onMessage?: (msg: CodexIncomingMessage) => void;
  private nativeCodex?:
    | { kind: "server"; path: string }
    | { kind: "direct"; path: string }
    | { kind: "node"; nodeExe: string; script: string }
    | { kind: "cmd"; path: string };

  constructor(opts: {
    id: string;
    mode: ServerMode;
    cwd?: string;
    codexPath?: string;
    serverPath?: string;
    experimentalApiOptIn?: boolean;
    onMessage?: (msg: CodexIncomingMessage) => void;
  }) {
    this.id = opts.id;
    this.mode = opts.mode;
    this.cwd = opts.cwd;
    this.codexPath = opts.codexPath;
    this.serverPath = opts.serverPath;
    this.experimentalApiOptIn = Boolean(opts.experimentalApiOptIn);
    this.onMessage = opts.onMessage;
  }

  get running() {
    return Boolean(this.proc && !this.proc.killed);
  }

  get capabilities() {
    return { experimentalApi: this.experimentalApiEnabled };
  }

  async start(): Promise<void> {
    if (this.proc) throw new Error("server already started");

    if (this.mode === "native") this.preflightNative();

    const { command, args, spawnCwd } = this.getSpawnCommand();
    if (spawnCwd) this.ensureSpawnCwd(spawnCwd);
    this.proc = spawn(command, args, {
      cwd: spawnCwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: command.toLowerCase().endsWith("cmd.exe"),
    });
    this.stopping = false;

    const spawnFailed = new Promise<never>((_resolve, reject) => {
      this.proc?.once("error", (err: any) => {
        const missingWorkspace = Boolean(spawnCwd) && !existsSync(String(spawnCwd));
        const msg =
          err?.code === "ENOENT"
            ? missingWorkspace
              ? `Workspace directory does not exist: ${spawnCwd}`
              : `Executable not found: ${command}`
            : String(err?.message ?? err);
        reject(new Error(`codex app-server failed to start: ${msg}`));
      });
    });

    this.proc.on("exit", (code, signal) => {
      const error = new Error(`codex app-server exited (code=${code}, signal=${signal})`);
      this.rejectPending(error);
      this.onMessage?.({ kind: "local", method: "codex/exit", params: { code, signal, expected: this.stopping } });
      this.stopping = false;
    });

    this.proc.stderr?.on("data", (buf) => {
      const text = buf.toString("utf8");
      this.onMessage?.({ kind: "local", method: "codex/stderr", params: { text } });
    });

    if (!this.proc.stdout || !this.proc.stdin) throw new Error("failed to start codex app-server");

    this.rl = readline.createInterface({ input: this.proc.stdout, crlfDelay: Infinity });
    this.rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg: any;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        this.onMessage?.({ kind: "local", method: "codex/parseError", params: { line: trimmed } });
        return;
      }
      this.handleIncoming(msg);
    });

    await Promise.race([this.initializeHandshake(), spawnFailed]);
  }

  stop(): void {
    const proc = this.proc;
    if (!proc) return;
    const pid = proc.pid;
    this.stopping = true;
    this.rejectPending(new Error("codex app-server stopped"));
    try {
      this.rl?.close();
    } catch (error) {
      logger.warn("codex-server", "failed to close readline", error);
    }
    try {
      proc.stdin?.destroy();
    } catch (error) {
      logger.warn("codex-server", "failed to destroy stdin", error);
    }
    try {
      proc.stdout?.destroy();
    } catch (error) {
      logger.warn("codex-server", "failed to destroy stdout", error);
    }
    try {
      proc.stderr?.destroy();
    } catch (error) {
      logger.warn("codex-server", "failed to destroy stderr", error);
    }
    try {
      if (process.platform === "win32" && pid) {
        const killer = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
          stdio: "ignore",
          windowsHide: true,
        });
        killer.on("error", () => undefined);
        killer.unref();
      } else {
        proc.kill();
      }
    } catch (error) {
      logger.warn("codex-server", "primary kill failed, retrying", error);
      try {
        proc.kill();
      } catch (retryError) {
        logger.warn("codex-server", "retry kill also failed", retryError);
      }
    }
    try {
      proc.unref();
    } catch (error) {
      logger.warn("codex-server", "failed to unref process", error);
    }
    this.proc = undefined;
    this.rl = undefined;
  }

  async request<M extends CodexRpcMethod>(
    method: M,
    params?: CodexRpcParams<M>,
    timeoutMs = 120_000
  ): Promise<CodexRpcResult<M>> {
    if (!isValidMethod(method)) throw new Error("invalid json-rpc method");
    if (isStandaloneCodexAppsMethod(method)) {
      throw new Error(standaloneCodexAppsError(method).message);
    }
    if (!isValidParams(params)) throw new Error(`invalid json-rpc params for method: ${method}`);
    const id: JsonRpcId = this.nextId++;
    const req: JsonRpcRequest = { id, method: method.trim(), params };
    this.write(req);
    return await new Promise<CodexRpcResult<M>>((resolve, reject) => {
      const pending: Pending = {
        resolve: (value) => resolve(value as CodexRpcResult<M>),
        reject,
        timeout: setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`request timeout: ${method}`));
        }, timeoutMs),
      };
      this.pending.set(id, pending);
    });
  }

  notify<M extends string>(method: M, params?: CodexNotifyParams<M>): void {
    if (!isValidMethod(method)) throw new Error("invalid json-rpc method");
    if (isStandaloneCodexAppsMethod(method)) {
      throw new Error(standaloneCodexAppsError(method).message);
    }
    if (!isValidParams(params)) throw new Error(`invalid json-rpc params for method: ${method}`);
    const n: JsonRpcNotification = { method: method.trim(), params };
    this.write(n);
  }

  respond(id: JsonRpcId, result?: unknown, error?: unknown): void {
    if (!isJsonRpcId(id)) throw new Error("invalid json-rpc id");
    const res: JsonRpcResponse = { id };
    if (error !== undefined) res.error = error;
    else res.result = result;
    this.write(res);
  }

  private write(msg: JsonRpcMessage): void {
    if (!this.proc?.stdin) throw new Error("server not running");
    this.proc.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  private handleIncoming(msg: any) {
    if (typeof msg !== "object" || msg === null) {
      this.emitProtocolError("incoming message is not an object", msg);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(msg, "method")) {
      if (!isValidMethod(msg.method)) {
        this.emitProtocolError("invalid notification/request method", msg);
        return;
      }
      if (isStandaloneCodexAppsMethod(msg.method)) {
        if (Object.prototype.hasOwnProperty.call(msg, "id") && isJsonRpcId(msg.id)) {
          this.respond(msg.id, undefined, standaloneCodexAppsError(msg.method));
        }
        return;
      }
      if (!isValidParams(msg.params)) {
        this.emitProtocolError("invalid notification/request params", msg);
        return;
      }
      if (Object.prototype.hasOwnProperty.call(msg, "id") && !isJsonRpcId(msg.id)) {
        this.emitProtocolError("invalid request id", msg);
        return;
      }
      this.onMessage?.(
        (Object.prototype.hasOwnProperty.call(msg, "id")
          ? { kind: "request", ...msg }
          : { kind: "notification", ...msg }) as CodexIncomingMessage
      );
      return;
    }

    if (Object.prototype.hasOwnProperty.call(msg, "id")) {
      if (!isJsonRpcId(msg.id)) {
        this.emitProtocolError("invalid response id", msg);
        return;
      }
      const hasResult = Object.prototype.hasOwnProperty.call(msg, "result");
      const hasError = Object.prototype.hasOwnProperty.call(msg, "error");
      if (hasResult === hasError) {
        this.emitProtocolError("response must contain exactly one of result/error", msg);
        return;
      }
      const p = this.pending.get(msg.id);
      if (p) {
        clearTimeout(p.timeout);
        this.pending.delete(msg.id);
        if (hasError) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      } else {
        this.onMessage?.({ kind: "local", method: "codex/unmatchedResponse", params: msg });
      }
      return;
    }

    this.emitProtocolError("unknown json-rpc envelope", msg);
  }

  private emitProtocolError(reason: string, message: unknown) {
    this.onMessage?.({
      kind: "local",
      method: "codex/protocolError",
      params: {
        reason,
        message,
      },
    });
  }

  private rejectPending(error: Error): void {
    for (const [id, p] of this.pending.entries()) {
      clearTimeout(p.timeout);
      p.reject(error);
      this.pending.delete(id);
    }
  }

  private getSpawnCommand(): { command: string; args: string[]; spawnCwd?: string } {
    if (this.nativeCodex?.kind === "server") {
      return { command: this.nativeCodex.path, args: ["--listen", "stdio://"], spawnCwd: this.cwd };
    }
    if (this.nativeCodex?.kind === "cmd") {
      const cmdline = this.cmdlineInvoke(this.nativeCodex.path, ["app-server", "--listen", "stdio://"]);
      return { command: "cmd.exe", args: ["/d", "/s", "/c", cmdline], spawnCwd: this.cwd };
    }
    if (this.nativeCodex?.kind === "node") {
      return {
        command: this.nativeCodex.nodeExe,
        args: [this.nativeCodex.script, "app-server", "--listen", "stdio://"],
        spawnCwd: this.cwd,
      };
    }
    if (this.nativeCodex?.kind === "direct") {
      return { command: this.nativeCodex.path, args: ["app-server", "--listen", "stdio://"], spawnCwd: this.cwd };
    }
    return {
      command: "codex",
      args: ["app-server", "--listen", "stdio://"],
      spawnCwd: this.cwd,
    };
  }

  private ensureSpawnCwd(spawnCwd: string): void {
    const cwd = String(spawnCwd ?? "").trim();
    if (!cwd) return;
    if (!existsSync(cwd)) {
      throw new Error(`Workspace directory does not exist: ${cwd}`);
    }
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(cwd);
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : String(e);
      throw new Error(`Workspace directory is not accessible: ${cwd} (${msg})`);
    }
    if (!stats.isDirectory()) {
      throw new Error(`Workspace path is not a directory: ${cwd}`);
    }
  }

  private preflightNative(): void {
    if (this.serverPath) {
      if (!existsSync(this.serverPath)) {
        throw new Error(`Bundled Codex app-server was not found: ${this.serverPath}`);
      }
      this.nativeCodex = { kind: "server", path: this.serverPath };
      return;
    }

    const found = spawnSync("where.exe", ["codex"], { encoding: "utf8" });
    const paths = discoverExistingCodexPaths({
      explicitPath: this.codexPath,
      whereStdout: found.stdout,
      appData: process.env.APPDATA,
      exists: existsSync,
    });

    if (paths.length === 0) {
      throw new Error(
        "codex (native) was not detected. Install Node.js LTS (including npm), run: npm i -g @openai/codex, and make sure codex is available on PATH. Restart the terminal or this app if needed."
      );
    }

    const exe = paths.find((p) => p.toLowerCase().endsWith(".exe"));
    if (exe) {
      this.nativeCodex = { kind: "direct", path: exe };
      return;
    }

    const cmd = paths.find((p) => p.toLowerCase().endsWith(".cmd"));
    if (cmd) {
      const base = dirname(cmd);
      const nodeExe = join(base, "node.exe");
      const codexJs = join(base, "node_modules", "@openai", "codex", "bin", "codex.js");
      if (existsSync(nodeExe) && existsSync(codexJs)) {
        // 为避免 cmd.exe 转义/引号问题，直接以 node.exe 运行底层入口脚本。
        this.nativeCodex = { kind: "node", nodeExe, script: codexJs };
        return;
      }
      this.nativeCodex = { kind: "cmd", path: cmd };
      return;
    }

    const bat = paths.find((p) => p.toLowerCase().endsWith(".bat"));
    if (bat) {
      this.nativeCodex = { kind: "cmd", path: bat };
      return;
    }

    throw new Error(
      `codex was found, but no executable entry (.exe/.cmd/.bat) was found. where.exe codex returned:\n${paths.join("\n")}\n\n` +
        `Confirm that you can run this directly in PowerShell: codex --version`
    );
  }

  private cmdlineInvoke(toolPath: string, args: string[]): string {
    // cmd.exe 引号/转义规则：使用 `cmd /d /s /c ""C:\path\tool.cmd" arg1 arg2"` 形式最稳妥。
    const joined = args.join(" ");
    return `""${toolPath}"${joined ? " " : ""}${joined}"`;
  }

  private async initializeHandshake(): Promise<void> {
    const initializeParams = {
      clientInfo: {
        name: "codenexus-local-runtime",
        title: null,
        version:
          typeof app?.getVersion === "function" ? app.getVersion() : (process.env.npm_package_version ?? "0.0.0"),
      },
      capabilities: this.experimentalApiOptIn ? { experimentalApi: true, requestAttestation: false } : null,
    };
    const result = await this.request("initialize", initializeParams);
    // 备注：Codex app-server 的 initialize result 往往只返回 userAgent，不会回显 capabilities。
    // 只要我们在 initialize params 中显式 opt-in，后续就应该按“已启用 experimentalApi”处理。
    this.experimentalApiEnabled = this.experimentalApiOptIn || this.detectExperimentalApiCapability(result);
    this.notify("initialized");
  }

  private detectExperimentalApiCapability(result: unknown): boolean {
    const fromRoot = this.readExperimentalApiFlag(result);
    if (typeof fromRoot === "boolean") return fromRoot;

    const capabilities =
      result && typeof result === "object" ? (result as Record<string, unknown>).capabilities : undefined;
    const fromCapabilities = this.readExperimentalApiFlag(capabilities);
    if (typeof fromCapabilities === "boolean") return fromCapabilities;

    return false;
  }

  private readExperimentalApiFlag(value: unknown): boolean | undefined {
    if (!value || typeof value !== "object") return undefined;
    const obj = value as Record<string, unknown>;
    const direct = obj.experimentalApi;
    if (typeof direct === "boolean") return direct;
    if (typeof direct === "string") {
      const normalized = direct.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }

    return undefined;
  }
}
