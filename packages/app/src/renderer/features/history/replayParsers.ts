// 历史回放解析：把 sessions 分页数据归一化为时间线事件序列。
import type { HistoryThreadEvent } from "@codenexus/shared/ipc";
import { resolveComposeTextElements } from "../../domain/composeFileMentions";
import { translate } from "../../i18n/translate";
import { normalizeHistoryWebSearchCall } from "../timeline/webSearch";

export type ReplayTimelineEvent = {
  id: string;
  method: string;
  paramsText: string;
  params?: unknown;
  turnId?: string;
  level?: "info" | "warn" | "error";
  localKind?: "user" | "thinking";
  localState?: "pending" | "sent" | "failed";
  thinkingPhase?: "queued" | "preparing" | "reasoning" | "streaming" | "waiting_more" | "completed" | "failed";
  hidden?: boolean;
  createdAt?: number;
};

// 标准化字符串输入，统一 trim 处理。
function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAgentMessagePhase(value: unknown): "commentary" | "final_answer" | "" {
  const phase = normalizeText(value);
  return phase === "commentary" || phase === "final_answer" ? phase : "";
}

// 识别 AGENTS 指令注入文本，避免在聊天区重复占位展示。
function isAgentsBootstrapText(text: string): boolean {
  const value = normalizeText(text);
  if (!value) return false;
  if (value.includes("AGENTS.md instructions for")) return true;
  if (value.includes("<INSTRUCTIONS>") && value.includes("</INSTRUCTIONS>")) return true;
  return false;
}

// 推断注入指令来源（全局配置/项目目录/未知）。
function inferContextInjectionSource(text: string): "global" | "project" | "unknown" {
  const value = normalizeText(text).toLowerCase();
  if (!value) return "unknown";
  if (value.includes(".codex")) return "global";
  if (value.includes("instructions for")) return "project";
  return "unknown";
}

// 从指令文本里提取来源文件名。
function extractContextInjectionFile(text: string): string {
  const value = String(text ?? "");
  const firstLine =
    value
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0)
      ?.trim() ?? "";
  const headingMatch = firstLine.match(/^#\s*([^\s]+)\s+instructions\s+for\s+/i);
  if (headingMatch?.[1]) return headingMatch[1];
  const mdMatch = value.match(/\b([A-Z0-9_.-]+\.md)\b/i);
  if (mdMatch?.[1]) return mdMatch[1];
  return "AGENTS.md";
}

// 粗略统计指令规则条目数，用于生成摘要。
function countContextRules(text: string): number {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const explicitRules = lines.filter((line) => /^[-*]\s*(✅|❌|☑️|✔️)/.test(line)).length;
  if (explicitRules > 0) return explicitRules;
  const numberedRules = lines.filter((line) => /^\d+\.\s+/.test(line)).length;
  if (numberedRules > 0) return numberedRules;
  const bulletRules = lines.filter((line) => /^[-*]\s+/.test(line)).length;
  return bulletRules;
}

// 生成“上下文注入”展示摘要。
function toContextInjectionSummary(text: string): { source: string; file: string; rules: number; summary: string } {
  const source = inferContextInjectionSource(text);
  const file = extractContextInjectionFile(text);
  const rules = countContextRules(text);
  return {
    source,
    file,
    rules,
    summary: translate("runtime.contextInjectedSummary", { source, file, rules }),
  };
}

function toEpochMillis(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1_000_000_000_000) return Math.round(value);
    if (value > 1_000_000_000) return Math.round(value * 1000);
    return null;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return toEpochMillis(numeric);
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// 从 content 数组提取文本（兼容 string/object 混排）。
export function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      const text = part.trim();
      if (text) parts.push(text);
      continue;
    }
    if (!part || typeof part !== "object") continue;
    const text = normalizeText((part as any).text);
    if (text) parts.push(text);
  }
  return parts.join("\n");
}

// 把 reasoning summary 数组提取成纯文本片段列表。
function toReasoningTexts(summary: unknown): string[] {
  if (!Array.isArray(summary)) return [];
  const texts: string[] = [];
  for (const part of summary) {
    if (typeof part === "string") {
      const text = part.trim();
      if (text) texts.push(text);
      continue;
    }
    if (!part || typeof part !== "object") continue;
    const text = normalizeText((part as any).text);
    if (text) texts.push(text);
  }
  return texts;
}

function stableReplayId(prefix: string, createdAt: number, seq: number): string {
  return `${prefix}:${createdAt}:${seq}`;
}

function toCommandLifecycleReplayEventId(
  method: "item/started" | "item/completed",
  threadId: string,
  turnId: string,
  itemId: string
): string {
  const normalizedThreadId = normalizeText(threadId) || "__app__";
  const normalizedTurnId = normalizeText(turnId) || "unknown";
  const normalizedItemId = normalizeText(itemId) || "unknown";
  return `notif:${method}:commandExecution:${normalizedThreadId}:${normalizedTurnId}:${normalizedItemId}`;
}

function sortReplayEvents(events: ReplayTimelineEvent[]): ReplayTimelineEvent[] {
  return [...events].sort((a, b) => {
    const ta = Number.isFinite(a.createdAt) ? Number(a.createdAt) : 0;
    const tb = Number.isFinite(b.createdAt) ? Number(b.createdAt) : 0;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}

function parseCommandFromArguments(raw: unknown): string {
  const text = normalizeText(raw);
  if (!text) return "shell_command";
  try {
    const parsed = JSON.parse(text);
    const command = normalizeText((parsed as any)?.command);
    return command || "shell_command";
  } catch {
    return text.length > 220 ? `${text.slice(0, 220)}…` : text;
  }
}

function parseMcpName(name: unknown): { ok: true; server: string; tool: string } | { ok: false } {
  const raw = normalizeText(name);
  if (!raw) return { ok: false };
  if (!raw.startsWith("mcp__")) return { ok: false };
  const parts = raw.split("__").filter(Boolean);
  if (parts.length < 3) return { ok: false };
  const server = parts[1] || "unknown";
  const tool = parts.slice(2).join("__") || "mcpToolCall";
  return { ok: true, server, tool };
}

function tryParseJson(value: string): unknown | null {
  const text = normalizeText(value);
  if (!text) return null;
  if (!text.startsWith("{") && !text.startsWith("[")) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractTextFromMcpOutput(output: unknown): string {
  if (typeof output === "string") {
    const maybe = tryParseJson(output);
    if (Array.isArray(maybe)) {
      const texts = maybe
        .map((p) => (p && typeof p === "object" ? normalizeText((p as any).text) : ""))
        .filter(Boolean);
      if (texts.length > 0) return texts.join("\n\n");
    }
    if (maybe && typeof maybe === "object") {
      const content = (maybe as any).content;
      if (Array.isArray(content)) {
        const texts = content
          .map((p: any) => (typeof p === "string" ? p.trim() : normalizeText(p?.text)))
          .filter(Boolean);
        if (texts.length > 0) return texts.join("\n\n");
      }
      const textField = normalizeText((maybe as any).text);
      if (textField) return textField;
      const outputField = normalizeText((maybe as any).output);
      if (outputField) return outputField;
    }
    return output;
  }

  if (output && typeof output === "object") {
    const content = (output as any).content;
    if (Array.isArray(content)) {
      const texts = content
        .map((p: any) => (typeof p === "string" ? p.trim() : normalizeText(p?.text)))
        .filter(Boolean);
      if (texts.length > 0) return texts.join("\n\n");
    }
    const textField = normalizeText((output as any).text);
    if (textField) return textField;
    const outputField = normalizeText((output as any).output);
    if (outputField) return outputField;
  }

  return "";
}

export function parseSessionReplayEvents(entries: HistoryThreadEvent[], threadId: string): ReplayTimelineEvent[] {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(translate("runtime.sessionsHistoryEmpty"));
  }
  const events: ReplayTimelineEvent[] = [];
  const seenMessage = new Set<string>();
  const seenContextSummary = new Set<string>();
  const seenUserMessageIndex = new Map<string, number>();
  const pendingCalls = new Map<
    string,
    {
      kind: "shell" | "mcp" | "other";
      name: string;
      command: string;
      server: string;
      tool: string;
      turnId: string;
      createdAt: number;
      arguments: unknown;
    }
  >();
  const startedTurn = new Set<string>();
  let activeTurnId = "";
  let seq = 0;
  const baseTs = Date.now() - entries.length * 25;

  const push = (event: Omit<ReplayTimelineEvent, "id">) => {
    const createdAt = Number.isFinite(event.createdAt) ? Number(event.createdAt) : baseTs + seq;
    events.push({
      ...event,
      createdAt,
      id: stableReplayId("sessions", createdAt, seq),
    });
    seq += 1;
  };

  const pushWithId = (id: string, event: Omit<ReplayTimelineEvent, "id">) => {
    const createdAt = Number.isFinite(event.createdAt) ? Number(event.createdAt) : baseTs + seq;
    const normalizedId = normalizeText(id);
    events.push({
      ...event,
      createdAt,
      id: normalizedId || stableReplayId("sessions", createdAt, seq),
    });
    seq += 1;
  };

  const normalizeUserMessagePayload = (payload: {
    text: string;
    text_elements?: unknown;
    images?: unknown;
    local_images?: unknown;
    content?: unknown;
  }): {
    displayText: string;
    canonical: string;
    imageCount: number;
    payload: {
      role: "user";
      text: string;
      text_elements: ReturnType<typeof resolveComposeTextElements>;
      images: string[] | null;
      local_images: string[];
      content?: unknown[];
    };
  } => {
    const rawContent = Array.isArray(payload.content) ? payload.content : [];
    const content = rawContent.filter((item) => item && typeof item === "object" && !Array.isArray(item)) as Record<
      string,
      unknown
    >[];
    const contentText = content
      .filter((item) => item.type === "text" || item.type === "input_text")
      .map((item) => String(item.text ?? ""))
      .join("");
    const text = (String(payload.text ?? "") || contentText).replace(/\r\n/g, "\n");
    const normalizedImages = Array.isArray(payload.images) ? payload.images.map((item) => String(item ?? "")) : [];
    const normalizedLocalImages = Array.isArray(payload.local_images)
      ? payload.local_images.map((item) => String(item ?? "")).filter((item) => Boolean(item.trim()))
      : [];
    const textElements = resolveComposeTextElements(text, payload.text_elements, { inferAbsolutePaths: true });
    for (const item of content) {
      if (item.type === "image" && typeof item.url === "string" && item.url.trim()) {
        normalizedImages.push(item.url.trim());
      } else if (item.type === "localImage" && typeof item.path === "string" && item.path.trim()) {
        normalizedLocalImages.push(item.path.trim());
      } else if (item.type === "input_image") {
        const imageUrl =
          typeof item.image_url === "string"
            ? item.image_url
            : item.image_url && typeof item.image_url === "object" && "url" in item.image_url
              ? String(item.image_url.url ?? "")
              : "";
        if (imageUrl.trim()) normalizedImages.push(imageUrl.trim());
      }
    }
    const uniqueImages = [...new Set(normalizedImages)];
    const uniqueLocalImages = [...new Set(normalizedLocalImages)];
    const imageCount = uniqueImages.length + uniqueLocalImages.length;
    const skills = content
      .filter((item) => item.type === "skill" || item.type === "input_skill")
      .map((item) => ({ name: String(item.name ?? "").trim(), path: String(item.path ?? "").trim() }))
      .filter((item) => item.name && item.path);
    const imageSummary = imageCount > 0 ? translate("runtime.attachedImageSummary", { count: imageCount }) : "";
    const contentSummary = content
      .map((item) => {
        if (item.type === "text" || item.type === "input_text") return String(item.text ?? "");
        if (item.type === "skill" || item.type === "input_skill") return item.name ? `$${item.name}` : "";
        if (item.type === "mention") return String(item.path ?? "");
        return "";
      })
      .join("");
    const messageSummary = contentText ? contentSummary : [text, contentSummary].filter(Boolean).join("\n");
    const displayText = [messageSummary, imageSummary].filter(Boolean).join("\n");
    const canonicalBase = [
      normalizeText(text),
      ...skills.map((item) => `${item.name}:${item.path}`),
      ...content.filter((item) => item.type === "mention").map((item) => String(item.path ?? "")),
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return {
      displayText,
      canonical: canonicalBase || `__image_only__:${imageCount}`,
      imageCount,
      payload: {
        role: "user",
        text,
        text_elements: textElements,
        images: uniqueImages.length > 0 ? uniqueImages : null,
        local_images: uniqueLocalImages,
        ...(content.length > 0 ? { content } : {}),
      },
    };
  };

  const buildUserDedupeKeys = (turnId: string, canonical: string, createdAt: number): string[] => {
    const turnKey = normalizeText(turnId) || "unknown";
    const secondBucket = Math.floor(Number(createdAt) / 1000);
    return [`${turnKey}:user:${canonical}`, `${secondBucket}:user:${canonical}`];
  };

  const findExistingUserMessageIndex = (keys: string[]): number | null => {
    for (const key of keys) {
      const hit = seenUserMessageIndex.get(key);
      if (typeof hit === "number" && hit >= 0) return hit;
    }
    return null;
  };

  const rememberUserMessageIndex = (keys: string[], index: number) => {
    for (const key of keys) {
      if (!key) continue;
      seenUserMessageIndex.set(key, index);
    }
  };

  const pushUserMessage = (
    turnId: string,
    payload: {
      text: string;
      text_elements?: unknown;
      images?: unknown;
      local_images?: unknown;
      content?: unknown;
    },
    createdAt: number
  ) => {
    const normalized = normalizeUserMessagePayload(payload);
    if (!normalized.displayText) return;

    const dedupeKeys = buildUserDedupeKeys(turnId, normalized.canonical, createdAt);
    const existingIdx = findExistingUserMessageIndex(dedupeKeys);
    if (existingIdx != null) {
      const existing = events[existingIdx];
      const existingText = normalizeText(existing?.paramsText) ?? "";
      const existingParams =
        existing?.params && typeof existing.params === "object" ? (existing.params as Record<string, unknown>) : null;
      const existingTextElementCount = Array.isArray(existingParams?.text_elements)
        ? existingParams.text_elements.length
        : 0;
      const existingImageCount =
        (Array.isArray(existingParams?.images) ? existingParams.images.length : 0) +
        (Array.isArray(existingParams?.local_images) ? existingParams.local_images.length : 0);
      const existingContent = Array.isArray(existingParams?.content) ? existingParams.content : [];
      if (
        normalized.displayText.length > existingText.length ||
        normalized.payload.text_elements.length > existingTextElementCount ||
        normalized.imageCount > existingImageCount ||
        (normalized.payload.content?.length ?? 0) > existingContent.length
      ) {
        // 事件对象被视为不可变数据：下游会按对象身份做签名缓存，原地改写会让缓存读到旧值。
        events[existingIdx] = {
          ...existing,
          paramsText:
            normalized.displayText.length >= existingText.length ? normalized.displayText : existing.paramsText,
          params: {
            ...existingParams,
            ...normalized.payload,
            ...(!normalized.payload.content && existingContent.length > 0 ? { content: existingContent } : {}),
            ...(existingTextElementCount > normalized.payload.text_elements.length ||
            (existingTextElementCount > 0 && !Array.isArray(payload.text_elements))
              ? { text_elements: existingParams?.text_elements }
              : {}),
            images: [
              ...new Set([
                ...(Array.isArray(existingParams?.images) ? existingParams.images : []),
                ...(normalized.payload.images ?? []),
              ]),
            ],
            local_images: [
              ...new Set([
                ...(Array.isArray(existingParams?.local_images) ? existingParams.local_images : []),
                ...normalized.payload.local_images,
              ]),
            ],
          },
        };
      }
      return;
    }

    const hideUserRow = isAgentsBootstrapText(normalized.payload.text || normalized.displayText);
    push({
      method: "user",
      paramsText: normalized.displayText,
      params: normalized.payload,
      turnId: turnId || undefined,
      localKind: "user",
      localState: "sent",
      hidden: hideUserRow,
      createdAt,
    });
    rememberUserMessageIndex(dedupeKeys, events.length - 1);

    if (!hideUserRow) return;
    const context = toContextInjectionSummary(normalized.payload.text || normalized.displayText);
    const summaryKey = `${turnId || "unknown"}:${context.source}:${context.file}:${context.rules}`;
    if (seenContextSummary.has(summaryKey)) return;
    seenContextSummary.add(summaryKey);
    push({
      method: "history/contextInjected",
      paramsText: context.summary,
      params: {
        source: context.source,
        file: context.file,
        rules: context.rules,
      },
      turnId: turnId || undefined,
      createdAt: createdAt + 1,
    });
  };

  const pushAssistantMessage = (
    turnId: string,
    text: string,
    createdAt: number,
    phase: "commentary" | "final_answer" | "" = ""
  ) => {
    const value = normalizeText(text);
    if (!value) return;
    const dedupeKey = `${turnId}:assistant:${value}`;
    if (seenMessage.has(dedupeKey)) return;
    seenMessage.add(dedupeKey);
    push({
      method: "item/agentMessage/delta",
      paramsText: value,
      params: {
        item: {
          type: "agentMessage",
          text: value,
          ...(phase ? { phase } : {}),
        },
        turnId,
        threadId,
      },
      turnId: turnId || undefined,
      createdAt,
    });
  };

  const ensureTurnStarted = (turnId: string, createdAt: number) => {
    const normalized = normalizeText(turnId);
    if (!normalized) return;
    if (startedTurn.has(normalized)) return;
    startedTurn.add(normalized);
    push({
      method: "turn/started",
      paramsText: JSON.stringify({ turn: { id: normalized } }),
      params: { threadId, turn: { id: normalized } },
      turnId: normalized,
      hidden: true,
      createdAt,
    });
  };

  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || !normalizeText((entry as any).type)) {
      throw new Error(translate("runtime.sessionsInvalidLogLine"));
    }
    const type = normalizeText(entry.type);
    const payload = entry.payload as any;
    const createdAt = toEpochMillis(entry.timestamp) ?? baseTs + seq;
    const contextualTurnId = normalizeText(payload?.turn_id ?? payload?.turnId ?? payload?.turn?.id);

    // 历史 sessions 中并不总是存在 turn/started 辅助通知；
    // 很多旧记录只有 turn_context / event_msg.task_started 携带 turn_id。
    // 若这里不提前接管 activeTurnId，后续 function_call 会全部落到 unknown turn，
    // 导致聊天时间线把跨回合命令混在一起，看起来像“重复渲染”。
    if (contextualTurnId) {
      activeTurnId = contextualTurnId;
      ensureTurnStarted(contextualTurnId, createdAt);
    }

    if (type === "turn_context") {
      continue;
    }

    if (type === "session_meta") {
      const sessionId = normalizeText(payload?.id) || threadId;
      push({
        method: "thread/started",
        paramsText: JSON.stringify({
          thread: { id: sessionId, cwd: payload?.cwd ?? "", modelProvider: payload?.model_provider ?? "unknown" },
        }),
        params: {
          thread: {
            id: sessionId,
            cwd: payload?.cwd ?? "",
            modelProvider: payload?.model_provider ?? "unknown",
          },
        },
        hidden: true,
        createdAt,
      });
      continue;
    }

    if (type === "aux_notification") {
      const method = normalizeText(payload?.method);
      const params = payload?.params ?? {};
      const turnId = normalizeText((params as any)?.turnId ?? (params as any)?.turn?.id) || activeTurnId;
      const replayId = normalizeText(payload?.id);
      if (method === "turn/started" && turnId) activeTurnId = turnId;
      if (turnId) ensureTurnStarted(turnId, createdAt);
      if (method) {
        pushWithId(replayId || stableReplayId(`aux:${method}`, createdAt, seq), {
          method,
          paramsText: normalizeText(payload?.paramsText) || JSON.stringify(params),
          params,
          turnId: turnId || undefined,
          createdAt,
        });
      }
      continue;
    }

    if (type === "event_msg" && normalizeText(payload?.type) === "user_message") {
      pushUserMessage(
        activeTurnId,
        {
          text: String(payload?.message ?? ""),
          text_elements: payload?.text_elements,
          images: payload?.images,
          local_images: payload?.local_images,
          content: payload?.content,
        },
        createdAt
      );
      continue;
    }

    if (type !== "response_item") continue;

    const payloadType = normalizeText(payload?.type);
    if (!payloadType) continue;

    if (payloadType === "message") {
      const role = normalizeText(payload?.role).toLowerCase();
      const text = extractTextFromContent(payload?.content) || normalizeText(payload?.text);
      const content: unknown[] | undefined = Array.isArray(payload?.content) ? payload.content : undefined;
      if (!text && !content) continue;
      if (role === "user") {
        const userText = content
          ?.map((item) => {
            if (!item || typeof item !== "object") return "";
            const part = item as Record<string, unknown>;
            return part.type === "text" || part.type === "input_text" ? String(part.text ?? "") : "";
          })
          .join("");
        pushUserMessage(activeTurnId, { text: userText || text, content }, createdAt);
        continue;
      }
      if (role === "assistant") {
        pushAssistantMessage(activeTurnId, text, createdAt, normalizeAgentMessagePhase(payload?.phase));
        continue;
      }
      if (role === "developer" || role === "system") {
        push({
          method: `history/${role}`,
          paramsText: text,
          params: { role, text },
          turnId: activeTurnId || undefined,
          hidden: true,
          createdAt,
        });
      }
      continue;
    }

    if (payloadType === "reasoning") {
      const texts = toReasoningTexts(payload?.summary);
      for (let i = 0; i < texts.length; i += 1) {
        push({
          method: "item/reasoning/summaryTextDelta",
          paramsText: texts[i],
          params: {
            threadId,
            turnId: activeTurnId,
            item: { type: "reasoning", summary: payload?.summary ?? [] },
            summaryIndex: i,
          },
          turnId: activeTurnId || undefined,
          createdAt: createdAt + i,
        });
      }
      continue;
    }

    if (payloadType === "plan") {
      const turnId = activeTurnId;
      const text = extractTextFromContent(payload?.content) || normalizeText(payload?.text);
      const itemId = normalizeText(payload?.id) || `plan-${turnId || "unknown"}-${seq}`;
      if (turnId && itemId && text) {
        pushWithId(`notif:item/plan/delta:${threadId}:${turnId}:${itemId}`, {
          method: "item/plan/delta",
          paramsText: text,
          params: { threadId, turnId, item: { id: itemId, type: "plan", text } },
          turnId: turnId || undefined,
          createdAt,
        });
      }
      continue;
    }

    if (payloadType === "web_search_call") {
      const turnId = activeTurnId;
      const normalized = normalizeHistoryWebSearchCall(payload);
      if (!normalized) continue;
      const itemId = `websearch-${turnId || "unknown"}-${createdAt}-${seq}`;
      const normalizedItem = {
        id: itemId,
        type: "webSearch",
        query: normalized.query,
        action: normalized.action,
      };
      pushWithId(`notif:${normalized.method}:webSearch:${threadId}:${turnId || "unknown"}:${itemId}`, {
        method: normalized.method,
        paramsText: JSON.stringify({ item: normalizedItem, turnId }),
        params: { threadId, turnId, item: normalizedItem },
        turnId: turnId || undefined,
        createdAt,
      });
      continue;
    }

    if (payloadType === "function_call") {
      const callId = normalizeText(payload?.call_id);
      if (!callId) continue;
      const turnId = activeTurnId;
      const name = normalizeText(payload?.name) || "shell_command";
      const mcp = parseMcpName(name);
      const argsRaw = normalizeText(payload?.arguments);
      const argsParsed = argsRaw ? (tryParseJson(argsRaw) ?? argsRaw) : "";

      if (mcp.ok) {
        pendingCalls.set(callId, {
          kind: "mcp",
          name,
          command: name,
          server: mcp.server,
          tool: mcp.tool,
          turnId,
          createdAt,
          arguments: argsParsed,
        });
        const normalizedItem = {
          id: callId,
          type: "mcpToolCall",
          status: "running",
          server: mcp.server,
          tool: mcp.tool,
          arguments: argsParsed,
        };
        push({
          method: "item/started",
          paramsText: JSON.stringify({ item: normalizedItem, turnId }),
          params: { threadId, turnId, item: normalizedItem },
          turnId: turnId || undefined,
          createdAt,
        });
      } else {
        // 历史聊天时间线只将真实的 shell 命令回放为 commandExecution。
        // 像 read_text_file / update_plan / apply_patch 这类本地工具调用，
        // 运行期本就不会以“命令卡片”展示；若在回放阶段强行伪装成命令，
        // 会把大量工具调用挤进命令时间线，并触发错误的弱去重/状态合并。
        const isShellCommand = name === "shell_command";
        const command = isShellCommand ? parseCommandFromArguments(payload?.arguments) : "";
        pendingCalls.set(callId, {
          kind: isShellCommand ? "shell" : "other",
          name,
          command,
          server: "unknown",
          tool: "",
          turnId,
          createdAt,
          arguments: argsParsed,
        });
        if (!isShellCommand) continue;
        const normalizedItem = {
          id: callId,
          type: "commandExecution",
          status: "inProgress",
          command,
          commandActions: [{ command }],
          aggregatedOutput: "",
        };
        pushWithId(toCommandLifecycleReplayEventId("item/started", threadId, turnId, callId), {
          method: "item/started",
          paramsText: JSON.stringify({ item: normalizedItem, turnId }),
          params: { threadId, turnId, item: normalizedItem },
          turnId: turnId || undefined,
          createdAt,
        });
      }
      continue;
    }

    if (payloadType === "function_call_output") {
      const callId = normalizeText(payload?.call_id);
      if (!callId) continue;
      const pending = pendingCalls.get(callId);
      const turnId = normalizeText(pending?.turnId) || activeTurnId;
      const outputValue = payload?.output;

      if (pending?.kind === "mcp") {
        const normalizedOutputValue =
          typeof outputValue === "string" ? (tryParseJson(outputValue) ?? outputValue) : outputValue;
        const normalizedItem = {
          id: callId,
          type: "mcpToolCall",
          status: "completed",
          server: pending.server || "unknown",
          tool: pending.tool || "mcpToolCall",
          arguments: pending.arguments ?? "",
          result: normalizedOutputValue,
        };
        push({
          method: "item/completed",
          paramsText: JSON.stringify({ item: normalizedItem, turnId }),
          params: { threadId, turnId, item: normalizedItem },
          turnId: turnId || undefined,
          createdAt,
        });
      } else if (pending?.kind === "shell") {
        const command = pending?.command ?? "shell_command";
        const normalizedItem = {
          id: callId,
          type: "commandExecution",
          status: "completed",
          command,
          commandActions: [{ command }],
          aggregatedOutput: typeof outputValue === "string" ? outputValue : extractTextFromMcpOutput(outputValue),
        };
        pushWithId(toCommandLifecycleReplayEventId("item/completed", threadId, turnId, callId), {
          method: "item/completed",
          paramsText: JSON.stringify({ item: normalizedItem, turnId }),
          params: { threadId, turnId, item: normalizedItem },
          turnId: turnId || undefined,
          createdAt,
        });
      }
      continue;
    }
  }

  if (events.length === 0) {
    throw new Error(translate("runtime.sessionsNoReplayEvents"));
  }
  return sortReplayEvents(events);
}
