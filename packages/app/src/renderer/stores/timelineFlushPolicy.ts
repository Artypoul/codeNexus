// 流式刷新的节奏策略：可见时跟随 rAF（带兜底定时器），后台时降频批量刷新。
export const STREAM_FLUSH_DELAY_MS = 33;
export const STREAM_FLUSH_FALLBACK_DELAY_MS = 120;
export const STREAM_FLUSH_HIDDEN_DELAY_MS = 250;

export type StreamFlushPlan = {
  useRaf: boolean;
  delayMs: number;
};

export function resolveStreamFlushPlan(params: { hidden: boolean; rafAvailable: boolean }): StreamFlushPlan {
  // 后台标签页的 rAF 会被暂停，只能靠定时器；同时把频率降到 250ms，减少无意义的重算。
  if (params.hidden) return { useRaf: false, delayMs: STREAM_FLUSH_HIDDEN_DELAY_MS };
  if (params.rafAvailable) return { useRaf: true, delayMs: STREAM_FLUSH_FALLBACK_DELAY_MS };
  return { useRaf: false, delayMs: STREAM_FLUSH_DELAY_MS };
}
