import { spawn, spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { watch as fsWatch } from "node:fs";
import net from "node:net";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const nodeExec = process.execPath;
const npmExecPath = process.env.npm_execpath ? String(process.env.npm_execpath).trim() : "";

const viteHost = "127.0.0.1";
const defaultVitePort = 5173;
const smokeMode = process.argv.includes("--smoke");

const children = [];
let shuttingDown = false;
// 主进程不会随 esbuild 重建自动加载新代码，这里手动监听 dist 重建并重启 electron。
let electronChild = null;
let electronRestartTimer = null;
let restartingElectron = false;

function spawnPnpm(args, options = {}) {
  const name = options.name ?? args.join(" ");
  const child = spawnByPlatform(args, options);

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const suffix = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`[dev] ${name} exited with ${suffix}`);
    void shutdown(1, `${name} exited`);
  });

  child.on("error", (error) => {
    if (shuttingDown) return;
    console.error(`[dev] ${name} failed to start: ${error.message}`);
    void shutdown(1, `${name} failed to start`);
  });

  children.push(child);
  return child;
}

function spawnByPlatform(args, options = {}) {
  const env = { ...process.env, ...(options.env ?? {}) };
  const packageManagerArgs = withExecSeparator(args);

  if (npmExecPath) {
    return spawn(nodeExec, [npmExecPath, ...packageManagerArgs], {
      cwd: projectRoot,
      stdio: "inherit",
      env,
      shell: false,
    });
  }

  if (process.platform === "win32") {
    return spawn("cmd.exe", ["/d", "/s", "/c", buildPnpmCommand(packageManagerArgs)], {
      cwd: projectRoot,
      stdio: "inherit",
      env,
      shell: false,
      windowsHide: true,
    });
  }

  return spawn("pnpm", packageManagerArgs, {
    cwd: projectRoot,
    stdio: "inherit",
    env,
    shell: false,
  });
}

function withExecSeparator(args) {
  if (args[0] !== "exec" || args[1] === "--") return args;
  return ["exec", "--", ...args.slice(1)];
}

function buildPnpmCommand(args) {
  return `pnpm ${args.map((arg) => quoteCmdArg(arg)).join(" ")}`;
}

function quoteCmdArg(arg) {
  const text = String(arg ?? "");
  if (!text) return '""';
  if (!/[\s"]/u.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function killChildTree(child) {
  if (!child || child.killed) return;
  if (process.platform === "win32") {
    const pid = Number(child.pid);
    if (!Number.isFinite(pid) || pid <= 0) return;
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
}

async function waitForFile(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      /* ignore */
    }
    await delay(200);
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function waitForHttpReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok || response.status >= 400) return;
    } catch {
      /* ignore */
    }
    await delay(300);
  }
  throw new Error(`timed out waiting for dev server: ${url}`);
}

function canListenOnPort(host, port) {
  return new Promise((resolvePort) => {
    const server = net.createServer();
    server.once("error", () => resolvePort(false));
    server.once("listening", () => {
      server.close(() => resolvePort(true));
    });
    server.listen({ host, port });
  });
}

async function findAvailablePort(host, preferredPort) {
  const basePort = Number.parseInt(String(process.env.VITE_DEV_SERVER_PORT ?? preferredPort), 10);
  const startPort = Number.isFinite(basePort) && basePort > 0 ? basePort : preferredPort;
  for (let port = startPort; port < startPort + 100; port += 1) {
    if (await canListenOnPort(host, port)) return String(port);
  }
  throw new Error(`no available dev server port found from ${startPort} to ${startPort + 99}`);
}

async function waitForBootstrap(viteUrl) {
  await Promise.all([
    waitForFile(resolve(projectRoot, "dist/main.cjs"), 30_000),
    waitForFile(resolve(projectRoot, "dist/preload.cjs"), 30_000),
    waitForHttpReady(viteUrl, 45_000),
  ]);
}

async function shutdown(exitCode = 0, reason = "unknown") {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[dev] shutting down (exitCode=${exitCode}, reason=${reason})`);

  for (const child of children) {
    killChildTree(child);
  }

  await delay(250);

  for (const child of children) {
    killChildTree(child);
  }

  process.exit(exitCode);
}

function bindShutdownSignals() {
  const handler = (signal) => {
    void shutdown(0, `signal:${signal}`);
  };
  process.on("SIGINT", () => handler("SIGINT"));
  process.on("SIGTERM", () => handler("SIGTERM"));
  process.on("SIGHUP", () => handler("SIGHUP"));

  process.on("uncaughtException", (error) => {
    console.error("[dev] uncaught exception", error);
    void shutdown(1, "uncaughtException");
  });

  process.on("unhandledRejection", (reason) => {
    console.error("[dev] unhandled rejection", reason);
    void shutdown(1, "unhandledRejection");
  });
}

function launchElectron(viteUrl) {
  const child = spawnByPlatform(["exec", "electron", "."], {
    env: { VITE_DEV_SERVER_URL: viteUrl },
  });
  electronChild = child;
  children.push(child);

  child.on("exit", (code, signal) => {
    if (shuttingDown || restartingElectron) return;
    const suffix = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`[dev] electron exited with ${suffix}`);
    void shutdown(typeof code === "number" ? code : 0, "electron exited");
  });

  child.on("error", (error) => {
    if (shuttingDown) return;
    console.error(`[dev] electron failed to start: ${error.message}`);
    void shutdown(1, "electron failed to start");
  });

  return child;
}

// 主进程 bundle 重建后重启 electron（debounce：esbuild 会分别写 main.cjs / preload.cjs）。
function scheduleElectronRestart(viteUrl) {
  if (shuttingDown) return;
  if (electronRestartTimer) clearTimeout(electronRestartTimer);
  electronRestartTimer = setTimeout(() => {
    electronRestartTimer = null;
    if (shuttingDown) return;
    const previous = electronChild;
    if (!previous) {
      launchElectron(viteUrl);
      return;
    }
    console.info("[dev] main/preload rebuilt — restarting electron...");
    restartingElectron = true;
    const index = children.indexOf(previous);
    if (index >= 0) children.splice(index, 1);
    previous.once("exit", () => {
      restartingElectron = false;
      if (shuttingDown) return;
      launchElectron(viteUrl);
    });
    killChildTree(previous);
  }, 400);
}

function watchMainBundleForElectronRestart(viteUrl) {
  const distDir = resolve(projectRoot, "dist");
  try {
    fsWatch(distDir, { persistent: false }, (_event, filename) => {
      const name = String(filename ?? "");
      if (name === "main.cjs" || name === "preload.cjs") scheduleElectronRestart(viteUrl);
    });
  } catch (error) {
    console.warn(`[dev] could not watch dist for electron auto-restart: ${error.message}`);
  }
}

async function start() {
  bindShutdownSignals();
  const vitePort = await findAvailablePort(viteHost, defaultVitePort);
  const viteUrl = `http://${viteHost}:${vitePort}`;
  console.info(`[dev] starting vite + esbuild watchers${smokeMode ? " (smoke)" : ""} on ${viteUrl}...`);

  spawnPnpm(["--filter", "@t3tools/web", "dev", "--", "--host", viteHost, "--port", vitePort, "--strictPort"], {
    name: "t3-vite",
  });

  spawnPnpm(
    [
      "exec",
      "esbuild",
      "src/t3/entry.ts",
      "--bundle",
      "--platform=browser",
      "--format=iife",
      "--target=chrome140",
      "--outfile=../t3-web/public/codenexus-adapter.js",
      "--sourcemap",
      "--watch=forever",
    ],
    { name: "t3-adapter-esbuild" }
  );

  spawnPnpm(
    [
      "exec",
      "esbuild",
      "src/main/main.ts",
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--target=node20",
      "--external:electron",
      "--outfile=dist/main.cjs",
      "--sourcemap",
      "--watch=forever",
    ],
    { name: "main-esbuild" }
  );

  spawnPnpm(
    [
      "exec",
      "esbuild",
      "src/preload/preload.ts",
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--target=node20",
      "--external:electron",
      "--outfile=dist/preload.cjs",
      "--sourcemap",
      "--watch=forever",
    ],
    { name: "preload-esbuild" }
  );

  await waitForBootstrap(viteUrl);
  console.info(`[dev] bootstrap ready: ${viteUrl}`);

  if (smokeMode) {
    console.info("[dev] smoke check passed");
    await shutdown(0, "smokeMode");
    return;
  }

  launchElectron(viteUrl);
  watchMainBundleForElectronRestart(viteUrl);
  console.info("[dev] electron launched (auto-restarts on main/preload rebuild)");
}

void start().catch((error) => {
  console.error(`[dev] startup failed: ${error.message}`);
  void shutdown(1, "startup failed");
});
