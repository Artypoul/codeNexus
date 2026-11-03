export type PathHighlightToken = { kind: "text"; value: string } | { kind: "path"; value: string };

const PATH_CHUNK_CLASS = String.raw`[^\s()\[\]{}<>"'` + "`" + String.raw`,;!?，。；：！？、（）【】《》“”‘’「」『』…]`;
const CANDIDATE_REGEX = new RegExp(`${PATH_CHUNK_CLASS}*[\\\\/]${PATH_CHUNK_CLASS}+`, "g");

const TRIM_LEFT_CHARS = new Set(["(", "[", "{", "<", '"', "'", "“", "‘", "（", "【", "《"]);
const TRIM_RIGHT_CHARS = new Set([
  ")",
  "]",
  "}",
  ">",
  '"',
  "'",
  "”",
  "’",
  ",",
  ".",
  ";",
  "!",
  "?",
  "，",
  "。",
  "…",
  "；",
  "！",
  "？",
  "）",
  "】",
  "》",
  "」",
  "』",
]);

const KNOWN_REPO_DIRS = [
  "src",
  "packages",
  "apps",
  "docs",
  "scripts",
  "test",
  "tests",
  "build",
  "dist",
  "public",
  "assets",
  "config",
  "configs",
  "components",
  "services",
  "lib",
  "libs",
  "api",
  "backend",
  "frontend",
  "server",
  "client",
  "shared",
  "tools",
  "examples",
  "example",
  "demo",
  "node_modules",
  "tmp",
  ".github",
  ".vscode",
];
const KNOWN_REPO_DIR_ALTERNATION = KNOWN_REPO_DIRS.map(escapeRegExp).join("|");
const KNOWN_REPO_PREFIX_REGEX = new RegExp(`^(?:${KNOWN_REPO_DIR_ALTERNATION})[\\\\/]`, "i");
const KNOWN_REPO_PREFIX_SEARCH_REGEX = new RegExp(
  `(?:^|[^A-Za-z0-9_@#%+=~.\\\\/-])(${KNOWN_REPO_DIR_ALTERNATION}[\\\\/])`,
  "i"
);
const RELATIVE_PREFIX_REGEX = /^(\.{1,2}[\\/]|~[\\/])/;
const WINDOWS_ABSOLUTE_REGEX = /^[A-Za-z]:[\\/]/;
const UNC_ABSOLUTE_REGEX = /^(\\\\|\/\/)[^\s]+/;
const UNIX_ABSOLUTE_REGEX = /^\//;
const URL_LIKE_REGEX = /:\/\//;
const SENTENCE_PUNCTUATION_REGEX = /[、，。；：！？…（）【】《》“”‘’「」『』]/;
const FILE_EXTENSION_AT_END_REGEX = /\.(?:c|h|m|r|7z|[A-Za-z][A-Za-z0-9]{1,11})$/i;
const CJK_LETTER_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u;

export type ParsedPathToken = {
  full: string;
  core: string;
  suffix: string;
  basename: string;
  segments: string[];
};

type PathTextMatch = {
  value: string;
  start: number;
  end: number;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countSeparators(value: string): number {
  let count = 0;
  for (const ch of value) {
    if (ch === "/" || ch === "\\") count += 1;
  }
  return count;
}

function splitCandidatePunctuation(raw: string): { leading: string; core: string; trailing: string } {
  let start = 0;
  let end = raw.length;
  while (start < end && TRIM_LEFT_CHARS.has(raw[start] ?? "")) start += 1;
  while (end > start && TRIM_RIGHT_CHARS.has(raw[end - 1] ?? "")) end -= 1;
  return { leading: raw.slice(0, start), core: raw.slice(start, end), trailing: raw.slice(end) };
}

function findPathStartIndex(core: string): number {
  if (WINDOWS_ABSOLUTE_REGEX.test(core)) return 0;
  if (UNC_ABSOLUTE_REGEX.test(core)) return 0;
  if (UNIX_ABSOLUTE_REGEX.test(core)) return 0;
  if (RELATIVE_PREFIX_REGEX.test(core)) return 0;

  const known = KNOWN_REPO_PREFIX_SEARCH_REGEX.exec(core);
  if (known?.index != null) {
    return known.index + known[0].length - known[1].length;
  }

  const asciiSegment = /[A-Za-z0-9_@#%+=~.-]+[\\/]/.exec(core);
  return asciiSegment?.index ?? 0;
}

function trimTrailingProseAfterExtension(core: string): string {
  const extensionPattern = /\.[A-Za-z0-9]{1,12}/g;
  let cutAt = -1;

  while (true) {
    const match = extensionPattern.exec(core);
    if (!match) break;
    const extensionEnd = (match.index ?? 0) + match[0].length;
    const rest = core.slice(extensionEnd);
    const suffix = /^(?::\d+(?::\d+)?|#L\d+(?:C\d+)?)/i.exec(rest)?.[0] ?? "";
    const afterSuffix = rest.slice(suffix.length);
    const nextCodePoint = afterSuffix.codePointAt(0);
    if (nextCodePoint != null && CJK_LETTER_REGEX.test(String.fromCodePoint(nextCodePoint))) {
      cutAt = extensionEnd + suffix.length;
    }
  }

  return cutAt > 0 ? core.slice(0, cutAt) : core;
}

function isStrongPathCore(coreValue: string): boolean {
  const core = String(coreValue ?? "").trim();
  if (!core) return false;
  if (URL_LIKE_REGEX.test(core)) return false;
  if (SENTENCE_PUNCTUATION_REGEX.test(core)) return false;

  if (WINDOWS_ABSOLUTE_REGEX.test(core)) return true;
  if (UNC_ABSOLUTE_REGEX.test(core)) return true;
  if (UNIX_ABSOLUTE_REGEX.test(core)) return true;
  if (RELATIVE_PREFIX_REGEX.test(core)) return true;
  if (KNOWN_REPO_PREFIX_REGEX.test(core)) return true;

  const { core: withoutSuffix } = extractSuffix(core);
  const segments = splitSegments(withoutSuffix);
  const basename = segments[segments.length - 1] ?? "";
  return FILE_EXTENSION_AT_END_REGEX.test(basename);
}

function isLoosePathCore(coreValue: string): boolean {
  const core = String(coreValue ?? "").trim();
  if (!core) return false;
  if (URL_LIKE_REGEX.test(core)) return false;
  if (SENTENCE_PUNCTUATION_REGEX.test(core)) return false;
  if (isStrongPathCore(core)) return true;

  if (countSeparators(core) < 2 || core.length < 6) return false;
  return splitSegments(core).some((segment) => /[A-Za-z]/.test(segment) || segment.includes("."));
}

function findPathTextMatch(value: string, strongOnly: boolean): PathTextMatch | null {
  const raw = String(value ?? "");
  if (!raw.includes("/") && !raw.includes("\\")) return null;
  if (URL_LIKE_REGEX.test(raw)) return null;

  const split = splitCandidatePunctuation(raw);
  if (!split.core) return null;
  if (/\s/.test(split.core)) return null;

  let core = split.core;
  let leading = split.leading;
  const startInCore = findPathStartIndex(core);
  if (startInCore > 0) {
    leading += core.slice(0, startInCore);
    core = core.slice(startInCore);
  }
  core = trimTrailingProseAfterExtension(core);
  if (!core) return null;
  if (strongOnly ? !isStrongPathCore(core) : !isLoosePathCore(core)) return null;

  return {
    value: core,
    start: leading.length,
    end: leading.length + core.length,
  };
}

export function isPathLikeStrict(textValue: string): boolean {
  return findPathTextMatch(String(textValue ?? "").trim(), false) != null;
}

export function isPathLikeStrong(textValue: string): boolean {
  return findPathTextMatch(String(textValue ?? "").trim(), true) != null;
}

function normalizeSlashes(value: string): string {
  return String(value ?? "").replace(/\\/g, "/");
}

function extractSuffix(value: string): { core: string; suffix: string } {
  const text = String(value ?? "").trim();
  if (!text) return { core: "", suffix: "" };

  // Support :line[:col] suffix
  const colonMatch = text.match(/^(.*?)(:\d+(?::\d+)?)$/);
  if (colonMatch) {
    return { core: colonMatch[1] ?? "", suffix: colonMatch[2] ?? "" };
  }

  // Support #Lline[Ccol] suffix
  const anchorMatch = text.match(/^(.*?)(#L\d+(?:C\d+)?)$/i);
  if (anchorMatch) {
    return { core: anchorMatch[1] ?? "", suffix: anchorMatch[2] ?? "" };
  }

  return { core: text, suffix: "" };
}

function splitSegments(core: string): string[] {
  const normalized = normalizeSlashes(core);
  return normalized.split("/").filter(Boolean);
}

function basenameFromSegments(segments: string[]): string {
  return segments.length > 0 ? (segments[segments.length - 1] ?? "") : "";
}

export function parsePathToken(value: string): ParsedPathToken | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const match = findPathTextMatch(raw, false);
  if (!match) return null;

  const trimmed = match.value;
  const { core, suffix } = extractSuffix(trimmed);
  if (!core) return null;

  const segments = splitSegments(core);
  const basename = basenameFromSegments(segments);
  if (!basename) return null;

  return {
    full: trimmed,
    core,
    suffix,
    basename,
    segments,
  };
}

function pushText(tokens: PathHighlightToken[], value: string) {
  if (!value) return;
  const last = tokens[tokens.length - 1];
  if (last?.kind === "text") {
    last.value += value;
    return;
  }
  tokens.push({ kind: "text", value });
}

function pushPath(tokens: PathHighlightToken[], value: string) {
  if (!value) return;
  tokens.push({ kind: "path", value });
}

export function tokenizePathLikeText(textValue: string): PathHighlightToken[] {
  const text = String(textValue ?? "");
  if (!text) return [{ kind: "text", value: "" }];
  if (!text.includes("/") && !text.includes("\\")) return [{ kind: "text", value: text }];

  const tokens: PathHighlightToken[] = [];
  let lastIndex = 0;

  CANDIDATE_REGEX.lastIndex = 0;
  while (true) {
    const match = CANDIDATE_REGEX.exec(text);
    if (!match) break;
    const rawCandidate = match[0] ?? "";
    const matchStart = match.index ?? 0;
    const matchEnd = matchStart + rawCandidate.length;

    if (matchStart > lastIndex) pushText(tokens, text.slice(lastIndex, matchStart));

    const pathMatch = findPathTextMatch(rawCandidate, true);
    if (!pathMatch) {
      pushText(tokens, rawCandidate);
      lastIndex = matchEnd;
      continue;
    }

    if (pathMatch.start > 0) pushText(tokens, rawCandidate.slice(0, pathMatch.start));
    pushPath(tokens, pathMatch.value);
    if (pathMatch.end < rawCandidate.length) pushText(tokens, rawCandidate.slice(pathMatch.end));

    lastIndex = matchEnd;
  }

  if (lastIndex < text.length) pushText(tokens, text.slice(lastIndex));
  if (tokens.length === 0) return [{ kind: "text", value: text }];

  return tokens;
}
