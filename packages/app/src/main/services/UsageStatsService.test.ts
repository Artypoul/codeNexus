import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UsageStatsService } from "./UsageStatsService";

const tempRoots: string[] = [];

function localNoonIso(ymd: string): string {
  const match = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("invalid date");
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0).toISOString();
}

function sessionMeta(originator = "codex-electron-win"): string {
  return JSON.stringify({
    type: "session_meta",
    payload: {
      id: "session-1",
      originator,
      model_provider: "test",
    },
  });
}

function turnContext(ymd: string, model: string): string {
  return JSON.stringify({
    timestamp: localNoonIso(ymd),
    type: "turn_context",
    payload: {
      turn_id: `turn-${model}`,
      model,
    },
  });
}

function tokenCount(
  ymd: string,
  usage: {
    input: number;
    cached?: number;
    cacheWrite?: number;
    output: number;
    total: number;
  }
): string {
  return JSON.stringify({
    timestamp: localNoonIso(ymd),
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: 9_999_999,
          cached_input_tokens: 9_999_999,
          cache_write_input_tokens: 9_999_999,
          output_tokens: 9_999_999,
          reasoning_output_tokens: 9_999_999,
          total_tokens: 19_999_998,
        },
        last_token_usage: {
          input_tokens: usage.input,
          cached_input_tokens: usage.cached ?? 0,
          cache_write_input_tokens: usage.cacheWrite ?? 0,
          output_tokens: usage.output,
          reasoning_output_tokens: 0,
          total_tokens: usage.total,
        },
        last_usage_includes_reasoning: false,
        model_context_window: 200_000,
      },
    },
  });
}

async function createFixture(files: Record<string, string[]>): Promise<{
  cachePath: string;
  sessionsRoot: string;
  filePaths: Map<string, string>;
}> {
  const root = await mkdtemp(join(tmpdir(), "codenexus-usage-"));
  tempRoots.push(root);
  const sessionsRoot = join(root, "sessions");
  const filePaths = new Map<string, string>();
  for (const [relativePath, lines] of Object.entries(files)) {
    const filePath = join(sessionsRoot, relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
    filePaths.set(relativePath, filePath);
  }
  return {
    cachePath: join(root, "usage-cache.json"),
    sessionsRoot,
    filePaths,
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("UsageStatsService", () => {
  it("aggregates per-request usage, attributes models, and ignores non-CodeNexus sessions", async () => {
    const fixture = await createFixture({
      "2026/04/01/rollout-one.jsonl": [
        sessionMeta(),
        turnContext("2026-04-01", "model-alpha"),
        tokenCount("2026-04-01", { input: 100, cached: 20, output: 50, total: 150 }),
        tokenCount("2026-04-01", { input: 200, cached: 100, cacheWrite: 7, output: 80, total: 280 }),
        turnContext("2026-04-02", "model-beta"),
        tokenCount("2026-04-02", { input: 40, output: 10, total: 50 }),
      ],
      "2026/04/01/rollout-other.jsonl": [
        sessionMeta("codex-cli"),
        turnContext("2026-04-01", "other-model"),
        tokenCount("2026-04-01", { input: 10_000, output: 10_000, total: 20_000 }),
      ],
    });
    const service = new UsageStatsService(fixture.cachePath, fixture.sessionsRoot);

    const result = await service.getTokenStats({ startDate: "2026-04-01", endDate: "2026-04-03" });

    expect(result.summary).toEqual({
      requestCount: 3,
      totalTokens: 480,
      inputTokens: 340,
      outputTokens: 140,
      cachedInputTokens: 120,
      cacheWriteInputTokens: 7,
    });
    expect(result.daily).toEqual([
      {
        date: "2026-04-01",
        requestCount: 2,
        totalTokens: 430,
        inputTokens: 300,
        outputTokens: 130,
        cachedInputTokens: 120,
        cacheWriteInputTokens: 7,
      },
      {
        date: "2026-04-02",
        requestCount: 1,
        totalTokens: 50,
        inputTokens: 40,
        outputTokens: 10,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
      },
      {
        date: "2026-04-03",
        requestCount: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
      },
    ]);
    expect(result.models).toEqual([
      {
        model: "model-alpha",
        requestCount: 2,
        totalTokens: 430,
        inputTokens: 300,
        outputTokens: 130,
        cachedInputTokens: 120,
        cacheWriteInputTokens: 7,
      },
      {
        model: "model-beta",
        requestCount: 1,
        totalTokens: 50,
        inputTokens: 40,
        outputTokens: 10,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
      },
    ]);
  });

  it("reuses cached aggregates and reparses a session after it changes", async () => {
    const fixture = await createFixture({
      "2026/04/01/rollout-cache.jsonl": [
        sessionMeta(),
        turnContext("2026-04-01", "model-alpha"),
        tokenCount("2026-04-01", { input: 10, output: 5, total: 15 }),
      ],
    });
    const firstService = new UsageStatsService(fixture.cachePath, fixture.sessionsRoot);
    const first = await firstService.getTokenStats({ startDate: "2026-04-01", endDate: "2026-04-01" });
    expect(first.summary.totalTokens).toBe(15);

    const filePath = fixture.filePaths.get("2026/04/01/rollout-cache.jsonl");
    expect(filePath).toBeTruthy();
    await appendFile(
      filePath!,
      `${tokenCount("2026-04-01", { input: 20, cached: 4, output: 6, total: 26 })}\n`,
      "utf8"
    );

    const secondService = new UsageStatsService(fixture.cachePath, fixture.sessionsRoot);
    const second = await secondService.getTokenStats({ startDate: "2026-04-01", endDate: "2026-04-01" });
    expect(second.summary).toMatchObject({
      requestCount: 2,
      totalTokens: 41,
      inputTokens: 30,
      outputTokens: 11,
      cachedInputTokens: 4,
    });
  });

  it("rejects invalid or reversed date ranges", async () => {
    const fixture = await createFixture({});
    const service = new UsageStatsService(fixture.cachePath, fixture.sessionsRoot);

    await expect(service.getTokenStats({ startDate: "2026-04-03", endDate: "2026-04-01" })).rejects.toThrow(
      "startDate must be earlier than or equal to endDate"
    );
    await expect(service.getTokenStats({ startDate: "2026-02-30", endDate: "2026-03-01" })).rejects.toThrow(
      "startDate must be a valid YYYY-MM-DD date"
    );
  });
});
