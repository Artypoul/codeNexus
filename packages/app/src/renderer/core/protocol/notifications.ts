import { isServerNotificationMethod, type ServerNotificationMethod } from "../../app/events/protocolMethods";
import type { OfficialCodexServerNotification } from "@codenexus/shared/codex-protocol";

const IGNORED_DEPRECATED_SERVER_NOTIFICATION_METHODS = new Set<string>(["item/fileChange/outputDelta"]);

type SupportedOfficialServerNotification = Extract<
  OfficialCodexServerNotification,
  { method: ServerNotificationMethod }
>;

type OfficialNormalizedNotification = SupportedOfficialServerNotification & {
  threadId?: string;
  turnId?: string;
  itemId?: string;
  serverId?: string;
};

export type NormalizedNotification = OfficialNormalizedNotification;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickId(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    if (text) return text;
  }
  return undefined;
}

function extractIdsFromRecord(record: Record<string, unknown>) {
  const thread = toRecord(record.thread);
  const turn = toRecord(record.turn);
  const item = toRecord(record.item);

  return {
    threadId: pickId(record.threadId, thread?.id, turn?.threadId, item?.threadId),
    turnId: pickId(record.turnId, turn?.id, item?.turnId),
    itemId: pickId(record.itemId, item?.id),
  };
}

function normalizeServerId(serverId: string | undefined): string | undefined {
  return normalizeText(serverId) || undefined;
}

function normalizeOfficialNotification(
  method: ServerNotificationMethod,
  paramsRecord: Record<string, unknown>,
  serverId?: string
): OfficialNormalizedNotification {
  const notification = {
    method,
    params: paramsRecord,
  } as SupportedOfficialServerNotification;
  const ids = extractIdsFromRecord(paramsRecord);
  return {
    ...notification,
    ...ids,
    serverId: normalizeServerId(serverId),
  };
}

export function normalizeNotification(
  payload: { method?: unknown; params?: unknown } | null | undefined,
  serverId?: string
): NormalizedNotification | null {
  if (!payload || typeof payload !== "object") return null;

  const methodRaw = payload.method;
  if (typeof methodRaw !== "string") {
    console.warn("[eventBridge] ignore non-string notification method", payload);
    return null;
  }

  const method = methodRaw.trim();
  if (!method) return null;
  if (IGNORED_DEPRECATED_SERVER_NOTIFICATION_METHODS.has(method)) return null;

  const paramsRaw = payload.params;
  const paramsRecord = toRecord(paramsRaw);
  if (!isServerNotificationMethod(method)) {
    console.warn("[eventBridge] ignore non-official notification method", methodRaw);
    return null;
  }

  if (!paramsRecord) {
    console.warn("[eventBridge] ignore notification with invalid params shape", { method, params: paramsRaw });
    return null;
  }

  return normalizeOfficialNotification(method, paramsRecord, serverId);
}
