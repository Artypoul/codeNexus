import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const projectRoot = resolve(scriptDir, "../../..");
const sourceRoot = join(projectRoot, "vendor", "openai-codex", "codex-rs");
const cargoTargetDir = process.env.CODENEXUS_CARGO_TARGET_DIR ?? "D:\\t";
const cargoHome = process.env.CODENEXUS_CARGO_HOME ?? "D:\\c";
const runtimeDir = process.env.CODENEXUS_NATIVE_RUNTIME_DIR ?? "D:\\Development\\CodeNexus\\native-runtime";
const builtBinary = join(cargoTargetDir, "release", "codex-app-server.exe");
const stagedBinary = join(runtimeDir, "codex-app-server.exe");

export function buildNativeRuntime({ force = true } = {}) {
  if (!force && existsSync(stagedBinary)) return stagedBinary;

  if (!existsSync(join(sourceRoot, "Cargo.toml"))) {
    throw new Error(`Vendored Codex source is missing: ${sourceRoot}`);
  }

  const result = spawnSync(
    "cargo",
    ["build", "--manifest-path", join(sourceRoot, "Cargo.toml"), "-p", "codex-app-server", "--release"],
    {
      cwd: projectRoot,
      stdio: "inherit",
      shell: false,
      env: {
        ...process.env,
        CARGO_HOME: cargoHome,
        CARGO_TARGET_DIR: cargoTargetDir,
        CARGO_NET_GIT_FETCH_WITH_CLI: "true",
      },
    }
  );

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (!existsSync(builtBinary)) {
    throw new Error(`Cargo completed without producing ${builtBinary}`);
  }

  mkdirSync(runtimeDir, { recursive: true });
  copyFileSync(builtBinary, stagedBinary);
  return stagedBinary;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  buildNativeRuntime({ force: true });
  console.log(`Staged Codex app-server at ${stagedBinary}`);
}
