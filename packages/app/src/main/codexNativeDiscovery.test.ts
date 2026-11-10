import { describe, expect, it } from "vitest";
import { discoverExistingCodexPaths, resolveBundledCodexAppServerPath } from "./codexNativeDiscovery";

describe("discoverExistingCodexPaths", () => {
  it("puts an existing explicit executable first", () => {
    const paths = discoverExistingCodexPaths({
      explicitPath: "C:\\Tools\\codex.exe",
      whereStdout: "C:\\Users\\Art\\AppData\\Roaming\\npm\\codex.cmd",
      appData: "C:\\Users\\Art\\AppData\\Roaming",
      exists: (path) => path.endsWith("codex.exe") || path.endsWith("codex.cmd"),
    });

    expect(paths).toEqual(["C:\\Tools\\codex.exe", "C:\\Users\\Art\\AppData\\Roaming\\npm\\codex.cmd"]);
  });

  it("falls back when the explicit path is missing", () => {
    const paths = discoverExistingCodexPaths({
      explicitPath: "C:\\Missing\\codex.cmd",
      whereStdout: "C:\\Tools\\codex.bat",
      appData: "C:\\Users\\Art\\AppData\\Roaming",
      exists: (path) => !path.includes("Missing") && (path.endsWith("codex.bat") || path.endsWith("codex.cmd")),
    });

    expect(paths).toEqual(["C:\\Tools\\codex.bat", "C:\\Users\\Art\\AppData\\Roaming\\npm\\codex.cmd"]);
  });
});

describe("resolveBundledCodexAppServerPath", () => {
  it("resolves the packaged resource without falling back to the CLI", () => {
    const path = resolveBundledCodexAppServerPath({
      appIsPackaged: true,
      resourcesPath: "C:\\Program Files\\CodeNexus\\resources",
      exists: (candidate) => candidate.endsWith("codex-runtime\\codex-app-server.exe"),
    });

    expect(path).toBe("C:\\Program Files\\CodeNexus\\resources\\codex-runtime\\codex-app-server.exe");
  });

  it("allows a development override for the staged native runtime", () => {
    const path = resolveBundledCodexAppServerPath({
      appIsPackaged: false,
      env: { CODENEXUS_NATIVE_APP_SERVER: "D:\\Development\\CodeNexus\\native-runtime\\codex-app-server.exe" },
      devRuntimeDir: "D:\\Development\\CodeNexus\\native-runtime",
      exists: (candidate) => candidate.includes("native-runtime"),
    });

    expect(path).toBe("D:\\Development\\CodeNexus\\native-runtime\\codex-app-server.exe");
  });
});
