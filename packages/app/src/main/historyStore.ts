import { createReadStream } from "node:fs";
import { appendFile, mkdir, open, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import readline from "node:readline";
import type { ThreadSourceKind } from "@codenexus/generated/codex-app-server/v2/ThreadSourceKind";

export type HistorySource = "cache" | "disk" | "runtime";

export type HistoryThread = {
  id: string;
  title: string;
  cwd?: string;
  modelProvider?: string;
  updatedAt: number;
  sessionPath: string;
  source: HistorySource;
  running?: boolean;
  activeTurnId?: string;
  threadSourceKind?: ThreadSourceKind;
  forkedFromId?: string;
  agentNickname?: string;
  agentRole?: string;
  agentPath?: string;
  gitInfoSummary?: string;
  projectId?: string | null;
  sectionId?: string | null;
  sectionName?: string | null;
};

export type HistoryThreadMetadataPatch = {
  id: string;
  threadSourceKind?: ThreadSourceKind | null;
  forkedFromId?: string | null;
  agentNickname?: string | null;
  agentRole?: string | null;
  agentPath?: string | null;
  gitInfoSummary?: string | null;
  projectId?: string | null;
  sectionId?: string | null;
  sectionName?: string | null;
};

export type HistoryMessage = {
  role: "user" | "assistant";
  text: string;
  timestamp?: string;
};

export type HistoryThreadEvent = {
  lineNo: number;
  timestamp?: string;
  type: string;
  payload?: unknown;
};

export type HistoryThreadEventsPage = {
  entries: HistoryThreadEvent[];
  total: number;
  loaded: number;
  hasMore: boolean;
};

type AuxNotificationPayload = {
  id: string;
  method: string;
  params?: unknown;
  paramsText?: string;
};

type FileSnapshot = {
  mtimeMs: number;
  size: number;
};

type PersistedHistoryThread = Omit<HistoryThread, "source">;

type SessionSummaryCacheEntry = {
  sessionPath: string;
  mtimeMs: number;
  size: number;
  thread: PersistedHistoryThread;
};

type HistoryCachePayload = {
  version: 3;
  items: PersistedHistoryThread[];
  sessionSummaries?: SessionSummaryCacheEntry[];
};

type HistoryCacheState = {
  items: HistoryThread[];
  sessionSummaries: SessionSummaryCacheEntry[];
};

type SessionMessagesCacheEntry = {
  filePath: string;
  mtimeMs: number;
  size: number;
  messages: HistoryMessage[];
};

type SessionEventsCacheEntry = {
  filePath: string;
  mtimeMs: number;
  size: number;
  events: HistoryThreadEvent[];
};

type ThreadEventsCacheEntry = {
  filePath: string;
  fileMtimeMs: number;
  fileSize: number;
  auxSignature: string;
  events: HistoryThreadEvent[];
};

type TailReadResult = {
  lines: string[];
  reachedStart: boolean;
};

type AuxLogFileInfo = FileSnapshot & {
  filePath: string;
};

type AuxThreadEventsCacheEntry = {
  signature: string;
  events: HistoryThreadEvent[];
};

type HistoryDiagRecord = Record<string, unknown>;

type SlowFileStat = {
  ms: number;
  filePath: string;
  size: number;
};

type ScanDiskDiagStats = {
  sessionsRoot: string;
  exists: boolean;
  collectFilesMs: number;
  files: number;
  purgedSummaries: number;
  concurrency: number;
  statMs: number;
  cacheHit: number;
  cacheMiss: number;
  parseMs: number;
  parsedOk: number;
  parsedNull: number;
  mergeSortMs: number;
  slowFiles: SlowFileStat[];
};

type HistoryThreadMetadataKeys =
  | "threadSourceKind"
  | "forkedFromId"
  | "agentNickname"
  | "agentRole"
  | "agentPath"
  | "gitInfoSummary"
  | "projectId"
  | "sectionId"
  | "sectionName";

type HistoryThreadMetadata = Pick<HistoryThread, HistoryThreadMetadataKeys>;

type NormalizedHistoryThreadMetadataPatch = {
  id: string;
  threadSourceKind?: ThreadSourceKind | undefined;
  forkedFromId?: string | undefined;
  agentNickname?: string | undefined;
  agentRole?: string | undefined;
  agentPath?: string | undefined;
  gitInfoSummary?: string | undefined;
  projectId?: string | null | undefined;
  sectionId?: string | null | undefined;
  sectionName?: string | null | undefined;
};

const HISTORY_THREAD_SOURCE_KINDS: readonly ThreadSourceKind[] = [
  "cli",
  "vscode",
  "exec",
  "appServer",
  "unknown",
] as const;

function toLocalDateYmd(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? String(v) : v));
  } catch (e: any) {
    return JSON.stringify({ _error: "json_stringify_failed", message: String(e?.message ?? e) });
  }
}

function estimateJsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(safeJsonStringify(value), "utf8");
  } catch {
    return 0;
  }
}

function pushTopNSlowest(list: SlowFileStat[], next: SlowFileStat, n: number): SlowFileStat[] {
  const safeN = Math.max(1, Math.min(50, Math.round(n)));
  const out = [...list, next];
  out.sort((a, b) => b.ms - a.ms);
  if (out.length > safeN) out.splice(safeN);
  return out;
}

function toPersistedThread(item: HistoryThread): PersistedHistoryThread {
  return {
    id: item.id,
    title: item.title,
    cwd: item.cwd,
    modelProvider: item.modelProvider,
    updatedAt: item.updatedAt,
    sessionPath: item.sessionPath,
    running: item.running,
    activeTurnId: item.activeTurnId,
    threadSourceKind: item.threadSourceKind,
    forkedFromId: item.forkedFromId,
    agentNickname: item.agentNickname,
    agentRole: item.agentRole,
    agentPath: item.agentPath,
    gitInfoSummary: item.gitInfoSummary,
    projectId: item.projectId,
    sectionId: item.sectionId,
    sectionName: item.sectionName,
  };
}

function toHistoryThread(item: PersistedHistoryThread, source: HistorySource): HistoryThread {
  return {
    id: item.id,
    title: item.title,
    cwd: item.cwd,
    modelProvider: item.modelProvider,
    updatedAt: item.updatedAt,
    sessionPath: item.sessionPath,
    source,
    running: item.running,
    activeTurnId: item.activeTurnId,
    threadSourceKind: item.threadSourceKind,
    forkedFromId: item.forkedFromId,
    agentNickname: item.agentNickname,
    agentRole: item.agentRole,
    agentPath: item.agentPath,
    gitInfoSummary: item.gitInfoSummary,
    projectId: item.projectId,
    sectionId: item.sectionId,
    sectionName: item.sectionName,
  };
}

function normalizeThreadSourceKind(value: unknown): ThreadSourceKind | undefined {
  const raw = normalizeText(value);
  if (!raw) return undefined;
  return HISTORY_THREAD_SOURCE_KINDS.find((item) => item === raw);
}

function normalizeNullableMetadataText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return normalizeText(value) ?? null;
}

function copyHistoryThreadMetadata(
  item: HistoryThread | PersistedHistoryThread | null | undefined
): HistoryThreadMetadata {
  const metadata: HistoryThreadMetadata = {
    threadSourceKind: normalizeThreadSourceKind(item?.threadSourceKind),
    forkedFromId: normalizeText(item?.forkedFromId),
    agentNickname: normalizeText(item?.agentNickname),
    agentRole: normalizeText(item?.agentRole),
    agentPath: normalizeText(item?.agentPath),
    gitInfoSummary: normalizeText(item?.gitInfoSummary),
  };
  if (item) {
    if (Object.prototype.hasOwnProperty.call(item, "projectId")) {
      metadata.projectId = normalizeNullableMetadataText(item.projectId);
    }
    if (Object.prototype.hasOwnProperty.call(item, "sectionId")) {
      metadata.sectionId = normalizeNullableMetadataText(item.sectionId);
    }
    if (Object.prototype.hasOwnProperty.call(item, "sectionName")) {
      metadata.sectionName = normalizeNullableMetadataText(item.sectionName);
    }
  }
  return metadata;
}

function mergeHistoryThreadMetadataIntoItem<T extends HistoryThread | PersistedHistoryThread>(
  item: T,
  source: HistoryThread | PersistedHistoryThread | null | undefined
): T {
  if (!source) return item;
  return {
    ...item,
    ...copyHistoryThreadMetadata(source),
  };
}

function assignOptionalMetadataPatchValue(
  target: Partial<NormalizedHistoryThreadMetadataPatch>,
  source: Record<string, unknown>,
  key: Exclude<keyof NormalizedHistoryThreadMetadataPatch, "id">
) {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return;
  if (key === "threadSourceKind") {
    target.threadSourceKind = normalizeThreadSourceKind(source.threadSourceKind);
    return;
  }
  if (key === "projectId" || key === "sectionId" || key === "sectionName") {
    target[key] = normalizeNullableMetadataText(source[key]);
    return;
  }
  target[key] = normalizeText(source[key]);
}

function sanitizeHistoryThreadMetadataPatch(input: unknown): NormalizedHistoryThreadMetadataPatch | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const source = input as Record<string, unknown>;
  const id = normalizeText(source.id);
  if (!id) return null;
  const patch: NormalizedHistoryThreadMetadataPatch = { id };
  assignOptionalMetadataPatchValue(patch, source, "threadSourceKind");
  assignOptionalMetadataPatchValue(patch, source, "forkedFromId");
  assignOptionalMetadataPatchValue(patch, source, "agentNickname");
  assignOptionalMetadataPatchValue(patch, source, "agentRole");
  assignOptionalMetadataPatchValue(patch, source, "agentPath");
  assignOptionalMetadataPatchValue(patch, source, "gitInfoSummary");
  assignOptionalMetadataPatchValue(patch, source, "projectId");
  assignOptionalMetadataPatchValue(patch, source, "sectionId");
  assignOptionalMetadataPatchValue(patch, source, "sectionName");
  return patch;
}

function mergeMetadataPatches(
  previous: NormalizedHistoryThreadMetadataPatch,
  next: NormalizedHistoryThreadMetadataPatch
): NormalizedHistoryThreadMetadataPatch {
  const merged: NormalizedHistoryThreadMetadataPatch = { ...previous, id: next.id };
  if (Object.prototype.hasOwnProperty.call(next, "threadSourceKind")) merged.threadSourceKind = next.threadSourceKind;
  if (Object.prototype.hasOwnProperty.call(next, "forkedFromId")) merged.forkedFromId = next.forkedFromId;
  if (Object.prototype.hasOwnProperty.call(next, "agentNickname")) merged.agentNickname = next.agentNickname;
  if (Object.prototype.hasOwnProperty.call(next, "agentRole")) merged.agentRole = next.agentRole;
  if (Object.prototype.hasOwnProperty.call(next, "agentPath")) merged.agentPath = next.agentPath;
  if (Object.prototype.hasOwnProperty.call(next, "gitInfoSummary")) merged.gitInfoSummary = next.gitInfoSummary;
  if (Object.prototype.hasOwnProperty.call(next, "projectId")) merged.projectId = next.projectId;
  if (Object.prototype.hasOwnProperty.call(next, "sectionId")) merged.sectionId = next.sectionId;
  if (Object.prototype.hasOwnProperty.call(next, "sectionName")) merged.sectionName = next.sectionName;
  return merged;
}

function applyHistoryThreadMetadataPatch<T extends HistoryThread | PersistedHistoryThread>(
  item: T,
  patch: NormalizedHistoryThreadMetadataPatch | null | undefined
): T {
  if (!patch) return item;
  const next = { ...item } as T;
  if (Object.prototype.hasOwnProperty.call(patch, "threadSourceKind")) next.threadSourceKind = patch.threadSourceKind;
  if (Object.prototype.hasOwnProperty.call(patch, "forkedFromId")) next.forkedFromId = patch.forkedFromId;
  if (Object.prototype.hasOwnProperty.call(patch, "agentNickname")) next.agentNickname = patch.agentNickname;
  if (Object.prototype.hasOwnProperty.call(patch, "agentRole")) next.agentRole = patch.agentRole;
  if (Object.prototype.hasOwnProperty.call(patch, "agentPath")) next.agentPath = patch.agentPath;
  if (Object.prototype.hasOwnProperty.call(patch, "gitInfoSummary")) next.gitInfoSummary = patch.gitInfoSummary;
  if (Object.prototype.hasOwnProperty.call(patch, "projectId")) next.projectId = patch.projectId;
  if (Object.prototype.hasOwnProperty.call(patch, "sectionId")) next.sectionId = patch.sectionId;
  if (Object.prototype.hasOwnProperty.call(patch, "sectionName")) next.sectionName = patch.sectionName;
  return next;
}

function hasSameHistoryThreadMetadata(
  left: HistoryThread | PersistedHistoryThread,
  right: HistoryThread | PersistedHistoryThread
): boolean {
  return (
    left.threadSourceKind === right.threadSourceKind &&
    left.forkedFromId === right.forkedFromId &&
    left.agentNickname === right.agentNickname &&
    left.agentRole === right.agentRole &&
    left.agentPath === right.agentPath &&
    left.gitInfoSummary === right.gitInfoSummary &&
    left.projectId === right.projectId &&
    left.sectionId === right.sectionId &&
    left.sectionName === right.sectionName
  );
}

function sameFileSnapshot(
  left: Pick<FileSnapshot, "mtimeMs" | "size">,
  right: Pick<FileSnapshot, "mtimeMs" | "size">
): boolean {
  return left.mtimeMs === right.mtimeMs && left.size === right.size;
}

function threadEventsCacheKey(threadId: string, includeAux: boolean): string {
  const tid = String(threadId ?? "").trim();
  if (!tid) return "";
  return includeAux ? tid : `${tid}|noaux`;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const result = new Array<R>(items.length);
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      result[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return result;
}

async function readLastLines(filePath: string, maxLines: number, fileSize: number): Promise<TailReadResult> {
  const targetLines = Math.max(1, Math.round(maxLines));
  if (fileSize <= 0) {
    return { lines: [], reachedStart: true };
  }

  const handle = await open(filePath, "r");
  try {
    const lines: string[] = [];
    let remainder = Buffer.alloc(0);
    let position = fileSize;
    const chunkSize = 64 * 1024;

    while (position > 0 && lines.length < targetLines) {
      const nextSize = Math.min(chunkSize, position);
      position -= nextSize;
      const buffer = Buffer.allocUnsafe(nextSize);
      const { bytesRead } = await handle.read(buffer, 0, nextSize, position);
      const chunk = bytesRead === nextSize ? buffer : buffer.subarray(0, bytesRead);
      let combined = Buffer.concat([chunk, remainder]);
      let cursor = combined.length;

      while (cursor > 0 && lines.length < targetLines) {
        const newlineIndex = combined.lastIndexOf(0x0a, cursor - 1);
        if (newlineIndex < 0) break;
        const lineBuffer = combined.subarray(newlineIndex + 1, cursor);
        cursor = newlineIndex;
        if (lineBuffer.length === 0) continue;
        const line = lineBuffer.toString("utf8").replace(/\r$/, "");
        if (!line.trim()) continue;
        lines.push(line);
      }

      remainder = combined.subarray(0, cursor);
    }

    const reachedStart = position <= 0;
    if (reachedStart && remainder.length > 0 && lines.length < targetLines) {
      const line = remainder.toString("utf8").replace(/\r$/, "");
      if (line.trim()) lines.push(line);
    }

    lines.reverse();
    return { lines, reachedStart };
  } finally {
    await handle.close();
  }
}

function normalizeText(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text : undefined;
}

function normalizeUserMessageText(value: unknown): string | undefined {
  const source = normalizeText(value);
  if (!source) return undefined;
  const normalized = source.replace(/\r\n/g, "\n");
  const imageTags = normalized.match(/<\s*image\s*>/gi) ?? [];
  const imageCount = imageTags.length;
  const withoutTags = normalized
    .replace(/<\s*\/?\s*image\s*>/gi, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const baseText = normalizeText(withoutTags);
  if (imageCount <= 0) return baseText;
  return baseText ? `${baseText}\n[Attached images: ${imageCount}]` : `[Attached images: ${imageCount}]`;
}

function toEpochMillis(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1_000_000_000_000) return Math.round(value);
    if (value > 1_000_000_000) return Math.round(value * 1000);
    return undefined;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return toEpochMillis(numeric);
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function extractYmdFromSessionPath(sessionPath: string): string | "" {
  const value = String(sessionPath ?? "").trim();
  if (!value) return "";
  const match = value.match(/[\\/]+sessions[\\/]+(\d{4})[\\/]+(\d{2})[\\/]+(\d{2})[\\/]+/i);
  if (!match) return "";
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function ymdWithOffset(ymd: string, offsetDays: number): string | "" {
  const m = String(ymd ?? "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return "";
  const dt = new Date(y, mo - 1, d);
  if (Number.isFinite(offsetDays) && offsetDays !== 0) dt.setDate(dt.getDate() + Math.round(offsetDays));
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function isFileChangeAuxLogName(name: string): boolean {
  const value = String(name ?? "").trim();
  if (!value) return false;
  return /^file-change-\d{4}-\d{2}-\d{2}\.txt$/i.test(value);
}

async function collectFileChangeAuxLogFiles(): Promise<AuxLogFileInfo[]> {
  const logDir = join(homedir(), ".codex", "logs");
  try {
    const entries = await readdir(logDir, { withFileTypes: true });
    const fileNames = entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter(isFileChangeAuxLogName)
      .sort((a, b) => a.localeCompare(b, "en"));
    const files = await mapWithConcurrency(fileNames, 8, async (fileName) => {
      try {
        const filePath = join(logDir, fileName);
        const info = await stat(filePath);
        return {
          filePath,
          mtimeMs: info.mtimeMs,
          size: info.size,
        } satisfies AuxLogFileInfo;
      } catch {
        return null;
      }
    });
    return files.filter((item): item is AuxLogFileInfo => Boolean(item));
  } catch {
    return [];
  }
}

function buildAuxLogSignature(files: AuxLogFileInfo[]): string {
  if (files.length === 0) return "";
  return (
    files
      // file-change 日志是 append-only，mtime/size 会频繁变化；这里采用“粗粒度签名”避免缓存抖动。
      // 代价：最多延迟 ~10s/1MB 的旁路日志可见性，但能显著降低历史加载卡顿。
      .map(
        (file) => `${basename(file.filePath)}:${Math.floor(file.mtimeMs / 10_000)}:${Math.floor(file.size / 1_000_000)}`
      )
      .join("|")
  );
}

async function readTailJsonlLinesUtf8(
  filePath: string,
  fileSize: number,
  tailBytes: number,
  opts?: { needle?: string }
): Promise<{ lines: string[]; truncated: boolean; containsNeedle: boolean }> {
  const safeTailBytes = Math.max(1, Math.min(32_000_000, Math.round(tailBytes)));
  if (fileSize <= 0) return { lines: [], truncated: false, containsNeedle: false };
  const start = Math.max(0, fileSize - safeTailBytes);
  const len = Math.max(0, fileSize - start);
  if (len <= 0) return { lines: [], truncated: false, containsNeedle: false };

  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(len);
    const { bytesRead } = await handle.read(buffer, 0, len, start);
    const truncated = start > 0;
    let normalized = bytesRead === len ? buffer : buffer.subarray(0, bytesRead);
    if (truncated && normalized.length > 0) {
      const i = normalized.indexOf(0x0a);
      normalized = i >= 0 ? normalized.subarray(i + 1) : Buffer.alloc(0);
    }

    const needle = String(opts?.needle ?? "").trim();
    if (needle && !normalized.includes(needle, 0, "utf8")) {
      return { lines: [], truncated, containsNeedle: false };
    }

    const text = normalized.toString("utf8");

    const lines = text
      .split("\n")
      .map((line) => line.replace(/\r$/, "").trim())
      .filter(Boolean);
    return { lines, truncated, containsNeedle: Boolean(needle) };
  } finally {
    await handle.close();
  }
}

async function readAuxNotificationsForThread(
  threadId: string,
  auxFiles: AuxLogFileInfo[],
  opts?: { tailBytes?: number; retryTailBytes?: number }
): Promise<HistoryThreadEvent[]> {
  const tid = String(threadId ?? "").trim();
  if (!tid) return [];

  if (auxFiles.length === 0) return [];

  const threadNeedle = `\"threadId\":\"${tid}\"`;
  const baseTailBytes = Number.isFinite(opts?.tailBytes)
    ? Math.max(64_000, Math.round(Number(opts?.tailBytes)))
    : 6_000_000;
  const retryTailBytes = Number.isFinite(opts?.retryTailBytes)
    ? Math.max(baseTailBytes, Math.round(Number(opts?.retryTailBytes)))
    : Math.max(baseTailBytes, 24_000_000);

  const run = async (tailBytes: number) => {
    const turnDiffByKey = new Map<string, { id: string; ts: number; params: any; paramsText?: string }>();
    const events: { ts: number; seq: number; event: HistoryThreadEvent }[] = [];
    let seq = 0;
    let matched = 0;

    for (const auxFile of auxFiles) {
      const filePath = auxFile.filePath;
      let lineNo = 0;
      let lines: string[] = [];
      try {
        const tail = await readTailJsonlLinesUtf8(filePath, auxFile.size, tailBytes, { needle: threadNeedle });
        lines = tail.lines;
      } catch {
        continue;
      }

      for (const line of lines) {
        lineNo += 1;
        const trimmed = line.trim();
        if (!trimmed) continue;
        // 预过滤：aux 日志可能非常大（例如 90MB+），先用字符串匹配跳过无关行，避免对每行做 JSON.parse。
        if (!trimmed.includes(threadNeedle)) continue;
        let record: any;
        try {
          record = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (!record || typeof record !== "object") continue;
        if (String(record.threadId ?? "").trim() !== tid) continue;
        matched += 1;

        const ts = toEpochMillis(record.ts) ?? toEpochMillis(record.timestamp) ?? Date.now();
        const method = String(record.method ?? "").trim();
        const params = record.params ?? undefined;
        const paramsText = typeof record.paramsText === "string" ? record.paramsText : undefined;
        const turnId = String(record.turnId ?? (params as any)?.turnId ?? "").trim();
        const itemId = String(record.itemId ?? (params as any)?.itemId ?? (params as any)?.item?.id ?? "").trim();

        if (!method) continue;

        if (method === "turn/diff/updated") {
          const key = `${turnId || "unknown"}`;
          const streamId = `aux:stream:turn/diff/updated:${tid}:${turnId || "unknown"}`;
          const existing = turnDiffByKey.get(key);
          const mergedParams =
            params && typeof params === "object"
              ? { ...(params as any) }
              : { threadId: tid, turnId, diff: record.chunk ?? "" };
          if (existing) {
            if (ts >= existing.ts) {
              turnDiffByKey.set(key, { id: streamId, ts, params: mergedParams, paramsText });
            }
            continue;
          }
          turnDiffByKey.set(key, { id: streamId, ts, params: mergedParams, paramsText });
          continue;
        }

        seq += 1;
        const id = `aux:${basename(filePath)}:${lineNo}:${method}:${tid}:${turnId || "unknown"}:${itemId || "unknown"}:${ts}`;
        const payload: AuxNotificationPayload = { id, method, params, paramsText };
        events.push({
          ts,
          seq,
          event: {
            lineNo: 0,
            timestamp: String(ts),
            type: "aux_notification",
            payload,
          },
        });
      }
    }

    // 聚合 turn diff：每个 turn 仅保留最后一个快照，匹配实时 upsert 行为。
    for (const agg of turnDiffByKey.values()) {
      seq += 1;
      const payload: AuxNotificationPayload = {
        id: agg.id,
        method: "turn/diff/updated",
        params: agg.params,
        paramsText: agg.paramsText,
      };
      events.push({
        ts: agg.ts,
        seq,
        event: {
          lineNo: 0,
          timestamp: String(agg.ts),
          type: "aux_notification",
          payload,
        },
      });
    }

    // 统一按时间排序（再按写入顺序稳定排序）。
    events.sort((a, b) => a.ts - b.ts || a.seq - b.seq);
    return { matched, events: events.map((e) => e.event) };
  };

  const first = await run(baseTailBytes);
  if (first.matched > 0 || retryTailBytes <= baseTailBytes) return first.events;
  const second = await run(retryTailBytes);
  return second.events;
}

function shortTitle(text: string): string {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n");
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

function fallbackTitle(id: string): string {
  const suffix = id.length > 8 ? id.slice(-8) : id;
  return `Thread ${suffix}`;
}

function inferIdFromFile(filePath: string): string | undefined {
  const name = basename(filePath);
  const match = name.match(/-([0-9a-z]{8,}(?:-[0-9a-z]+)+)\.jsonl$/i);
  return match?.[1];
}

function extractUserMessageText(entry: any): string | undefined {
  if (!entry || typeof entry !== "object") return undefined;

  if (entry.type === "response_item" && entry.payload?.type === "message" && entry.payload?.role === "user") {
    const content = Array.isArray(entry.payload?.content) ? entry.payload.content : [];
    for (const part of content) {
      const text = normalizeUserMessageText(part?.text);
      if (text) return text;
    }
  }

  return undefined;
}

function isBootstrapUserMessage(text: string): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return true;
  if (raw.startsWith("<environment_context>")) return true;
  if (raw.startsWith("# AGENTS.md instructions")) return true;
  if (raw.includes("<INSTRUCTIONS>")) return true;
  return false;
}

function extractChatMessage(entry: any): HistoryMessage | null {
  if (!entry || typeof entry !== "object") return null;
  const timestamp = normalizeText(entry.timestamp);

  if (entry.type === "response_item" && entry.payload?.type === "message") {
    const role = entry.payload?.role === "user" ? "user" : entry.payload?.role === "assistant" ? "assistant" : null;
    if (!role) return null;
    const content = Array.isArray(entry.payload?.content) ? entry.payload.content : [];
    for (const part of content) {
      const text = role === "user" ? normalizeUserMessageText(part?.text) : normalizeText(part?.text);
      if (text) return { role, text, timestamp };
    }
  }

  return null;
}

function parseHistoryThreadEventLine(line: string, lineNo: number): HistoryThreadEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let entry: any;
  try {
    entry = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const type = normalizeText(entry?.type);
  if (!type) return null;
  const timestampRaw = entry?.timestamp;
  const timestamp =
    typeof timestampRaw === "string"
      ? timestampRaw.trim()
      : typeof timestampRaw === "number" && Number.isFinite(timestampRaw)
        ? String(timestampRaw)
        : undefined;

  return {
    lineNo,
    type,
    timestamp,
    payload: entry?.payload,
  };
}

function mergeAndSort(items: HistoryThread[]): HistoryThread[] {
  const byId = new Map<string, HistoryThread>();
  for (const item of items) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }
    if (item.updatedAt > existing.updatedAt) {
      byId.set(item.id, item);
      continue;
    }
    if (item.updatedAt === existing.updatedAt && item.source === "disk" && existing.source !== "disk") {
      byId.set(item.id, item);
    }
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function collectJsonlFiles(rootDir: string): Promise<string[]> {
  const result: string[] = [];
  const queue = [rootDir];
  while (queue.length > 0) {
    const current = queue.pop()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl")) {
        result.push(fullPath);
      }
    }
  }
  return result;
}

async function parseSessionFile(filePath: string, fileSnapshot?: FileSnapshot): Promise<HistoryThread | null> {
  let sessionId: string | undefined;
  let title: string | undefined;
  let cwd: string | undefined;
  let modelProvider: string | undefined;
  let updatedAt: number | undefined;
  const inferredId = inferIdFromFile(filePath);

  let fileMtime = fileSnapshot?.mtimeMs ?? Date.now();
  if (!fileSnapshot) {
    try {
      fileMtime = (await stat(filePath)).mtimeMs;
    } catch {
      // 读取文件 mtime 失败时忽略，使用 Date.now() 作为兜底时间戳。
    }
  }

  try {
    const stream = createReadStream(filePath, { encoding: "utf8" });
    const reader = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    for await (const line of reader) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let entry: any;
      try {
        entry = JSON.parse(trimmed);
      } catch {
        continue;
      }

      if (!sessionId && entry.type === "session_meta") {
        sessionId = normalizeText(entry.payload?.id);
        cwd = normalizeText(entry.payload?.cwd);
        modelProvider = normalizeText(entry.payload?.model_provider);
        updatedAt = toEpochMillis(entry.payload?.timestamp) ?? toEpochMillis(entry.timestamp) ?? updatedAt;
      }

      if (!title) {
        const userText = extractUserMessageText(entry);
        if (userText && !isBootstrapUserMessage(userText)) {
          title = shortTitle(userText);
        }
      }

      // 我们只需要 session_meta + 首条有效 user 消息即可生成列表项；提前结束可显著减少读取大文件的开销。
      if (title && (sessionId || inferredId)) {
        try {
          reader.close();
        } catch {}
        try {
          stream.destroy();
        } catch {}
        break;
      }
    }
  } catch {
    return null;
  }

  const id = sessionId ?? inferredId;
  if (!id) return null;
  const safeTitle = title ?? fallbackTitle(id);
  const safeUpdatedAt = updatedAt ?? fileMtime;

  return {
    id,
    title: safeTitle,
    cwd,
    modelProvider,
    updatedAt: safeUpdatedAt,
    sessionPath: filePath,
    source: "disk",
  };
}

function sanitizePersistedHistoryThread(input: unknown): PersistedHistoryThread | null {
  if (!input || typeof input !== "object") return null;
  const id = normalizeText((input as any).id);
  const title = normalizeText((input as any).title);
  const sessionPath = normalizeText((input as any).sessionPath);
  const updatedAt = toEpochMillis((input as any).updatedAt);
  if (!id || !title || !sessionPath || !updatedAt) return null;
  return {
    id,
    title,
    cwd: normalizeText((input as any).cwd),
    modelProvider: normalizeText((input as any).modelProvider),
    updatedAt,
    sessionPath,
    running: Boolean((input as any).running),
    activeTurnId: normalizeText((input as any).activeTurnId),
    threadSourceKind: normalizeThreadSourceKind((input as any).threadSourceKind),
    forkedFromId: normalizeText((input as any).forkedFromId),
    agentNickname: normalizeText((input as any).agentNickname),
    agentRole: normalizeText((input as any).agentRole),
    agentPath: normalizeText((input as any).agentPath),
    gitInfoSummary: normalizeText((input as any).gitInfoSummary),
    projectId: normalizeNullableMetadataText((input as any).projectId),
    sectionId: normalizeNullableMetadataText((input as any).sectionId),
    sectionName: normalizeNullableMetadataText((input as any).sectionName),
  };
}

function sanitizeCachedHistory(input: unknown): HistoryThread[] {
  if (!Array.isArray(input)) return [];
  const normalized: HistoryThread[] = [];
  for (const item of input) {
    const persisted = sanitizePersistedHistoryThread(item);
    if (!persisted) continue;
    normalized.push(toHistoryThread(persisted, "cache"));
  }
  return mergeAndSort(normalized);
}

function sanitizeSessionSummaryCache(input: unknown): SessionSummaryCacheEntry[] {
  if (!Array.isArray(input)) return [];
  const normalized: SessionSummaryCacheEntry[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const sessionPath = normalizeText((item as any).sessionPath);
    const mtimeMs = toEpochMillis((item as any).mtimeMs);
    const size =
      typeof (item as any).size === "number" && Number.isFinite((item as any).size)
        ? Math.max(0, Math.round((item as any).size))
        : undefined;
    const thread = sanitizePersistedHistoryThread((item as any).thread);
    if (!sessionPath || !mtimeMs || size === undefined || !thread) continue;
    normalized.push({
      sessionPath,
      mtimeMs,
      size,
      thread,
    });
  }
  return normalized;
}

function sanitizeCachedHistoryState(input: unknown): HistoryCacheState {
  if (Array.isArray(input)) {
    return {
      items: sanitizeCachedHistory(input),
      sessionSummaries: [],
    };
  }
  if (!input || typeof input !== "object") {
    return {
      items: [],
      sessionSummaries: [],
    };
  }
  return {
    items: sanitizeCachedHistory((input as any).items),
    sessionSummaries: sanitizeSessionSummaryCache((input as any).sessionSummaries),
  };
}

export class HistoryStore {
  private readonly cachePath: string;
  private readonly sessionsRoot: string;
  private snapshot: HistoryThread[] = [];
  private readonly threadById = new Map<string, HistoryThread>();
  private sessionSummaryCache = new Map<string, SessionSummaryCacheEntry>();
  private sessionMessagesCache = new Map<string, SessionMessagesCacheEntry>();
  private sessionEventsCache = new Map<string, SessionEventsCacheEntry>();
  private threadEventsCache = new Map<string, ThreadEventsCacheEntry>();
  private auxThreadEventsCache = new Map<string, AuxThreadEventsCacheEntry>();
  private initialized = false;
  private refreshPromise: Promise<HistoryThread[]> | null = null;
  private refreshSeq = 0;

  constructor(cachePath: string, sessionsRoot?: string) {
    this.cachePath = cachePath;
    this.sessionsRoot = sessionsRoot ?? join(homedir(), ".codex", "sessions");
  }

  private updateSnapshot(items: HistoryThread[]): void {
    this.snapshot = items;
    this.threadById.clear();
    for (const item of items) {
      this.threadById.set(item.id, item);
    }
  }

  private getThreadById(threadId: string): HistoryThread | undefined {
    const id = String(threadId ?? "").trim();
    if (!id) return undefined;
    return this.threadById.get(id);
  }

  private diagLogPath(now = new Date()): string {
    const logDir = join(homedir(), ".codex", "logs");
    return join(logDir, `history-load-${toLocalDateYmd(now)}.txt`);
  }

  private async appendDiagLog(record: HistoryDiagRecord): Promise<void> {
    const logPath = this.diagLogPath();
    const line = `${safeJsonStringify(record)}\n`;
    try {
      await mkdir(dirname(logPath), { recursive: true });
      await appendFile(logPath, line, "utf8");
    } catch {
      // 诊断日志写入失败不应影响主流程。
    }
  }

  private logDiag(record: HistoryDiagRecord): void {
    void this.appendDiagLog(record);
  }

  async listWithBackgroundRefresh(onUpdated?: (items: HistoryThread[]) => void): Promise<HistoryThread[]> {
    const t0 = performance.now();
    await this.loadCacheIfNeeded();
    void this.refreshDisk(onUpdated);
    const snap = this.getSnapshot();
    const elapsedMs = Number((performance.now() - t0).toFixed(1));
    if (elapsedMs >= 200) {
      this.logDiag({
        ts: Date.now(),
        op: "history.listWithBackgroundRefresh",
        elapsedMs,
        items: snap.length,
      });
    }
    return snap;
  }

  async refreshDisk(onUpdated?: (items: HistoryThread[]) => void): Promise<HistoryThread[]> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      const refreshId = (this.refreshSeq += 1);
      const startedAt = Date.now();
      const t0 = performance.now();
      this.logDiag({
        ts: startedAt,
        op: "history.refreshDisk",
        phase: "start",
        refreshId,
        cachedItems: this.snapshot.length,
      });

      const scanStart = performance.now();
      const { items: diskHistory, stats } = await this.scanDisk(refreshId);
      const scanMs = Number((performance.now() - scanStart).toFixed(1));

      const previousById = new Map(this.threadById);
      this.updateSnapshot(
        diskHistory.map((item) => mergeHistoryThreadMetadataIntoItem(item, previousById.get(item.id)))
      );

      const writeStart = performance.now();
      await this.writeCache(this.snapshot);
      const writeCacheMs = Number((performance.now() - writeStart).toFixed(1));

      const next = this.getSnapshot();
      onUpdated?.(next);
      const elapsedMs = Number((performance.now() - t0).toFixed(1));
      this.logDiag({
        ts: Date.now(),
        op: "history.refreshDisk",
        phase: "end",
        refreshId,
        elapsedMs,
        scanMs,
        writeCacheMs,
        items: next.length,
        scan: stats,
      });
      return next;
    })()
      .catch((error) => {
        console.error("[historyStore] refresh failed:", error);
        this.logDiag({
          ts: Date.now(),
          op: "history.refreshDisk",
          phase: "failed",
          message: String((error as any)?.message ?? error),
          error: safeJsonStringify(error),
        });
        return this.getSnapshot();
      })
      .finally(() => {
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }

  async mergeThreadMetadata(patches: HistoryThreadMetadataPatch[]): Promise<HistoryThread[]> {
    await this.loadCacheIfNeeded();

    const patchById = new Map<string, NormalizedHistoryThreadMetadataPatch>();
    for (const rawPatch of patches) {
      const patch = sanitizeHistoryThreadMetadataPatch(rawPatch);
      if (!patch) continue;
      const previous = patchById.get(patch.id);
      patchById.set(patch.id, previous ? mergeMetadataPatches(previous, patch) : patch);
    }
    if (patchById.size === 0) return this.getSnapshot();

    let changed = false;
    this.updateSnapshot(
      this.snapshot.map((item) => {
        const patch = patchById.get(item.id);
        if (!patch) return item;
        const next = applyHistoryThreadMetadataPatch(item, patch);
        if (!hasSameHistoryThreadMetadata(item, next)) changed = true;
        return next;
      })
    );

    const nextSessionSummaryCache = new Map<string, SessionSummaryCacheEntry>();
    for (const [sessionPath, entry] of this.sessionSummaryCache.entries()) {
      const patch = patchById.get(entry.thread.id);
      if (!patch) {
        nextSessionSummaryCache.set(sessionPath, entry);
        continue;
      }
      const nextThread = applyHistoryThreadMetadataPatch(entry.thread, patch);
      if (!hasSameHistoryThreadMetadata(entry.thread, nextThread)) changed = true;
      nextSessionSummaryCache.set(sessionPath, {
        ...entry,
        thread: nextThread,
      });
    }
    this.sessionSummaryCache = nextSessionSummaryCache;

    if (!changed) return this.getSnapshot();

    await this.writeCache(this.snapshot);
    return this.getSnapshot();
  }

  async getThreadMessages(threadId: string, limit = 120): Promise<HistoryMessage[]> {
    if (!threadId) return [];
    const t0 = performance.now();
    await this.loadCacheIfNeeded();
    const current = this.getThreadById(threadId);
    if (!current) {
      await this.refreshDisk();
      const afterRefresh = this.getThreadById(threadId);
      if (!afterRefresh) return [];
      const messages = await this.readThreadMessagesFromFile(afterRefresh.sessionPath, limit);
      const elapsedMs = Number((performance.now() - t0).toFixed(1));
      if (elapsedMs >= 150) {
        this.logDiag({
          ts: Date.now(),
          op: "history.getThreadMessages",
          threadId,
          limit,
          elapsedMs,
          miss: true,
          messages: messages.length,
        });
      }
      return messages;
    }
    const messages = await this.readThreadMessagesFromFile(current.sessionPath, limit);
    const elapsedMs = Number((performance.now() - t0).toFixed(1));
    if (elapsedMs >= 150) {
      this.logDiag({
        ts: Date.now(),
        op: "history.getThreadMessages",
        threadId,
        limit,
        elapsedMs,
        miss: false,
        messages: messages.length,
      });
    }
    return messages;
  }

  async getThreadEvents(
    threadId: string,
    opts?: { limit?: number; before?: number; includeAux?: boolean }
  ): Promise<HistoryThreadEventsPage> {
    if (!threadId) return { entries: [], total: 0, loaded: 0, hasMore: false };
    const t0 = performance.now();
    const includeAux = opts?.includeAux !== false;
    await this.loadCacheIfNeeded();
    const current = this.getThreadById(threadId);
    if (!current) {
      await this.refreshDisk();
      const afterRefresh = this.getThreadById(threadId);
      if (!afterRefresh) return { entries: [], total: 0, loaded: 0, hasMore: false };
      const page = await this.readThreadEventsFromFile(afterRefresh.sessionPath, threadId, {
        limit: opts?.limit,
        before: opts?.before,
        includeAux,
      });
      const elapsedMs = Number((performance.now() - t0).toFixed(1));
      if (elapsedMs >= 180) {
        this.logDiag({
          ts: Date.now(),
          op: "history.getThreadEvents",
          threadId,
          opts: { limit: opts?.limit ?? null, before: opts?.before ?? null, includeAux },
          elapsedMs,
          miss: true,
          loaded: page.loaded,
          total: page.total,
          hasMore: page.hasMore,
        });
      }
      return page;
    }
    const page = await this.readThreadEventsFromFile(current.sessionPath, threadId, {
      limit: opts?.limit,
      before: opts?.before,
      includeAux,
    });
    const elapsedMs = Number((performance.now() - t0).toFixed(1));
    if (elapsedMs >= 180) {
      this.logDiag({
        ts: Date.now(),
        op: "history.getThreadEvents",
        threadId,
        opts: { limit: opts?.limit ?? null, before: opts?.before ?? null, includeAux },
        elapsedMs,
        miss: false,
        loaded: page.loaded,
        total: page.total,
        hasMore: page.hasMore,
      });
    }
    return page;
  }

  async deleteThread(threadId: string): Promise<HistoryThread[]> {
    const id = String(threadId ?? "").trim();
    if (!id) return this.getSnapshot();

    await this.loadCacheIfNeeded();

    let current = this.getThreadById(id);
    if (!current) {
      await this.refreshDisk();
      current = this.getThreadById(id);
    }

    const sessionPath = current?.sessionPath ? String(current.sessionPath) : "";
    if (!sessionPath) {
      // 磁盘上没有可删除的会话目录；但若缓存快照中仍存在，仍需移除。
      this.updateSnapshot(this.snapshot.filter((item) => item.id !== id));
      this.threadEventsCache.delete(threadEventsCacheKey(id, true));
      this.threadEventsCache.delete(threadEventsCacheKey(id, false));
      this.auxThreadEventsCache.delete(id);
      await this.writeCache(this.snapshot);
      return this.getSnapshot();
    }

    const sessionsRootAbs = resolve(this.sessionsRoot);
    const sessionAbs = resolve(sessionPath);

    const rootNorm = sessionsRootAbs.toLowerCase();
    const targetNorm = sessionAbs.toLowerCase();
    const rootWithSep = rootNorm.endsWith(sep) ? rootNorm : `${rootNorm}${sep}`;
    if (!(targetNorm === rootNorm || targetNorm.startsWith(rootWithSep))) {
      throw new Error(`refuse to delete session outside sessions root: ${sessionAbs}`);
    }

    try {
      await unlink(sessionAbs);
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }

    this.updateSnapshot(this.snapshot.filter((item) => item.id !== id));
    this.sessionSummaryCache.delete(sessionPath);
    this.sessionSummaryCache.delete(sessionAbs);
    this.invalidateFileCaches(sessionAbs);
    this.threadEventsCache.delete(threadEventsCacheKey(id, true));
    this.threadEventsCache.delete(threadEventsCacheKey(id, false));
    this.auxThreadEventsCache.delete(id);
    await this.writeCache(this.snapshot);
    return this.getSnapshot();
  }

  private async getFileSnapshot(filePath: string): Promise<FileSnapshot | null> {
    try {
      const info = await stat(filePath);
      return {
        mtimeMs: info.mtimeMs,
        size: info.size,
      };
    } catch {
      return null;
    }
  }

  private invalidateFileCaches(filePath: string) {
    this.sessionMessagesCache.delete(filePath);
    this.sessionEventsCache.delete(filePath);
    for (const [cacheKey, entry] of this.threadEventsCache.entries()) {
      if (entry.filePath === filePath) {
        this.threadEventsCache.delete(cacheKey);
      }
    }
  }

  private paginateThreadEvents(
    normalized: HistoryThreadEvent[],
    opts?: { limit?: number; before?: number }
  ): HistoryThreadEventsPage {
    const safeLimit = Number.isFinite(opts?.limit) ? Math.max(1, Math.min(1000, Math.round(Number(opts?.limit)))) : 50;
    const total = normalized.length;
    if (total === 0) return { entries: [], total: 0, loaded: 0, hasMore: false };

    const beforeRaw = Number.isFinite(opts?.before) ? Math.max(0, Math.round(Number(opts?.before))) : 0;
    const before = Math.min(beforeRaw, total);
    const end = Math.max(0, total - before);
    const start = Math.max(0, end - safeLimit);
    const entries = normalized.slice(start, end);
    const loaded = Math.min(total, before + entries.length);
    const hasMore = start > 0;

    return { entries, total, loaded, hasMore };
  }

  private async scanDisk(refreshId: number): Promise<{ items: HistoryThread[]; stats: ScanDiskDiagStats }> {
    const t0 = performance.now();
    const stats: ScanDiskDiagStats = {
      sessionsRoot: this.sessionsRoot,
      exists: false,
      collectFilesMs: 0,
      files: 0,
      purgedSummaries: 0,
      concurrency: 8,
      statMs: 0,
      cacheHit: 0,
      cacheMiss: 0,
      parseMs: 0,
      parsedOk: 0,
      parsedNull: 0,
      mergeSortMs: 0,
      slowFiles: [],
    };

    const exists = await pathExists(this.sessionsRoot);
    stats.exists = exists;
    if (!exists) return { items: [], stats };

    const collectStart = performance.now();
    const files = await collectJsonlFiles(this.sessionsRoot);
    stats.collectFilesMs = Number((performance.now() - collectStart).toFixed(1));
    stats.files = files.length;

    const knownPaths = new Set(files);
    for (const cachedPath of [...this.sessionSummaryCache.keys()]) {
      if (!knownPaths.has(cachedPath)) {
        this.sessionSummaryCache.delete(cachedPath);
        this.invalidateFileCaches(cachedPath);
        stats.purgedSummaries += 1;
      }
    }

    const parsedItems = await mapWithConcurrency(files, stats.concurrency, async (filePath) => {
      const statStart = performance.now();
      const fileSnapshot = await this.getFileSnapshot(filePath);
      stats.statMs += performance.now() - statStart;
      if (!fileSnapshot) {
        this.sessionSummaryCache.delete(filePath);
        this.invalidateFileCaches(filePath);
        stats.parsedNull += 1;
        return null;
      }

      const cached = this.sessionSummaryCache.get(filePath);
      if (cached && sameFileSnapshot(cached, fileSnapshot)) {
        stats.cacheHit += 1;
        return toHistoryThread(cached.thread, "disk");
      }
      stats.cacheMiss += 1;

      const parseStart = performance.now();
      const parsed = await parseSessionFile(filePath, fileSnapshot);
      const parseMs = performance.now() - parseStart;
      stats.parseMs += parseMs;
      if (parseMs >= 80) {
        stats.slowFiles = pushTopNSlowest(
          stats.slowFiles,
          { ms: Number(parseMs.toFixed(1)), filePath, size: fileSnapshot.size },
          20
        );
      }

      if (!parsed) {
        this.sessionSummaryCache.delete(filePath);
        this.invalidateFileCaches(filePath);
        stats.parsedNull += 1;
        return null;
      }

      const nextThread = mergeHistoryThreadMetadataIntoItem(parsed, cached?.thread);

      this.sessionSummaryCache.set(filePath, {
        sessionPath: filePath,
        mtimeMs: fileSnapshot.mtimeMs,
        size: fileSnapshot.size,
        thread: toPersistedThread(nextThread),
      });
      stats.parsedOk += 1;
      return nextThread;
    });

    const result: HistoryThread[] = [];
    for (const item of parsedItems) {
      if (item) result.push(item);
    }

    const mergeStart = performance.now();
    const merged = mergeAndSort(result);
    stats.mergeSortMs = Number((performance.now() - mergeStart).toFixed(1));
    stats.statMs = Number(stats.statMs.toFixed(1));
    stats.parseMs = Number(stats.parseMs.toFixed(1));

    const elapsedMs = performance.now() - t0;
    if (elapsedMs >= 900) {
      this.logDiag({
        ts: Date.now(),
        op: "history.scanDisk",
        phase: "slow",
        refreshId,
        elapsedMs: Number(elapsedMs.toFixed(1)),
        stats,
      });
    }

    return { items: merged, stats };
  }

  private async loadCacheIfNeeded() {
    if (this.initialized) return;
    const t0 = performance.now();
    this.initialized = true;
    const cacheState = await this.readCache();
    this.updateSnapshot(cacheState.items);
    this.sessionSummaryCache = new Map(cacheState.sessionSummaries.map((item) => [item.sessionPath, item]));
    const elapsedMs = Number((performance.now() - t0).toFixed(1));
    if (elapsedMs >= 120) {
      this.logDiag({
        ts: Date.now(),
        op: "history.loadCacheIfNeeded",
        elapsedMs,
        items: this.snapshot.length,
        sessionSummaries: this.sessionSummaryCache.size,
      });
    }
  }

  private async readThreadMessagesFromFile(filePath: string, limit: number): Promise<HistoryMessage[]> {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(2000, Math.round(limit))) : 120;
    const t0 = performance.now();
    const fileSnapshot = await this.getFileSnapshot(filePath);
    if (!fileSnapshot) return [];

    const cached = this.sessionMessagesCache.get(filePath);
    if (cached && sameFileSnapshot(cached, fileSnapshot)) {
      return cached.messages.length > safeLimit
        ? cached.messages.slice(cached.messages.length - safeLimit)
        : [...cached.messages];
    }

    const result: HistoryMessage[] = [];
    try {
      const reader = readline.createInterface({
        input: createReadStream(filePath, { encoding: "utf8" }),
        crlfDelay: Infinity,
      });
      for await (const line of reader) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let entry: any;
        try {
          entry = JSON.parse(trimmed);
        } catch {
          continue;
        }
        const msg = extractChatMessage(entry);
        if (!msg) continue;
        const prev = result[result.length - 1];
        if (prev && prev.role === msg.role && prev.text === msg.text) continue;
        result.push(msg);
      }
    } catch {
      return [];
    }
    this.sessionMessagesCache.set(filePath, {
      filePath,
      mtimeMs: fileSnapshot.mtimeMs,
      size: fileSnapshot.size,
      messages: result,
    });
    const elapsedMs = Number((performance.now() - t0).toFixed(1));
    if (elapsedMs >= 220) {
      this.logDiag({
        ts: Date.now(),
        op: "history.readThreadMessagesFromFile",
        elapsedMs,
        filePath,
        size: fileSnapshot.size,
        messages: result.length,
        returned: Math.min(result.length, safeLimit),
      });
    }
    return result.length > safeLimit ? result.slice(result.length - safeLimit) : result;
  }

  private async readSessionEventsFromFile(filePath: string, fileSnapshot: FileSnapshot): Promise<HistoryThreadEvent[]> {
    const cached = this.sessionEventsCache.get(filePath);
    if (cached && sameFileSnapshot(cached, fileSnapshot)) {
      return cached.events.map((item) => ({ ...item }));
    }

    const all: HistoryThreadEvent[] = [];
    const t0 = performance.now();
    try {
      const reader = readline.createInterface({
        input: createReadStream(filePath, { encoding: "utf8" }),
        crlfDelay: Infinity,
      });
      let lineNo = 0;
      for await (const line of reader) {
        lineNo += 1;
        const event = parseHistoryThreadEventLine(line, lineNo);
        if (!event) continue;
        all.push(event);
      }
    } catch {
      return [];
    }

    this.sessionEventsCache.set(filePath, {
      filePath,
      mtimeMs: fileSnapshot.mtimeMs,
      size: fileSnapshot.size,
      events: all,
    });
    const elapsedMs = Number((performance.now() - t0).toFixed(1));
    if (elapsedMs >= 350) {
      this.logDiag({
        ts: Date.now(),
        op: "history.readSessionEventsFromFile",
        elapsedMs,
        filePath,
        size: fileSnapshot.size,
        events: all.length,
      });
    }
    return all.map((item) => ({ ...item }));
  }

  private async readRecentSessionEventsFromFile(
    filePath: string,
    fileSnapshot: FileSnapshot,
    targetCount: number
  ): Promise<{ events: HistoryThreadEvent[]; reachedStart: boolean }> {
    if (targetCount <= 0) {
      return { events: [], reachedStart: true };
    }

    const t0 = performance.now();
    const linesToRead = Math.max(targetCount * 4, targetCount + 40);
    const tail = await readLastLines(filePath, linesToRead, fileSnapshot.size);
    const events: HistoryThreadEvent[] = [];
    let syntheticLineNo = 1;

    for (const line of tail.lines) {
      const event = parseHistoryThreadEventLine(line, syntheticLineNo);
      if (!event) continue;
      events.push(event);
      syntheticLineNo += 1;
    }

    if (events.length <= targetCount || tail.reachedStart) {
      const elapsedMs = Number((performance.now() - t0).toFixed(1));
      if (elapsedMs >= 160) {
        this.logDiag({
          ts: Date.now(),
          op: "history.readRecentSessionEventsFromFile",
          elapsedMs,
          filePath,
          size: fileSnapshot.size,
          targetCount,
          linesRead: tail.lines.length,
          events: events.length,
          reachedStart: tail.reachedStart,
        });
      }
      return {
        events,
        reachedStart: tail.reachedStart,
      };
    }

    {
      const elapsedMs = Number((performance.now() - t0).toFixed(1));
      if (elapsedMs >= 160) {
        this.logDiag({
          ts: Date.now(),
          op: "history.readRecentSessionEventsFromFile",
          elapsedMs,
          filePath,
          size: fileSnapshot.size,
          targetCount,
          linesRead: tail.lines.length,
          events: events.length,
          reachedStart: false,
        });
      }
    }
    return {
      events: events.slice(events.length - targetCount),
      reachedStart: false,
    };
  }

  private async getAuxEventsForThread(threadId: string): Promise<{ signature: string; events: HistoryThreadEvent[] }> {
    const t0 = performance.now();
    const auxFiles = await collectFileChangeAuxLogFiles();

    // 优先按 session 日期筛选对应的 file-change 日志，避免在历史回放时扫描巨大的日志全集。
    const tid = String(threadId ?? "").trim();
    const sessionPath = tid ? String(this.getThreadById(tid)?.sessionPath ?? "") : "";
    const sessionYmd = sessionPath ? extractYmdFromSessionPath(sessionPath) : "";
    const ymds = sessionYmd
      ? [ymdWithOffset(sessionYmd, -1), sessionYmd, ymdWithOffset(sessionYmd, 1)].filter(Boolean)
      : [];
    const filteredAuxFiles =
      ymds.length > 0
        ? auxFiles.filter((f) => {
            const name = basename(f.filePath);
            return ymds.some((ymd) => name.includes(ymd));
          })
        : auxFiles;

    // 若筛选不到（比如 sessionPath 不规范或日志缺失），回退到最新的少量文件，避免把历史加载拖死。
    const selectedAuxFiles =
      filteredAuxFiles.length > 0 ? filteredAuxFiles : [...auxFiles].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 3);

    const signature = buildAuxLogSignature(selectedAuxFiles);
    if (!signature) {
      this.auxThreadEventsCache.delete(threadId);
      return { signature: "", events: [] };
    }

    const cached = this.auxThreadEventsCache.get(threadId);
    if (cached && cached.signature === signature) {
      return {
        signature,
        events: cached.events.map((item) => ({ ...item })),
      };
    }

    const events = await readAuxNotificationsForThread(threadId, selectedAuxFiles, {
      tailBytes: 6_000_000,
      retryTailBytes: 24_000_000,
    });
    this.auxThreadEventsCache.set(threadId, {
      signature,
      events,
    });
    const elapsedMs = Number((performance.now() - t0).toFixed(1));
    if (elapsedMs >= 140) {
      this.logDiag({
        ts: Date.now(),
        op: "history.getAuxEventsForThread",
        elapsedMs,
        threadId,
        sessionYmd: sessionYmd || null,
        auxFiles: selectedAuxFiles.length,
        events: events.length,
      });
    }
    return {
      signature,
      events: events.map((item) => ({ ...item })),
    };
  }

  private async readThreadEventsFromFile(
    filePath: string,
    threadId: string,
    opts?: { limit?: number; before?: number; includeAux?: boolean }
  ): Promise<HistoryThreadEventsPage> {
    const safeLimit = Number.isFinite(opts?.limit) ? Math.max(1, Math.min(1000, Math.round(Number(opts?.limit)))) : 50;
    const before = Number.isFinite(opts?.before) ? Math.max(0, Math.round(Number(opts?.before))) : 0;
    const includeAux = opts?.includeAux !== false;
    const cacheKey = threadEventsCacheKey(threadId, includeAux);
    const fileSnapshot = await this.getFileSnapshot(filePath);
    if (!fileSnapshot) return { entries: [], total: 0, loaded: 0, hasMore: false };

    let auxSignature = "";
    let aux: HistoryThreadEvent[] = [];
    if (includeAux) {
      const auxResult = await this.getAuxEventsForThread(threadId);
      auxSignature = auxResult.signature;
      aux = auxResult.events;
    }
    const cached = this.threadEventsCache.get(cacheKey);
    if (
      cached &&
      cached.filePath === filePath &&
      cached.auxSignature === auxSignature &&
      cached.fileMtimeMs === fileSnapshot.mtimeMs &&
      cached.fileSize === fileSnapshot.size
    ) {
      return this.paginateThreadEvents(cached.events, opts);
    }

    const sessionEventsCached = this.sessionEventsCache.get(filePath);
    const canUseTailFastPath =
      before <= 0 && !(sessionEventsCached && sameFileSnapshot(sessionEventsCached, fileSnapshot));
    if (canUseTailFastPath) {
      const recentTarget = Math.max(safeLimit * 2 + 50, safeLimit + 80);
      const recent = await this.readRecentSessionEventsFromFile(filePath, fileSnapshot, recentTarget);
      const combinedRecent = [...recent.events, ...aux];
      const decoratedRecent = combinedRecent.map((event, index) => ({
        event,
        createdAt: toEpochMillis(event.timestamp) ?? index,
        seq: index,
      }));
      decoratedRecent.sort((a, b) => a.createdAt - b.createdAt || a.seq - b.seq);

      const normalizedRecent: HistoryThreadEvent[] = [];
      for (let i = 0; i < decoratedRecent.length; i += 1) {
        normalizedRecent.push({
          ...decoratedRecent[i].event,
          lineNo: i + 1,
        });
      }

      const pageEntries = normalizedRecent.slice(Math.max(0, normalizedRecent.length - safeLimit));
      const hasMore = !recent.reachedStart || normalizedRecent.length > pageEntries.length;
      const total = hasMore ? Math.max(pageEntries.length + 1, normalizedRecent.length) : normalizedRecent.length;
      const loaded = pageEntries.length;
      return {
        entries: pageEntries.map((item) => ({ ...item })),
        total,
        loaded,
        hasMore,
      };
    }

    const all = await this.readSessionEventsFromFile(filePath, fileSnapshot);
    const combined = [...all, ...aux];
    const decorated = combined.map((event, index) => ({
      event,
      createdAt: toEpochMillis(event.timestamp) ?? index,
      seq: index,
    }));
    decorated.sort((a, b) => a.createdAt - b.createdAt || a.seq - b.seq);

    const normalized: HistoryThreadEvent[] = [];
    for (let i = 0; i < decorated.length; i += 1) {
      normalized.push({
        ...decorated[i].event,
        lineNo: i + 1,
      });
    }

    this.threadEventsCache.set(cacheKey, {
      filePath,
      fileMtimeMs: fileSnapshot.mtimeMs,
      fileSize: fileSnapshot.size,
      auxSignature,
      events: normalized,
    });

    return this.paginateThreadEvents(normalized, opts);
  }

  private async readCache(): Promise<HistoryCacheState> {
    try {
      const raw = await readFile(this.cachePath, "utf8");
      return sanitizeCachedHistoryState(JSON.parse(raw));
    } catch {
      return {
        items: [],
        sessionSummaries: [],
      };
    }
  }

  private async writeCache(items: HistoryThread[]) {
    try {
      await mkdir(dirname(this.cachePath), { recursive: true });
      const payload: HistoryCachePayload = {
        version: 3,
        items: items.map(toPersistedThread),
        sessionSummaries: [...this.sessionSummaryCache.values()],
      };
      await writeFile(this.cachePath, JSON.stringify(payload, null, 2), "utf8");
    } catch (error) {
      console.error("[historyStore] write cache failed:", error);
    }
  }

  getMemoryCacheStats(): { items: number; bytes: number; updatedAt: number } {
    let items = this.snapshot.length;
    let bytes = estimateJsonBytes(this.snapshot);

    const sessionSummaries = [...this.sessionSummaryCache.values()];
    items += sessionSummaries.length;
    bytes += estimateJsonBytes(sessionSummaries);

    const sessionMessages = [...this.sessionMessagesCache.values()];
    for (const entry of sessionMessages) items += entry.messages.length;
    bytes += estimateJsonBytes(sessionMessages);

    const sessionEvents = [...this.sessionEventsCache.values()];
    for (const entry of sessionEvents) items += entry.events.length;
    bytes += estimateJsonBytes(sessionEvents);

    const threadEvents = [...this.threadEventsCache.values()];
    for (const entry of threadEvents) items += entry.events.length;
    bytes += estimateJsonBytes(threadEvents);

    const auxEvents = [...this.auxThreadEventsCache.values()];
    for (const entry of auxEvents) items += entry.events.length;
    bytes += estimateJsonBytes(auxEvents);

    return {
      items: Math.max(0, Math.round(items)),
      bytes: Math.max(0, Math.round(bytes)),
      updatedAt: Date.now(),
    };
  }

  clearMemoryCaches(): void {
    this.updateSnapshot([]);
    this.sessionSummaryCache.clear();
    this.sessionMessagesCache.clear();
    this.sessionEventsCache.clear();
    this.threadEventsCache.clear();
    this.auxThreadEventsCache.clear();
    this.refreshPromise = null;
    this.initialized = false;
  }

  private getSnapshot(): HistoryThread[] {
    return this.snapshot.map((item) => ({ ...item }));
  }
}
