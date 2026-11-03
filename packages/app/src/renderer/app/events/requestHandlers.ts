import type { CodexServerRequestMessage, CodexServerRespondArgs } from "@codenexus/shared/codex-protocol";
import { isServerRequestMethod, type ServerRequestMethod } from "./protocolMethods";

export type AppServerRequest = CodexServerRequestMessage & { method: ServerRequestMethod };

export type RequestKind = "approval" | "userInput" | "toolCall" | "authRefresh" | "currentTime" | "unknown";

export type RequestHandlingResult = {
  kind: RequestKind;
  isKnownMethod: boolean;
  requiresResponse: boolean;
};

export type JsonRpcErrorPayload = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcResponsePayload<M extends ServerRequestMethod = ServerRequestMethod> = CodexServerRespondArgs<M>;

const APPROVAL_METHODS = new Set<string>([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
]);

function isJsonRpcId(value: unknown): value is number | string {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return false;
}

function isRequestParams(value: unknown): boolean {
  if (value === undefined) return true;
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function isServerRequest(msg: unknown): msg is AppServerRequest {
  if (!msg || typeof msg !== "object") return false;
  const record = msg as Record<string, unknown>;
  if (record.kind !== "request") return false;
  const method = typeof record.method === "string" ? record.method.trim() : "";
  if (!method || !isServerRequestMethod(method)) return false;
  if (!isJsonRpcId(record.id)) return false;
  return isRequestParams(record.params);
}

export function getServerRequestThreadId(request: AppServerRequest): string {
  const params = toRecord(request.params);
  return String(params.threadId ?? "").trim();
}

export function getServerRequestTurnId(request: AppServerRequest): string {
  const params = toRecord(request.params);
  return String(params.turnId ?? "").trim();
}

export function getServerRequestItemId(request: AppServerRequest): string {
  const params = toRecord(request.params);
  return String(params.itemId ?? "").trim();
}

export function classifyServerRequest(method: ServerRequestMethod): RequestHandlingResult {
  if (APPROVAL_METHODS.has(method)) {
    return { kind: "approval", isKnownMethod: true, requiresResponse: true };
  }

  if (method === "item/tool/requestUserInput") {
    return { kind: "userInput", isKnownMethod: true, requiresResponse: true };
  }

  if (method === "mcpServer/elicitation/request") {
    return { kind: "userInput", isKnownMethod: true, requiresResponse: true };
  }

  if (method === "item/tool/call") {
    return { kind: "toolCall", isKnownMethod: true, requiresResponse: true };
  }

  if (method === "account/chatgptAuthTokens/refresh") {
    return { kind: "authRefresh", isKnownMethod: true, requiresResponse: true };
  }

  if (method === "currentTime/read") {
    return { kind: "currentTime", isKnownMethod: true, requiresResponse: true };
  }

  return { kind: "unknown", isKnownMethod: true, requiresResponse: true };
}

export function buildJsonRpcError(code: number, message: string, data?: unknown): JsonRpcErrorPayload {
  return {
    code,
    message,
    ...(data === undefined ? {} : { data }),
  };
}

export function buildRequestMethodNotImplementedError(method: string): JsonRpcErrorPayload {
  return buildJsonRpcError(-32601, `server request not implemented: ${method}`, { method });
}

export function buildAuthRefreshNotImplementedError(method: string): JsonRpcErrorPayload {
  return buildJsonRpcError(-32601, "account token refresh is not implemented; please login via account flow", {
    method,
  });
}

export function buildInvalidUserInputPayloadError(method: ServerRequestMethod): JsonRpcErrorPayload {
  if (method === "mcpServer/elicitation/request") {
    return buildJsonRpcError(-32602, "invalid mcp elicitation payload");
  }
  return buildJsonRpcError(-32602, "invalid request_user_input payload");
}

export function respondRequestError<M extends ServerRequestMethod>(
  serverId: string,
  id: number | string,
  method: M,
  error: JsonRpcErrorPayload
): JsonRpcResponsePayload<M> {
  return {
    serverId,
    id,
    method,
    error,
  };
}
