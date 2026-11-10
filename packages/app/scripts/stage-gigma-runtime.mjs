import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const sourceBinary =
  process.env.CODENEXUS_GIGMA_RUNTIME_SOURCE ??
  "D:\\GitHub\\gigma-cli\\apps\\kimi-code\\dist-native\\bin\\win32-x64\\gigma.exe";
const runtimeDir = process.env.CODENEXUS_NATIVE_RUNTIME_DIR ?? "D:\\Development\\CodeNexus\\native-runtime";
const stagedBinary = join(runtimeDir, "gigma.exe");

export function stageGigmaRuntime({ force = true } = {}) {
  if (!force && existsSync(stagedBinary)) return stagedBinary;
  if (!existsSync(sourceBinary)) {
    throw new Error(`Gigma CLI runtime binary is missing: ${sourceBinary}`);
  }
  if (statSync(sourceBinary).size < 1_000_000) {
    throw new Error(`Gigma CLI runtime binary is unexpectedly small: ${sourceBinary}`);
  }
  mkdirSync(runtimeDir, { recursive: true });
  copyFileSync(sourceBinary, stagedBinary);
  return stagedBinary;
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname.endsWith("stage-gigma-runtime.mjs")) {
  const path = stageGigmaRuntime({ force: true });
  console.log(`Staged Gigma CLI runtime at ${path}`);
}
