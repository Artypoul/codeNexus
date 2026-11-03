// Agent Markdown 渲染 Hook：把增量/流式 markdown 渲染为安全 HTML，并提供缓存清理。
import { onBeforeUnmount, shallowRef, watch } from "vue";
import { createLruCache } from "../../shared/lruCache";
import type { TimelineEventItem } from "../../domain/types";
import { stripInlineMemoryCitation } from "../../domain/taggedMessageBlocks";
import { getMarkdownRendererVersion, renderMarkdownToSafeHtml, whenMarkdownRendererReady } from "./markdownRenderer";

type AgentMarkdownRenderEntry = {
  renderedText: string;
  renderedHtml: string;
  pendingText: string | null;
  lastRenderedAt: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  settleTimer: ReturnType<typeof setTimeout> | null;
  rendererVersion: number;
  headText: string;
  headHtml: string;
  partial: boolean;
};

const AGENT_MARKDOWN_MIN_INTERVAL_MS = 48;
const AGENT_MARKDOWN_MAX_INTERVAL_MS = 120;
const AGENT_MARKDOWN_INTERVAL_PER_CHAR_MS = 0.006;
const AGENT_MARKDOWN_INTERVAL_FREE_CHARS = 1200;
const AGENT_MARKDOWN_EVENT_CACHE_MAX = 240;
const AGENT_MARKDOWN_EVENT_CACHE_KEEP = 180;
// 文本超过该长度后启用「稳定前缀 + 末尾块」增量渲染，避免每帧重排整段 Markdown。
const STREAM_INCREMENTAL_MIN_CHARS = 700;
// 末尾块过长（单个超长段落）时退回整段渲染，保证语义正确。
const STREAM_TAIL_MAX_CHARS = 2000;
// 文本停止增长的静置时间：到期后做一次完整渲染，修补分块渲染的边界差异。
const STREAM_SETTLE_MS = 280;

const FENCE_PATTERN = /^(`{3,}|~{3,})/;
const FENCE_CLOSE_PATTERN = /^(`{3,}|~{3,})\s*$/;
const LIST_ITEM_PATTERN = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)/;
const BLOCKQUOTE_PATTERN = /^ {0,3}>/;
const REFERENCE_DEFINITION_PATTERN = /^ {0,3}\[[^\]\n]+\]:/m;

type MarkdownLine = {
  text: string;
  end: number;
};

function splitMarkdownLines(text: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let start = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index !== text.length && text.charCodeAt(index) !== 10) continue;
    lines.push({ text: text.slice(start, index), end: index });
    start = index + 1;
  }
  return lines;
}

function readLineText(line: MarkdownLine): string {
  return line.text.endsWith("\r") ? line.text.slice(0, -1) : line.text;
}

function countIndentColumns(line: string): number {
  let columns = 0;
  for (const char of line) {
    if (char === " ") {
      columns += 1;
      continue;
    }
    if (char === "\t") {
      columns += 4 - (columns % 4);
      continue;
    }
    break;
  }
  return columns;
}

function findNextNonBlankLine(lines: MarkdownLine[], fromIndex: number): MarkdownLine | null {
  for (let index = fromIndex; index < lines.length; index += 1) {
    if (readLineText(lines[index]).trim()) return lines[index];
  }
  return null;
}

function isSafeStreamingSplit(previous: MarkdownLine | null, next: MarkdownLine): boolean {
  if (!previous) return false;
  const previousText = readLineText(previous);
  const nextText = readLineText(next);
  const previousIndent = countIndentColumns(previousText);
  const nextIndent = countIndentColumns(nextText);

  // 下一行是缩进代码块时不能切：空行可能仍属于代码块内容。
  if (nextIndent >= 4) return false;

  const previousInListContext = LIST_ITEM_PATTERN.test(previousText) || previousIndent >= 2;
  if (previousInListContext) {
    // 松散列表项之间、或列表项的缩进续行之间不能切。
    if (LIST_ITEM_PATTERN.test(nextText)) return false;
    if (nextIndent >= 2) return false;
  }

  // 连续引用块之间不能切，避免把同一引用拆成两段。
  if (BLOCKQUOTE_PATTERN.test(previousText) && BLOCKQUOTE_PATTERN.test(nextText)) return false;

  return true;
}

// 找出最后一个「空行之后的块起点」，且该位置不在未闭合的代码围栏内。
export function findStreamingSplitIndex(text: string): number {
  const length = text.length;
  if (length < 2) return 0;
  // 引用定义可以跨块生效，分块渲染会让 head 里的链接在 tail 中失效。
  if (REFERENCE_DEFINITION_PATTERN.test(text)) return 0;

  const lines = splitMarkdownLines(text);
  let inFence = false;
  let fenceChar = "";
  let fenceLength = 0;
  let splitIndex = 0;
  let previousNonBlank: MarkdownLine | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineText = readLineText(line);
    const indent = countIndentColumns(lineText);

    if (!inFence) {
      // 4 空格缩进属于代码块内容，不能当成围栏开头。
      if (indent >= 4) {
        previousNonBlank = line;
        continue;
      }
      const fence = FENCE_PATTERN.exec(lineText.trimStart());
      if (fence) {
        inFence = true;
        fenceChar = fence[1][0];
        fenceLength = fence[1].length;
        previousNonBlank = line;
        continue;
      }
      if (lineText.trim() === "") {
        const next = findNextNonBlankLine(lines, index + 1);
        if (next && isSafeStreamingSplit(previousNonBlank, next)) {
          splitIndex = line.end + 1;
        }
        continue;
      }
      previousNonBlank = line;
    } else {
      if (indent >= 4) continue;
      const close = FENCE_CLOSE_PATTERN.exec(lineText.trimStart());
      if (close && close[1][0] === fenceChar && close[1].length >= fenceLength) {
        inFence = false;
        fenceChar = "";
        fenceLength = 0;
        previousNonBlank = line;
      }
    }
  }
  return splitIndex;
}

// 渲染间隔随文本长度增长，把长文本的整段重渲染频率压到可接受范围。
function resolveRenderIntervalMs(textLength: number): number {
  const overflow = Math.max(0, textLength - AGENT_MARKDOWN_INTERVAL_FREE_CHARS);
  return Math.min(
    AGENT_MARKDOWN_MAX_INTERVAL_MS,
    AGENT_MARKDOWN_MIN_INTERVAL_MS + overflow * AGENT_MARKDOWN_INTERVAL_PER_CHAR_MS
  );
}

// 维护事件级 markdown 渲染缓存，避免高频 delta 触发抖动重渲染。
export function useAgentMarkdownRenderer(params: { key: () => string }) {
  const agentMarkdownRenderTick = shallowRef(0);
  let agentMarkdownByEventId = new Map<string, AgentMarkdownRenderEntry>();
  let activeKey = params.key();
  // Keep three inactive threads plus the active thread. Weight counts retained
  // text/HTML characters, so unusually large replies cannot fill every slot.
  const inactiveThreads = createLruCache<string, Map<string, AgentMarkdownRenderEntry>>(3, 3_000_000, (entries) =>
    [...entries.values()].reduce(
      (sum, entry) =>
        sum + entry.renderedText.length + entry.renderedHtml.length + entry.headText.length + entry.headHtml.length,
      0
    )
  );
  let markdownReadyListenerRegistered = false;

  const scheduleMarkdownReadyRefresh = () => {
    if (getMarkdownRendererVersion() > 0) return;
    if (markdownReadyListenerRegistered) return;
    markdownReadyListenerRegistered = true;
    void whenMarkdownRendererReady()
      .then(() => {
        markdownReadyListenerRegistered = false;
        agentMarkdownRenderTick.value += 1;
      })
      .catch(() => {
        markdownReadyListenerRegistered = false;
      });
  };

  const renderWithCurrentMarkdownRenderer = (text: string) => {
    const renderedHtml = renderMarkdownToSafeHtml(text, { cache: false });
    const rendererVersion = getMarkdownRendererVersion();
    if (rendererVersion === 0) scheduleMarkdownReadyRefresh();
    return { renderedHtml, rendererVersion };
  };

  // 读取渲染器版本；依赖尚未加载完成时登记一次就绪刷新，保证降级文本能被替换。
  const readRendererVersion = () => {
    const version = getMarkdownRendererVersion();
    if (version === 0) scheduleMarkdownReadyRefresh();
    return version;
  };

  const clearEntryTimer = (entry: AgentMarkdownRenderEntry) => {
    if (entry.flushTimer == null) return;
    clearTimeout(entry.flushTimer);
    entry.flushTimer = null;
  };

  const clearSettleTimer = (entry: AgentMarkdownRenderEntry) => {
    if (entry.settleTimer == null) return;
    clearTimeout(entry.settleTimer);
    entry.settleTimer = null;
  };

  // 增量渲染：稳定前缀只在其自身变化时重渲染，逐帧只处理末尾块。
  const renderIncremental = (text: string, entry: AgentMarkdownRenderEntry) => {
    if (text.length < STREAM_INCREMENTAL_MIN_CHARS) return null;
    const splitIndex = findStreamingSplitIndex(text);
    if (splitIndex <= 0) return null;
    const tailText = text.slice(splitIndex);
    if (tailText.length > STREAM_TAIL_MAX_CHARS) return null;
    const headText = text.slice(0, splitIndex);
    if (headText !== entry.headText) {
      entry.headText = headText;
      entry.headHtml = renderMarkdownToSafeHtml(headText, { cache: false });
    }
    if (!entry.headHtml) return null;
    const tailHtml = renderMarkdownToSafeHtml(tailText, { cache: false });
    return entry.headHtml + tailHtml;
  };

  // 文本静置后统一做一次完整渲染，消除分块渲染在列表、引用定义等边界的差异。
  const scheduleSettleRender = (entry: AgentMarkdownRenderEntry) => {
    clearSettleTimer(entry);
    entry.settleTimer = setTimeout(() => {
      entry.settleTimer = null;
      if (!entry.partial || entry.pendingText != null) return;
      if (!entry.renderedText) return;
      const { renderedHtml, rendererVersion } = renderWithCurrentMarkdownRenderer(entry.renderedText);
      entry.renderedHtml = renderedHtml;
      entry.rendererVersion = rendererVersion;
      entry.headText = "";
      entry.headHtml = "";
      entry.partial = false;
      entry.lastRenderedAt = Date.now();
      agentMarkdownRenderTick.value += 1;
    }, STREAM_SETTLE_MS);
  };

  const applyRender = (entry: AgentMarkdownRenderEntry, text: string) => {
    const incrementalHtml = renderIncremental(text, entry);
    if (incrementalHtml != null) {
      entry.renderedText = text;
      entry.renderedHtml = incrementalHtml;
      entry.rendererVersion = readRendererVersion();
      entry.partial = true;
      entry.lastRenderedAt = Date.now();
      scheduleSettleRender(entry);
      return incrementalHtml;
    }
    const { renderedHtml, rendererVersion } = renderWithCurrentMarkdownRenderer(text);
    entry.renderedText = text;
    entry.renderedHtml = renderedHtml;
    entry.rendererVersion = rendererVersion;
    entry.headText = "";
    entry.headHtml = "";
    entry.partial = false;
    entry.lastRenderedAt = Date.now();
    clearSettleTimer(entry);
    return renderedHtml;
  };

  // 缓存超过上限后丢弃最旧项。
  const pruneCache = () => {
    if (agentMarkdownByEventId.size <= AGENT_MARKDOWN_EVENT_CACHE_MAX) return;
    const dropCount = Math.max(0, agentMarkdownByEventId.size - AGENT_MARKDOWN_EVENT_CACHE_KEEP);
    if (dropCount <= 0) return;
    const staleIds = [...agentMarkdownByEventId.keys()].slice(0, dropCount);
    for (const staleId of staleIds) {
      const entry = agentMarkdownByEventId.get(staleId);
      if (entry) {
        clearEntryTimer(entry);
        clearSettleTimer(entry);
      }
      agentMarkdownByEventId.delete(staleId);
    }
  };

  // 清空事件缓存与全局 markdown 缓存。
  const clear = () => {
    for (const entries of [agentMarkdownByEventId, ...inactiveThreads.values()]) {
      for (const entry of entries.values()) {
        clearEntryTimer(entry);
        clearSettleTimer(entry);
      }
    }
    agentMarkdownByEventId.clear();
    inactiveThreads.clear();
    // 不清空全局 markdown 文本缓存：它自带上限与淘汰策略，频繁清空会导致切线程回放时反复重渲染。
  };

  // 获取指定事件的 markdown HTML；高频更新时做最小间隔节流。
  const getMarkdownEventHtml = (event: TimelineEventItem) => {
    void agentMarkdownRenderTick.value;
    const eventId = String(event.id ?? "").trim();
    const text = stripInlineMemoryCitation(event.paramsText);
    if (!eventId) return renderWithCurrentMarkdownRenderer(text).renderedHtml;
    const currentRendererVersion = getMarkdownRendererVersion();

    let entry = agentMarkdownByEventId.get(eventId);
    if (!entry) {
      entry = {
        renderedText: "",
        renderedHtml: "",
        pendingText: null,
        lastRenderedAt: 0,
        flushTimer: null,
        settleTimer: null,
        rendererVersion: -1,
        headText: "",
        headHtml: "",
        partial: false,
      };
      agentMarkdownByEventId.set(eventId, entry);
      pruneCache();
    }

    if (text === entry.renderedText && entry.pendingText == null && entry.rendererVersion === currentRendererVersion) {
      if (entry.partial && entry.settleTimer == null) scheduleSettleRender(entry);
      return entry.renderedHtml;
    }

    const now = Date.now();
    const elapsed = now - entry.lastRenderedAt;
    const intervalMs = resolveRenderIntervalMs(text.length);
    // 渲染器版本变化（Markdown 依赖加载完成/主题重建）时，前缀缓存必须失效。
    if (entry.rendererVersion !== currentRendererVersion) {
      entry.headText = "";
      entry.headHtml = "";
    }
    if (entry.renderedText.length === 0 || entry.rendererVersion !== currentRendererVersion || elapsed >= intervalMs) {
      clearEntryTimer(entry);
      entry.pendingText = null;
      return applyRender(entry, text);
    }

    entry.pendingText = text;
    if (entry.flushTimer == null) {
      const waitMs = Math.max(1, intervalMs - elapsed);
      entry.flushTimer = setTimeout(() => {
        entry!.flushTimer = null;
        if (entry!.pendingText == null) return;
        if (entry!.pendingText === entry!.renderedText) {
          entry!.pendingText = null;
          return;
        }
        const finalText = entry!.pendingText;
        entry!.pendingText = null;
        applyRender(entry!, finalText);
        agentMarkdownRenderTick.value += 1;
      }, waitMs);
    }
    return entry.renderedHtml || renderWithCurrentMarkdownRenderer(text).renderedHtml;
  };

  watch(
    () => params.key(),
    (key) => {
      for (const entry of agentMarkdownByEventId.values()) {
        clearEntryTimer(entry);
        clearSettleTimer(entry);
        entry.pendingText = null;
      }
      const restored = inactiveThreads.get(key);
      inactiveThreads.delete(key);
      inactiveThreads.set(activeKey, agentMarkdownByEventId);
      agentMarkdownByEventId = restored ?? new Map();
      activeKey = key;
    },
    { flush: "sync" }
  );

  onBeforeUnmount(() => {
    clear();
  });

  return { getMarkdownEventHtml, clear };
}
