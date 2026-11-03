import type { McpResourceParameterEntry, McpServerState, TimelineEventItem } from "../../../domain/types";
import type { FileUpdateChange } from "@codenexus/generated/codex-app-server/v2/FileUpdateChange";
import type { PatchApplyStatus } from "@codenexus/generated/codex-app-server/v2/PatchApplyStatus";
import type { PatchChangeKind } from "@codenexus/generated/codex-app-server/v2/PatchChangeKind";
import { safeJsonStringify } from "../../../utils/safeJson";
import { translate } from "../../../i18n/translate";
import {
  parseMcpResourceReadEvent,
  toMcpResourceLookupKey,
  type ParsedMcpResourceReadContent,
  type ParsedMcpResourceReadEvent,
} from "./parsers/mcpResourceReadParser";
import { getDiffLineStats } from "./diff";

export type CommandGroupItemStatus = "running" | "completed" | "failed" | "unknown";
export type CommandEventMethod =
  | "item/started"
  | "item/completed"
  | "item/commandExecution/outputDelta"
  | "item/commandExecution/terminalInteraction";

export type CommandGroupItem = {
  id: string;
  outputKey: string;
  status: CommandGroupItemStatus;
  cwd: string;
  processId: string;
  source: string;
  actions: CommandParsedAction[];
  commandShort: string;
  commandFull: string;
  lastEventMethod: CommandEventMethod | "";
  outputPreview: string;
  outputFull: string;
  files: string[];
  filesCount: number;
  exitCode: number | null;
  durationMs: number | null;
  startedAt: number | null;
  completedAt: number | null;
};

export type CommandActionNode = {
  id: string;
  createdAt: number;
  turnId: string;
  item: CommandGroupItem;
};

export type CommandSessionNode = {
  id: string;
  createdAt: number;
  turnId: string;
  status: CommandGroupItemStatus;
  commandFull: string;
  commandShort: string;
  cwd: string;
  processId: string;
  source: string;
  outputFull: string;
  outputKey: string;
  outputPreview: string;
  recentOutputLines: string[];
  urls: string[];
  exitCode: number | null;
  durationMs: number | null;
  startedAt: number | null;
  completedAt: number | null;
};

export type CommandParsedAction = {
  type: "read" | "listFiles" | "search" | "unknown";
  command: string;
  name: string;
  path: string;
  query: string;
  startLine: number | null;
  endLine: number | null;
};

export type CommandReadNode = {
  id: string;
  createdAt: number;
  turnId: string;
  status: CommandGroupItemStatus;
  commandFull: string;
  outputFull: string;
  outputKey: string;
  exitCode: number | null;
  durationMs: number | null;
  name: string;
  path: string;
  startLine: number | null;
  endLine: number | null;
  lineCount: number;
  previewLines: string[];
};

export type CommandListNode = {
  id: string;
  createdAt: number;
  turnId: string;
  status: CommandGroupItemStatus;
  commandFull: string;
  outputFull: string;
  outputKey: string;
  path: string;
  files: string[];
  filesCount: number;
};

export type CommandSearchMatch = {
  path: string;
  line: number | null;
  column: number | null;
  text: string;
};

export type CommandSearchNode = {
  id: string;
  createdAt: number;
  turnId: string;
  status: CommandGroupItemStatus;
  commandFull: string;
  outputFull: string;
  outputKey: string;
  query: string;
  path: string;
  matches: CommandSearchMatch[];
  matchCount: number;
};

export type McpToolCallStatus = "running" | "completed" | "failed" | "unknown";

export type McpToolCallItem = {
  id: string;
  itemId: string;
  createdAt: number;
  turnId: string;
  server: string;
  tool: string;
  status: McpToolCallStatus;
  rawStatus: string;
  durationMs: number | null;
  startedAt: number | null;
  completedAt: number | null;
  argumentsSummary: string;
  argumentsRaw: string;
  resultSummary: string;
  pageSummary: string;
  snapshotSummary: string;
  eventsSummary: string;
  resultRaw: string;
  structuredContentRaw: string;
  metaRaw: string;
  outputSchemaRaw: string;
  errorText: string;
  argumentsKey: string;
  resultKey: string;
  structuredContentKey: string;
  metaKey: string;
  outputSchemaKey: string;
  relatedResourceUri: string;
  relatedResourceSourceTab: "resources" | "templates";
  relatedResourceTemplateKey: string;
  relatedResourceLabel: string;
};

export type McpToolGroupNode = {
  id: string;
  createdAt: number;
  secondBucket: number;
  turnId: string;
  items: McpToolCallItem[];
  stats: {
    total: number;
    running: number;
    completed: number;
    failed: number;
    unknown: number;
  };
};

export type FileChangeStatus = "running" | "completed" | "failed" | "declined" | "unknown";
export type FileChangeKind = "add" | "modify" | "delete" | "rename" | "unknown";

export type FileChangeFile = {
  pathAbs: string;
  pathRel: string;
  pathAbsTo?: string | null;
  pathRelTo?: string | null;
  kind: FileChangeKind;
  diffText: string;
  updatedAt: number;
};

export type FileChangeNode = {
  id: string;
  createdAt: number;
  turnId: string;
  status: FileChangeStatus;
  rawStatus: string;
  startedAt: number | null;
  completedAt: number | null;
  streamUpdateCount: number;
  isStreaming: boolean;
  counts: { add: number; modify: number; delete: number; rename: number; unknown: number };
  files: FileChangeFile[];
};

export type ReasoningBlockNode = {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  durationMs: number | null;
  turnId: string;
  openDefault: boolean;
  paragraphCount: number;
  text: string;
  rawContent: string[];
  rawText: string;
  rawContentCount: number;
};

export type McpResourceReadContentPreview = ParsedMcpResourceReadContent;

export type McpResourceReadNode = {
  id: string;
  createdAt: number;
  threadId: string;
  turnId: string;
  server: string;
  uri: string;
  sourceTab: "resources" | "templates";
  templateKey: string;
  status: "running" | "completed" | "failed";
  fetchedAt: number | null;
  resourceLabel: string;
  toolNames: string[];
  parameterEntries: McpResourceParameterEntry[];
  contentsCount: number;
  contents: McpResourceReadContentPreview[];
  previewText: string;
  mimeSummary: string;
  errorText: string;
};

export type TimelineRenderNode =
  | { id: string; kind: "event"; event: TimelineEventItem }
  | { id: string; kind: "reasoningBlock"; item: ReasoningBlockNode }
  | { id: string; kind: "commandAction"; item: CommandActionNode }
  | { id: string; kind: "commandSession"; item: CommandSessionNode }
  | { id: string; kind: "commandRead"; item: CommandReadNode }
  | { id: string; kind: "commandList"; item: CommandListNode }
  | { id: string; kind: "commandSearch"; item: CommandSearchNode }
  | { id: string; kind: "mcpToolGroup"; group: McpToolGroupNode }
  | { id: string; kind: "mcpResourceRead"; item: McpResourceReadNode }
  | { id: string; kind: "fileChange"; item: FileChangeNode };

type BuildTimelineNodesParams = {
  events: TimelineEventItem[];
  timelineKey: string;
  workspaceRoot: string;
  debug: boolean;
  mcpToolDefinitions?: ReadonlyMap<
    string,
    {
      name: string;
      title?: string;
      description?: string;
      inputSchema: unknown;
      outputSchema?: unknown;
      annotations?: unknown;
      _meta?: unknown;
    }
  > | null;
};

type McpToolDefinitionLookupEntry =
  NonNullable<BuildTimelineNodesParams["mcpToolDefinitions"]> extends ReadonlyMap<any, infer T> ? T : never;

export function toMcpToolDefinitionKey(serverValue: unknown, toolValue: unknown): string {
  const server = String(serverValue ?? "").trim();
  const tool = String(toolValue ?? "").trim();
  return server && tool ? `${server}::${tool}` : "";
}

export function buildMcpToolDefinitionIndex(
  servers: Array<Pick<McpServerState, "id" | "tools">> | null | undefined
): Map<string, McpServerState["tools"][number]> {
  const index = new Map<string, McpServerState["tools"][number]>();
  for (const server of servers ?? []) {
    const serverId = String(server?.id ?? "").trim();
    if (!serverId || !Array.isArray(server?.tools)) continue;
    for (const tool of server.tools) {
      const key = toMcpToolDefinitionKey(serverId, tool?.name);
      if (!key) continue;
      index.set(key, tool);
    }
  }
  return index;
}

const shortenText = (value: string, maxChars: number) => {
  const text = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
};

const deriveReasoningBlockTitle = (value: string): string | null => {
  const text = String(value ?? "");
  if (!text.trim()) return null;

  const firstNonEmptyLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstNonEmptyLine) return null;

  const headingMatch = firstNonEmptyLine.match(/^#{1,3}\s+(.+)$/);
  const boldLineMatch = firstNonEmptyLine.match(/^\*\*(.+)\*\*$/);
  const candidate = (headingMatch?.[1] ?? boldLineMatch?.[1] ?? "").replace(/\s+/g, " ").trim();
  if (!candidate) return null;

  // 防御极端长文本：截断标题，避免 UI 卡顿。
  return candidate.length > 200 ? candidate.slice(0, 200) : candidate;
};

const toCommandOutputPreview = (value: string) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? text;
  return shortenText(firstLine, 180);
};

const stripAnsi = (value: string) => {
  const text = String(value ?? "");
  if (!text) return "";
  return text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
};

const normalizeWhitespace = (value: string) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const LONG_RUNNING_COMMAND_PATTERNS = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview)\b/i,
  /\b(?:vite|next|nuxt|astro|webpack(?:-dev-server)?|vue-cli-service)\b/i,
  /\bflutter\s+run\b/i,
  /\bcargo\s+watch\b/i,
  /\b(?:dotnet\s+watch|air|nodemon|tsx\s+watch|ts-node-dev)\b/i,
  /\b(?:python|python3|py)\s+-m\s+(?:http\.server|uvicorn)\b/i,
  /\b(?:uvicorn|gunicorn|flask\s+run|rails\s+server|vite-node)\b/i,
];

const isPotentialLongRunningCommand = (cmd: string, source: string) => {
  const text = normalizeWhitespace(cmd);
  if (!text) return false;
  if (
    String(source ?? "")
      .toLowerCase()
      .includes("startup")
  )
    return true;
  return LONG_RUNNING_COMMAND_PATTERNS.some((pattern) => pattern.test(text));
};

const extractUrlsFromText = (value: string): string[] => {
  const text = stripAnsi(String(value ?? ""));
  if (!text) return [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s"'<>）)]+/gi)) {
    const url = String(match[0] ?? "").replace(/[.,;]+$/g, "");
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= 4) break;
  }
  return urls;
};

const recentMeaningfulOutputLines = (value: string, maxLines = 6): string[] => {
  const lines = stripAnsi(String(value ?? ""))
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  return lines.slice(Math.max(0, lines.length - maxLines));
};

const isDirectoryListingCommand = (cmd: string) =>
  /\b(get-childitem|gci|dir|ls)\b/i.test(String(cmd ?? "")) || /\brg\b[\s\S]*\s--files\b/i.test(String(cmd ?? ""));

const isReadCommand = (cmd: string) => /\b(get-content|cat|type)\b/i.test(String(cmd ?? ""));

const isSearchCommand = (cmd: string) =>
  /\b(rg|grep|findstr)\b/i.test(String(cmd ?? "")) || /\bselect-string\b/i.test(String(cmd ?? ""));

const parseGetChildItemOutputFiles = (output: string): { ok: boolean; files: string[] } => {
  const cleaned = stripAnsi(output);
  const lines = cleaned.split(/\r?\n/);

  // 表格格式：Name/Mode 两列（常见于 Format-Table 输出）
  const headerIndex = lines.findIndex((line) => /\bName\b/i.test(line) && /\bMode\b/i.test(line));
  if (headerIndex >= 0) {
    const header = lines[headerIndex] ?? "";
    const modeCol = header.search(/\bMode\b/i);
    if (modeCol < 1) return { ok: false, files: [] };

    const seen = new Set<string>();
    const files: string[] = [];
    const maxFiles = 5000;

    for (let i = headerIndex + 1; i < lines.length; i += 1) {
      const rawLine = lines[i] ?? "";
      const line = rawLine.replace(/\s+$/g, "");
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^-{2,}\s*-*\s*$/i.test(trimmed)) continue;
      if (/^Name\s+Mode\b/i.test(trimmed)) continue;
      if (trimmed.startsWith("---")) continue;

      const nameCandidate = line.length >= modeCol ? line.slice(0, modeCol).trimEnd() : "";
      const name = (nameCandidate || trimmed.split(/\s+/)[0] || "").trim();
      if (!name) continue;
      if (name === "----") continue;
      if (seen.has(name)) continue;
      seen.add(name);
      files.push(name);
      if (files.length >= maxFiles) break;
    }

    return { ok: true, files };
  }

  // 表格格式：仅 FullName 一列（常见于 Select-Object FullName 输出）
  const fullNameIndex = lines.findIndex((line) => /^\s*FullName\s*$/i.test(String(line ?? "")));
  if (fullNameIndex < 0) return { ok: false, files: [] };

  const seen = new Set<string>();
  const files: string[] = [];
  const maxFiles = 5000;

  for (let i = fullNameIndex + 1; i < lines.length; i += 1) {
    const trimmed = String(lines[i] ?? "").trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("---")) continue;
    if (/^FullName\s*$/i.test(trimmed)) continue;
    if (/^-{2,}\s*-*\s*$/i.test(trimmed)) continue;
    if (/^(Exit code|Wall time|Total output lines)\b/i.test(trimmed)) continue;
    if (/^Output:\s*$/i.test(trimmed)) continue;

    const value = trimmed;
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    files.push(value);
    if (files.length >= maxFiles) break;
  }

  return { ok: true, files };
};

const splitCommandOutputBody = (value: string): { headerLines: string[]; body: string } => {
  const text = stripAnsi(String(value ?? ""))
    .replace(/\r\n/g, "\n")
    .trimEnd();
  if (!text.trim()) return { headerLines: [], body: "" };
  const lines = text.split("\n");
  const idx = lines.findIndex(
    (line) =>
      String(line ?? "")
        .trim()
        .toLowerCase() === "output:"
  );
  if (idx < 0) return { headerLines: [], body: text };
  return {
    headerLines: lines
      .slice(0, idx)
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0),
    body: lines
      .slice(idx + 1)
      .join("\n")
      .trim(),
  };
};

const toMeaningfulOutputLines = (output: string) => {
  const { body } = splitCommandOutputBody(output);
  if (!body.trim()) return [];
  return body
    .split(/\n/)
    .map((line) => line.replace(/\r/g, "").trimEnd())
    .filter((line) => line.trim().length > 0);
};

const parsePlainFileListOutput = (output: string): { ok: boolean; files: string[] } => {
  const lines = toMeaningfulOutputLines(output);
  const seen = new Set<string>();
  const files: string[] = [];
  const maxFiles = 5000;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(Exit code|Wall time|Total output lines)\b/i.test(trimmed)) continue;
    if (/^Output:\s*$/i.test(trimmed)) continue;
    if (/^[-\s]+$/.test(trimmed)) continue;
    if (/^\w+:\s/.test(trimmed) && !/^[a-zA-Z]:[\\/]/.test(trimmed)) continue;
    const value = trimmed.replace(/\//g, "\\");
    if (seen.has(value)) continue;
    seen.add(value);
    files.push(value);
    if (files.length >= maxFiles) break;
  }
  return { ok: files.length > 0, files };
};

const parseCommandListOutputFiles = (output: string): { ok: boolean; files: string[] } => {
  const table = parseGetChildItemOutputFiles(output);
  if (table.ok) return table;
  return parsePlainFileListOutput(output);
};

const commandOutputBodyForPreview = (value: string): string => {
  const text = stripAnsi(String(value ?? ""))
    .replace(/\r\n/g, "\n")
    .trimEnd();
  if (!text.trim()) return "";
  const marker = /(?:^|\n)\s*output:\s*(?:\n|$)/i.exec(text);
  return marker ? text.slice(marker.index + marker[0].length).trim() : text;
};

const summarizeMeaningfulOutputLines = (
  output: string,
  maxPreviewLines: number
): { lineCount: number; previewLines: string[] } => {
  const body = commandOutputBodyForPreview(output);
  if (!body.trim()) return { lineCount: 0, previewLines: [] };

  const previewLines: string[] = [];
  let lineCount = 0;
  let start = 0;

  while (start <= body.length) {
    const nextBreak = body.indexOf("\n", start);
    const end = nextBreak >= 0 ? nextBreak : body.length;
    const line = body.slice(start, end).replace(/\r$/, "").trimEnd();
    if (line.trim()) {
      lineCount += 1;
      if (previewLines.length < maxPreviewLines) previewLines.push(line);
    }
    if (nextBreak < 0) break;
    start = nextBreak + 1;
  }

  return { lineCount, previewLines };
};

const readLineRangeFromAction = (raw: Record<string, any>): { startLine: number | null; endLine: number | null } => {
  const explicitStart =
    toPositiveLineNumberOrNull(raw.startLine) ??
    toPositiveLineNumberOrNull(raw.start_line) ??
    toPositiveLineNumberOrNull(raw.lineStart) ??
    toPositiveLineNumberOrNull(raw.line_start);
  const explicitEnd =
    toPositiveLineNumberOrNull(raw.endLine) ??
    toPositiveLineNumberOrNull(raw.end_line) ??
    toPositiveLineNumberOrNull(raw.lineEnd) ??
    toPositiveLineNumberOrNull(raw.line_end);
  if (explicitStart != null || explicitEnd != null) {
    return { startLine: explicitStart, endLine: explicitEnd };
  }

  const rangeValue = raw.lineRange ?? raw.line_range ?? raw.range;
  if (typeof rangeValue === "string") {
    const match = rangeValue.trim().match(/^L?(\d+)\s*[-:]\s*L?(\d+)$/i);
    if (match) {
      return {
        startLine: toPositiveLineNumberOrNull(match[1]),
        endLine: toPositiveLineNumberOrNull(match[2]),
      };
    }
  }
  if (rangeValue && typeof rangeValue === "object") {
    return {
      startLine:
        toPositiveLineNumberOrNull((rangeValue as any).startLine) ??
        toPositiveLineNumberOrNull((rangeValue as any).start) ??
        toPositiveLineNumberOrNull((rangeValue as any).from),
      endLine:
        toPositiveLineNumberOrNull((rangeValue as any).endLine) ??
        toPositiveLineNumberOrNull((rangeValue as any).end) ??
        toPositiveLineNumberOrNull((rangeValue as any).to),
    };
  }

  return { startLine: null, endLine: null };
};

const normalizeCommandParsedAction = (value: unknown, fallbackCommand: string): CommandParsedAction | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, any>;
  const rawType = String(raw.type ?? "")
    .trim()
    .toLowerCase();
  const type =
    rawType === "read"
      ? "read"
      : rawType === "listfiles" || rawType === "list_files"
        ? "listFiles"
        : rawType === "search"
          ? "search"
          : rawType === "unknown"
            ? "unknown"
            : null;
  if (!type) return null;
  const command = String(raw.command ?? raw.cmd ?? fallbackCommand ?? "").trim();
  const lineRange = readLineRangeFromAction(raw);
  return {
    type,
    command,
    name: String(raw.name ?? "").trim(),
    path: String(raw.path ?? "").trim(),
    query: String(raw.query ?? "").trim(),
    startLine: lineRange.startLine,
    endLine: lineRange.endLine,
  };
};

const normalizeCommandParsedActions = (value: unknown, fallbackCommand: string): CommandParsedAction[] => {
  const raw = Array.isArray(value) ? value : [];
  const actions = raw
    .map((entry) => normalizeCommandParsedAction(entry, fallbackCommand))
    .filter((entry): entry is CommandParsedAction => Boolean(entry));
  return actions;
};

const tokenizeCommandLike = (cmd: string): string[] => {
  const text = String(cmd ?? "").trim();
  if (!text) return [];
  const tokens: string[] = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(text))) {
    const token = String(match[1] ?? match[2] ?? match[3] ?? "").replace(/\\(["'\\])/g, "$1");
    if (token.trim()) tokens.push(token.trim());
  }
  return tokens;
};

const extractFlagTokenValue = (tokens: string[], ...flags: string[]) => {
  const wanted = new Set(flags.map((flag) => flag.toLowerCase()));
  for (let i = 0; i < tokens.length; i += 1) {
    const token = String(tokens[i] ?? "").toLowerCase();
    if (!wanted.has(token)) continue;
    const next = String(tokens[i + 1] ?? "").trim();
    if (next && next !== "|" && next !== ";") return next.replace(/[;|]+$/g, "");
  }
  return "";
};

const extractReadPathFromCommand = (command: string) => {
  const tokens = tokenizeCommandLike(command);
  const lower = tokens.map((token) => token.toLowerCase());
  const start = lower.findIndex((token) => token === "get-content" || token === "cat" || token === "type");
  if (start < 0) return "";
  const flagged = extractFlagTokenValue(tokens, "-Path", "-LiteralPath");
  if (flagged) return flagged;
  const flagsWithValue = new Set(["-encoding", "-totalcount", "-tail", "-readcount", "-delimiter", "-stream", "-head"]);
  for (let i = start + 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "|" || token === ";") break;
    if (token.startsWith("-")) {
      if (flagsWithValue.has(token.toLowerCase())) i += 1;
      continue;
    }
    return token.replace(/[;|]+$/g, "");
  }
  return "";
};

const extractListPathFromCommand = (command: string) => {
  const tokens = tokenizeCommandLike(command);
  const lower = tokens.map((token) => token.toLowerCase());
  if (lower.includes("--files")) {
    const rgIndex = lower.findIndex(
      (token) => token === "rg" || token.endsWith("\\rg.exe") || token.endsWith("/rg.exe")
    );
    const afterFiles = lower.indexOf("--files");
    for (let i = Math.max(rgIndex, afterFiles) + 1; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (!token || token.startsWith("-") || token === "|" || token === ";") continue;
      return token.replace(/[;|]+$/g, "");
    }
  }
  const start = lower.findIndex(
    (token) => token === "get-childitem" || token === "gci" || token === "dir" || token === "ls"
  );
  if (start < 0) return "";
  const flagged = extractFlagTokenValue(tokens, "-Path", "-LiteralPath");
  if (flagged) return flagged;
  for (let i = start + 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "|" || token === ";") break;
    if (token.startsWith("-")) {
      if (["-filter", "-include", "-exclude"].includes(token.toLowerCase())) i += 1;
      continue;
    }
    return token.replace(/[;|]+$/g, "");
  }
  return "";
};

const extractSearchInfoFromCommand = (command: string): { query: string; path: string } => {
  const tokens = tokenizeCommandLike(command);
  const lower = tokens.map((token) => token.toLowerCase());
  const selectStringIndex = lower.findIndex((token) => token === "select-string");
  if (selectStringIndex >= 0) {
    return {
      query: extractFlagTokenValue(tokens, "-Pattern"),
      path: extractFlagTokenValue(tokens, "-Path", "-LiteralPath"),
    };
  }
  const searchIndex = lower.findIndex(
    (token) =>
      token === "rg" ||
      token === "grep" ||
      token === "findstr" ||
      token.endsWith("\\rg.exe") ||
      token.endsWith("/rg.exe")
  );
  if (searchIndex < 0) return { query: "", path: "" };
  const positional: string[] = [];
  const flagsWithValue = new Set(["-g", "--glob", "--type", "--path-separator", "-e", "--regexp"]);
  for (let i = searchIndex + 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "|" || token === ";") break;
    if (token.startsWith("-")) {
      if (flagsWithValue.has(token.toLowerCase())) {
        if (token.toLowerCase() === "-e" || token.toLowerCase() === "--regexp") positional.push(tokens[i + 1] ?? "");
        i += 1;
      }
      continue;
    }
    positional.push(token.replace(/[;|]+$/g, ""));
    if (positional.length >= 2) break;
  }
  return { query: positional[0] ?? "", path: positional[1] ?? "" };
};

const firstVisualCommandAction = (item: CommandGroupItem): CommandParsedAction | null => {
  return (
    (item.actions ?? []).find(
      (action) => action.type === "read" || action.type === "listFiles" || action.type === "search"
    ) ?? null
  );
};

const inferFallbackCommandAction = (item: CommandGroupItem): CommandParsedAction | null => {
  const command = String(item.commandFull || item.commandShort || "").trim();
  if (!command) return null;
  if (isReadCommand(command))
    return {
      type: "read",
      command,
      name: "",
      path: extractReadPathFromCommand(command),
      query: "",
      startLine: null,
      endLine: null,
    };
  if (isDirectoryListingCommand(command))
    return {
      type: "listFiles",
      command,
      name: "",
      path: extractListPathFromCommand(command),
      query: "",
      startLine: null,
      endLine: null,
    };
  if (isSearchCommand(command)) {
    const { query, path } = extractSearchInfoFromCommand(command);
    return { type: "search", command, name: "", path, query, startLine: null, endLine: null };
  }
  return null;
};

const parseCommandSearchMatches = (output: string, workspaceRoot: string): CommandSearchMatch[] => {
  const lines = toMeaningfulOutputLines(output);
  const matches: CommandSearchMatch[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    const match = line.match(/^(.+?):(\d+)(?::(\d+))?:(.*)$/);
    if (match) {
      matches.push({
        path: toWorkspaceRelativePath(match[1] ?? "", workspaceRoot),
        line: Number.parseInt(match[2] ?? "", 10),
        column: match[3] ? Number.parseInt(match[3], 10) : null,
        text: String(match[4] ?? "").trim(),
      });
      continue;
    }
    matches.push({ path: "", line: null, column: null, text: line.trim() });
  }
  return matches;
};

const buildSpecializedCommandNode = (
  nodeId: string,
  createdAt: number,
  turnId: string,
  item: CommandGroupItem,
  workspaceRoot: string
): TimelineRenderNode | null => {
  const action = firstVisualCommandAction(item) ?? inferFallbackCommandAction(item);
  if (!action) return null;

  const commandFull = item.commandFull || action.command || item.commandShort;
  if (action.type === "read") {
    const outputSummary = summarizeMeaningfulOutputLines(item.outputFull, 40);
    const actionPath = action.path || "";
    const path = toWorkspaceRelativePath(actionPath, workspaceRoot) || actionPath;
    const fallbackName =
      path
        .split(/[\\/]+/)
        .filter(Boolean)
        .pop() ?? "";
    return {
      id: nodeId,
      kind: "commandRead",
      item: {
        id: nodeId,
        createdAt,
        turnId,
        status: ensureCommandGroupItemStatus(item),
        commandFull,
        outputFull: "",
        outputKey: item.outputKey,
        exitCode: item.exitCode,
        durationMs: item.durationMs,
        name: action.name || fallbackName || path || translate("timelineBuild.readContent"),
        path,
        startLine: action.startLine,
        endLine: action.endLine,
        lineCount: outputSummary.lineCount,
        previewLines: outputSummary.previewLines,
      },
    };
  }

  if (action.type === "listFiles") {
    const parsed = parseCommandListOutputFiles(item.outputFull);
    const files = parsed.ok
      ? parsed.files
          .map((file) => toWorkspaceRelativePath(String(file ?? ""), workspaceRoot))
          .filter((file) => file.trim().length > 0)
      : item.files;
    const path = action.path ? toWorkspaceRelativePath(action.path, workspaceRoot) || action.path : "";
    return {
      id: nodeId,
      kind: "commandList",
      item: {
        id: nodeId,
        createdAt,
        turnId,
        status: ensureCommandGroupItemStatus(item),
        commandFull,
        outputFull: item.outputFull,
        outputKey: item.outputKey,
        path,
        files,
        filesCount: Math.max(files.length, item.filesCount ?? 0),
      },
    };
  }

  if (action.type === "search") {
    const matches = parseCommandSearchMatches(item.outputFull, workspaceRoot);
    const path = action.path ? toWorkspaceRelativePath(action.path, workspaceRoot) || action.path : "";
    return {
      id: nodeId,
      kind: "commandSearch",
      item: {
        id: nodeId,
        createdAt,
        turnId,
        status: ensureCommandGroupItemStatus(item),
        commandFull,
        outputFull: item.outputFull,
        outputKey: item.outputKey,
        query: action.query,
        path,
        matches: matches.slice(0, 1000),
        matchCount: matches.length,
      },
    };
  }

  return null;
};

const buildCommandSessionNode = (
  nodeId: string,
  createdAt: number,
  turnId: string,
  item: CommandGroupItem
): TimelineRenderNode | null => {
  const status = ensureCommandGroupItemStatus(item);
  const commandFull = item.commandFull || item.commandShort;
  const processId = String(item.processId ?? "").trim();
  const source = String(item.source ?? "").trim();
  if (!processId) return null;
  if (!isPotentialLongRunningCommand(commandFull, source)) return null;

  return {
    id: nodeId,
    kind: "commandSession",
    item: {
      id: nodeId,
      createdAt,
      turnId,
      status,
      commandFull,
      commandShort: item.commandShort || shortenText(commandFull, 150),
      cwd: item.cwd,
      processId,
      source,
      outputFull: item.outputFull,
      outputKey: item.outputKey,
      outputPreview: item.outputPreview,
      recentOutputLines: recentMeaningfulOutputLines(item.outputFull),
      urls: extractUrlsFromText(item.outputFull),
      exitCode: item.exitCode,
      durationMs: item.durationMs,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
    },
  };
};

const toPrettyJsonOrText = (value: unknown) => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return safeJsonStringify(value, { space: 2 });
};

const toCompactJsonOrText = (value: unknown) => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return safeJsonStringify(value, { space: 0 });
};

const tryParseJsonText = (value: unknown): unknown | null => {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!text.startsWith("{") && !text.startsWith("[")) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const toInlineValueSummary = (value: unknown, maxChars: number) => {
  const raw = toCompactJsonOrText(value);
  return shortenText(raw, maxChars);
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extractMarkdownSection = (text: string, heading: string) => {
  const source = String(text ?? "");
  if (!source) return "";
  const regex = new RegExp(`(?:^|\\n)###\\s*${escapeRegExp(heading)}\\s*\\n([\\s\\S]*?)(?=\\n###\\s+|$)`, "i");
  const match = source.match(regex);
  return match?.[1]?.trim() ?? "";
};

const toFirstMeaningfulLine = (text: string) => {
  const lines = String(text ?? "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("###")) continue;
    if (trimmed.startsWith("```")) continue;
    const normalized = trimmed
      .replace(/^[-*]\s+/, "")
      .replace(/^\d+\.\s+/, "")
      .trim();
    if (!normalized) continue;
    return normalized;
  }
  return "";
};

const parseMcpFullToolName = (value: unknown): { server: string; tool: string } | null => {
  const raw = String(value ?? "").trim();
  if (!raw || !raw.startsWith("mcp__")) return null;
  const parts = raw.split("__").filter(Boolean);
  if (parts.length < 3) return null;
  const server = String(parts[1] ?? "").trim() || "unknown";
  const tool = String(parts.slice(2).join("__") ?? "").trim() || "mcpToolCall";
  return { server, tool };
};

const toMcpOutputText = (value: unknown): string => {
  const normalized = typeof value === "string" ? (tryParseJsonText(value) ?? value) : value;
  if (typeof normalized === "string") return normalized;
  if (!normalized || typeof normalized !== "object") return "";

  if (Array.isArray(normalized)) {
    const texts = normalized
      .map((part) => {
        if (typeof part === "string") return part.trim();
        if (!part || typeof part !== "object") return "";
        return String((part as Record<string, any>).text ?? "").trim();
      })
      .filter(Boolean);
    if (texts.length > 0) return texts.join("\n\n");
  }

  const candidate = normalized as Record<string, any>;
  const content = candidate.content;
  if (Array.isArray(content)) {
    const texts = content
      .map((part) => {
        if (typeof part === "string") return part.trim();
        if (!part || typeof part !== "object") return "";
        return String((part as Record<string, any>).text ?? "").trim();
      })
      .filter(Boolean);
    if (texts.length > 0) return texts.join("\n\n");
  }

  if (typeof candidate.text === "string") return candidate.text;
  if (typeof candidate.output === "string") return candidate.output;
  if (typeof candidate.message === "string") return candidate.message;
  if (typeof candidate.response === "string") return candidate.response;
  return "";
};

const toMcpResultText = (result: unknown) => {
  return toMcpOutputText(result);
};

const toMcpResultSummaries = (result: unknown) => {
  const resultText = toMcpResultText(result);
  const runSection = extractMarkdownSection(resultText, "Ran Playwright code");
  const pageSection = extractMarkdownSection(resultText, "Page");
  const snapshotSection = extractMarkdownSection(resultText, "Snapshot");
  const eventsSection = extractMarkdownSection(resultText, "Events");

  const runLine = toFirstMeaningfulLine(runSection);
  const fallbackLine = toFirstMeaningfulLine(resultText);

  const pageUrl = pageSection.match(/Page URL:\s*(.+)/i)?.[1]?.trim() ?? "";
  const pageTitle = pageSection.match(/Page Title:\s*(.+)/i)?.[1]?.trim() ?? "";
  const pageLine = toFirstMeaningfulLine(pageSection);

  const snapshotLines = snapshotSection
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("```"));
  const snapshotLine = snapshotLines[0] ?? "";

  const eventLines = eventsSection
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));
  const firstEventLine = eventLines[0]?.replace(/^-+\s*/, "").trim() ?? "";

  const resultSummary = runLine
    ? translate("timelineBuild.executing", { text: shortenText(runLine, 180) })
    : fallbackLine
      ? translate("timelineBuild.result", { text: shortenText(fallbackLine, 180) })
      : toInlineValueSummary(result, 180)
        ? translate("timelineBuild.result", { text: toInlineValueSummary(result, 180) })
        : "";

  const pageSummary =
    pageUrl || pageTitle
      ? translate("timelineBuild.page", {
          text: shortenText([pageTitle, pageUrl].filter(Boolean).join(translate("timelineFormat.separator")), 220),
        })
      : pageLine
        ? translate("timelineBuild.page", { text: shortenText(pageLine, 220) })
        : "";

  const snapshotSummary =
    snapshotLines.length > 0
      ? translate("timelineBuild.snapshot", {
          text: shortenText(snapshotLine || translate("timelineBuild.lineCount", { count: snapshotLines.length }), 180),
        })
      : "";

  const eventsSummary =
    eventLines.length > 0
      ? translate("timelineBuild.events", { count: eventLines.length, text: shortenText(firstEventLine, 180) })
      : "";

  return { resultSummary, pageSummary, snapshotSummary, eventsSummary };
};

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
};

const toEpochMs = (value: unknown): number | null => {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return raw >= 1_000_000_000_000 ? Math.round(raw) : Math.round(raw * 1000);
};

const eventLifecycleTimeMs = (event: TimelineEventItem, payload: Record<string, any> | null): number => {
  if (event.method === "item/started") return toEpochMs(payload?.startedAtMs) ?? event.createdAt;
  if (event.method === "item/completed") return toEpochMs(payload?.completedAtMs) ?? event.createdAt;
  return event.createdAt;
};

const toPositiveLineNumberOrNull = (value: unknown): number | null => {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  if (!Number.isFinite(numberValue)) return null;
  const rounded = Math.floor(numberValue);
  return rounded > 0 ? rounded : null;
};

const toEventParamsObject = (event: TimelineEventItem): Record<string, any> | null => {
  if (event.params && typeof event.params === "object") return event.params as Record<string, any>;
  const text = String(event.paramsText ?? "").trim();
  if (!text || !text.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed as Record<string, any>;
  } catch {
    // 无需处理
  }
  return null;
};

const normalizeFsPath = (value: string): string => {
  return String(value ?? "")
    .trim()
    .replace(/\//g, "\\");
};

const toWorkspaceRelativePath = (pathValue: string, workspaceRootValue: string): string => {
  const path = normalizeFsPath(pathValue);
  const workspaceRoot = normalizeFsPath(workspaceRootValue).replace(/\\+$/g, "");
  if (!path || !workspaceRoot) return path || workspaceRoot || "";
  const pathLower = path.toLowerCase();
  const rootLower = workspaceRoot.toLowerCase();
  if (pathLower === rootLower) return ".";
  if (!pathLower.startsWith(`${rootLower}\\`)) return path;
  return path.slice(workspaceRoot.length).replace(/^\\+/, "") || ".";
};

const toPatchChangeKind = (raw: unknown): PatchChangeKind | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const type = (raw as { type?: unknown }).type;
  if (type === "add") return { type };
  if (type === "delete") return { type };
  if (type === "update") {
    const movePathRaw = (raw as { move_path?: unknown }).move_path;
    return { type, move_path: typeof movePathRaw === "string" ? movePathRaw : null };
  }
  return null;
};

const resolveFileChangeKind = (raw: unknown): FileChangeKind => {
  const kind = toPatchChangeKind(raw);
  if (!kind) return "unknown";
  if (kind.type === "add") return "add";
  if (kind.type === "delete") return "delete";
  if (kind.type === "update") return String(kind.move_path ?? "").trim() ? "rename" : "modify";
  return "unknown";
};

const resolveFileChangeMovePath = (raw: unknown): string => {
  const kind = toPatchChangeKind(raw);
  if (kind?.type !== "update") return "";
  return normalizeFsPath(String(kind.move_path ?? ""));
};

const toPatchApplyStatus = (raw: unknown): PatchApplyStatus | "" => {
  if (raw === "inProgress" || raw === "completed" || raw === "failed" || raw === "declined") return raw;
  return "";
};

const resolveFileChangeStatusFromRaw = (
  statusRaw: PatchApplyStatus | "",
  method: "item/started" | "item/completed" | "item/fileChange/patchUpdated",
  hasError: boolean
): FileChangeStatus => {
  if (hasError) return "failed";
  if (statusRaw === "declined") return "declined";
  if (statusRaw === "failed") return "failed";
  if (statusRaw === "completed") return "completed";
  if (statusRaw === "inProgress") return "running";
  if (method === "item/started") return "running";
  if (method === "item/fileChange/patchUpdated") return "running";
  if (method === "item/completed") return "completed";
  return "unknown";
};

type ParsedFileChangeEvent = {
  itemId: string;
  turnId: string;
  method: "item/started" | "item/completed" | "item/fileChange/patchUpdated";
  statusRaw: PatchApplyStatus | "";
  changes: Array<{ pathAbs: string; pathAbsTo: string | null; kind: FileChangeKind; diffText: string }>;
  createdAt: number;
  hasError: boolean;
};

const parseOfficialFileUpdateChanges = (
  changesRaw: unknown
): Array<{ pathAbs: string; pathAbsTo: string | null; kind: FileChangeKind; diffText: string }> => {
  if (!Array.isArray(changesRaw)) return [];
  const changes: Array<{ pathAbs: string; pathAbsTo: string | null; kind: FileChangeKind; diffText: string }> = [];
  for (const rawChange of changesRaw) {
    if (!rawChange || typeof rawChange !== "object" || Array.isArray(rawChange)) continue;
    const change = rawChange as Partial<FileUpdateChange>;
    const pathAbs = normalizeFsPath(String(change.path ?? ""));
    if (!pathAbs) continue;
    const kindRaw = change.kind;
    const kind = resolveFileChangeKind(kindRaw);
    const pathAbsTo = resolveFileChangeMovePath(kindRaw);
    const diffText = typeof change.diff === "string" ? change.diff : "";
    changes.push({ pathAbs, pathAbsTo: pathAbsTo.trim() ? pathAbsTo : null, kind, diffText });
  }
  return changes;
};

const parseFileChangeEvent = (event: TimelineEventItem): ParsedFileChangeEvent | null => {
  const payload = toEventParamsObject(event);
  if (!payload) return null;

  if (event.method === "item/fileChange/patchUpdated") {
    const itemId = String(payload.itemId ?? "").trim();
    if (!itemId) return null;
    const turnId = String(payload.turnId ?? event.turnId ?? "").trim() || "unknown";
    return {
      itemId,
      turnId,
      method: event.method,
      statusRaw: "inProgress",
      changes: parseOfficialFileUpdateChanges(payload.changes),
      createdAt: event.createdAt,
      hasError: false,
    };
  }

  if (event.method !== "item/started" && event.method !== "item/completed") return null;
  const item = payload.item;
  if (!item || typeof item !== "object") return null;
  if ((item as { type?: unknown }).type !== "fileChange") return null;
  const itemId = String((item as any).id ?? payload.itemId ?? "").trim();
  if (!itemId) return null;
  const turnId = String(payload.turnId ?? event.turnId ?? "").trim() || "unknown";
  const statusRaw = toPatchApplyStatus((item as any).status ?? payload.status);
  const hasError = Boolean((item as any).error ?? payload.error);

  return {
    itemId,
    turnId,
    method: event.method,
    statusRaw,
    changes: parseOfficialFileUpdateChanges((item as any).changes),
    createdAt: eventLifecycleTimeMs(event, payload),
    hasError,
  };
};

type ParsedCommandEvent = {
  itemId: string;
  turnId: string;
  method: CommandEventMethod;
  command: string;
  cwd: string;
  processId: string;
  source: string;
  actions: CommandParsedAction[];
  hasCommand: boolean;
  statusRaw: string;
  exitCode: number | null;
  durationMs: number | null;
  output: string;
  createdAt: number;
};

const parseCommandExecutionEvent = (event: TimelineEventItem): ParsedCommandEvent | null => {
  if (
    event.method !== "item/started" &&
    event.method !== "item/completed" &&
    event.method !== "item/commandExecution/outputDelta" &&
    event.method !== "item/commandExecution/terminalInteraction"
  )
    return null;
  const payload = toEventParamsObject(event);
  if (!payload) return null;

  if (event.method === "item/commandExecution/terminalInteraction") {
    const itemId = String(payload.itemId ?? "").trim();
    if (!itemId) return null;
    const turnId = String(payload.turnId ?? event.turnId ?? "").trim() || "unknown";
    const stdin = String(payload.stdin ?? event.paramsText ?? "");
    return {
      itemId,
      turnId,
      method: event.method,
      command: translate("timelineBuild.terminalInteraction"),
      cwd: "",
      processId: String(payload.processId ?? "").trim(),
      source: "terminalInteraction",
      actions: [],
      hasCommand: false,
      statusRaw: "running",
      exitCode: null,
      durationMs: null,
      output: stdin ? `[stdin]\n${stdin}` : "[stdin]",
      createdAt: event.createdAt,
    };
  }

  const item = payload.item;
  if (!item || typeof item !== "object") return null;
  if (String(item.type ?? "").trim() !== "commandExecution") return null;
  const itemId = String(item.id ?? "").trim();
  if (!itemId) return null;
  const commandAction = String(item.commandActions?.[0]?.command ?? "").trim();
  const commandRaw = String(item.command ?? "").trim();
  const hasCommand = Boolean(commandAction || commandRaw);
  const command = commandAction || commandRaw || translate("timelineBuild.commandExecution");
  const actions = normalizeCommandParsedActions(item.commandActions, command);
  const turnId = String(payload.turnId ?? event.turnId ?? "").trim() || "unknown";
  return {
    itemId,
    turnId,
    method: event.method,
    command,
    cwd: String(item.cwd ?? "").trim(),
    processId: String(item.processId ?? "").trim(),
    source: String(item.source ?? "").trim(),
    actions,
    hasCommand,
    statusRaw: String(item.status ?? "").trim(),
    exitCode: toNumberOrNull(item.exitCode),
    durationMs: toNumberOrNull(item.durationMs),
    output:
      event.method === "item/commandExecution/outputDelta"
        ? String(event.paramsText ?? "")
        : typeof item.aggregatedOutput === "string"
          ? item.aggregatedOutput
          : "",
    createdAt: eventLifecycleTimeMs(event, payload),
  };
};

type ParsedReasoningSummaryEvent = {
  threadId: string;
  turnId: string;
  itemId: string;
  summaryIndex: number;
  sectionText: string;
  createdAt: number;
};

const parseReasoningSummaryEvent = (event: TimelineEventItem): ParsedReasoningSummaryEvent | null => {
  if (event.method !== "item/reasoning/summaryTextDelta") return null;
  const payload = toEventParamsObject(event) ?? {};

  const threadId = String(payload.threadId ?? event.threadId ?? "").trim();
  const turnId = String(payload.turnId ?? event.turnId ?? "").trim() || "unknown";
  const itemId = String(payload.itemId ?? payload.item?.id ?? "").trim();
  if (!threadId) return null;

  const summaryIndexRaw = payload.summaryIndex;
  const summaryIndexNum = toNumberOrNull(summaryIndexRaw);
  const summaryIndex = summaryIndexNum == null ? 0 : Math.max(0, Math.round(summaryIndexNum));

  return {
    threadId,
    turnId,
    itemId,
    summaryIndex,
    sectionText: String(event.paramsText ?? ""),
    createdAt: event.createdAt,
  };
};

type ParsedReasoningRawTextEvent = {
  threadId: string;
  turnId: string;
  itemId: string;
  contentIndex: number;
  rawText: string;
  createdAt: number;
};

const parseReasoningRawTextEvent = (event: TimelineEventItem): ParsedReasoningRawTextEvent | null => {
  if (event.method !== "item/reasoning/textDelta") return null;
  const payload = toEventParamsObject(event) ?? {};

  const threadId = String(payload.threadId ?? event.threadId ?? "").trim();
  const turnId = String(payload.turnId ?? event.turnId ?? "").trim() || "unknown";
  const itemId = String(payload.itemId ?? payload.item?.id ?? "").trim();
  if (!threadId || !itemId) return null;

  const contentIndexRaw = payload.contentIndex;
  const contentIndexNum = toNumberOrNull(contentIndexRaw);
  const contentIndex = contentIndexNum == null ? 0 : Math.max(0, Math.round(contentIndexNum));

  return {
    threadId,
    turnId,
    itemId,
    contentIndex,
    rawText: String(event.paramsText ?? ""),
    createdAt: event.createdAt,
  };
};

type ParsedMcpToolCallEvent = {
  itemId: string;
  turnId: string;
  method: "item/started" | "item/completed" | "item/mcpToolCall/progress";
  server: string;
  tool: string;
  statusRaw: string;
  durationMs: number | null;
  argumentsSummary: string;
  argumentsRaw: string;
  resultSummary: string;
  pageSummary: string;
  snapshotSummary: string;
  eventsSummary: string;
  resultRaw: string;
  structuredContentRaw: string;
  metaRaw: string;
  outputSchemaRaw: string;
  errorText: string;
  relatedResourceUri: string;
  relatedResourceSourceTab: "resources" | "templates";
  relatedResourceTemplateKey: string;
  relatedResourceLabel: string;
  createdAt: number;
};

type McpCallHint = {
  callId: string;
  server: string;
  tool: string;
  argumentsValue: unknown;
  resultValue: unknown;
};

const MCP_RESOURCE_URI_FIELD_KEYS = new Set(["uri", "resourceuri", "resource_uri"]);

const findExplicitResourceUri = (value: unknown, depth = 0, seen = new Set<unknown>()): string => {
  if (depth > 4 || value == null) return "";
  if (typeof value === "string") return "";
  if (typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findExplicitResourceUri(entry, depth + 1, seen);
      if (found) return found;
    }
    return "";
  }

  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = rawKey.trim().toLowerCase();
    if (MCP_RESOURCE_URI_FIELD_KEYS.has(key) && typeof rawValue === "string" && rawValue.trim()) {
      return rawValue.trim();
    }
  }

  for (const rawValue of Object.values(value as Record<string, unknown>)) {
    const found = findExplicitResourceUri(rawValue, depth + 1, seen);
    if (found) return found;
  }
  return "";
};

const resolveMcpStatusFromRaw = (
  statusRaw: string,
  method: "item/started" | "item/completed" | "item/mcpToolCall/progress",
  hasError: boolean
): McpToolCallStatus => {
  if (hasError) return "failed";
  const normalized = String(statusRaw ?? "")
    .trim()
    .toLowerCase();
  if (/(fail|error|cancel|declin|denied|timeout)/.test(normalized)) return "failed";
  if (/(complete|success|done|succeed|finished)/.test(normalized)) return "completed";
  if (/(inprogress|running|start|pending|queued)/.test(normalized)) return "running";
  if (method === "item/started") return "running";
  if (method === "item/completed") return "completed";
  if (method === "item/mcpToolCall/progress") return "running";
  return "unknown";
};

const parseMcpRawResponseItemEvent = (event: TimelineEventItem): Partial<McpCallHint> | null => {
  if (event.method !== "rawResponseItem/completed") return null;
  const payload = toEventParamsObject(event);
  if (!payload) return null;
  const rawItem = payload.item && typeof payload.item === "object" ? (payload.item as Record<string, any>) : null;
  if (!rawItem) return null;

  const rawType = String(rawItem.type ?? "")
    .trim()
    .toLowerCase();
  const callId = String(rawItem.call_id ?? "").trim();
  if (!callId) return null;

  if (rawType === "function_call") {
    const nameRaw = String(rawItem.name ?? "").trim();
    const parsed = parseMcpFullToolName(nameRaw);
    if (!parsed) return null;
    const argsRaw = rawItem.arguments;
    const argumentsValue = tryParseJsonText(argsRaw) ?? argsRaw;
    return {
      callId,
      server: parsed.server,
      tool: parsed.tool,
      argumentsValue,
    };
  }

  if (rawType === "function_call_output") {
    const outputRaw = rawItem.output;
    const resultValue = tryParseJsonText(outputRaw) ?? outputRaw;
    return { callId, resultValue };
  }

  return null;
};

const parseMcpToolCallEvent = (
  event: TimelineEventItem,
  hintsByCallId: Map<string, McpCallHint>,
  toolDefinitionsByKey: ReadonlyMap<string, McpToolDefinitionLookupEntry>,
  resourceReadsByKey: ReadonlyMap<string, ParsedMcpResourceReadEvent>
): ParsedMcpToolCallEvent | null => {
  if (
    event.method !== "item/started" &&
    event.method !== "item/completed" &&
    event.method !== "item/mcpToolCall/progress"
  )
    return null;
  const payload = toEventParamsObject(event);
  if (!payload) return null;

  const isProgressEvent = event.method === "item/mcpToolCall/progress";
  const item = payload.item && typeof payload.item === "object" ? (payload.item as Record<string, any>) : null;
  if (!isProgressEvent && !item) return null;

  const itemType = String(item?.type ?? "").trim();
  if (!isProgressEvent && itemType !== "mcpToolCall") return null;

  const itemId = String(item?.id ?? payload.itemId ?? "").trim();
  if (!itemId) return null;

  const callHint = hintsByCallId.get(itemId);
  const turnId = String(item?.turnId ?? payload.turnId ?? event.turnId ?? "").trim() || "unknown";
  const toolRaw = String(item?.tool ?? callHint?.tool ?? "").trim();
  const parsedFullTool = parseMcpFullToolName(toolRaw);
  const tool = (parsedFullTool?.tool ?? toolRaw).trim() || "mcpToolCall";
  const server = String(item?.server ?? callHint?.server ?? parsedFullTool?.server ?? "").trim() || "unknown";
  const statusRaw = isProgressEvent
    ? String(payload.message ?? "inProgress").trim()
    : String(item?.status ?? payload.status ?? "").trim();
  const durationMs = isProgressEvent ? null : toNumberOrNull(item?.durationMs);
  const createdAt = isProgressEvent ? event.createdAt : eventLifecycleTimeMs(event, payload);

  const argumentsValue = item?.arguments ?? callHint?.argumentsValue;
  const argumentsRaw = toPrettyJsonOrText(argumentsValue);
  const argumentsSummary = argumentsRaw
    ? translate("timelineBuild.arguments", { text: toInlineValueSummary(argumentsValue, 220) })
    : translate("timelineBuild.argumentsEmpty");

  const rawResultValue = item?.result ?? callHint?.resultValue;
  const resultValue = tryParseJsonText(rawResultValue) ?? rawResultValue;
  const resultRecord =
    resultValue && typeof resultValue === "object" && !Array.isArray(resultValue)
      ? (resultValue as Record<string, unknown>)
      : null;
  let resultRaw = toPrettyJsonOrText(resultValue);
  let resultSummaryBundle = toMcpResultSummaries(resultValue);
  const structuredContentRaw =
    resultRecord?.structuredContent == null ? "" : toPrettyJsonOrText(resultRecord.structuredContent);
  const metaRaw = resultRecord?._meta == null ? "" : toPrettyJsonOrText(resultRecord._meta);
  const toolDefinition = toolDefinitionsByKey.get(toMcpToolDefinitionKey(server, tool));
  const outputSchemaRaw = toolDefinition?.outputSchema == null ? "" : toPrettyJsonOrText(toolDefinition.outputSchema);
  const candidateResourceUri =
    String(item?.mcpAppResourceUri ?? "").trim() ||
    findExplicitResourceUri(resultRecord?.structuredContent ?? resultValue);
  const relatedResource = candidateResourceUri
    ? resourceReadsByKey.get(toMcpResourceLookupKey(server, candidateResourceUri))
    : null;

  if (!resultRaw && isProgressEvent) {
    const progressMessage = String(payload.message ?? "").trim();
    if (progressMessage) {
      resultRaw = progressMessage;
      resultSummaryBundle = {
        ...resultSummaryBundle,
        resultSummary: translate("timelineBuild.progress", { text: shortenText(progressMessage, 180) }),
      };
    }
  }

  const errorValue = item?.error;
  const errorCompact = toInlineValueSummary(errorValue, 220);
  const errorText = errorCompact ? translate("timelineBuild.error", { text: errorCompact }) : "";
  const normalizedStatus = String(statusRaw ?? "")
    .trim()
    .toLowerCase();
  const seemsDone =
    event.method === "item/completed" || /(complete|success|done|finish|succeed|fail|error)/.test(normalizedStatus);
  if (!resultRaw && seemsDone) {
    resultRaw = toPrettyJsonOrText(item ?? payload);
    if (!resultSummaryBundle.resultSummary) {
      const payloadSummary = toInlineValueSummary(item ?? payload, 200);
      if (payloadSummary) {
        resultSummaryBundle = {
          ...resultSummaryBundle,
          resultSummary: translate("timelineBuild.result", { text: payloadSummary }),
        };
      }
    }
  }

  return {
    itemId,
    turnId,
    method: event.method,
    server,
    tool,
    statusRaw,
    durationMs,
    argumentsSummary,
    argumentsRaw,
    resultSummary: resultSummaryBundle.resultSummary,
    pageSummary: resultSummaryBundle.pageSummary,
    snapshotSummary: resultSummaryBundle.snapshotSummary,
    eventsSummary: resultSummaryBundle.eventsSummary,
    resultRaw,
    structuredContentRaw,
    metaRaw,
    outputSchemaRaw,
    errorText,
    relatedResourceUri: relatedResource?.uri ?? candidateResourceUri,
    relatedResourceSourceTab: relatedResource?.sourceTab ?? "resources",
    relatedResourceTemplateKey: relatedResource?.templateKey ?? "",
    relatedResourceLabel: candidateResourceUri ? translate("timelineBuild.openRelatedResourceResult") : "",
    createdAt,
  };
};

type McpToolCallAccumulator = {
  key: string;
  turnId: string;
  firstIndex: number;
  firstCreatedAt: number;
  item: McpToolCallItem;
};

type McpToolGroupAccumulator = {
  id: string;
  createdAt: number;
  secondBucket: number;
  turnId: string;
  firstIndex: number;
  items: McpToolCallItem[];
};

type CommandItemAccumulator = {
  key: string;
  turnId: string;
  firstIndex: number;
  firstCreatedAt: number;
  item: CommandGroupItem;
};

type FileChangeAccumulator = {
  key: string;
  turnId: string;
  itemId: string;
  firstIndex: number;
  firstCreatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  rawStatus: string;
  status: FileChangeStatus;
  filesByAbs: Map<string, FileChangeFile>;
  streamUpdateCount: number;
};

type FileChangeVisualAccumulator = Omit<FileChangeAccumulator, "filesByAbs"> & {
  file: FileChangeFile;
};

type ReasoningBlockAccumulator = {
  id: string;
  turnId: string;
  itemId: string;
  firstIndex: number;
  firstCreatedAt: number;
  lastCreatedAt: number;
  openDefault: boolean;
  sectionTexts: Map<number, string>;
  rawContentTexts: Map<number, string>;
};

type ReasoningTurnAccumulator = {
  nextOrdinal: number;
  activeBlockId: string | null;
  blocks: ReasoningBlockAccumulator[];
  blockIdByItemId: Map<string, string>;
};

const ensureCommandGroupItemStatus = (item: CommandGroupItem): CommandGroupItemStatus => {
  const normalizedStatus = String(item.status ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (item.completedAt != null) {
    if (item.exitCode != null && item.exitCode !== 0) return "failed";
    if (normalizedStatus === "failed" || normalizedStatus === "error" || normalizedStatus === "timeout")
      return "failed";
    return "completed";
  }
  if (normalizedStatus === "failed" || normalizedStatus === "error" || normalizedStatus === "timeout") return "failed";
  if (
    normalizedStatus === "completed" ||
    normalizedStatus === "success" ||
    normalizedStatus === "done" ||
    normalizedStatus === "succeeded" ||
    normalizedStatus === "finished"
  )
    return "completed";
  if (
    normalizedStatus === "running" ||
    normalizedStatus === "inprogress" ||
    normalizedStatus === "pending" ||
    normalizedStatus === "queued"
  )
    return "running";
  if (item.startedAt != null) return "running";
  return "unknown";
};

const commandStatusPriority = (status: CommandGroupItemStatus): number => {
  if (status === "failed") return 3;
  if (status === "completed") return 2;
  if (status === "running") return 1;
  return 0;
};

const mergeCommandGroupItemStatus = (current: CommandGroupItem, incoming: CommandGroupItem): CommandGroupItemStatus => {
  const currentStatus = ensureCommandGroupItemStatus(current);
  const incomingStatus = ensureCommandGroupItemStatus(incoming);
  return commandStatusPriority(incomingStatus) > commandStatusPriority(currentStatus) ? incomingStatus : currentStatus;
};

const fileChangeStatusPriority = (status: FileChangeStatus): number => {
  if (status === "failed" || status === "declined") return 4;
  if (status === "completed") return 3;
  if (status === "running") return 2;
  return 1;
};

const mergeFileChangeStatus = (current: FileChangeStatus, incoming: FileChangeStatus): FileChangeStatus =>
  fileChangeStatusPriority(incoming) > fileChangeStatusPriority(current) ? incoming : current;

const fileChangePathSignature = (turnId: string, itemId: string, file: FileChangeFile): string => {
  const from = normalizeFsPath(file.pathRel || file.pathAbs).toLowerCase();
  const to = normalizeFsPath(file.pathRelTo || file.pathAbsTo || "").toLowerCase();
  return `${turnId}:${itemId}:${from}:${to}`;
};

const fileChangeDiffScore = (file: FileChangeFile): number => {
  const text = String(file.diffText ?? "");
  if (!text.trim()) return 0;
  const stats = getDiffLineStats(text, file.kind);
  const changedLines = stats.add + stats.del;
  if (changedLines > 0) return 1_000_000 + changedLines;
  if (stats.structured) return 500_000 + stats.lineCount;
  return stats.lineCount;
};

const mergeFileChangeFile = (current: FileChangeFile, incoming: FileChangeFile): FileChangeFile => {
  const currentScore = fileChangeDiffScore(current);
  const incomingScore = fileChangeDiffScore(incoming);
  const keepDiffFromIncoming =
    incomingScore > currentScore || (incomingScore === currentScore && incoming.updatedAt >= current.updatedAt);
  const newest = incoming.updatedAt >= current.updatedAt ? incoming : current;
  const bestDiff = keepDiffFromIncoming ? incoming : current;

  return {
    ...current,
    pathAbs: newest.pathAbs || current.pathAbs,
    pathRel: newest.pathRel || current.pathRel,
    pathAbsTo: newest.pathAbsTo || current.pathAbsTo,
    pathRelTo: newest.pathRelTo || current.pathRelTo,
    kind: newest.kind !== "unknown" ? newest.kind : current.kind,
    diffText: bestDiff.diffText || newest.diffText || current.diffText,
    updatedAt: Math.max(current.updatedAt ?? 0, incoming.updatedAt ?? 0),
  };
};

const ensureMcpToolCallStatus = (item: McpToolCallItem): McpToolCallStatus => {
  if (item.errorText) return "failed";
  if (item.status === "failed") return "failed";
  if (item.completedAt != null) return "completed";
  if (item.startedAt != null) return "running";
  return "unknown";
};

export function buildTimelineRenderNodes(params: BuildTimelineNodesParams): TimelineRenderNode[] {
  const events = params.events ?? [];
  if (params.debug) {
    return events.map((event) => ({ id: `event:${event.id}`, kind: "event", event }));
  }

  const renderNodes: Array<{ index: number; createdAt: number; node: TimelineRenderNode }> = [];
  const mcpToolDefinitions = params.mcpToolDefinitions ?? new Map();
  const workspaceRoot = normalizeFsPath(String(params.workspaceRoot ?? ""));
  const fileChangeItemsByKey = new Map<string, FileChangeAccumulator>();
  const commandItemsByKey = new Map<string, CommandItemAccumulator>();
  const mcpItemsByKey = new Map<string, McpToolCallAccumulator>();
  const mcpCallHintsById = new Map<string, McpCallHint>();
  const mcpResourceReadsByKey = new Map<string, ParsedMcpResourceReadEvent>();
  const reasoningTurnsByKey = new Map<string, ReasoningTurnAccumulator>();

  for (const event of events) {
    const hint = parseMcpRawResponseItemEvent(event);
    if (hint?.callId) {
      const existing = mcpCallHintsById.get(hint.callId) ?? {
        callId: hint.callId,
        server: "unknown",
        tool: "mcpToolCall",
        argumentsValue: null,
        resultValue: null,
      };
      if (hint.server) existing.server = hint.server;
      if (hint.tool) existing.tool = hint.tool;
      if (typeof hint.argumentsValue !== "undefined") existing.argumentsValue = hint.argumentsValue;
      if (typeof hint.resultValue !== "undefined") existing.resultValue = hint.resultValue;
      mcpCallHintsById.set(hint.callId, existing);
    }

    const resourceRead = parseMcpResourceReadEvent(event);
    if (!resourceRead || resourceRead.status !== "completed") continue;
    const key = toMcpResourceLookupKey(resourceRead.server, resourceRead.uri);
    if (!key) continue;
    mcpResourceReadsByKey.set(key, resourceRead);
  }

  const toReasoningTurnKey = (threadId: string, turnId: string) => `${threadId}:${turnId}`;
  const toReasoningBlockId = (turnId: string, ordinal: number) =>
    `reasonblk:${params.timelineKey}:${turnId}:${ordinal}`;

  const createReasoningTurnAccumulator = (): ReasoningTurnAccumulator => ({
    nextOrdinal: 1,
    activeBlockId: null,
    blocks: [],
    blockIdByItemId: new Map<string, string>(),
  });

  const getOrCreateReasoningTurn = (threadId: string, turnId: string) => {
    const turnKey = toReasoningTurnKey(threadId, turnId);
    const existing = reasoningTurnsByKey.get(turnKey);
    if (existing) return existing;
    const created = createReasoningTurnAccumulator();
    reasoningTurnsByKey.set(turnKey, created);
    return created;
  };

  const getOrCreateReasoningBlock = (params: {
    turn: ReasoningTurnAccumulator;
    turnId: string;
    itemId: string;
    index: number;
    createdAt: number;
    startNewWhenUnbound: boolean;
  }): ReasoningBlockAccumulator => {
    const itemId = String(params.itemId ?? "").trim();
    const existingItemBlockId = itemId ? params.turn.blockIdByItemId.get(itemId) : "";
    const existingItemBlock = existingItemBlockId
      ? (params.turn.blocks.find((block) => block.id === existingItemBlockId) ?? null)
      : null;
    if (existingItemBlock) {
      params.turn.activeBlockId = existingItemBlock.id;
      return existingItemBlock;
    }

    if (!itemId && params.turn.activeBlockId && !params.startNewWhenUnbound) {
      const activeBlock = params.turn.blocks.find((block) => block.id === params.turn.activeBlockId) ?? null;
      if (activeBlock) return activeBlock;
    }

    const id = toReasoningBlockId(params.turnId, params.turn.nextOrdinal);
    params.turn.nextOrdinal += 1;
    const block: ReasoningBlockAccumulator = {
      id,
      turnId: params.turnId,
      itemId,
      firstIndex: params.index,
      firstCreatedAt: params.createdAt,
      lastCreatedAt: params.createdAt,
      openDefault: false,
      sectionTexts: new Map<number, string>(),
      rawContentTexts: new Map<number, string>(),
    };
    params.turn.blocks.push(block);
    params.turn.activeBlockId = id;
    if (itemId) params.turn.blockIdByItemId.set(itemId, id);
    return block;
  };

  const collapseActiveReasoningBlock = (threadId: string, turnId: string) => {
    const key = toReasoningTurnKey(threadId, turnId);
    const turn = reasoningTurnsByKey.get(key);
    if (!turn) return;
    // 结束当前 block，避免后续零散的 reasoning chunk 误并入同一段。
    turn.activeBlockId = null;
  };

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];

    const reasoningEvent = parseReasoningSummaryEvent(event);
    if (reasoningEvent) {
      const turn = getOrCreateReasoningTurn(reasoningEvent.threadId, reasoningEvent.turnId);
      const block = getOrCreateReasoningBlock({
        turn,
        turnId: reasoningEvent.turnId,
        itemId: reasoningEvent.itemId,
        index,
        createdAt: reasoningEvent.createdAt,
        startNewWhenUnbound: reasoningEvent.summaryIndex === 0,
      });

      const sectionText = String(reasoningEvent.sectionText ?? "");
      if (sectionText.trim()) {
        block.sectionTexts.set(reasoningEvent.summaryIndex, sectionText);
      }
      block.lastCreatedAt = Math.max(block.lastCreatedAt, reasoningEvent.createdAt);
      continue;
    }

    const reasoningRawTextEvent = parseReasoningRawTextEvent(event);
    if (reasoningRawTextEvent) {
      const turn = getOrCreateReasoningTurn(reasoningRawTextEvent.threadId, reasoningRawTextEvent.turnId);
      const block = getOrCreateReasoningBlock({
        turn,
        turnId: reasoningRawTextEvent.turnId,
        itemId: reasoningRawTextEvent.itemId,
        index,
        createdAt: reasoningRawTextEvent.createdAt,
        startNewWhenUnbound: false,
      });
      const rawText = String(reasoningRawTextEvent.rawText ?? "");
      if (rawText.trim()) {
        block.rawContentTexts.set(reasoningRawTextEvent.contentIndex, rawText);
      }
      block.lastCreatedAt = Math.max(block.lastCreatedAt, reasoningRawTextEvent.createdAt);
      continue;
    }

    {
      const payload = toEventParamsObject(event);
      const threadId = String(event.threadId ?? payload?.threadId ?? "").trim();
      const turnId = String(event.turnId ?? payload?.turnId ?? "").trim();
      if (threadId && turnId) collapseActiveReasoningBlock(threadId, turnId);
    }

    const resourceReadEvent = parseMcpResourceReadEvent(event);
    if (resourceReadEvent) {
      const nodeId = `mcpres:${event.id}`;
      renderNodes.push({
        index,
        createdAt: resourceReadEvent.createdAt,
        node: {
          id: nodeId,
          kind: "mcpResourceRead",
          item: {
            id: nodeId,
            createdAt: resourceReadEvent.createdAt,
            threadId: resourceReadEvent.threadId,
            turnId: resourceReadEvent.turnId,
            server: resourceReadEvent.server,
            uri: resourceReadEvent.uri,
            sourceTab: resourceReadEvent.sourceTab,
            templateKey: resourceReadEvent.templateKey,
            status: resourceReadEvent.status,
            fetchedAt: resourceReadEvent.fetchedAt,
            resourceLabel: resourceReadEvent.resourceLabel,
            toolNames: resourceReadEvent.toolNames,
            parameterEntries: resourceReadEvent.parameterEntries,
            contentsCount: resourceReadEvent.contents.length,
            contents: resourceReadEvent.contents,
            previewText: resourceReadEvent.previewText,
            mimeSummary: resourceReadEvent.mimeSummary,
            errorText: resourceReadEvent.errorText,
          },
        },
      });
      continue;
    }

    const fileEvent = parseFileChangeEvent(event);
    if (fileEvent) {
      const itemKey = `${fileEvent.turnId}:${fileEvent.itemId}`;
      const existing = fileChangeItemsByKey.get(itemKey);
      const filesByAbs = existing?.filesByAbs ?? new Map<string, FileChangeFile>();

      for (const change of fileEvent.changes) {
        const pathAbs = normalizeFsPath(change.pathAbs);
        if (!pathAbs) continue;
        const previous = filesByAbs.get(pathAbs);
        const pathRel = toWorkspaceRelativePath(pathAbs, workspaceRoot);
        const pathAbsTo = change.pathAbsTo ? normalizeFsPath(change.pathAbsTo) : "";
        const pathRelTo = pathAbsTo ? toWorkspaceRelativePath(pathAbsTo, workspaceRoot) : "";
        const next: FileChangeFile = previous ?? {
          pathAbs,
          pathRel,
          ...(pathAbsTo ? { pathAbsTo, pathRelTo: pathRelTo || pathAbsTo } : {}),
          kind: change.kind,
          diffText: change.diffText,
          updatedAt: fileEvent.createdAt,
        };
        next.pathRel = pathRel || next.pathRel || pathAbs;
        if (change.kind !== "unknown") next.kind = change.kind;
        if (pathAbsTo) {
          next.pathAbsTo = pathAbsTo;
          next.pathRelTo = pathRelTo || pathAbsTo;
        }
        if (change.diffText) next.diffText = change.diffText;
        next.updatedAt = fileEvent.createdAt;
        filesByAbs.set(pathAbs, next);
      }

      const nextStatus = resolveFileChangeStatusFromRaw(fileEvent.statusRaw, fileEvent.method, fileEvent.hasError);
      const status = existing?.status === "failed" ? "failed" : nextStatus;
      const streamUpdateCount =
        (existing?.streamUpdateCount ?? 0) + (fileEvent.method === "item/fileChange/patchUpdated" ? 1 : 0);

      const startedAt =
        fileEvent.method === "item/completed"
          ? (existing?.startedAt ?? null)
          : existing?.startedAt == null
            ? fileEvent.createdAt
            : Math.min(existing.startedAt, fileEvent.createdAt);
      const completedAt = fileEvent.method === "item/completed" ? fileEvent.createdAt : (existing?.completedAt ?? null);

      fileChangeItemsByKey.set(itemKey, {
        key: itemKey,
        turnId: fileEvent.turnId,
        itemId: fileEvent.itemId,
        firstIndex: existing ? existing.firstIndex : index,
        firstCreatedAt: existing ? existing.firstCreatedAt : fileEvent.createdAt,
        startedAt,
        completedAt,
        rawStatus: fileEvent.statusRaw || existing?.rawStatus || "",
        status: completedAt != null && status === "running" ? "completed" : status,
        filesByAbs,
        streamUpdateCount,
      });
      continue;
    }

    const commandEvent = parseCommandExecutionEvent(event);
    if (commandEvent) {
      const itemKey = `${commandEvent.turnId}:${commandEvent.itemId}`;
      const existing = commandItemsByKey.get(itemKey);
      const baseItem: CommandGroupItem = existing?.item ?? {
        id: commandEvent.itemId,
        outputKey: `${params.timelineKey}:${itemKey}`,
        status: "unknown",
        cwd: "",
        processId: "",
        source: "",
        actions: [],
        commandShort: shortenText(commandEvent.command, 150),
        commandFull: commandEvent.command,
        lastEventMethod: "",
        outputPreview: "",
        outputFull: "",
        files: [],
        filesCount: 0,
        exitCode: null,
        durationMs: null,
        startedAt: null,
        completedAt: null,
      };

      const incomingCommand = String(commandEvent.command ?? "").trim();
      const isPlaceholderCommand =
        incomingCommand === "" ||
        incomingCommand === translate("timelineBuild.commandExecution") ||
        incomingCommand === "shell_command" ||
        incomingCommand === "—";
      if (commandEvent.hasCommand && !isPlaceholderCommand) {
        baseItem.commandFull = incomingCommand;
        baseItem.commandShort = shortenText(incomingCommand, 150);
      } else if (!String(baseItem.commandFull ?? "").trim()) {
        baseItem.commandFull = incomingCommand || translate("timelineBuild.commandExecution");
        baseItem.commandShort = shortenText(baseItem.commandFull, 150);
      }
      if (commandEvent.cwd) baseItem.cwd = commandEvent.cwd;
      if (commandEvent.processId) baseItem.processId = commandEvent.processId;
      if (commandEvent.source) baseItem.source = commandEvent.source;
      baseItem.lastEventMethod = commandEvent.method;
      if (commandEvent.actions.length > 0) {
        const bySignature = new Map(
          (baseItem.actions ?? []).map((action) => [
            `${action.type}:${action.command}:${action.path}:${action.query}:${action.startLine ?? ""}:${action.endLine ?? ""}`,
            action,
          ])
        );
        for (const action of commandEvent.actions) {
          bySignature.set(
            `${action.type}:${action.command}:${action.path}:${action.query}:${action.startLine ?? ""}:${action.endLine ?? ""}`,
            action
          );
        }
        baseItem.actions = [...bySignature.values()];
      }

      if (commandEvent.method === "item/started") {
        baseItem.startedAt =
          baseItem.startedAt == null ? commandEvent.createdAt : Math.min(baseItem.startedAt, commandEvent.createdAt);
        baseItem.status = "running";
      } else if (commandEvent.method === "item/completed") {
        baseItem.completedAt = commandEvent.createdAt;
        baseItem.exitCode = commandEvent.exitCode;
        baseItem.durationMs = commandEvent.durationMs;
        if (commandEvent.exitCode != null && commandEvent.exitCode !== 0) baseItem.status = "failed";
        else baseItem.status = "completed";
      } else {
        baseItem.startedAt =
          baseItem.startedAt == null ? commandEvent.createdAt : Math.min(baseItem.startedAt, commandEvent.createdAt);
        if (baseItem.completedAt == null && baseItem.status !== "failed") {
          baseItem.status = "running";
        }
      }

      if (commandEvent.output) {
        baseItem.outputFull = commandEvent.output;
        baseItem.outputPreview = toCommandOutputPreview(commandEvent.output);
        if (isDirectoryListingCommand(baseItem.commandFull)) {
          const parsed = parseCommandListOutputFiles(commandEvent.output);
          if (parsed.ok) {
            const normalized = parsed.files
              .map((f) => toWorkspaceRelativePath(String(f ?? ""), params.workspaceRoot))
              .filter((f) => String(f ?? "").trim().length > 0);
            baseItem.files = normalized;
            baseItem.filesCount = normalized.length;
          }
        }
      }

      commandItemsByKey.set(itemKey, {
        key: itemKey,
        turnId: commandEvent.turnId,
        firstIndex: existing ? existing.firstIndex : index,
        firstCreatedAt: existing ? existing.firstCreatedAt : commandEvent.createdAt,
        item: baseItem,
      });
      continue;
    }

    const mcpEvent = parseMcpToolCallEvent(event, mcpCallHintsById, mcpToolDefinitions, mcpResourceReadsByKey);
    if (mcpEvent) {
      const itemKey = `${mcpEvent.turnId}:${mcpEvent.itemId}`;
      const existing = mcpItemsByKey.get(itemKey);
      const baseItem: McpToolCallItem = existing?.item ?? {
        id: `mcpitem:${params.timelineKey}:${itemKey}`,
        itemId: mcpEvent.itemId,
        createdAt: mcpEvent.createdAt,
        turnId: mcpEvent.turnId,
        server: mcpEvent.server,
        tool: mcpEvent.tool,
        status: "unknown",
        rawStatus: "",
        durationMs: null,
        startedAt: null,
        completedAt: null,
        argumentsSummary: translate("timelineBuild.argumentsEmpty"),
        argumentsRaw: "",
        resultSummary: "",
        pageSummary: "",
        snapshotSummary: "",
        eventsSummary: "",
        resultRaw: "",
        structuredContentRaw: "",
        metaRaw: "",
        outputSchemaRaw: "",
        errorText: "",
        argumentsKey: `${params.timelineKey}:${itemKey}:arguments`,
        resultKey: `${params.timelineKey}:${itemKey}:result`,
        structuredContentKey: `${params.timelineKey}:${itemKey}:structuredContent`,
        metaKey: `${params.timelineKey}:${itemKey}:meta`,
        outputSchemaKey: `${params.timelineKey}:${itemKey}:outputSchema`,
        relatedResourceUri: "",
        relatedResourceSourceTab: "resources",
        relatedResourceTemplateKey: "",
        relatedResourceLabel: "",
      };

      baseItem.turnId = mcpEvent.turnId;
      baseItem.server = mcpEvent.server || baseItem.server;
      baseItem.tool = mcpEvent.tool || baseItem.tool;
      baseItem.rawStatus = mcpEvent.statusRaw || baseItem.rawStatus;
      if (mcpEvent.durationMs != null) baseItem.durationMs = mcpEvent.durationMs;
      if (mcpEvent.argumentsRaw) {
        baseItem.argumentsRaw = mcpEvent.argumentsRaw;
        baseItem.argumentsSummary = mcpEvent.argumentsSummary;
      }
      if (mcpEvent.resultRaw) {
        baseItem.resultRaw = mcpEvent.resultRaw;
      }
      if (mcpEvent.structuredContentRaw) baseItem.structuredContentRaw = mcpEvent.structuredContentRaw;
      if (mcpEvent.metaRaw) baseItem.metaRaw = mcpEvent.metaRaw;
      if (mcpEvent.outputSchemaRaw) baseItem.outputSchemaRaw = mcpEvent.outputSchemaRaw;
      if (mcpEvent.resultSummary) baseItem.resultSummary = mcpEvent.resultSummary;
      if (mcpEvent.pageSummary) baseItem.pageSummary = mcpEvent.pageSummary;
      if (mcpEvent.snapshotSummary) baseItem.snapshotSummary = mcpEvent.snapshotSummary;
      if (mcpEvent.eventsSummary) baseItem.eventsSummary = mcpEvent.eventsSummary;
      if (mcpEvent.errorText) baseItem.errorText = mcpEvent.errorText;
      if (mcpEvent.relatedResourceUri) {
        baseItem.relatedResourceUri = mcpEvent.relatedResourceUri;
        baseItem.relatedResourceSourceTab = mcpEvent.relatedResourceSourceTab;
        baseItem.relatedResourceTemplateKey = mcpEvent.relatedResourceTemplateKey;
        baseItem.relatedResourceLabel = mcpEvent.relatedResourceLabel;
      }

      const eventStatus = resolveMcpStatusFromRaw(mcpEvent.statusRaw, mcpEvent.method, Boolean(mcpEvent.errorText));
      if (mcpEvent.method === "item/started") {
        baseItem.startedAt =
          baseItem.startedAt == null ? mcpEvent.createdAt : Math.min(baseItem.startedAt, mcpEvent.createdAt);
        if (baseItem.completedAt == null || eventStatus === "failed") baseItem.status = eventStatus;
      } else if (mcpEvent.method === "item/mcpToolCall/progress") {
        baseItem.startedAt =
          baseItem.startedAt == null ? mcpEvent.createdAt : Math.min(baseItem.startedAt, mcpEvent.createdAt);
        if (eventStatus === "completed" || eventStatus === "failed") {
          baseItem.completedAt = mcpEvent.createdAt;
        }
        if (baseItem.completedAt == null || eventStatus === "failed") baseItem.status = eventStatus;
      } else {
        baseItem.completedAt = mcpEvent.createdAt;
        baseItem.status = eventStatus;
      }
      baseItem.status = ensureMcpToolCallStatus(baseItem);

      mcpItemsByKey.set(itemKey, {
        key: itemKey,
        turnId: mcpEvent.turnId,
        firstIndex: existing ? existing.firstIndex : index,
        firstCreatedAt: existing ? existing.firstCreatedAt : mcpEvent.createdAt,
        item: baseItem,
      });
      continue;
    }

    renderNodes.push({ index, createdAt: event.createdAt, node: { id: `event:${event.id}`, kind: "event", event } });
  }

  // 防御：同一 turn 内，协议/回放可能重复写入相同 reasoning 区块；渲染层做一次弱去重，避免出现两条相同标题/内容。
  const reasoningBlocksBySignature = new Map<
    string,
    {
      index: number;
      createdAt: number;
      id: string;
      turnId: string;
      itemId: string;
      lastCreatedAt: number;
      openDefault: boolean;
      paragraphCount: number;
      text: string;
      rawContent: string[];
      rawText: string;
      rawContentCount: number;
    }
  >();

  for (const entry of reasoningTurnsByKey.values()) {
    for (const block of entry.blocks) {
      const createdAt = block.firstCreatedAt;
      const orderedSections = [...block.sectionTexts.entries()].sort((a, b) => a[0] - b[0]);
      const sectionTexts = orderedSections
        .map(([, value]) => String(value ?? ""))
        .filter((value) => value.trim().length > 0);
      const text = sectionTexts.join("\n\n");
      const orderedRawContent = [...block.rawContentTexts.entries()].sort((a, b) => a[0] - b[0]);
      const rawContent = orderedRawContent
        .map(([, value]) => String(value ?? ""))
        .filter((value) => value.trim().length > 0);
      const rawText = rawContent.join("\n\n");
      const bucket = Math.floor(createdAt / 1000);
      const sigText = normalizeWhitespace(text || rawText).slice(0, 600);
      const sig = `${block.turnId}:${block.itemId || bucket}:${bucket}:${sigText}`;

      const candidate = {
        index: block.firstIndex,
        createdAt,
        id: block.id,
        turnId: block.turnId,
        itemId: block.itemId,
        lastCreatedAt: block.lastCreatedAt,
        openDefault: block.openDefault,
        paragraphCount: sectionTexts.length,
        text,
        rawContent,
        rawText,
        rawContentCount: rawContent.length,
      };

      const existing = reasoningBlocksBySignature.get(sig);
      if (!existing) {
        reasoningBlocksBySignature.set(sig, candidate);
        continue;
      }

      // 选择“信息更完整”的那条；并保留更早的 index/createdAt 以保持排序稳定。
      const existingScore = existing.paragraphCount * 10 + existing.text.length + existing.rawText.length;
      const candidateScore = candidate.paragraphCount * 10 + candidate.text.length + candidate.rawText.length;
      const keep = candidateScore > existingScore ? candidate : existing;
      const merged = {
        ...keep,
        index: Math.min(existing.index, candidate.index),
        createdAt: Math.min(existing.createdAt, candidate.createdAt),
        lastCreatedAt: Math.max(existing.lastCreatedAt, candidate.lastCreatedAt),
      };
      reasoningBlocksBySignature.set(sig, merged);
    }
  }

  for (const block of reasoningBlocksBySignature.values()) {
    renderNodes.push({
      index: block.index,
      createdAt: block.createdAt,
      node: {
        id: block.id,
        kind: "reasoningBlock",
        item: {
          id: block.id,
          title: deriveReasoningBlockTitle(block.text),
          createdAt: block.createdAt,
          updatedAt: block.lastCreatedAt,
          durationMs: block.lastCreatedAt > block.createdAt ? block.lastCreatedAt - block.createdAt : null,
          turnId: block.turnId,
          openDefault: block.openDefault,
          paragraphCount: block.paragraphCount,
          text: block.text,
          rawContent: block.rawContent,
          rawText: block.rawText,
          rawContentCount: block.rawContentCount,
        },
      },
    });
  }

  const fileChangeVisualItemsByPath = new Map<string, FileChangeVisualAccumulator>();
  for (const entry of fileChangeItemsByKey.values()) {
    const files = [...entry.filesByAbs.values()].sort(
      (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.pathRel.localeCompare(b.pathRel)
    );

    for (const file of files) {
      const signature = fileChangePathSignature(entry.turnId, entry.itemId, file);
      const candidate: FileChangeVisualAccumulator = {
        key: `${entry.key}:${file.pathAbs}`,
        turnId: entry.turnId,
        itemId: entry.itemId,
        firstIndex: entry.firstIndex,
        firstCreatedAt: entry.firstCreatedAt,
        startedAt: entry.startedAt,
        completedAt: entry.completedAt,
        rawStatus: entry.rawStatus,
        status: entry.status,
        file,
        streamUpdateCount: entry.streamUpdateCount,
      };
      const existing = fileChangeVisualItemsByPath.get(signature);
      if (!existing) {
        fileChangeVisualItemsByPath.set(signature, candidate);
        continue;
      }

      const startedAt =
        existing.startedAt == null
          ? candidate.startedAt
          : candidate.startedAt == null
            ? existing.startedAt
            : Math.min(existing.startedAt, candidate.startedAt);
      const completedAt =
        existing.completedAt == null
          ? candidate.completedAt
          : candidate.completedAt == null
            ? existing.completedAt
            : Math.max(existing.completedAt, candidate.completedAt);
      fileChangeVisualItemsByPath.set(signature, {
        ...existing,
        firstIndex: Math.min(existing.firstIndex, candidate.firstIndex),
        firstCreatedAt: Math.min(existing.firstCreatedAt, candidate.firstCreatedAt),
        startedAt,
        completedAt,
        rawStatus: candidate.rawStatus || existing.rawStatus,
        status: mergeFileChangeStatus(existing.status, candidate.status),
        file: mergeFileChangeFile(existing.file, candidate.file),
        streamUpdateCount: existing.streamUpdateCount + candidate.streamUpdateCount,
      });
    }
  }

  for (const entry of fileChangeVisualItemsByPath.values()) {
    const counts = { add: 0, modify: 0, delete: 0, rename: 0, unknown: 0 };
    counts[entry.file.kind] += 1;
    const createdAt = entry.startedAt ?? entry.firstCreatedAt;
    const nodeId = `filechg:${params.timelineKey}:${entry.turnId}:${entry.itemId}:${entry.file.pathAbs}`;
    const isStreaming = entry.status === "running" && entry.completedAt == null;
    renderNodes.push({
      index: entry.firstIndex,
      createdAt,
      node: {
        id: nodeId,
        kind: "fileChange",
        item: {
          id: nodeId,
          createdAt,
          turnId: entry.turnId,
          status: entry.status,
          rawStatus: entry.rawStatus,
          startedAt: entry.startedAt,
          completedAt: entry.completedAt,
          streamUpdateCount: entry.streamUpdateCount,
          isStreaming,
          counts,
          files: [entry.file],
        },
      },
    });
  }

  // 防御：同一 turn 的同一条命令，有时会因回放/协议重复生成两份 itemId 不同的 commandExecution。
  // 这里按“turnId + 时间片 + 归一化命令”弱去重，并把信息合并到更完整的那条里。
  const commandEntriesBySignature = new Map<string, CommandItemAccumulator>();
  for (const entry of commandItemsByKey.values()) {
    const anchorTs = entry.item.startedAt ?? entry.item.completedAt ?? entry.firstCreatedAt;
    const bucket = Math.floor(anchorTs / 1000);
    const commandText = normalizeWhitespace(entry.item.commandFull || entry.item.commandShort || "");
    const sig = `${entry.turnId}:${bucket}:${commandText}`;

    const existing = commandEntriesBySignature.get(sig);
    if (!existing) {
      commandEntriesBySignature.set(sig, entry);
      continue;
    }

    const merged: CommandItemAccumulator = { ...existing };
    merged.firstIndex = Math.min(existing.firstIndex, entry.firstIndex);
    merged.firstCreatedAt = Math.min(existing.firstCreatedAt, entry.firstCreatedAt);

    const keepItem: CommandGroupItem = { ...existing.item };
    const incomingItem = entry.item;

    const chooseIfBetterText = (current: string, incoming: string) => {
      const c = String(current ?? "").trim();
      const i = String(incoming ?? "").trim();
      if (!c && i) return i;
      if (i.length > c.length) return i;
      return c;
    };

    keepItem.commandFull = chooseIfBetterText(keepItem.commandFull, incomingItem.commandFull);
    keepItem.commandShort = chooseIfBetterText(keepItem.commandShort, incomingItem.commandShort);
    keepItem.cwd = chooseIfBetterText(keepItem.cwd, incomingItem.cwd);
    keepItem.processId = chooseIfBetterText(keepItem.processId, incomingItem.processId);
    keepItem.source = chooseIfBetterText(keepItem.source, incomingItem.source);
    const actionsBySignature = new Map(
      (keepItem.actions ?? []).map((action) => [
        `${action.type}:${action.command}:${action.path}:${action.query}:${action.startLine ?? ""}:${action.endLine ?? ""}`,
        action,
      ])
    );
    for (const action of incomingItem.actions ?? []) {
      actionsBySignature.set(
        `${action.type}:${action.command}:${action.path}:${action.query}:${action.startLine ?? ""}:${action.endLine ?? ""}`,
        action
      );
    }
    keepItem.actions = [...actionsBySignature.values()];
    keepItem.lastEventMethod = String(incomingItem.lastEventMethod || keepItem.lastEventMethod) as
      | CommandEventMethod
      | "";

    keepItem.startedAt =
      keepItem.startedAt == null
        ? incomingItem.startedAt
        : incomingItem.startedAt == null
          ? keepItem.startedAt
          : Math.min(keepItem.startedAt, incomingItem.startedAt);
    keepItem.completedAt =
      keepItem.completedAt == null
        ? incomingItem.completedAt
        : incomingItem.completedAt == null
          ? keepItem.completedAt
          : Math.max(keepItem.completedAt, incomingItem.completedAt);

    if (keepItem.exitCode == null && incomingItem.exitCode != null) keepItem.exitCode = incomingItem.exitCode;
    if (keepItem.durationMs == null && incomingItem.durationMs != null) keepItem.durationMs = incomingItem.durationMs;

    const outputExisting = String(keepItem.outputFull ?? "");
    const outputIncoming = String(incomingItem.outputFull ?? "");
    if (outputIncoming.length > outputExisting.length) {
      keepItem.outputFull = outputIncoming;
      keepItem.outputPreview = toCommandOutputPreview(outputIncoming);
    }

    const combinedFiles = [...new Set([...(keepItem.files ?? []), ...(incomingItem.files ?? [])])];
    keepItem.files = combinedFiles;
    keepItem.filesCount = Math.max(keepItem.filesCount ?? 0, incomingItem.filesCount ?? 0, combinedFiles.length);
    keepItem.status = mergeCommandGroupItemStatus(keepItem, incomingItem);

    merged.item = keepItem;
    commandEntriesBySignature.set(sig, merged);
  }

  for (const entry of commandEntriesBySignature.values()) {
    const anchorTs = entry.item.startedAt ?? entry.item.completedAt ?? entry.firstCreatedAt;
    const nodeId = `cmd:${params.timelineKey}:${entry.turnId}:${entry.item.id}`;
    const sessionNode = buildCommandSessionNode(nodeId, anchorTs, entry.turnId, entry.item);
    if (sessionNode) {
      renderNodes.push({
        index: entry.firstIndex,
        createdAt: anchorTs,
        node: sessionNode,
      });
      continue;
    }
    const specializedNode = buildSpecializedCommandNode(
      nodeId,
      anchorTs,
      entry.turnId,
      entry.item,
      params.workspaceRoot
    );
    if (specializedNode) {
      renderNodes.push({
        index: entry.firstIndex,
        createdAt: anchorTs,
        node: specializedNode,
      });
      continue;
    }
    renderNodes.push({
      index: entry.firstIndex,
      createdAt: anchorTs,
      node: {
        id: nodeId,
        kind: "commandAction",
        item: {
          id: nodeId,
          createdAt: anchorTs,
          turnId: entry.turnId,
          item: { ...entry.item, status: ensureCommandGroupItemStatus(entry.item) },
        },
      },
    });
  }

  const mcpGroupsById = new Map<string, McpToolGroupAccumulator>();
  for (const entry of mcpItemsByKey.values()) {
    const anchorTs = entry.item.startedAt ?? entry.firstCreatedAt;
    const secondBucket = Math.floor(anchorTs / 1000);
    const groupId = `mcpgrp:${params.timelineKey}:${entry.turnId}:${secondBucket}`;
    let group = mcpGroupsById.get(groupId);
    if (!group) {
      group = {
        id: groupId,
        createdAt: anchorTs,
        secondBucket,
        turnId: entry.turnId,
        firstIndex: entry.firstIndex,
        items: [],
      };
      mcpGroupsById.set(groupId, group);
    } else {
      group.createdAt = Math.min(group.createdAt, anchorTs);
      group.firstIndex = Math.min(group.firstIndex, entry.firstIndex);
    }
    group.items.push({ ...entry.item, createdAt: anchorTs, status: ensureMcpToolCallStatus(entry.item) });
  }

  for (const group of mcpGroupsById.values()) {
    group.items.sort((a, b) => {
      const ta = a.startedAt ?? a.completedAt ?? a.createdAt;
      const tb = b.startedAt ?? b.completedAt ?? b.createdAt;
      if (ta !== tb) return ta - tb;
      return a.id.localeCompare(b.id);
    });
    const stats = {
      total: group.items.length,
      running: group.items.filter((item) => item.status === "running").length,
      completed: group.items.filter((item) => item.status === "completed").length,
      failed: group.items.filter((item) => item.status === "failed").length,
      unknown: group.items.filter((item) => item.status === "unknown").length,
    };
    renderNodes.push({
      index: group.firstIndex,
      createdAt: group.createdAt,
      node: {
        id: group.id,
        kind: "mcpToolGroup",
        group: {
          id: group.id,
          createdAt: group.createdAt,
          secondBucket: group.secondBucket,
          turnId: group.turnId,
          items: group.items,
          stats,
        },
      },
    });
  }

  renderNodes.sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.node.id.localeCompare(b.node.id);
  });
  return renderNodes.map((item) => item.node);
}
