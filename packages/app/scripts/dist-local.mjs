import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildNativeRuntime } from "./build-codex-app-server.mjs";
import { stageGigmaRuntime } from "./stage-gigma-runtime.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nodeExec = process.execPath;
const npmExecPath = String(process.env.npm_execpath ?? "").trim();
export const LOCAL_OUTPUT_DIR = "D:\\Development\\CodeNexus";

export function createLocalDistArgs() {
  return [
    "--config",
    "electron-builder.yml",
    "--config.directories.output",
    LOCAL_OUTPUT_DIR,
    "--config.win.signAndEditExecutable",
    "false",
    "--win",
    "--x64",
    "--publish",
    "never",
  ];
}

function runPnpm(args, env = {}) {
  const commandEnv = { ...process.env, ...env };
  const result = npmExecPath
    ? spawnSync(nodeExec, [npmExecPath, ...args], {
        cwd: projectRoot,
        stdio: "inherit",
        shell: false,
        env: commandEnv,
      })
    : process.platform === "win32"
      ? spawnSync("cmd.exe", ["/d", "/s", "/c", `pnpm ${args.join(" ")}`], {
          cwd: projectRoot,
          stdio: "inherit",
          shell: false,
          windowsHide: true,
          env: commandEnv,
        })
      : spawnSync("pnpm", args, { cwd: projectRoot, stdio: "inherit", shell: false, env: commandEnv });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function main() {
  buildNativeRuntime({ force: process.env.CODENEXUS_REBUILD_NATIVE === "1" });
  stageGigmaRuntime({ force: process.env.CODENEXUS_REBUILD_GIGMA === "1" });
  runPnpm(["run", "build"]);
  runPnpm(["exec", "electron-builder", ...createLocalDistArgs()], {
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
