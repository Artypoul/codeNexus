import type { HistoryThreadMetadataPatch } from "@codenexus/shared/ipc/contracts";
import type { GitInfo } from "@codenexus/generated/codex-app-server/v2/GitInfo";
import type { SessionSource } from "@codenexus/generated/codex-app-server/v2/SessionSource";
import type { Thread as ServerThread } from "@codenexus/generated/codex-app-server/v2/Thread";
import type { ThreadSourceKind } from "@codenexus/generated/codex-app-server/v2/ThreadSourceKind";
import type { ThreadHistoryItem } from "../../domain/types";

export const ALL_THREAD_SOURCE_KINDS: ThreadSourceKind[] = ["cli", "vscode", "exec", "appServer", "unknown"];

export type ThreadSourceDetails = {
  threadSourceKind: ThreadSourceKind | null;
  agentPath: string | null;
  agentNickname: string | null;
  agentRole: string | null;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

export function toEpochMs(value: unknown): number | null {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return raw >= 1_000_000_000_000 ? Math.round(raw) : Math.round(raw * 1000);
}

export function buildGitInfoSummary(gitInfo: GitInfo | null | undefined): string | null {
  if (!gitInfo) return null;
  const branch = normalizeOptionalText(gitInfo.branch);
  const sha = normalizeOptionalText(gitInfo.sha);
  const originUrl = normalizeOptionalText(gitInfo.originUrl);
  const shortSha = sha ? sha.slice(0, 8) : null;
  const parts = [branch, shortSha, originUrl].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function extractThreadSourceDetails(source: SessionSource | null | undefined): ThreadSourceDetails {
  if (!source) {
    return {
      threadSourceKind: null,
      agentPath: null,
      agentNickname: null,
      agentRole: null,
    };
  }

  if (typeof source === "string") {
    return {
      threadSourceKind: ALL_THREAD_SOURCE_KINDS.includes(source as ThreadSourceKind)
        ? (source as ThreadSourceKind)
        : "unknown",
      agentPath: null,
      agentNickname: null,
      agentRole: null,
    };
  }

  const sourceRecord = toRecord(source);
  if (!sourceRecord) {
    return {
      threadSourceKind: "unknown",
      agentPath: null,
      agentNickname: null,
      agentRole: null,
    };
  }

  if (Object.prototype.hasOwnProperty.call(sourceRecord, "custom")) {
    return {
      threadSourceKind: "unknown",
      agentPath: null,
      agentNickname: null,
      agentRole: null,
    };
  }

  return {
    threadSourceKind: "unknown",
    agentPath: null,
    agentNickname: null,
    agentRole: null,
  };
}

export function buildHistoryThreadMetadataPatchFromServerThread(
  thread: ServerThread
): HistoryThreadMetadataPatch | null {
  const id = normalizeOptionalText(thread.id);
  if (!id) return null;
  const sourceDetails = extractThreadSourceDetails(thread.source);
  return {
    id,
    threadSourceKind: sourceDetails.threadSourceKind,
    forkedFromId: normalizeOptionalText(thread.forkedFromId),
    agentNickname: normalizeOptionalText(thread.agentNickname) ?? sourceDetails.agentNickname,
    agentRole: normalizeOptionalText(thread.agentRole) ?? sourceDetails.agentRole,
    agentPath: sourceDetails.agentPath,
    gitInfoSummary: buildGitInfoSummary(thread.gitInfo),
    projectId: normalizeOptionalText(thread.projectId),
    sectionId: normalizeOptionalText(thread.section?.id),
    sectionName: normalizeOptionalText(thread.section?.name),
  };
}

export function buildThreadHistoryMetadataFromServerThread(
  thread: Pick<
    ServerThread,
    "source" | "forkedFromId" | "agentNickname" | "agentRole" | "gitInfo" | "projectId" | "section"
  >
): Pick<
  ThreadHistoryItem,
  | "threadSourceKind"
  | "forkedFromId"
  | "agentNickname"
  | "agentRole"
  | "agentPath"
  | "gitInfoSummary"
  | "projectId"
  | "sectionId"
  | "sectionName"
> {
  const sourceDetails = extractThreadSourceDetails(thread.source);
  return {
    threadSourceKind: sourceDetails.threadSourceKind ?? undefined,
    forkedFromId: normalizeOptionalText(thread.forkedFromId) ?? undefined,
    agentNickname: normalizeOptionalText(thread.agentNickname) ?? sourceDetails.agentNickname ?? undefined,
    agentRole: normalizeOptionalText(thread.agentRole) ?? sourceDetails.agentRole ?? undefined,
    agentPath: sourceDetails.agentPath ?? undefined,
    gitInfoSummary: buildGitInfoSummary(thread.gitInfo) ?? undefined,
    projectId: normalizeOptionalText(thread.projectId),
    sectionId: normalizeOptionalText(thread.section?.id),
    sectionName: normalizeOptionalText(thread.section?.name),
  };
}

export function resolveThreadParentIdForGraph(item: { forkedFromId?: string | null }): string {
  return normalizeOptionalText(item.forkedFromId) ?? "";
}
