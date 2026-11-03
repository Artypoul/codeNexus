import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { AppTextEncoding, AppTextLineEnding } from "@codenexus/shared/ipc/contracts";

export function isPathWithinDir(filePath: string, dirPath: string): boolean {
  const file = resolve(String(filePath ?? ""));
  const dir = resolve(String(dirPath ?? ""));
  if (!file || !dir) return false;
  if (file === dir) return true;
  const rel = relative(dir, file);
  if (!rel) return false;
  return !rel.startsWith("..") && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function resolveLocalFilePath(input: string): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const home = homedir();
  let expanded = raw.replace(/^~(?=$|[\\/])/, home);
  expanded = expanded.replace(/%([^%]+)%/g, (_match, key: string) => {
    const value = process.env[String(key ?? "").trim()];
    return typeof value === "string" && value.length > 0 ? value : `%${key}%`;
  });
  expanded = expanded.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, key: string) => {
    const value = process.env[String(key ?? "").trim()];
    return typeof value === "string" && value.length > 0 ? value : `$${key}`;
  });
  if (isAbsolute(expanded)) return expanded;
  return resolve(expanded);
}

export function detectTextEncoding(buffer: Buffer): AppTextEncoding {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return "UTF-8 BOM";
  }
  return "UTF-8";
}

export function stripUtf8Bom(buffer: Buffer): Buffer {
  return detectTextEncoding(buffer) === "UTF-8 BOM" ? buffer.subarray(3) : buffer;
}

export function detectLineEnding(text: string): AppTextLineEnding | null {
  if (text.includes("\r\n")) return "CRLF";
  if (text.includes("\n")) return "LF";
  if (text.includes("\r")) return "CR";
  return null;
}

export function encodeUtf8Text(content: string, encoding: AppTextEncoding): Buffer {
  const body = Buffer.from(String(content ?? ""), "utf8");
  if (encoding === "UTF-8 BOM") {
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]);
  }
  return body;
}

export function toLocalDateYmd(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? String(v) : v));
  } catch (e: any) {
    return JSON.stringify({ _error: "json_stringify_failed", message: String(e?.message ?? e) });
  }
}

export function truncateText(value: unknown, maxLen: number): string | undefined {
  const text = typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
  if (!text) return undefined;
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}\n…(truncated ${text.length - maxLen} chars)`;
}

export function toNullableText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

export function toIntegerInRange(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n);
  return Math.max(min, Math.min(max, rounded));
}

export function normalizeHttpUrl(value: unknown): string | null {
  const text = toNullableText(value);
  if (!text) return null;
  const trimmed = text.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.length > 1200 ? `${text.slice(0, 1200)}...` : text;
  } catch {
    return "";
  }
}
