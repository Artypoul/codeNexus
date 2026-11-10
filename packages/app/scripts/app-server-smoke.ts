import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import * as readline from "node:readline";
import { discoverExistingCodexPaths } from "../src/main/codexNativeDiscovery";
import {
  buildSmokeApprovalResponse,
  buildSmokeInitializeParams,
  parseSmokeJsonLine,
  type SmokeJsonObject,
} from "../src/main/appServerSmokeProtocol";

const HANDSHAKE_TIMEOUT_MS = 10_000;
const LIVE_TIMEOUT_MS = 120_000;

function resolveCodexPath(): { path: string; direct: boolean } {
  const bundledPath = String(process.env.CODEX_APP_SERVER_BIN ?? "").trim();
  if (bundledPath) {
    if (!existsSync(bundledPath)) throw new Error(`bundled Codex app-server was not found: ${bundledPath}`);
    return { path: bundledPath, direct: true };
  }
  const explicitPath = String(process.env.CODEX_BIN ?? process.env.CODEX_PATH ?? "").trim();
  const where = spawnSync("where.exe", ["codex"], { encoding: "utf8", windowsHide: true });
  const paths = discoverExistingCodexPaths({
    explicitPath,
    whereStdout: where.stdout,
    appData: process.env.APPDATA,
    exists: existsSync,
  });
  const path = paths[0];
  if (!path) {
    throw new Error("codex executable was not found. Set CODEX_BIN or CODEX_PATH, or install @openai/codex globally.");
  }
  return { path, direct: false };
}

function buildSpawnCommand(path: string, direct: boolean): { command: string; args: string[] } {
  const args = direct ? ["--listen", "stdio://"] : ["app-server", "--listen", "stdio://"];
  if (/\.(?:cmd|bat)$/i.test(path)) {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", `""${path}" ${args.join(" ")}"`] };
  }
  return { command: path, args };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

class SmokeClient {
  private readonly pending = new Map<
    number,
    { resolve: (value: SmokeJsonObject) => void; reject: (error: Error) => void }
  >();
  private readonly reader: readline.Interface;
  private requestHandler?: (message: SmokeJsonObject) => void;

  constructor(private readonly process: ChildProcessWithoutNullStreams) {
    this.reader = readline.createInterface({ input: process.stdout, crlfDelay: Infinity });
    this.reader.on("line", (line) => {
      let message: SmokeJsonObject | null;
      try {
        message = parseSmokeJsonLine(line);
      } catch (error) {
        this.rejectAll(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (!message) return;
      if (typeof message.method === "string" && Object.prototype.hasOwnProperty.call(message, "id")) {
        this.requestHandler?.(message);
        return;
      }
      if (typeof message.id !== "number") return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      pending.resolve(message);
    });
    process.once("exit", (code, signal) => {
      this.rejectAll(new Error(`codex app-server exited (code=${code}, signal=${signal})`));
    });
  }

  send(message: SmokeJsonObject): void {
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  onRequest(handler: (message: SmokeJsonObject) => void): void {
    this.requestHandler = handler;
  }

  waitForResponse(id: number, timeoutMs: number): Promise<SmokeJsonObject> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for app-server response id=${id}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (message) => {
          clearTimeout(timeout);
          resolve(message);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
  }

  async waitForNotification(method: string, timeoutMs: number): Promise<SmokeJsonObject> {
    return await new Promise((resolve, reject) => {
      const onLine = (line: string) => {
        try {
          const message = parseSmokeJsonLine(line);
          if (message?.method === method) {
            cleanup();
            resolve(message);
          }
        } catch (error) {
          cleanup();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`timeout waiting for app-server notification ${method}`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timeout);
        this.reader.removeListener("line", onLine);
      };
      this.reader.on("line", onLine);
    });
  }

  close(): void {
    this.reader.close();
    const pid = this.process.pid;
    if (process.platform === "win32" && pid) {
      spawnSync("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      return;
    }
    this.process.kill();
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

async function run(): Promise<void> {
  const resolved = resolveCodexPath();
  const path = resolved.path;
  const invocation = buildSpawnCommand(path, resolved.direct);
  const approvalSmoke = process.env.CODEX_SMOKE_APPROVAL === "1";
  const approvalDecision = process.env.CODEX_SMOKE_APPROVAL_DECISION === "decline" ? "decline" : "accept";
  const workspace = String(process.env.CODEX_WORKSPACE ?? process.cwd()).trim() || process.cwd();
  let approvalResponses = 0;
  let approvalAccepted = 0;
  let approvalDeclined = 0;
  const child = spawn(invocation.command, invocation.args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const client = new SmokeClient(child);
  client.onRequest((message) => {
    const response = buildSmokeApprovalResponse(message, approvalDecision);
    if (!response) return;
    approvalResponses += 1;
    if (approvalDecision === "accept") approvalAccepted += 1;
    else approvalDeclined += 1;
    client.send(response);
  });
  child.stderr.on("data", (chunk) => {
    const text = readString(chunk).trim();
    if (text) process.stderr.write(`[codex-stderr] ${text}\n`);
  });

  try {
    client.send({ id: 1, method: "initialize", params: buildSmokeInitializeParams("0.1.0") });
    const initialize = await client.waitForResponse(1, HANDSHAKE_TIMEOUT_MS);
    if (initialize.error) throw new Error("app-server initialize returned an error");
    client.send({ method: "initialized" });

    if (process.argv.includes("--handshake-only") || process.env.CODEX_SMOKE_LIVE !== "1") {
      process.stdout.write(`${JSON.stringify({ ok: true, mode: "handshake", path })}\n`);
      return;
    }

    client.send({
      id: 2,
      method: "thread/start",
      params: {
        cwd: workspace,
        approvalPolicy: approvalSmoke ? "untrusted" : "never",
        sandbox: approvalSmoke ? "workspace-write" : "read-only",
        ephemeral: true,
      },
    });
    const threadStart = await client.waitForResponse(2, HANDSHAKE_TIMEOUT_MS);
    const threadId = String(
      ((threadStart.result as SmokeJsonObject | undefined)?.thread &&
        ((threadStart.result as SmokeJsonObject).thread as SmokeJsonObject).id) ??
        ""
    ).trim();
    if (!threadId) throw new Error("thread/start did not return a thread id");

    client.send({
      id: 3,
      method: "turn/start",
      params: {
        threadId,
        input: [
          {
            type: "text",
            text: approvalSmoke
              ? "Use the terminal tool to run a harmless command that prints approval-smoke, then reply with a short confirmation."
              : "Reply with a short confirmation.",
            text_elements: [],
          },
        ],
      },
    });
    const turnStart = await client.waitForResponse(3, HANDSHAKE_TIMEOUT_MS);
    if (turnStart.error) throw new Error("turn/start returned an error");
    await client.waitForNotification("turn/completed", LIVE_TIMEOUT_MS);
    if (approvalSmoke && approvalResponses === 0) {
      throw new Error("approval smoke did not receive an app-server approval request");
    }
    process.stdout.write(
      `${JSON.stringify({ ok: true, mode: "live", path, threadId, approvalSmoke, approvalDecision, approvalResponses, approvalAccepted, approvalDeclined })}\n`
    );
  } finally {
    client.close();
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
