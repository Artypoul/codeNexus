import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { GigmaAuthClient } from "./GigmaAuthClient";

const STARTUP_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 250;
const DEFAULT_GIGMA_ARGS = ["web", "--no-open", "--debug-endpoints"];

export function resolveGigmaRuntimeCommand(args: {
  explicitCommand?: string;
  resourcesPath?: string;
  devRuntimeDir?: string;
  exists?: (path: string) => boolean;
}): { command?: string; bundled: boolean } {
  const explicitCommand = String(args.explicitCommand ?? "").trim();
  if (explicitCommand) return { command: explicitCommand, bundled: false };

  const exists = args.exists ?? existsSync;
  const candidates = [
    args.resourcesPath ? join(args.resourcesPath, "gigma-runtime", "gigma.exe") : "",
    args.devRuntimeDir ? join(args.devRuntimeDir, "gigma.exe") : "",
    "D:\\Development\\CodeNexus\\native-runtime\\gigma.exe",
  ];
  const command = candidates.find((candidate) => candidate && exists(candidate));
  return { command, bundled: Boolean(command) };
}

function readArgs(): string[] {
  const raw = String(process.env.GIGMA_KAP_SERVER_ARGS_JSON ?? "").trim();
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("GIGMA_KAP_SERVER_ARGS_JSON must be a JSON array.");
  }
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
    throw new Error("GIGMA_KAP_SERVER_ARGS_JSON must contain only strings.");
  }
  return parsed;
}

export class GigmaAuthProcessSupervisor {
  private process?: ChildProcess;

  constructor(private readonly auth: GigmaAuthClient) {}

  async ensure(): Promise<void> {
    const current = await this.auth.status();
    if (current.available) return;
    const resolved = resolveGigmaRuntimeCommand({
      explicitCommand: process.env.GIGMA_KAP_SERVER_COMMAND,
      resourcesPath: process.resourcesPath,
      devRuntimeDir: process.env.CODENEXUS_NATIVE_RUNTIME_DIR,
    });
    const command = resolved.command;
    if (!command) throw new Error(current.error ?? "Gigma CLI auth service is unavailable.");
    if ((command.includes("\\") || command.includes("/")) && !existsSync(command)) {
      throw new Error(`Configured Gigma auth server was not found: ${command}`);
    }
    if (!this.process || this.process.killed) {
      const configuredArgs = readArgs();
      const args = configuredArgs.length > 0 || !resolved.bundled ? configuredArgs : DEFAULT_GIGMA_ARGS;
      this.process = spawn(command, args, {
        cwd: process.env.GIGMA_KAP_SERVER_WORKDIR || undefined,
        windowsHide: true,
        stdio: "ignore",
      });
      this.process.once("exit", () => {
        this.process = undefined;
      });
    }
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if ((await this.auth.status()).available) return;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error("Gigma CLI auth service did not become available.");
  }

  stop(): void {
    const child = this.process;
    this.process = undefined;
    if (!child || child.killed) return;
    if (process.platform === "win32" && child.pid) {
      const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.unref();
      return;
    }
    child.kill();
  }
}
