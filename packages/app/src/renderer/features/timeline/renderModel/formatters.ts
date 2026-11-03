import type { DiffLineKind } from "./diff";
import { getDiffLineStats } from "./diff";
export { isLocalThinkingEvent, isLocalUserEvent, isMarkdownEvent, isReasoningStreamEvent } from "../eventKinds";
import type {
  CommandActionNode,
  CommandGroupItem,
  FileChangeKind,
  FileChangeNode,
  McpToolCallItem,
  McpToolCallStatus,
  McpToolGroupNode,
} from "./buildTimelineNodes";
import { translate } from "../../../i18n/translate";

export function diffLineClass(kind: DiffLineKind) {
  if (kind === "meta") {
    return "text-[var(--diff-meta-text)] bg-[var(--diff-meta-bg)]";
  }
  if (kind === "hunk") {
    return "text-[var(--diff-hunk-text)] bg-[var(--diff-hunk-bg)] [box-shadow:var(--diff-hunk-shadow)]";
  }
  if (kind === "add") {
    return "bg-[var(--diff-add-bg)] [box-shadow:var(--diff-add-shadow)]";
  }
  if (kind === "del") {
    return "bg-[var(--diff-del-bg)] [box-shadow:var(--diff-del-shadow)]";
  }
  return "bg-[var(--diff-plain-bg)]";
}

export function fileChangeEventClass(item: FileChangeNode) {
  if (item.status === "running") return "border-[var(--timeline-status-running-border)]";
  if (item.status === "completed") return "border-[var(--timeline-status-completed-border)]";
  if (item.status === "failed") return "border-[var(--timeline-status-failed-border)]";
  if (item.status === "declined") return "border-[var(--timeline-status-declined-border)]";
  return "border-[var(--timeline-status-unknown-border)]";
}

export function fileChangeStatusText(status: FileChangeNode["status"]) {
  if (status === "running") return translate("timelineFormat.status.running");
  if (status === "completed") return translate("timelineFormat.status.completed");
  if (status === "failed") return translate("timelineFormat.status.failed");
  if (status === "declined") return translate("timelineFormat.status.declined");
  return translate("timelineFormat.status.unknown");
}

export function fileChangeCountsText(
  counts: FileChangeNode["counts"],
  files: Array<{ diffText: string; kind?: string }>
) {
  const parts: string[] = [];
  if (counts.add) parts.push(translate("timelineFormat.fileCounts.add", { count: counts.add }));
  if (counts.modify) parts.push(translate("timelineFormat.fileCounts.modify", { count: counts.modify }));
  if (counts.delete) parts.push(translate("timelineFormat.fileCounts.delete", { count: counts.delete }));
  if (counts.rename) parts.push(translate("timelineFormat.fileCounts.rename", { count: counts.rename }));

  let addLines = 0;
  let delLines = 0;
  for (const f of files ?? []) {
    const stats = getDiffLineStats((f as any)?.diffText ?? "", (f as any)?.kind ?? "");
    addLines += stats.add;
    delLines += stats.del;
  }
  if (addLines > 0 || delLines > 0) parts.push(`+${addLines} -${delLines}`);

  if (parts.length === 0) {
    if (counts.unknown) return translate("timelineFormat.fileCounts.unknown", { count: counts.unknown });
    return translate("timelineFormat.fileCounts.empty");
  }
  return parts.join(translate("timelineFormat.separator"));
}

export function fileChangeFilesPreviewText(
  files: Array<{ pathRel: string; kind?: string; pathRelTo?: string | null }>
) {
  if (!files || files.length === 0) return "";
  const head = files.slice(0, 3).map((f) => {
    const kind = String((f as any)?.kind ?? "");
    const to = String((f as any)?.pathRelTo ?? "").trim();
    if (kind === "rename" && to) return `${f.pathRel}->${to}`;
    return f.pathRel;
  });
  const more = files.length > 3 ? ` +${files.length - 3}` : "";
  return `${head.join(", ")}${more}`;
}

export function fileChangeFilesPreviewTitle(
  files: Array<{ pathRel: string; kind: FileChangeKind; pathRelTo?: string | null }>
) {
  if (!files || files.length === 0) return "";
  return files
    .map((f) => {
      const to = String((f as any)?.pathRelTo ?? "").trim();
      const name = f.kind === "rename" && to ? `${f.pathRel} -> ${to}` : f.pathRel;
      return `${fileChangeKindText(f.kind)} ${name}`;
    })
    .join("\n");
}

export function fileChangeKindText(kind: FileChangeKind) {
  if (kind === "add") return translate("timelineFormat.changeKind.add");
  if (kind === "modify") return translate("timelineFormat.changeKind.modify");
  if (kind === "delete") return translate("timelineFormat.changeKind.delete");
  if (kind === "rename") return translate("timelineFormat.changeKind.rename");
  return translate("timelineFormat.status.unknown");
}

export function fileChangeKindClass(kind: FileChangeKind) {
  if (kind === "add") {
    return "border-[var(--timeline-status-completed-border)] bg-[var(--timeline-kind-add-bg)] text-[var(--timeline-kind-add-text)]";
  }
  if (kind === "modify") {
    return "border-[var(--timeline-status-running-border)] bg-[var(--timeline-kind-modify-bg)] text-[var(--timeline-kind-modify-text)]";
  }
  if (kind === "delete") {
    return "border-[var(--timeline-status-failed-border)] bg-[var(--timeline-kind-delete-bg)] text-[var(--timeline-kind-delete-text)]";
  }
  if (kind === "rename") {
    return "border-[var(--timeline-status-declined-border)] bg-[var(--timeline-kind-rename-bg)] text-[var(--timeline-kind-rename-text)]";
  }
  return "border-[var(--timeline-status-unknown-border)] bg-[var(--timeline-kind-unknown-bg)] text-[var(--timeline-kind-unknown-text)]";
}

export function fileChangeDiffMetaText(diffText: string, fileKind = "") {
  const text = String(diffText ?? "");
  if (!text.trim()) return "—";
  const { add, del, lineCount } = getDiffLineStats(text, fileKind);
  if (add > 0 || del > 0) return `+${add} -${del}`;
  return translate("timelineFormat.diffLines", { count: lineCount.toLocaleString() });
}

export function commandGroupItemStatusText(item: CommandGroupItem) {
  if (item.status === "running") return translate("timelineFormat.status.running");
  if (item.status === "completed") return translate("timelineFormat.status.success");
  if (item.status === "failed") return translate("timelineFormat.status.failed");
  return translate("timelineFormat.status.unknown");
}

const normalizeWhitespace = (value: string) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const inferScopeHint = (cmd: string) => {
  const text = cmd.toLowerCase();
  if (text.includes(" backend") || text.includes("\\backend") || text.includes("/backend")) return "backend";
  if (text.includes(" frontend") || text.includes("\\frontend") || text.includes("/frontend")) return "frontend";
  if (text.includes(" src") || text.includes("\\src") || text.includes("/src")) return "src";
  return "";
};

const extractFirstQuoted = (cmd: string) => {
  const m = String(cmd ?? "").match(/["']([^"']+)["']/);
  return String(m?.[1] ?? "").trim();
};

const looksLikePathOrFile = (value: string) => {
  const s = String(value ?? "").trim();
  if (!s) return false;
  if (/^[a-zA-Z]:\\/.test(s)) return true;
  if (s.startsWith(".\\") || s.startsWith("./") || s.startsWith("..\\")) return true;
  if (/[\\/]/.test(s)) return true;
  if (/\.[a-z0-9]{1,8}$/i.test(s)) return true;
  return false;
};

const extractFirstQuotedPathLike = (cmd: string) => {
  const text = String(cmd ?? "");
  if (!text) return "";
  const re = /["']([^"']+)["']/g;
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(text))) {
    const candidate = String(match[1] ?? "").trim();
    if (!candidate) continue;
    if (looksLikePathOrFile(candidate)) return candidate;
  }
  return "";
};

const extractAnyPathLike = (cmd: string) => {
  const text = String(cmd ?? "");
  if (!text) return "";
  // 常见“疑似路径”片段；匹配要保守，避免把参数 flag 误识别为路径。
  const m = text.match(/(?:[a-zA-Z]:\\|\.\\|\.\.\\|\.\/|\/)?[^\s|;]+?\.[a-z0-9]{1,8}/i);
  const candidate = String(m?.[0] ?? "").trim();
  if (!candidate) return "";
  return looksLikePathOrFile(candidate) ? candidate : "";
};

const extractPsVarPath = (cmd: string) => {
  const m = String(cmd ?? "").match(/\$p\s*=\s*["']([^"']+)["']/i);
  return String(m?.[1] ?? "").trim();
};

const extractFlagValue = (cmd: string, flag: string) => {
  const r = new RegExp(`${flag}\\s+["']?([^\\s"']+)["']?`, "i");
  const m = String(cmd ?? "").match(r);
  return String(m?.[1] ?? "").trim();
};

const tokenizeShellLike = (cmd: string): string[] => {
  const text = String(cmd ?? "").trim();
  if (!text) return [];
  const tokens: string[] = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\\S+)/g;
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(text))) {
    const token = match[1] ?? match[2] ?? match[3] ?? "";
    const unescaped = token.replace(/\\(["'\\])/g, "$1").trim();
    if (unescaped) tokens.push(unescaped);
  }
  return tokens;
};

const trimTrailingDelims = (token: string) =>
  String(token ?? "")
    .replace(/[;|]+$/g, "")
    .trim();

const extractGetChildItemTargetPath = (cmd: string) => {
  const tokens = tokenizeShellLike(cmd);
  if (tokens.length === 0) return "";
  const lower = tokens.map((t) => t.toLowerCase());
  const start = lower.findIndex((t) => t === "get-childitem" || t === "gci" || t === "dir" || t === "ls");
  if (start < 0) return "";

  for (let i = start + 1; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t === "|" || t === ";") break;
    if (t.startsWith("-")) {
      if (t.toLowerCase() === "-path") {
        const next = tokens[i + 1] ?? "";
        if (next && next !== "|" && next !== ";") return trimTrailingDelims(next);
      }
      continue;
    }
    const cleaned = trimTrailingDelims(t);
    if (cleaned) return cleaned;
  }
  return "";
};

const extractGetContentTargetPath = (cmd: string) => {
  const tokens = tokenizeShellLike(cmd);
  if (tokens.length === 0) return "";
  const lower = tokens.map((t) => t.toLowerCase());
  const start = lower.findIndex((t) => t === "get-content" || t === "cat" || t === "type");
  if (start < 0) return "";

  const flagsWithValue = new Set([
    "-path",
    "-literalpath",
    "-encoding",
    "-totalcount",
    "-tail",
    "-readcount",
    "-delimiter",
    "-stream",
    "-head",
  ]);

  for (let i = start + 1; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t === "|" || t === ";") break;
    if (t.startsWith("-")) {
      const flag = t.toLowerCase();
      if (flagsWithValue.has(flag)) i += 1;
      continue;
    }
    const cleaned = trimTrailingDelims(t);
    if (cleaned) return cleaned;
  }
  return "";
};

const shortenText = (value: string, maxChars: number) => {
  const text = normalizeWhitespace(value);
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
};

const shortenPathLike = (value: string, maxSegments: number, maxChars: number) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const cleaned = raw.replace(/^\.\\/, "").replace(/^\.\//, "");
  const parts = cleaned.split(/[\\/]+/).filter(Boolean);
  const tail = parts.length <= maxSegments ? cleaned : parts.slice(-maxSegments).join("\\");
  return shortenText(tail, maxChars);
};

const unquoteToken = (token: string) => {
  const raw = String(token ?? "").trim();
  if (!raw) return "";
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
};

const redactToken = (token: string) => {
  const t = String(token ?? "");
  if (!t) return "";
  const lower = t.toLowerCase();
  if (lower.includes("api_key") || lower.includes("apikey") || lower.includes("token=") || lower.includes("secret")) {
    return "***";
  }
  if (/^sk-[A-Za-z0-9]{16,}$/.test(t)) return "***";
  if (t.length >= 60 && /[A-Za-z0-9+/=]{40,}/.test(t)) return "***";
  return t;
};

const extractRgPatternAndPath = (tokens: string[]) => {
  const lower = tokens.map((t) => String(t ?? "").toLowerCase());
  const idx = lower.findIndex(
    (t) => t === "rg" || t.endsWith("\\rg.exe") || t.endsWith("/rg.exe") || t.endsWith("rg.exe")
  );
  if (idx < 0) return { pattern: "", path: "" };

  const rest = tokens.slice(idx + 1);
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const t = String(rest[i] ?? "").trim();
    if (!t) continue;
    if (t === "|" || t === ";") break;
    if (t.startsWith("-")) {
      const lowerFlag = t.toLowerCase();
      if (lowerFlag === "-g" || lowerFlag === "--glob" || lowerFlag === "--type" || lowerFlag === "--path-separator") {
        i += 1;
      }
      continue;
    }
    positional.push(trimTrailingDelims(t));
    if (positional.length >= 2) break;
  }

  return { pattern: positional[0] ?? "", path: positional[1] ?? "" };
};

const verbForStatus = (
  status: CommandGroupItem["status"],
  base: { running: string; completed: string; failed: string; unknown: string }
) => {
  if (status === "running") return base.running;
  if (status === "completed") return base.completed;
  if (status === "failed") return base.failed;
  return base.unknown;
};

type CommandDisplayContext = {
  raw: string;
  normalized: string;
  tokens: string[];
};

const unwrapPwshCommand = (cmd: string) => {
  const tokens = tokenizeShellLike(cmd);
  if (tokens.length < 2) return "";
  const exe = String(tokens[0] ?? "").toLowerCase();
  if (!(exe.endsWith("pwsh.exe") || exe.endsWith("powershell.exe"))) return "";
  const idx = tokens.findIndex((t) => String(t).toLowerCase() === "-command");
  if (idx < 0) return "";
  const script = tokens[idx + 1] ?? "";
  return String(script ?? "").trim();
};

const unwrapCmdExe = (cmd: string) => {
  const tokens = tokenizeShellLike(cmd);
  if (tokens.length < 2) return "";
  const exe = String(tokens[0] ?? "").toLowerCase();
  if (!exe.endsWith("cmd.exe")) return "";
  const idx = tokens.findIndex((t) => {
    const s = String(t ?? "").toLowerCase();
    return s === "/c" || s === "/k";
  });
  if (idx < 0) return "";
  const rest = tokens
    .slice(idx + 1)
    .join(" ")
    .trim();
  return rest;
};

const extractSetLocation = (cmd: string): { cwd: string; inner: string } | null => {
  const text = String(cmd ?? "").trim();
  if (!text) return null;
  const m = text.match(
    /^\s*(?:set-location|cd)\s+("([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^\s;|]+))\s*;\s*(.+)$/i
  );
  if (!m) return null;
  const rawPath = m[2] ?? m[3] ?? m[4] ?? m[1] ?? "";
  const cwd = String(rawPath ?? "").trim();
  const inner = String(m[5] ?? "").trim();
  if (!cwd || !inner) return null;
  return { cwd, inner };
};

const buildCommandDisplayContext = (rawCmd: string): CommandDisplayContext => {
  const raw = String(rawCmd ?? "").trim();
  if (!raw) return { raw: "", normalized: "", tokens: [] };

  const pwshInner = unwrapPwshCommand(raw);
  const cmdInner = unwrapCmdExe(raw);
  const unwrapped = pwshInner || cmdInner || raw;

  const setLoc = extractSetLocation(unwrapped);
  const normalized = setLoc?.inner ?? unwrapped;
  const tokens = tokenizeShellLike(normalized);
  return { raw, normalized, tokens };
};

const commandTextForAction = (item: CommandGroupItem) => {
  const full = normalizeWhitespace(item.commandFull ?? "");
  if (full) return full;
  return normalizeWhitespace(item.commandShort ?? "");
};

export type CommandGroupItemType = "search" | "command";

export function commandGroupItemType(item: CommandGroupItem): CommandGroupItemType {
  const ctx = buildCommandDisplayContext(commandTextForAction(item));
  const cmd = ctx.normalized;
  if (!cmd) return "command";

  if (/\b(rg|grep|findstr)\b/i.test(cmd)) return "search";
  if (/\bselect-string\b/i.test(cmd)) return "search";
  if (/\b(get-childitem|gci|dir|ls)\b/i.test(cmd)) return "search";
  return "command";
}

export function commandGroupItemActionText(item: CommandGroupItem) {
  const ctx = buildCommandDisplayContext(commandTextForAction(item));
  const cmd = ctx.normalized;
  const lc = cmd.toLowerCase();
  const tokens = ctx.tokens;

  const withPrefix = (text: string) => text;

  const scope = inferScopeHint(cmd);

  const scopeOr = (fallbackPath: string) => {
    const hint = scope || shortenPathLike(fallbackPath, 2, 64);
    return hint ? ` in ${hint}` : "";
  };

  // 文本搜索（rg / Select-String）
  if (/\brg\b/.test(cmd)) {
    const { pattern, path } = extractRgPatternAndPath(tokens);
    const p = shortenText(unquoteToken(pattern || extractFirstQuoted(cmd)), 72) || "—";
    const s = verbForStatus(item.status, {
      running: "Grepping",
      completed: "Grepped",
      failed: "Grep attempted",
      unknown: "Grep attempted",
    });
    return withPrefix(`${s} ${p}${scopeOr(path)}`.trim());
  }

  if (/\bselect-string\b/i.test(cmd)) {
    const pattern = extractFlagValue(cmd, "-Pattern") || extractFirstQuoted(cmd);
    const path = extractFlagValue(cmd, "-Path") || extractPsVarPath(cmd);
    const p = shortenText(unquoteToken(pattern), 72) || "—";
    const s = verbForStatus(item.status, {
      running: "Grepping",
      completed: "Grepped",
      failed: "Grep attempted",
      unknown: "Grep attempted",
    });
    return withPrefix(`${s} ${p}${scopeOr(path)}`.trim());
  }

  // 读文件
  if (/\b(get-content|cat|type)\b/i.test(cmd)) {
    const path =
      extractPsVarPath(cmd) ||
      extractFlagValue(cmd, "-Path") ||
      extractFlagValue(cmd, "-LiteralPath") ||
      extractFirstQuotedPathLike(cmd) ||
      extractGetContentTargetPath(cmd) ||
      extractAnyPathLike(cmd);
    const s = verbForStatus(item.status, {
      running: "Reading",
      completed: "Read",
      failed: "Read attempted",
      unknown: "Read attempted",
    });
    const p = shortenPathLike(unquoteToken(path), 2, 84);
    return withPrefix(p ? `${s} ${p}` : s);
  }

  // 查找 / 列出文件
  if (/\b(get-childitem|gci|dir|ls)\b/i.test(cmd)) {
    const path = extractGetChildItemTargetPath(cmd) || extractFlagValue(cmd, "-Path") || extractFirstQuoted(cmd);
    const include = extractFlagValue(cmd, "-Include");
    const filter = extractFlagValue(cmd, "-Filter");
    const rawPattern = unquoteToken(include || filter || "*");
    const patternParts = rawPattern
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const patternHead = patternParts[0] ?? "*";
    const patternTail = patternParts.length > 1 ? ` (+${patternParts.length - 1})` : "";
    const pattern = shortenText(`${patternHead}${patternTail}`, 72) || "*";

    const s = verbForStatus(item.status, {
      running: "Searching files",
      completed: "Searched files",
      failed: "Search files attempted",
      unknown: "Search files attempted",
    });

    const target = shortenPathLike(unquoteToken(path), 2, 64);
    const where = scope ? ` in ${scope}` : target ? ` in ${target}` : "";
    return withPrefix(`${s} ${pattern}${where}`.trim());
  }

  // 构建 / 运行
  if (/\b(npm|pnpm|yarn)\b/i.test(cmd) && /\brun\b/i.test(cmd)) {
    const m = cmd.match(/\b(npm|pnpm|yarn)\b\s+run\s+([^\s]+)/i);
    const tool = String(m?.[1] ?? "npm").trim();
    const task = String(m?.[2] ?? "").trim();
    if (task) return withPrefix(translate("timelineFormat.command.runTaskWithTask", { tool, task }));
    return withPrefix(translate("timelineFormat.command.runTask", { tool }));
  }

  if (/\bnode\b/i.test(cmd)) {
    const quoted = extractFirstQuoted(cmd) || "";
    if (quoted) return withPrefix(translate("timelineFormat.command.runScriptWithScript", { script: quoted }));
    const idx = tokens.findIndex((t) => String(t ?? "").toLowerCase() === "node");
    const next = idx >= 0 ? String(tokens[idx + 1] ?? "").trim() : "";
    if (next) return withPrefix(translate("timelineFormat.command.runScriptWithScript", { script: next }));
    return withPrefix(translate("timelineFormat.command.runScript"));
  }

  if (/\btsc\b/i.test(cmd)) return withPrefix(translate("timelineFormat.command.typeCheck"));
  if (/\beslint\b/i.test(cmd)) return withPrefix(translate("timelineFormat.command.lint"));
  if (/\bvite\b/i.test(cmd) && lc.includes("build")) return withPrefix(translate("timelineFormat.command.buildOutput"));
  if (/\belectron-builder\b/i.test(cmd)) return withPrefix(translate("timelineFormat.command.packageBuild"));

  // Git（版本控制）
  if (/(^|\s)git(\s|$)/i.test(cmd)) {
    const sub = String(tokens[1] ?? "").trim();
    if (sub) return withPrefix(`Git：${sub}`);
    return withPrefix("Git");
  }

  // Docker（容器命令）
  if (String(tokens[0] ?? "").toLowerCase() === "docker") {
    const sub = String(tokens[1] ?? "")
      .trim()
      .toLowerCase();
    if (sub === "ps") return withPrefix(translate("timelineFormat.command.dockerListContainers"));
    if (sub === "inspect") {
      const target = String(tokens[2] ?? "").trim();
      return withPrefix(
        target
          ? translate("timelineFormat.command.dockerInspectWithTarget", { target })
          : translate("timelineFormat.command.dockerInspect")
      );
    }
    if (sub === "exec") {
      const target = String(tokens[2] ?? "").trim();
      const inner = tokens.slice(3).join(" ").trim();
      const innerShort = inner ? shortenText(inner, 80) : "";
      if (target && innerShort)
        return withPrefix(translate("timelineFormat.command.dockerExecTargetCommand", { target, command: innerShort }));
      if (target) return withPrefix(translate("timelineFormat.command.dockerExecTarget", { target }));
      return withPrefix(translate("timelineFormat.command.dockerExec"));
    }
    if (sub) return withPrefix(`Docker：${sub}`);
    return withPrefix("Docker");
  }

  // HTTP 请求（curl）
  if (String(tokens[0] ?? "").toLowerCase() === "curl") {
    const url = tokens.find((t) => /^https?:\/\//i.test(String(t ?? ""))) ?? "";
    const u = String(url ?? "").trim();
    if (u) return withPrefix(translate("timelineFormat.command.httpRequestWithUrl", { url: u }));
    return withPrefix(translate("timelineFormat.command.httpRequest"));
  }

  // 端口 / 网络（netstat）
  if (/\bnetstat\b/i.test(cmd)) {
    const ports = Array.from(new Set((cmd.match(/:(\d{2,5})/g) ?? []).map((m) => m.slice(1))));
    if (ports.length > 0)
      return withPrefix(translate("timelineFormat.command.portCheckWithPorts", { ports: ports.slice(0, 4).join(",") }));
    return withPrefix(translate("timelineFormat.command.portCheck"));
  }

  // Windows where.exe（查找可执行文件）
  if (/^(where\.exe|where)\b/i.test(cmd)) {
    const names = tokens
      .slice(1)
      .filter((t) => !String(t ?? "").startsWith("2>"))
      .map((t) => String(t ?? "").trim())
      .filter(Boolean);
    const shown = names.slice(0, 4).join(", ");
    if (shown) return withPrefix(translate("timelineFormat.command.findCommandWithNames", { names: shown }));
    return withPrefix(translate("timelineFormat.command.findCommand"));
  }

  // Get-Date（获取时间）
  if (/^get-date\b/i.test(cmd)) {
    return withPrefix(translate("timelineFormat.command.getTime"));
  }

  // Get-CimInstance Win32_Process（按 PID 查询）
  if (/^get-ciminstance\b/i.test(cmd) && /\bwin32_process\b/i.test(cmd)) {
    const pid = cmd.match(/\bprocessid\s*=\s*(\d{1,10})\b/i)?.[1] ?? "";
    if (pid) return withPrefix(translate("timelineFormat.command.processQueryWithPid", { pid }));
    return withPrefix(translate("timelineFormat.command.processQuery"));
  }

  // Python / Django 命令识别
  const firstLower = String(tokens[0] ?? "").toLowerCase();
  if (
    firstLower === "python" ||
    firstLower.endsWith("\\python.exe") ||
    firstLower.endsWith("/python.exe") ||
    firstLower.endsWith("python.exe")
  ) {
    if (tokens.includes("-V") || tokens.includes("--version"))
      return withPrefix(translate("timelineFormat.command.pythonVersion"));
    const cIdx = tokens.findIndex((t) => String(t ?? "").toLowerCase() === "-c");
    if (cIdx >= 0) return withPrefix(translate("timelineFormat.command.pythonExecC"));
    const manageIdx = tokens.findIndex((t) => /manage\.py$/i.test(String(t ?? "")));
    if (manageIdx >= 0) {
      const sub = String(tokens[manageIdx + 1] ?? "")
        .trim()
        .toLowerCase();
      const app = String(tokens[manageIdx + 2] ?? "").trim();
      if (sub === "migrate")
        return withPrefix(
          app
            ? translate("timelineFormat.command.djangoMigrateApp", { app })
            : translate("timelineFormat.command.djangoMigrate")
        );
      if (sub === "showmigrations")
        return withPrefix(
          app
            ? translate("timelineFormat.command.djangoShowMigrationsApp", { app })
            : translate("timelineFormat.command.djangoShowMigrations")
        );
      if (sub) return withPrefix(`Django：${sub}`);
      return withPrefix(translate("timelineFormat.command.djangoManage"));
    }
    return withPrefix(translate("timelineFormat.command.pythonExec"));
  }

  // 文件操作
  if (/^new-item\b/i.test(cmd) && /\b-itemtype\b/i.test(cmd) && /\bdirectory\b/i.test(cmd)) {
    const path = extractFlagValue(cmd, "-Path") || extractFirstQuoted(cmd) || String(tokens[tokens.length - 1] ?? "");
    if (path)
      return withPrefix(translate("timelineFormat.command.createDirectoryWithPath", { path: unquoteToken(path) }));
    return withPrefix(translate("timelineFormat.command.createDirectory"));
  }

  if (/^set-content\b/i.test(cmd)) {
    const path = extractFlagValue(cmd, "-Path") || extractFirstQuoted(cmd) || String(tokens[tokens.length - 1] ?? "");
    if (path) return withPrefix(translate("timelineFormat.command.writeFileWithPath", { path: unquoteToken(path) }));
    return withPrefix(translate("timelineFormat.command.writeFile"));
  }

  if (/^resolve-path\b/i.test(cmd)) {
    const path = extractFirstQuoted(cmd) || String(tokens[1] ?? "");
    if (path) return withPrefix(translate("timelineFormat.command.resolvePathWithPath", { path: unquoteToken(path) }));
    return withPrefix(translate("timelineFormat.command.resolvePath"));
  }

  // PowerShell 片段的脚本式兜底（多语句 / 管道 / 结构语句）
  if (
    cmd.startsWith("$") ||
    /^(foreach|if|for)\b/i.test(cmd) ||
    cmd.startsWith("@{") ||
    cmd.includes(" | ") ||
    (cmd.match(/;/g)?.length ?? 0) >= 2
  ) {
    const head = cmd.split(";")[0] ?? cmd;
    return withPrefix(translate("timelineFormat.command.scriptPreview", { script: shortenText(head, 90) }));
  }

  // 通用兜底：可执行文件 + 简短参数预览
  if (tokens.length > 0) {
    const exe = redactToken(String(tokens[0] ?? ""));
    const args = tokens
      .slice(1, 5)
      .map((t) => redactToken(String(t ?? "")))
      .join(" ")
      .trim();
    const tail = args ? ` ${shortenText(args, 72)}` : "";
    if (scope)
      return withPrefix(translate("timelineFormat.command.executeWithScope", { command: `${exe}${tail}`, scope }));
    return withPrefix(translate("timelineFormat.command.execute", { command: `${exe}${tail}` }));
  }

  const out = shortenText(String(item.outputPreview ?? ""), 80);
  if (out) return withPrefix(translate("timelineFormat.command.execute", { command: out }));
  return withPrefix(translate("timelineFormat.command.executeUnknown"));
}

export function commandGroupItemActionDetailText(item: CommandGroupItem) {
  const ctx = buildCommandDisplayContext(commandTextForAction(item));
  const cmd = ctx.normalized;
  if (/\brg\b/.test(cmd) || /\bselect-string\b/i.test(cmd)) return "";
  if (/\b(get-content|cat|type)\b/i.test(cmd)) return "";
  if (/\b(get-childitem|gci|dir|ls)\b/i.test(cmd)) return "";
  const scope = inferScopeHint(cmd);
  if (scope) return translate("timelineFormat.command.scope", { scope });
  return "";
}

export function commandActionNodeTitle(node: CommandActionNode) {
  const cmd = buildCommandDisplayContext(commandTextForAction(node.item)).normalized;
  const statusText = commandGroupItemStatusText(node.item);

  const MAX_PREVIEW_LINES = 6;
  const MAX_GCI_FILES_PREVIEW = 10;
  const MAX_TOOLTIP_CHARS = 2200;

  const stripAnsi = (value: string) => String(value ?? "").replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");

  const normalizeNewlines = (value: string) => stripAnsi(String(value ?? "")).replace(/\r\n/g, "\n");

  const splitRunnerOutput = (value: string): { headerLines: string[]; body: string } => {
    const text = normalizeNewlines(value).trimEnd();
    if (!text.trim()) return { headerLines: [], body: "" };
    const lines = text.split("\n");
    const idx = lines.findIndex(
      (line) =>
        String(line ?? "")
          .trim()
          .toLowerCase() === "output:"
    );
    if (idx < 0) return { headerLines: [], body: text };
    const headerLines = lines
      .slice(0, idx)
      .map((l) => String(l ?? "").trimEnd())
      .filter((l) => l.trim().length > 0);
    const body = lines
      .slice(idx + 1)
      .join("\n")
      .trim();
    return { headerLines, body };
  };

  const summarizeOutputBody = (body: string, maxLines: number) => {
    const rawLines = String(body ?? "")
      .split("\n")
      .map((l) => String(l ?? "").trimEnd());
    const trimmedLines = rawLines.filter((l) => l.trim().length > 0);
    const lineCount = trimmedLines.length;
    const previewLines = trimmedLines.slice(0, maxLines);
    const truncated = lineCount > maxLines;
    return { lineCount, previewLines, truncated };
  };

  const formatResultLines = () => {
    if (node.item.filesCount > 0 && Array.isArray(node.item.files) && node.item.files.length > 0) {
      const head = node.item.files.slice(0, MAX_GCI_FILES_PREVIEW);
      const remain = Math.max(0, node.item.filesCount - head.length);
      const listText = head.join(", ");
      const suffix = remain > 0 ? translate("timelineFormat.remainingSuffix", { count: remain }) : "";
      return [translate("timelineFormat.filesPreview", { count: node.item.filesCount, files: listText, suffix })];
    }

    const { body } = splitRunnerOutput(node.item.outputFull ?? "");
    const { lineCount, previewLines, truncated } = summarizeOutputBody(body, MAX_PREVIEW_LINES);
    const lines: string[] = [];
    lines.push(`outputLines: ${lineCount}`);
    lines.push("result:");
    if (previewLines.length === 0) lines.push("—");
    else lines.push(...previewLines);
    if (truncated) lines.push(translate("timelineFormat.outputTruncatedLines", { count: MAX_PREVIEW_LINES }));
    return lines;
  };

  const metrics: string[] = [];
  if (node.item.exitCode != null) metrics.push(`exitCode: ${node.item.exitCode}`);
  if (node.item.durationMs != null) metrics.push(`duration: ${node.item.durationMs}ms`);

  const parts = [
    `cmd: ${cmd}`,
    `status: ${statusText}${metrics.length > 0 ? ` ｜ ${metrics.join(" ｜ ")}` : ""}`,
    ...formatResultLines(),
  ];

  let text = parts.join("\n");
  if (text.length > MAX_TOOLTIP_CHARS) {
    text = `${text.slice(0, Math.max(0, MAX_TOOLTIP_CHARS - 1))}${translate("timelineFormat.truncatedSuffix")}`;
  }
  return text;
}

function ensureMcpToolCallStatus(item: McpToolCallItem): McpToolCallStatus {
  if (item.errorText) return "failed";
  if (item.status === "failed") return "failed";
  if (item.completedAt != null) return "completed";
  if (item.startedAt != null) return "running";
  return "unknown";
}

export function mcpToolGroupTagText(group: McpToolGroupNode) {
  if (group.stats.failed > 0) return translate("timelineFormat.mcp.groupFailed");
  if (group.stats.running > 0) return translate("timelineFormat.mcp.groupRunning");
  return "MCP";
}

export function mcpToolGroupSummaryText(group: McpToolGroupNode) {
  if (group.stats.running > 0)
    return translate("timelineFormat.mcp.summaryRunning", { running: group.stats.running, total: group.stats.total });
  if (group.stats.failed > 0)
    return translate("timelineFormat.mcp.summaryFailed", {
      completed: group.stats.completed,
      total: group.stats.total,
      failed: group.stats.failed,
    });
  if (group.stats.completed > 0)
    return translate("timelineFormat.mcp.summaryCompleted", {
      completed: group.stats.completed,
      total: group.stats.total,
    });
  return translate("timelineFormat.mcp.summaryPending", { total: group.stats.total });
}

export function mcpToolGroupStatsText(group: McpToolGroupNode) {
  const parts = [
    translate("timelineFormat.mcp.statsTotal", { count: group.stats.total }),
    translate("timelineFormat.mcp.statsCompleted", { count: group.stats.completed }),
    translate("timelineFormat.mcp.statsRunning", { count: group.stats.running }),
  ];
  if (group.stats.failed > 0) parts.push(translate("timelineFormat.mcp.statsFailed", { count: group.stats.failed }));
  if (group.stats.unknown > 0) parts.push(translate("timelineFormat.mcp.statsUnknown", { count: group.stats.unknown }));
  return parts.join(translate("timelineFormat.separator"));
}

export function mcpToolItemClass(item: McpToolCallItem) {
  const status = ensureMcpToolCallStatus(item);
  if (status === "running") return "[&_.mcp-tool-item-status]:text-[var(--accent)]";
  if (status === "completed") return "[&_.mcp-tool-item-status]:text-[var(--success)]";
  if (status === "failed") return "[&_.mcp-tool-item-status]:text-[var(--danger)]";
  return "[&_.mcp-tool-item-status]:text-[var(--warning)]";
}

export function mcpToolItemStatusText(item: McpToolCallItem) {
  const status = ensureMcpToolCallStatus(item);
  if (status === "running") {
    if (item.startedAt == null) return translate("timelineFormat.status.running");
    const elapsedMs = Math.max(0, Date.now() - item.startedAt);
    const elapsedSec = Math.max(1, Math.round(elapsedMs / 1000));
    return translate("timelineFormat.status.runningElapsed", { seconds: elapsedSec });
  }
  if (status === "completed") return translate("timelineFormat.status.completed");
  if (status === "failed") return translate("timelineFormat.status.failed");
  return translate("timelineFormat.status.unknown");
}

export function mcpToolItemMetricsText(item: McpToolCallItem) {
  const metrics: string[] = [];
  if (item.durationMs != null) metrics.push(`${item.durationMs}ms`);
  if (item.rawStatus) metrics.push(`status ${item.rawStatus}`);
  if (metrics.length > 0) return metrics.join(" ｜ ");
  return "—";
}

export function mcpToolItemMetaText(item: McpToolCallItem) {
  const parts = [`server ${item.server || "unknown"}`];
  if (item.turnId && item.turnId !== "unknown") parts.push(`turn ${String(item.turnId).slice(0, 24)}`);
  if (item.tool) parts.push(`tool ${item.tool}`);
  return parts.join(" ｜ ");
}

export function mcpToolItemTitle(item: McpToolCallItem) {
  const toolText = String(item.tool ?? "").trim() || translate("timelineFormat.mcp.toolFallback");
  const eventsText = String(item.eventsSummary ?? "").trim();
  if (!eventsText) return toolText;
  return `${toolText}\n${eventsText}`;
}

export function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString();
}
