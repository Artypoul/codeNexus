import { describe, expect, it } from "vitest";
import { DEFAULT_USER_LOCAL_SETTINGS } from "@codenexus/shared/localSettings";
import type { CodexDiagnosticsResult } from "@codenexus/shared/ipc/contracts";
import { buildEnvDiagnosticsViewModel } from "./envDiagnostics";

function diagnostics(overrides: Partial<CodexDiagnosticsResult> = {}): CodexDiagnosticsResult {
  return {
    codex: { ok: true },
    node: { ok: true },
    npm: { ok: true },
    resolvedPath: "C:\\Tools\\codex.exe",
    login: { status: "authenticated" },
    ...overrides,
  };
}

describe("buildEnvDiagnosticsViewModel", () => {
  it("returns a startable model for an authenticated installation", () => {
    const view = buildEnvDiagnosticsViewModel(diagnostics(), DEFAULT_USER_LOCAL_SETTINGS);

    expect(view).toEqual({
      pathInput: "",
      resolvedPath: "C:\\Tools\\codex.exe",
      loginStatus: "authenticated",
      status: "ready",
      canStart: true,
    });
  });

  it("keeps signed-out and unknown login states unavailable", () => {
    const signedOut = buildEnvDiagnosticsViewModel(
      diagnostics({ login: { status: "signed_out" } }),
      DEFAULT_USER_LOCAL_SETTINGS
    );
    const unknown = buildEnvDiagnosticsViewModel(
      diagnostics({ login: { status: "unknown" } }),
      DEFAULT_USER_LOCAL_SETTINGS
    );

    expect(signedOut.status).toBe("not_ready");
    expect(signedOut.canStart).toBe(false);
    expect(unknown.status).toBe("unknown");
    expect(unknown.canStart).toBe(false);
  });

  it("uses the saved path and reports a missing installation", () => {
    const settings = {
      ...DEFAULT_USER_LOCAL_SETTINGS,
      codex: { executablePath: "C:\\Custom\\codex.cmd" },
    };
    const view = buildEnvDiagnosticsViewModel(
      diagnostics({
        codex: { ok: false },
        resolvedPath: null,
        login: { status: "unknown" },
      }),
      settings
    );

    expect(view.pathInput).toBe("C:\\Custom\\codex.cmd");
    expect(view.resolvedPath).toBeNull();
    expect(view.status).toBe("not_ready");
    expect(view.canStart).toBe(false);
  });
});
