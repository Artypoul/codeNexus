import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stageT3Client } from "./stage-t3-client.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const nodeExec = process.execPath;
const npmExecPath = process.env.npm_execpath;
const pnpmFallback = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function runPnpm(args) {
  const options = {
    cwd: projectRoot,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  };
  const packageManagerArgs = withExecSeparator(args);

  if (npmExecPath) {
    execFileSync(nodeExec, [npmExecPath, ...packageManagerArgs], options);
    return;
  }

  execFileSync(pnpmFallback, packageManagerArgs, options);
}

function withExecSeparator(args) {
  if (args[0] !== "exec" || args[1] === "--") return args;
  return ["exec", "--", ...args.slice(1)];
}

if (!process.env.T3_CODE_CLIENT_DIR) runPnpm(["exec", "vite", "build"]);

if (await stageT3Client()) {
  runPnpm([
    "exec",
    "esbuild",
    "src/t3/entry.ts",
    "--bundle",
    "--platform=browser",
    "--format=iife",
    "--target=chrome140",
    "--outfile=dist/t3-client/codenexus-adapter.js",
  ]);
}

runPnpm([
  "exec",
  "esbuild",
  "src/main/main.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--target=node20",
  "--external:electron",
  "--outfile=dist/main.cjs",
]);

runPnpm([
  "exec",
  "esbuild",
  "src/preload/preload.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--target=node20",
  "--external:electron",
  "--outfile=dist/preload.cjs",
]);
