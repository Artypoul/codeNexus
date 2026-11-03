import type { SandboxMode } from "@codenexus/generated/codex-app-server/v2/SandboxMode";

/**
 * 每个线程的本地输入草稿。
 *
 * 该状态用于刷新或切换线程后恢复输入框、模型和沙箱选项，不代表已经发送到 Codex 的消息。
 */
export type LocalDraftSandboxMode = SandboxMode;

export type LocalDraftComposeMode = "default" | "plan";

export type LocalThreadComposeState = {
  sandboxMode: LocalDraftSandboxMode;
  composeInput: string;
  composeMode: LocalDraftComposeMode;
  model: string;
  reasoningEffort: string;
  reasoningSummary: string;
};

export type LocalDraftState = {
  version: 1;
  updatedAt: number;
  threads: Record<string, LocalThreadComposeState>;
};

/** 单线程草稿默认值代表新会话输入框的初始 UI 状态。 */
export const DEFAULT_LOCAL_THREAD_COMPOSE_STATE: LocalThreadComposeState = {
  sandboxMode: "danger-full-access",
  composeInput: "",
  composeMode: "default",
  model: "",
  reasoningEffort: "",
  reasoningSummary: "auto",
};

export const DEFAULT_LOCAL_DRAFT_STATE: LocalDraftState = {
  version: 1,
  updatedAt: 0,
  threads: {},
};

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toThreadKey(value: unknown): string {
  return String(value ?? "").trim();
}

function toComposeMode(value: unknown): LocalDraftComposeMode {
  return value === "plan" ? "plan" : "default";
}

function normalizeModelName(value: unknown): string {
  return String(value ?? "").trim();
}

function toSandboxMode(value: unknown): LocalDraftSandboxMode {
  if (
    value === "read-only" ||
    value === "workspace-write" ||
    value === "danger-full-access"
  ) {
    return value;
  }
  return DEFAULT_LOCAL_THREAD_COMPOSE_STATE.sandboxMode;
}

function toReasoningEffort(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/** 从持久化内容恢复单线程草稿，未知字段回落到当前默认输入设置。 */
export function normalizeLocalThreadComposeState(
  value: unknown,
): LocalThreadComposeState {
  const record = toRecord(value);
  return {
    sandboxMode: toSandboxMode(record?.sandboxMode),
    composeInput:
      typeof record?.composeInput === "string"
        ? record.composeInput
        : DEFAULT_LOCAL_THREAD_COMPOSE_STATE.composeInput,
    composeMode: toComposeMode(record?.composeMode),
    model: normalizeModelName(record?.model),
    reasoningEffort: toReasoningEffort(record?.reasoningEffort),
    reasoningSummary:
      typeof record?.reasoningSummary === "string"
        ? record.reasoningSummary
        : DEFAULT_LOCAL_THREAD_COMPOSE_STATE.reasoningSummary,
  };
}

export function normalizeLocalDraftState(value: unknown): LocalDraftState {
  const root = toRecord(value);
  const threadsRecord = toRecord(root?.threads);
  const threads: Record<string, LocalThreadComposeState> = {};
  for (const [rawThreadId, rawState] of Object.entries(threadsRecord ?? {})) {
    const threadId = toThreadKey(rawThreadId);
    if (!threadId) continue;
    threads[threadId] = normalizeLocalThreadComposeState(rawState);
  }
  const updatedAt = Number(root?.updatedAt);
  return {
    version: 1,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    threads,
  };
}

/** 覆盖单个线程草稿，用于输入框状态即时落盘。 */
export function upsertLocalDraftThreadState(
  current: unknown,
  threadIdValue: string,
  stateValue: unknown,
): LocalDraftState {
  const next = normalizeLocalDraftState(current);
  const threadId = toThreadKey(threadIdValue);
  if (!threadId) return next;
  return {
    version: 1,
    updatedAt: Date.now(),
    threads: {
      ...next.threads,
      [threadId]: normalizeLocalThreadComposeState(stateValue),
    },
  };
}

/** 批量合并多个线程草稿，只有成功写入有效 threadId 时才刷新 updatedAt。 */
export function mergeLocalDraftThreadStates(
  current: unknown,
  stateEntries: Record<string, unknown>,
): LocalDraftState {
  const next = normalizeLocalDraftState(current);
  const threads = { ...next.threads };
  let changed = false;

  for (const [rawThreadId, rawState] of Object.entries(stateEntries ?? {})) {
    const threadId = toThreadKey(rawThreadId);
    if (!threadId) continue;
    threads[threadId] = normalizeLocalThreadComposeState(rawState);
    changed = true;
  }

  if (!changed) return next;
  return {
    version: 1,
    updatedAt: Date.now(),
    threads,
  };
}

/** 删除不存在的线程草稿不会刷新 updatedAt，避免无意义持久化写入。 */
export function removeLocalDraftThreadState(
  current: unknown,
  threadIdValue: string,
): LocalDraftState {
  const next = normalizeLocalDraftState(current);
  const threadId = toThreadKey(threadIdValue);
  if (!threadId || !(threadId in next.threads)) return next;
  const threads = { ...next.threads };
  delete threads[threadId];
  return {
    version: 1,
    updatedAt: Date.now(),
    threads,
  };
}
