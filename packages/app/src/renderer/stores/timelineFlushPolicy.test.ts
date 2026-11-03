import { describe, expect, it } from "vitest";
import {
  resolveStreamFlushPlan,
  STREAM_FLUSH_DELAY_MS,
  STREAM_FLUSH_FALLBACK_DELAY_MS,
  STREAM_FLUSH_HIDDEN_DELAY_MS,
} from "./timelineFlushPolicy";

describe("resolveStreamFlushPlan", () => {
  it("前台且有 rAF 时跟随帧，并保留兜底定时器", () => {
    expect(resolveStreamFlushPlan({ hidden: false, rafAvailable: true })).toEqual({
      useRaf: true,
      delayMs: STREAM_FLUSH_FALLBACK_DELAY_MS,
    });
  });

  it("前台但没有 rAF 时退回 33ms 定时器", () => {
    expect(resolveStreamFlushPlan({ hidden: false, rafAvailable: false })).toEqual({
      useRaf: false,
      delayMs: STREAM_FLUSH_DELAY_MS,
    });
  });

  it("后台时无论有没有 rAF 都降频到 250ms", () => {
    expect(resolveStreamFlushPlan({ hidden: true, rafAvailable: true })).toEqual({
      useRaf: false,
      delayMs: STREAM_FLUSH_HIDDEN_DELAY_MS,
    });
    expect(resolveStreamFlushPlan({ hidden: true, rafAvailable: false })).toEqual({
      useRaf: false,
      delayMs: STREAM_FLUSH_HIDDEN_DELAY_MS,
    });
  });
});
