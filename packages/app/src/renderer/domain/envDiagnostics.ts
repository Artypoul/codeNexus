import type { CodexDiagnosticsResult } from "@codenexus/shared/ipc/contracts";
import type { UserLocalSettings } from "@codenexus/shared/localSettings";

export type EnvDiagnosticsViewModel = {
  pathInput: string;
  resolvedPath: string | null;
  loginStatus: "authenticated" | "signed_out" | "unknown";
  status: "ready" | "not_ready" | "unknown";
  canStart: boolean;
};

export function buildEnvDiagnosticsViewModel(
  result: CodexDiagnosticsResult,
  settings: UserLocalSettings
): EnvDiagnosticsViewModel {
  const loginStatus = result.login?.status ?? "unknown";
  const dependenciesReady = Boolean(result.codex?.ok && result.node?.ok && result.npm?.ok);
  const canStart = dependenciesReady && loginStatus === "authenticated";

  return {
    pathInput: settings.codex.executablePath ?? "",
    resolvedPath: result.resolvedPath ?? null,
    loginStatus,
    status: !dependenciesReady
      ? "not_ready"
      : loginStatus === "authenticated"
        ? "ready"
        : loginStatus === "unknown"
          ? "unknown"
          : "not_ready",
    canStart,
  };
}
