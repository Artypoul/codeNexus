export type SmokeJsonObject = Record<string, unknown>;

export function buildSmokeInitializeParams(version: string): SmokeJsonObject {
  return {
    clientInfo: {
      name: "codenexus-local-runtime-smoke",
      title: null,
      version: String(version ?? "").trim() || "0.1.0",
    },
    capabilities: null,
  };
}

export function parseSmokeJsonLine(line: string): SmokeJsonObject | null {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    throw new Error("invalid JSONL from codex app-server");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("codex app-server JSONL object expected");
  }
  return value as SmokeJsonObject;
}

export function buildSmokeApprovalResponse(
  message: SmokeJsonObject,
  decision: "accept" | "decline"
): SmokeJsonObject | null {
  const id = message.id;
  const method = String(message.method ?? "").trim();
  if ((typeof id !== "string" && typeof id !== "number") || !method) return null;
  if (
    method !== "item/fileChange/requestApproval" &&
    method !== "item/commandExecution/requestApproval" &&
    method !== "item/permissions/requestApproval"
  ) {
    return null;
  }
  if (method === "item/permissions/requestApproval") {
    const params = message.params && typeof message.params === "object" ? (message.params as SmokeJsonObject) : {};
    return decision === "accept"
      ? { id, result: { permissions: params.permissions ?? {}, scope: "turn" } }
      : { id, error: { code: 4001, message: "approval smoke decline" } };
  }
  return { id, result: { decision } };
}
