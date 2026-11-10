import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { discoverExistingCodexPaths } from "./codexNativeDiscovery";

export type CodexLoginStatus = {
  status: "authenticated" | "signed_out" | "unknown";
  details?: string;
};

export type CodexCommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
};

export type CodexCommandRunner = (path: string, args: string[]) => CodexCommandResult;

function runCodexCommand(path: string, args: string[]): CodexCommandResult {
  const isScript = /\.(?:cmd|bat)$/i.test(path);
  const command = isScript ? "cmd.exe" : path;
  const commandArgs = isScript ? ["/d", "/s", "/c", `""${path}" ${args.join(" ")}"`] : args;
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  return {
    status: typeof result.status === "number" ? result.status : null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.message,
  };
}

export function detectCodexNative(explicitPath?: string): {
  ok: boolean;
  details?: string;
  resolvedPath?: string;
} {
  // 在 Windows 环境通过 where.exe 检查 codex 是否已加入 PATH。
  const res = spawnSync("where.exe", ["codex"], { encoding: "utf8" });
  const paths = discoverExistingCodexPaths({
    explicitPath,
    whereStdout: res.stdout,
    appData: process.env.APPDATA,
    exists: existsSync,
  });
  if (paths.length > 0) {
    return { ok: true, details: paths.join("\n"), resolvedPath: paths[0] };
  }

  return { ok: false, details: (res.stderr || res.stdout || "").trim() };
}

export function checkCodexLoginStatus(path: string, runner: CodexCommandRunner = runCodexCommand): CodexLoginStatus {
  const result = runner(path, ["login", "status"]);
  if (result.status === 0) {
    return { status: "authenticated", details: "Codex CLI login is active." };
  }
  if (result.status !== null && !result.error) {
    return {
      status: "signed_out",
      details: "Codex CLI login is not active. Run codex login.",
    };
  }
  return {
    status: "unknown",
    details: "Unable to determine Codex CLI login status.",
  };
}

export function detectNpmNative(): { ok: boolean; details?: string } {
  // npm 通常随 Node.js 安装提供。
  const res = spawnSync("where.exe", ["npm"], { encoding: "utf8" });
  if (res.status === 0) return { ok: true, details: res.stdout.trim() };
  return { ok: false, details: (res.stderr || res.stdout || "").trim() };
}

export function detectNodeNative(): { ok: boolean; details?: string } {
  const res = spawnSync("where.exe", ["node"], { encoding: "utf8" });
  if (res.status === 0) return { ok: true, details: res.stdout.trim() };
  return { ok: false, details: (res.stderr || res.stdout || "").trim() };
}
