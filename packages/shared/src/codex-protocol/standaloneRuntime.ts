const CODEX_APP_METHOD_PREFIX = "app/";

/**
 * CodeNexus keeps the app-server transport local. Codex Apps/Connectors RPC is
 * intentionally outside that boundary and must never reach the renderer.
 */
export function isStandaloneCodexAppsMethod(method: string): boolean {
  return String(method ?? "")
    .trim()
    .startsWith(CODEX_APP_METHOD_PREFIX);
}

export function standaloneCodexAppsError(method: string) {
  const normalized = String(method ?? "").trim();
  return {
    code: -32001,
    message: `Codex Apps method is disabled in standalone local runtime: ${normalized}`,
    data: { method: normalized },
  };
}
