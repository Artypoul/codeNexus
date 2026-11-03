const MAX_REASONING_PREVIEW_CHARS = 240;
const FENCE_PATTERN = /^(`{3,}|~{3,})/;
const FENCE_CLOSE_PATTERN = /^(`{3,}|~{3,})\s*$/;

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

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|");
  return cells.length > 0 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
}

function normalizeTableRow(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return line;
  const cells = trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean);
  return cells.length > 1 ? cells.join(" ") : line;
}

function stripInlineMarkdown(line: string): string {
  return (
    line
      // 图片保留 alt，链接保留文字。
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
      .replace(/\[([^\]]+)\]/g, "$1")
      // 自动链接与内联 HTML。
      .replace(/<((?:https?:\/\/|mailto:)[^>]+)>/g, "$1")
      .replace(/<\/?[A-Za-z][^>]*>/g, "")
      // 强调语法只在词边界生效，避免破坏 snake_case。
      .replace(/(^|[\s([{])(\*\*|__)(?=\S)(.*?\S)\2(?=$|[\s)\]},.;:!?])/g, "$1$3")
      .replace(/(^|[\s([{])(\*|_)(?=\S)(.*?\S)\1(?=$|[\s)\]},.;:!?])/g, "$1$3")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
  );
}

/**
 * 提取思考块头部展示的最后一行文本。
 * 跳过围栏/缩进代码、表格分隔行和引用标记，并尽量去掉常见 Markdown 装饰。
 */
export function toReasoningPreviewLine(value: string): string {
  const text = String(value ?? "").replace(/\r\n?/g, "\n");
  let inFence = false;
  let fenceChar = "";
  let fenceLength = 0;
  let lastLine = "";

  for (const rawLine of text.split("\n")) {
    const indent = countIndentColumns(rawLine);
    const trimmed = rawLine.trim();

    if (inFence) {
      if (indent < 4) {
        const close = FENCE_CLOSE_PATTERN.exec(trimmed);
        if (close && close[1][0] === fenceChar && close[1].length >= fenceLength) {
          inFence = false;
          fenceChar = "";
          fenceLength = 0;
        }
      }
      continue;
    }

    if (indent >= 4) continue;
    const fence = FENCE_PATTERN.exec(trimmed);
    if (fence) {
      inFence = true;
      fenceChar = fence[1][0];
      fenceLength = fence[1].length;
      continue;
    }

    if (!trimmed) continue;
    if (isTableSeparator(trimmed) || /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(rawLine)) {
      continue;
    }

    const line = trimmed
      .replace(/^(?:>\s?)+/, "")
      .replace(/^#{1,6}\s+/, "")
      .replace(/^(?:[-*+]|\d{1,9}[.)])\s+/, "");
    if (line) lastLine = line;
  }

  const normalized = stripInlineMarkdown(normalizeTableRow(lastLine)).replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_REASONING_PREVIEW_CHARS) return normalized;
  return `${normalized.slice(0, MAX_REASONING_PREVIEW_CHARS - 1)}…`;
}
