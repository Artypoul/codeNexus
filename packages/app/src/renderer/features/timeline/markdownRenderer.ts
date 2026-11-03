import { installCjkFriendlyEmphasis } from "./markdownCjkEmphasis";

type MarkdownItConstructor = typeof import("markdown-it").default;
type MarkdownItInstance = InstanceType<MarkdownItConstructor>;
type DomPurify = typeof import("dompurify").default;

const sanitizeOptions = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ["target"],
  FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "input", "button", "textarea", "select"],
  FORBID_ATTR: [
    "onerror",
    "onload",
    "onclick",
    "onmouseover",
    "onfocus",
    "onmouseenter",
    "onmouseleave",
    "style",
    "formaction",
    "xlink:href",
  ],
  ALLOW_DATA_ATTR: false,
};

const CACHE_MAX = 320;
const CACHE_KEEP = 260;
const htmlCache = new Map<string, string>();
let markdown: MarkdownItInstance | null = null;
let DOMPurify: DomPurify | null = null;
let markdownDepsPromise: Promise<void> | null = null;
let markdownRendererVersion = 0;
const TABLE_ALIGNMENT_PATTERN = /text-align:\s*(left|center|right)/;

function moveTableAlignmentToClass(token: any) {
  const style = String(token.attrGet("style") ?? "");
  const match = TABLE_ALIGNMENT_PATTERN.exec(style);
  if (!match) return;
  token.attrJoin("class", `agent-align-${match[1]}`);
  token.attrSet("style", "");
}

function createMarkdownRenderer(MarkdownIt: MarkdownItConstructor) {
  // Markdown 解析配置：禁用原生 HTML，仅保留常用 markdown 能力。
  const renderer = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
    typographer: false,
  });
  installCjkFriendlyEmphasis(renderer);

  const originalLinkOpen =
    renderer.renderer.rules.link_open ??
    ((tokens: any[], idx: number, options: any, _env: any, self: any) => self.renderToken(tokens, idx, options));

  // 外链统一新窗口打开并加安全属性。
  renderer.renderer.rules.link_open = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    const token = tokens[idx];
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener noreferrer nofollow");
    return originalLinkOpen(tokens, idx, options, env, self);
  };

  const originalTableOpen =
    renderer.renderer.rules.table_open ??
    ((tokens: any[], idx: number, options: any, env: any, self: any) => self.renderToken(tokens, idx, options, env));

  const originalTableClose =
    renderer.renderer.rules.table_close ??
    ((tokens: any[], idx: number, options: any, env: any, self: any) => self.renderToken(tokens, idx, options, env));

  // Markdown 表格默认容易挤压列宽：统一加一层横向滚动容器，避免把聊天气泡撑得很拥挤。
  renderer.renderer.rules.table_open = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    return `<div class="agent-table-scroll app-scrollbar">${originalTableOpen(tokens, idx, options, env, self)}`;
  };

  renderer.renderer.rules.table_close = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    return `${originalTableClose(tokens, idx, options, env, self)}</div>`;
  };

  const originalThOpen =
    renderer.renderer.rules.th_open ??
    ((tokens: any[], idx: number, options: any, _env: any, self: any) => self.renderToken(tokens, idx, options));
  const originalTdOpen =
    renderer.renderer.rules.td_open ??
    ((tokens: any[], idx: number, options: any, _env: any, self: any) => self.renderToken(tokens, idx, options));

  // 清洗器会移除 style；把表格对齐转为 class，避免对齐信息丢失。
  renderer.renderer.rules.th_open = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    moveTableAlignmentToClass(tokens[idx]);
    return originalThOpen(tokens, idx, options, env, self);
  };

  renderer.renderer.rules.td_open = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    moveTableAlignmentToClass(tokens[idx]);
    return originalTdOpen(tokens, idx, options, env, self);
  };

  return renderer;
}

function loadMarkdownDeps() {
  if (markdown && DOMPurify) return Promise.resolve();
  if (!markdownDepsPromise) {
    markdownDepsPromise = Promise.all([import("markdown-it"), import("dompurify")])
      .then(([markdownItModule, domPurifyModule]) => {
        markdown = createMarkdownRenderer(markdownItModule.default);
        DOMPurify = domPurifyModule.default;
        markdownRendererVersion += 1;
      })
      .catch((error) => {
        markdownDepsPromise = null;
        throw error;
      });
  }
  return markdownDepsPromise;
}

// 控制缓存体积，超过阈值后清理最旧条目。
function pruneCacheIfNeeded() {
  if (htmlCache.size <= CACHE_MAX) return;
  const staleKeys = [...htmlCache.keys()].slice(0, Math.max(0, htmlCache.size - CACHE_KEEP));
  for (const key of staleKeys) htmlCache.delete(key);
}

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderPlainTextFallback(text: string) {
  const escaped = escapeHtml(text);
  if (!escaped) return "";
  return `<p>${escaped.replace(/\n/g, "<br>")}</p>`;
}

function renderMarkdown(text: string): string {
  if (!markdown) return renderPlainTextFallback(text);
  try {
    return markdown.render(text);
  } catch {
    // markdown 解析器异常时降级为纯文本段落，避免渲染崩溃。
    return `<p>${escapeHtml(text)}</p>`;
  }
}

export function renderMarkdownToSafeHtml(text: string, options: { cache?: boolean } = {}): string {
  const source = String(text ?? "");
  const shouldCache = options.cache !== false;
  const cached = shouldCache ? htmlCache.get(source) : null;
  if (cached != null) return cached;
  if (!markdown || !DOMPurify) {
    void loadMarkdownDeps().catch((error) => {
      console.warn("[markdown] lazy load failed", error);
    });
    return renderPlainTextFallback(source);
  }
  // 渲染后再做 DOMPurify 清洗，防止脚本/危险属性注入。
  const rendered = renderMarkdown(source);
  const sanitized = String(DOMPurify.sanitize(rendered, sanitizeOptions));
  if (shouldCache) {
    htmlCache.set(source, sanitized);
    pruneCacheIfNeeded();
  }
  return sanitized;
}

export function getMarkdownRendererVersion(): number {
  return markdownRendererVersion;
}

export function whenMarkdownRendererReady(): Promise<void> {
  return loadMarkdownDeps();
}

export function getMarkdownHtmlCacheStats(): { items: number; bytes: number; updatedAt: number } {
  let bytes = 0;
  for (const [key, value] of htmlCache.entries()) {
    bytes += key.length;
    bytes += value.length;
  }
  return {
    items: htmlCache.size,
    bytes: Math.max(0, Math.round(bytes)),
    updatedAt: Date.now(),
  };
}

export function clearMarkdownHtmlCache(): void {
  htmlCache.clear();
}
