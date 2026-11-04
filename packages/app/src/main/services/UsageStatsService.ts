import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import readline from "node:readline";
import type {
  TokenUsageStatsBreakdown,
  TokenUsageStatsDay,
  TokenUsageStatsModel,
  TokenUsageStatsResult,
} from "@codenexus/shared/ipc/contracts";

const USAGE_STATS_CACHE_VERSION = 1 as const;
const CODEX_CLIENT_NAME = "codex-electron-win";
const UNKNOWN_MODEL_LABEL = "unknown";
const FILE_SCAN_CONCURRENCY = 4;

type FileUsagePoint = TokenUsageStatsBreakdown & {
  day: string;
  model: string;
};

type UsageStatsFileCacheEntry = {
  filePath: string;
  mtimeMs: number;
  size: number;
  codexOwned: boolean;
  points: FileUsagePoint[];
};

type UsageStatsCachePayload = {
  version: typeof USAGE_STATS_CACHE_VERSION;
  files: UsageStatsFileCacheEntry[];
};

type ParsedUsageFile = {
  codexOwned: boolean;
  points: FileUsagePoint[];
};

type FileSnapshot = {
  mtimeMs: number;
  size: number;
};

function createEmptyBreakdown(): TokenUsageStatsBreakdown {
  return {
    requestCount: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
  };
}

function toNonNegativeNumber(value: unknown): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.max(0, Math.round(numberValue));
}

function normalizeBreakdown(value: unknown): TokenUsageStatsBreakdown {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    requestCount: toNonNegativeNumber(record.requestCount),
    totalTokens: toNonNegativeNumber(record.totalTokens),
    inputTokens: toNonNegativeNumber(record.inputTokens),
    outputTokens: toNonNegativeNumber(record.outputTokens),
    cachedInputTokens: toNonNegativeNumber(record.cachedInputTokens),
    cacheWriteInputTokens: toNonNegativeNumber(record.cacheWriteInputTokens),
  };
}

function addBreakdown(target: TokenUsageStatsBreakdown, source: TokenUsageStatsBreakdown): void {
  target.requestCount += source.requestCount;
  target.totalTokens += source.totalTokens;
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.cachedInputTokens += source.cachedInputTokens;
  target.cacheWriteInputTokens += source.cacheWriteInputTokens;
}

function toLocalYmd(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseYmd(value: unknown): { year: number; month: number; day: number; ymd: string } | null {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day, ymd: text };
}

function toRangeBoundaries(startDate: string, endDate: string) {
  const start = parseYmd(startDate);
  const end = parseYmd(endDate);
  if (!start) throw new Error("startDate must be a valid YYYY-MM-DD date");
  if (!end) throw new Error("endDate must be a valid YYYY-MM-DD date");

  const startAtMs = new Date(start.year, start.month - 1, start.day).getTime();
  const endExclusiveAtMs = new Date(end.year, end.month - 1, end.day + 1).getTime();
  if (startAtMs >= endExclusiveAtMs) throw new Error("startDate must be earlier than or equal to endDate");

  return {
    startDate: start.ymd,
    endDate: end.ymd,
    startAtMs,
    endExclusiveAtMs,
  };
}

function toEventTimestampMs(entry: any): number | null {
  const raw = entry?.timestamp;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 1_000_000_000_000 ? Math.round(raw) : Math.round(raw * 1000);
  }
  if (typeof raw !== "string" || !raw.trim()) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function readLastUsageBreakdown(info: unknown): TokenUsageStatsBreakdown | null {
  const infoRecord = info && typeof info === "object" ? (info as Record<string, unknown>) : null;
  const last =
    infoRecord?.last_token_usage && typeof infoRecord.last_token_usage === "object"
      ? (infoRecord.last_token_usage as Record<string, unknown>)
      : null;
  if (!last) return null;

  const inputTokens = toNonNegativeNumber(last.input_tokens);
  const outputTokens = toNonNegativeNumber(last.output_tokens);
  const cachedInputTokens = toNonNegativeNumber(last.cached_input_tokens);
  const cacheWriteInputTokens = toNonNegativeNumber(last.cache_write_input_tokens);
  const explicitTotal = toNonNegativeNumber(last.total_tokens);
  const totalTokens = explicitTotal > 0 ? explicitTotal : inputTokens + outputTokens;
  if (
    totalTokens <= 0 &&
    inputTokens <= 0 &&
    outputTokens <= 0 &&
    cachedInputTokens <= 0 &&
    cacheWriteInputTokens <= 0
  ) {
    return null;
  }

  return {
    requestCount: 1,
    totalTokens,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
  };
}

function addFilePoint(
  points: Map<string, FileUsagePoint>,
  timestampMs: number,
  model: string,
  breakdown: TokenUsageStatsBreakdown
) {
  const date = new Date(timestampMs);
  if (!Number.isFinite(date.getTime())) return;
  const day = toLocalYmd(date);
  const normalizedModel = String(model ?? "").trim() || UNKNOWN_MODEL_LABEL;
  const key = `${day}\u0000${normalizedModel}`;
  const existing = points.get(key);
  if (existing) {
    addBreakdown(existing, breakdown);
    return;
  }
  points.set(key, {
    day,
    model: normalizedModel,
    ...breakdown,
  });
}

async function parseUsageFile(filePath: string): Promise<ParsedUsageFile | null> {
  let codexOwned = false;
  let sessionMetaSeen = false;
  let currentModel = UNKNOWN_MODEL_LABEL;
  const points = new Map<string, FileUsagePoint>();
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of reader) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let entry: any;
      try {
        entry = JSON.parse(trimmed);
      } catch {
        continue;
      }

      if (!sessionMetaSeen && entry?.type === "session_meta") {
        sessionMetaSeen = true;
        codexOwned = String(entry?.payload?.originator ?? "").trim() === CODEX_CLIENT_NAME;
        if (!codexOwned) {
          try {
            reader.close();
          } catch {}
          try {
            stream.destroy();
          } catch {}
          return { codexOwned: false, points: [] };
        }
        continue;
      }

      if (!codexOwned) continue;

      if (entry?.type === "turn_context") {
        const model = String(entry?.payload?.model ?? "").trim();
        if (model) currentModel = model;
        continue;
      }

      if (entry?.type !== "event_msg" || entry?.payload?.type !== "token_count") continue;
      const timestampMs = toEventTimestampMs(entry);
      if (timestampMs == null) continue;
      const breakdown = readLastUsageBreakdown(entry?.payload?.info);
      if (!breakdown) continue;
      addFilePoint(points, timestampMs, currentModel, breakdown);
    }
  } catch {
    return null;
  } finally {
    try {
      reader.close();
    } catch {}
    try {
      stream.destroy();
    } catch {}
  }

  return {
    codexOwned,
    points: [...points.values()].sort(
      (left, right) => left.day.localeCompare(right.day) || left.model.localeCompare(right.model)
    ),
  };
}

function sanitizeFileCacheEntry(value: unknown): UsageStatsFileCacheEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const filePath = String(record.filePath ?? "").trim();
  const mtimeMs = toNonNegativeNumber(record.mtimeMs);
  const size = toNonNegativeNumber(record.size);
  const codexOwned = record.codexOwned === true;
  if (!filePath || !mtimeMs) return null;

  const points: FileUsagePoint[] = [];
  if (Array.isArray(record.points)) {
    for (const rawPoint of record.points) {
      if (!rawPoint || typeof rawPoint !== "object" || Array.isArray(rawPoint)) continue;
      const pointRecord = rawPoint as Record<string, unknown>;
      const day = String(pointRecord.day ?? "").trim();
      const model = String(pointRecord.model ?? "").trim();
      if (!parseYmd(day) || !model) continue;
      const breakdown = normalizeBreakdown(pointRecord);
      if (breakdown.requestCount <= 0) continue;
      points.push({ day, model, ...breakdown });
    }
  }

  return { filePath, mtimeMs, size, codexOwned, points };
}

function sanitizeCachePayload(value: unknown): UsageStatsFileCacheEntry[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  if (record.version !== USAGE_STATS_CACHE_VERSION || !Array.isArray(record.files)) return [];
  return record.files.map(sanitizeFileCacheEntry).filter((entry): entry is UsageStatsFileCacheEntry => Boolean(entry));
}

function extractSessionPathYmd(filePath: string): string {
  const match = String(filePath ?? "").match(/[\\/]+sessions[\\/]+(\d{4})[\\/]+(\d{2})[\\/]+(\d{2})[\\/]+/i);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

async function collectSessionFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [rootDir];
  while (pending.length > 0) {
    const current = pending.pop()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

export class UsageStatsService {
  private readonly sessionsRoot: string;
  private readonly cachePath: string;
  private cacheLoaded = false;
  private readonly fileCache = new Map<string, UsageStatsFileCacheEntry>();
  private queryQueue: Promise<unknown> = Promise.resolve();

  constructor(cachePath: string, sessionsRoot = join(homedir(), ".codex", "sessions")) {
    this.cachePath = cachePath;
    this.sessionsRoot = sessionsRoot;
  }

  async getTokenStats(args: { startDate: string; endDate: string }): Promise<TokenUsageStatsResult> {
    const query = this.queryQueue.catch(() => undefined).then(() => this.queryTokenStats(args));
    this.queryQueue = query.then(
      () => undefined,
      () => undefined
    );
    return await query;
  }

  private async queryTokenStats(args: { startDate: string; endDate: string }): Promise<TokenUsageStatsResult> {
    const range = toRangeBoundaries(args?.startDate, args?.endDate);
    await this.ensureCacheLoaded();

    const sessionFiles = await collectSessionFiles(this.sessionsRoot);
    const knownPaths = new Set(sessionFiles.map((filePath) => resolve(filePath)));
    for (const cachedPath of [...this.fileCache.keys()]) {
      if (!knownPaths.has(cachedPath)) this.fileCache.delete(cachedPath);
    }

    const candidateFiles: string[] = [];
    for (const filePath of sessionFiles) {
      const snapshot = await this.getFileSnapshot(filePath);
      if (!snapshot) continue;
      if (snapshot.mtimeMs < range.startAtMs) continue;
      const pathYmd = extractSessionPathYmd(filePath);
      if (pathYmd && pathYmd > range.endDate) continue;
      candidateFiles.push(filePath);
    }

    let cacheDirty = false;
    const parsed = await mapWithConcurrency(candidateFiles, FILE_SCAN_CONCURRENCY, async (filePath) => {
      const snapshot = await this.getFileSnapshot(filePath);
      if (!snapshot) return null;
      const key = resolve(filePath);
      const cached = this.fileCache.get(key);
      if (cached && cached.mtimeMs === snapshot.mtimeMs && cached.size === snapshot.size) {
        return cached;
      }
      const nextParsed = await parseUsageFile(filePath);
      if (!nextParsed) return cached ?? null;
      const nextEntry: UsageStatsFileCacheEntry = {
        filePath: key,
        mtimeMs: snapshot.mtimeMs,
        size: snapshot.size,
        ...nextParsed,
      };
      this.fileCache.set(key, nextEntry);
      cacheDirty = true;
      return nextEntry;
    });

    const modelsByName = new Map<string, TokenUsageStatsBreakdown>();
    const dailyByName = new Map<string, TokenUsageStatsBreakdown>();
    const totals = createEmptyBreakdown();
    for (const file of parsed) {
      if (!file?.codexOwned) continue;
      for (const point of file.points) {
        if (point.day < range.startDate || point.day > range.endDate) continue;
        addBreakdown(totals, point);
        let dayTotals = dailyByName.get(point.day);
        if (!dayTotals) {
          dayTotals = createEmptyBreakdown();
          dailyByName.set(point.day, dayTotals);
        }
        addBreakdown(dayTotals, point);
        let modelTotals = modelsByName.get(point.model);
        if (!modelTotals) {
          modelTotals = createEmptyBreakdown();
          modelsByName.set(point.model, modelTotals);
        }
        addBreakdown(modelTotals, point);
      }
    }

    const daily: TokenUsageStatsDay[] = [];
    const cursor = new Date(range.startAtMs);
    const endExclusive = new Date(range.endExclusiveAtMs);
    while (cursor.getTime() < endExclusive.getTime()) {
      const date = toLocalYmd(cursor);
      const breakdown = dailyByName.get(date) ?? createEmptyBreakdown();
      daily.push({ date, ...breakdown });
      cursor.setDate(cursor.getDate() + 1);
    }

    const models: TokenUsageStatsModel[] = [...modelsByName.entries()]
      .map(([model, breakdown]) => ({ model, ...breakdown }))
      .sort((left, right) => right.totalTokens - left.totalTokens || left.model.localeCompare(right.model));

    if (cacheDirty) await this.writeCache();

    return {
      startDate: range.startDate,
      endDate: range.endDate,
      summary: totals,
      daily,
      models,
      generatedAt: Date.now(),
    };
  }

  private async ensureCacheLoaded(): Promise<void> {
    if (this.cacheLoaded) return;
    this.cacheLoaded = true;
    try {
      const raw = await readFile(this.cachePath, "utf8");
      const entries = sanitizeCachePayload(JSON.parse(raw));
      for (const entry of entries) {
        this.fileCache.set(resolve(entry.filePath), {
          ...entry,
          filePath: resolve(entry.filePath),
        });
      }
    } catch {}
  }

  private async writeCache(): Promise<void> {
    try {
      await mkdir(dirname(this.cachePath), { recursive: true });
      const payload: UsageStatsCachePayload = {
        version: USAGE_STATS_CACHE_VERSION,
        files: [...this.fileCache.values()].map((entry) => ({
          ...entry,
          points: entry.points.map((point) => ({ ...point })),
        })),
      };
      await writeFile(this.cachePath, JSON.stringify(payload), "utf8");
    } catch {}
  }

  private async getFileSnapshot(filePath: string): Promise<FileSnapshot | null> {
    try {
      const info = await stat(filePath);
      return { mtimeMs: Math.round(info.mtimeMs), size: info.size };
    } catch {
      return null;
    }
  }
}
