import { join } from "node:path";

export type FileExists = (path: string) => boolean;

function normalizePathLine(value: unknown): string {
  return String(value ?? "").trim();
}

function pushUnique(paths: string[], value: string): void {
  const path = normalizePathLine(value);
  if (!path) return;
  const key = path.toLowerCase();
  if (paths.some((existing) => existing.toLowerCase() === key)) return;
  paths.push(path);
}

function isCodexExecutablePath(value: string): boolean {
  return /\.(?:exe|cmd|bat)$/i.test(value);
}

export function splitWhereOutput(stdout: string): string[] {
  return String(stdout ?? "")
    .split(/\r?\n/)
    .map(normalizePathLine)
    .filter(Boolean);
}

export function npmCodexCmdPathFromAppData(appDataValue: unknown): string {
  const appData = normalizePathLine(appDataValue);
  return appData ? join(appData, "npm", "codex.cmd") : "";
}

export function resolveBundledCodexAppServerPath(args: {
  appIsPackaged: boolean;
  resourcesPath?: string;
  env?: Record<string, string | undefined>;
  devRuntimeDir?: string;
  exists: FileExists;
}): string | undefined {
  const env = args.env ?? {};
  const candidates = [
    normalizePathLine(env.CODENEXUS_NATIVE_APP_SERVER),
    args.appIsPackaged && args.resourcesPath ? join(args.resourcesPath, "codex-runtime", "codex-app-server.exe") : "",
    !args.appIsPackaged && args.devRuntimeDir ? join(args.devRuntimeDir, "codex-app-server.exe") : "",
  ];

  return candidates.find((candidate) => candidate && args.exists(candidate));
}

export function discoverExistingCodexPaths(args: {
  explicitPath?: string;
  whereStdout?: string;
  appData?: string;
  exists: FileExists;
}): string[] {
  const exists = args.exists;
  const paths: string[] = [];

  const explicitPath = normalizePathLine(args.explicitPath);
  if (explicitPath && isCodexExecutablePath(explicitPath) && exists(explicitPath)) {
    pushUnique(paths, explicitPath);
  }

  for (const candidate of splitWhereOutput(args.whereStdout ?? "")) {
    if (exists(candidate)) pushUnique(paths, candidate);
  }

  const appDataCandidate = npmCodexCmdPathFromAppData(args.appData);
  if (appDataCandidate && exists(appDataCandidate)) pushUnique(paths, appDataCandidate);

  return paths;
}
