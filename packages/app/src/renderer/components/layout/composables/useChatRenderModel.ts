import { computed, ref, watch } from "vue";
import type { TimelineEventItem } from "../../../domain/types";
import {
  buildTimelineRenderNodes,
  type TimelineRenderNode,
  type ReasoningBlockNode,
} from "../../../features/timeline/renderModel/buildTimelineNodes";
import { getDiffLineStats } from "../../../features/timeline/renderModel/diff";
import { isLocalUserEvent, isMarkdownEvent } from "../../../features/timeline/renderModel/formatters";
import { useRuntimeStore } from "../../../stores/runtime.store";
import { useThreadStore } from "../../../stores/thread.store";
import { extractWebSearchTimelineItem } from "../../../features/timeline/webSearch";
import { buildImageToolItemFromProtocolItem } from "../../../features/timeline/imageToolRender";
import { buildDynamicToolTimelineItemFromProtocolItem } from "../../../domain/dynamicTools";
import { IMAGE_GENERATION_DYNAMIC_TOOL_NAME } from "@codenexus/shared/dynamicTools";
import {
  buildGuardianApprovalReviewActivity,
  isGuardianApprovalReviewMethod,
} from "../../../features/guardian/guardianApprovalReview";
import { i18n } from "../../../i18n";
import { translate } from "../../../i18n/translate";
import { canReuseAuxGroup, type AuxGroupCacheEntry } from "./auxGroupCache";
import { createTurnRowsCacheState, syncTurnRows } from "./turnRowsCache";
import { createLruCache } from "../../../shared/lruCache";
import type {
  ChatAuxActivityGroupRow,
  ChatAuxActivitySummaryItem,
  ChatAuxActivityStatus,
  ChatAuxiliaryRow,
  ChatRow,
  ChatRenderedRow,
  ChatWebSearchItem,
} from "../types/chat.types";

const STREAM_NOTIFICATION_ACTIVITY_METHODS = new Set([
  "command/exec/outputDelta",
  "item/commandExecution/terminalInteraction",
]);
const DIRECT_STREAMING_MODEL_METHODS = new Set([
  "item/plan/delta",
  "item/agentMessage/delta",
  "item/commandExecution/outputDelta",
]);
const paramsObjectSignatureIds = new WeakMap<object, number>();
let nextParamsObjectSignatureId = 1;

function shortenActivityText(value: unknown, max = 220): string {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function toEventParamsObject(event: TimelineEventItem): Record<string, any> {
  return event.params && typeof event.params === "object" && !Array.isArray(event.params)
    ? (event.params as Record<string, any>)
    : {};
}

// Codex treats visible assistant text without a phase as a final answer.
// Only explicitly labelled commentary belongs to the intermediate process.
function isAnswerAgentMessageEvent(event: TimelineEventItem): boolean {
  if (event.method !== "item/agentMessage/delta") return false;
  const params = toEventParamsObject(event);
  const item = params.item && typeof params.item === "object" ? (params.item as Record<string, any>) : null;
  const phase = String(item?.phase ?? "").trim();
  return phase === "final_answer" || phase === "";
}

function isIntermediateAgentMessageEvent(event: TimelineEventItem): boolean {
  if (event.method !== "item/agentMessage/delta") return false;
  const params = toEventParamsObject(event);
  const item = params.item && typeof params.item === "object" ? (params.item as Record<string, any>) : null;
  const phase = String(item?.phase ?? "").trim();
  return phase === "commentary";
}

function paramsObjectSignature(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  let id = paramsObjectSignatureIds.get(value);
  if (id == null) {
    id = nextParamsObjectSignatureId;
    nextParamsObjectSignatureId += 1;
    paramsObjectSignatureIds.set(value, id);
  }
  return String(id);
}

function decodeBase64Utf8(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    if (typeof atob === "function") {
      const binary = atob(raw);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
  } catch {}
  try {
    const bufferCtor = (globalThis as any).Buffer;
    if (bufferCtor?.from) return bufferCtor.from(raw, "base64").toString("utf8");
  } catch {}
  return raw;
}

function streamNotificationActivityText(event: TimelineEventItem): string {
  const params = toEventParamsObject(event);
  if (event.method === "command/exec/outputDelta") {
    const stream = String(params.stream ?? "").trim();
    const text = decodeBase64Utf8(params.deltaBase64);
    const suffix = params.capReached === true ? translate("timelineFormat.truncatedSuffix") : "";
    return translate("timeline.commandOutput", {
      stream: stream ? ` ${stream}` : "",
      text: shortenActivityText(text || event.paramsText || translate("timeline.outputReceived")),
      suffix,
    });
  }
  if (event.method === "item/commandExecution/terminalInteraction") {
    const stdin = String(params.stdin ?? event.paramsText ?? "").trim();
    return translate("timeline.terminalInput", {
      text: shortenActivityText(stdin || translate("timeline.emptyInput")),
    });
  }
  return "";
}

function uniqueNonEmptyStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function extractUrlHost(value: string): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    return new URL(text).host;
  } catch {}
  try {
    return new URL(`https://${text}`).host;
  } catch {}
  return "";
}

function isLocalDynamicImageGenerationEvent(event: TimelineEventItem): boolean {
  return String(event.id ?? "").startsWith("local:imageGeneration:");
}

function getLocalDynamicImageGenerationCallId(event: TimelineEventItem): string {
  if (!isLocalDynamicImageGenerationEvent(event)) return "";
  const item = ((event.params ?? {}) as any).item;
  if (!item || typeof item !== "object" || Array.isArray(item)) return "";
  return String(item.id ?? "").trim();
}

const AUX_ACTIVITY_KIND_ORDER = ["reasoning", "search", "command", "mcp", "tool", "activity"] as const;
const AUX_ACTIVITY_KIND_LABELS: Record<(typeof AUX_ACTIVITY_KIND_ORDER)[number], string> = {
  reasoning: "timeline.auxReasoning",
  search: "timeline.auxSearch",
  command: "timeline.auxCommand",
  mcp: "MCP",
  tool: "timeline.auxTool",
  activity: "timeline.auxActivity",
};

type AuxFileChangeStats = {
  fileCount: number;
  addedLines: number;
  deletedLines: number;
};

function isAuxiliaryRow(row: ChatRow): row is ChatAuxiliaryRow {
  return (
    row.kind === "activity" ||
    row.kind === "assistantCommentary" ||
    row.kind === "imageTool" ||
    row.kind === "dynamicTool" ||
    row.kind === "webSearch" ||
    row.kind === "reasoningBlock" ||
    row.kind === "fileChange" ||
    row.kind === "commandAction" ||
    row.kind === "commandSession" ||
    row.kind === "commandRead" ||
    row.kind === "commandList" ||
    row.kind === "commandSearch" ||
    row.kind === "mcpResourceRead" ||
    row.kind === "mcpToolGroup"
  );
}

function auxActivityKind(row: ChatAuxiliaryRow): (typeof AUX_ACTIVITY_KIND_ORDER)[number] {
  if (row.kind === "reasoningBlock") return "reasoning";
  if (row.kind === "webSearch") return "search";
  if (
    row.kind === "commandAction" ||
    row.kind === "commandSession" ||
    row.kind === "commandRead" ||
    row.kind === "commandList" ||
    row.kind === "commandSearch"
  ) {
    return "command";
  }
  if (row.kind === "mcpResourceRead" || row.kind === "mcpToolGroup") return "mcp";
  if (row.kind === "imageTool" || row.kind === "dynamicTool") return "tool";
  return "activity";
}

function rowIsRunning(row: ChatAuxiliaryRow): boolean {
  if (row.kind === "activity") {
    return row.tone === "running";
  }
  if (row.kind === "webSearch") return row.item.status === "running";
  if (row.kind === "imageTool") {
    return row.item.status === "running";
  }
  if (row.kind === "dynamicTool") {
    return row.item.status === "running" || row.item.status === "awaitingApproval";
  }
  if (row.kind === "fileChange") {
    return row.item.status === "running";
  }
  if (row.kind === "mcpToolGroup") {
    return row.group.stats.running > 0;
  }
  if (row.kind === "mcpResourceRead") {
    return row.item.status === "running";
  }
  if (row.kind === "commandAction") {
    const status = row.item.item.status;
    return status === "running";
  }
  if (row.kind === "commandSession") {
    return row.item.status === "running";
  }
  if (row.kind === "commandRead" || row.kind === "commandList" || row.kind === "commandSearch") {
    const status = row.item.status;
    return status === "running";
  }
  return false;
}

function mergeAuxActivityStatus(items: ChatAuxiliaryRow[]): ChatAuxActivityStatus {
  if (items.some((item) => rowIsRunning(item))) return "running";
  return "completed";
}

function buildAuxFileChangeStats(items: ChatAuxiliaryRow[]): AuxFileChangeStats | null {
  const files = new Set<string>();
  let addedLines = 0;
  let deletedLines = 0;
  for (const row of items) {
    if (row.kind !== "fileChange") continue;
    for (const file of row.item.files) {
      const key = String(file.pathRelTo ?? file.pathAbsTo ?? file.pathRel ?? file.pathAbs ?? "").trim();
      if (key) files.add(key);
      const stats = getDiffLineStats(file.diffText, file.kind);
      addedLines += stats.add;
      deletedLines += stats.del;
    }
  }
  if (files.size <= 0 && addedLines <= 0 && deletedLines <= 0) return null;
  return { fileCount: files.size, addedLines, deletedLines };
}

function buildAuxActivityGroup(params: {
  items: ChatAuxiliaryRow[];
  groupIndex: number;
  defaultCollapsed: boolean;
  startedAtMs: number | null;
  answerStartedAtMs: number | null;
  elapsedLive: boolean;
}): ChatAuxActivityGroupRow {
  const counts = new Map<string, number>();
  for (const item of params.items) {
    if (item.kind === "fileChange") continue;
    const kind = auxActivityKind(item);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const fileChangeStats = buildAuxFileChangeStats(params.items);
  const summaryItems: ChatAuxActivitySummaryItem[] = AUX_ACTIVITY_KIND_ORDER.flatMap((key) => {
    const count = counts.get(key) ?? 0;
    const label = AUX_ACTIVITY_KIND_LABELS[key] === "MCP" ? "MCP" : translate(AUX_ACTIVITY_KIND_LABELS[key]);
    return count > 0 ? [{ key, label, count }] : [];
  });
  if (fileChangeStats) {
    summaryItems.push({
      key: "files",
      label: translate("timeline.auxFiles"),
      count: fileChangeStats.fileCount,
      valueText: String(fileChangeStats.fileCount),
      addText: `+${fileChangeStats.addedLines}`,
      delText: `-${fileChangeStats.deletedLines}`,
    });
  }
  const summaryText = summaryItems
    .map((item) => [item.label, item.valueText ?? item.count, item.addText, item.delText].filter(Boolean).join(" "))
    .join(" · ");
  const first = params.items[0];
  const status = mergeAuxActivityStatus(params.items);
  return {
    id: `aux:${params.groupIndex}:${first?.id ?? "empty"}`,
    turnKey: first?.turnKey ?? "",
    kind: "auxActivityGroup",
    items: [...params.items],
    summaryItems,
    summaryText: summaryText || translate("timeline.activityCount", { count: params.items.length }),
    status,
    defaultCollapsed: params.defaultCollapsed,
    startedAtMs: params.startedAtMs,
    answerStartedAtMs: params.answerStartedAtMs,
    elapsedLive: params.elapsedLive,
  };
}

function chatAuxRowCreatedAt(row: ChatAuxiliaryRow): number | null {
  if (row.kind === "activity" || row.kind === "imageTool" || row.kind === "dynamicTool" || row.kind === "webSearch") {
    return Number.isFinite(row.createdAt) ? Number(row.createdAt) : null;
  }
  if (row.kind === "assistantCommentary") {
    return Number.isFinite(row.event.createdAt) ? Number(row.event.createdAt) : null;
  }
  if (row.kind === "mcpToolGroup") return Number.isFinite(row.group.createdAt) ? Number(row.group.createdAt) : null;
  const item = row.item as { createdAt?: unknown; startedAt?: unknown };
  const startedAt = Number(item.startedAt);
  if (Number.isFinite(startedAt) && startedAt > 0) return Math.round(startedAt);
  const createdAt = Number(item.createdAt);
  return Number.isFinite(createdAt) && createdAt > 0 ? Math.round(createdAt) : null;
}

export function useChatRenderModel(
  contentEvents: () => TimelineEventItem[],
  contentRevision: () => number,
  workspaceRoot: () => string,
  mcpToolDefinitions: () => any,
  onLayoutChange?: () => void
) {
  const runtimeStore = useRuntimeStore();
  const threadStore = useThreadStore();
  // turn 级行缓存：只有受影响的 turn 会重建节点，流式文本变化只替换行里的事件引用。
  const turnRowsCaches = createLruCache<string, ReturnType<typeof createTurnRowsCacheState>>(
    4,
    12_000,
    (cache) => cache.snapshot.length
  );
  // aux 活动组缓存：组成员与展示标记不变时复用上一帧的组对象。
  const auxGroupCaches = createLruCache<string, Array<AuxGroupCacheEntry | undefined>>(4, 12_000, (entries) =>
    entries.reduce((sum, entry) => sum + (entry?.row.items.length ?? 0), 0)
  );
  // 事件对象在内容变化时会被整体替换，因此对象身份可用作签名缓存键。
  const eventSignatureCache = new WeakMap<TimelineEventItem, string>();

  const toWebSearchChatItem = (event: TimelineEventItem): ChatWebSearchItem | null => {
    const normalized = extractWebSearchTimelineItem(event);
    if (!normalized) return null;
    const actionType = normalized.action.type;
    let title = translate("timeline.webSearch");
    let actionLabel = translate("timeline.webOther");
    let primaryText = normalized.query || translate("timeline.webAction");
    let secondaryText = "";
    let summaryText = normalized.query || translate("timeline.webAction");
    let queries: string[] = [];
    let url = "";
    let pattern = "";
    let host = "";
    if (actionType === "search") {
      actionLabel = translate("timeline.webSearchAction");
      queries = uniqueNonEmptyStrings([normalized.action.query, ...(normalized.action.queries || [])]);
      primaryText = queries[0] || normalized.query || translate("timeline.searchWeb");
      secondaryText = queries.length > 1 ? translate("timeline.queryCount", { count: queries.length }) : "";
      summaryText = queries.join(translate("timelineFormat.separator")) || primaryText;
    } else if (actionType === "openPage") {
      title = translate("timeline.openPage");
      actionLabel = translate("timeline.openAction");
      url = normalized.action.url || normalized.query || "";
      host = extractUrlHost(url);
      primaryText = host || url || translate("timeline.openSearchResultPage");
      secondaryText = host && url ? url : "";
      summaryText = url || primaryText;
    } else if (actionType === "findInPage") {
      title = translate("timeline.findInPage");
      actionLabel = translate("timeline.findAction");
      url = normalized.action.url || "";
      pattern = normalized.action.pattern || "";
      host = extractUrlHost(url);
      primaryText = pattern || translate("timeline.findInPage");
      secondaryText = url
        ? `${host || translate("timeline.page")}${pattern ? `${translate("timelineFormat.separator")}${url}` : ""}`
        : "";
      summaryText = pattern
        ? url
          ? translate("timeline.keywordAndPage", { pattern, url })
          : translate("timeline.keywordOnly", { pattern })
        : url || normalized.query || translate("timeline.findInPage");
    }
    return {
      itemId: normalized.itemId,
      actionType,
      status: normalized.status,
      title,
      summaryText,
      actionLabel,
      primaryText,
      secondaryText,
      queries,
      url,
      pattern,
      host,
    };
  };

  const buildChatRowsFromNodes = (nodes: TimelineRenderNode[], threadKeyFallback: string) => {
    const rows: ChatRow[] = [];
    const rowIndexById = new Map<string, number>();
    const localImageGenerationCallIds = new Set(
      nodes
        .map((node) => (node.kind === "event" ? getLocalDynamicImageGenerationCallId(node.event) : ""))
        .filter(Boolean)
    );
    const pushRow = (row: ChatRow) => {
      rowIndexById.set(row.id, rows.length);
      rows.push(row);
    };
    const upsertRow = (row: ChatRow) => {
      const index = rowIndexById.get(row.id);
      if (index != null) {
        rows[index] = { ...row, turnKey: rows[index].turnKey || row.turnKey };
        return;
      }
      pushRow(row);
    };

    const toChatTurnKey = (turnIdValue: unknown, fallbackValue: unknown, threadKey: string) => {
      const turnId = String(turnIdValue ?? "").trim();
      return turnId ? `turn:${turnId}` : `loose:${String(fallbackValue ?? "").trim() || threadKey || "__app__"}`;
    };

    for (const node of nodes) {
      const turnKey =
        node.kind === "event"
          ? toChatTurnKey(node.event.turnId, String(node.event.id ?? "").trim() || node.id, threadKeyFallback)
          : node.kind === "mcpToolGroup"
            ? toChatTurnKey(node.group.turnId, node.id, threadKeyFallback)
            : toChatTurnKey(node.item.turnId, node.id, threadKeyFallback);

      if (node.kind === "event") {
        const e = node.event;
        if (isLocalUserEvent(e)) {
          pushRow({ id: `u:${e.id}`, turnKey, kind: "user", event: e });
          continue;
        }
        if (e.method === "history/contextInjected") {
          const p = (e.params ?? {}) as any;
          const f = (
            typeof p.file === "string" ? p.file : (String(e.paramsText ?? "").match(/\bfile=([^\s]+)\b/)?.[1] ?? "")
          ).trim();
          const r = typeof p.rules === "number" ? p.rules : null;
          pushRow({
            id: `x:${e.id}`,
            turnKey,
            kind: "activity",
            text: f
              ? translate("timeline.contextFileRead", {
                  file: f,
                  rules: r && r > 0 ? translate("timeline.contextRulesSuffix", { count: r }) : "",
                })
              : String(e.paramsText ?? "").trim() || translate("timeline.contextInjectedDone"),
            createdAt: e.createdAt,
          });
          continue;
        }
        if (isGuardianApprovalReviewMethod(e.method)) {
          const g = buildGuardianApprovalReviewActivity(e.method, e.params);
          if (g) {
            pushRow({
              id: `guardian:${e.id}`,
              turnKey,
              kind: "activity",
              text: g.summaryText || String(e.paramsText ?? "").trim() || translate("timeline.guardianReview"),
              createdAt: e.createdAt,
              tone: g.tone,
            });
            continue;
          }
        }
        if (STREAM_NOTIFICATION_ACTIVITY_METHODS.has(e.method)) {
          const text = streamNotificationActivityText(e);
          if (text) {
            pushRow({ id: `stream:${e.id}`, turnKey, kind: "activity", text, createdAt: e.createdAt });
            continue;
          }
        }
        if (e.method === "item/agentMessage/delta" && isMarkdownEvent(e) && isIntermediateAgentMessageEvent(e)) {
          const text = String(e.paramsText ?? "").trim();
          if (text) {
            pushRow({ id: `agent-commentary:${e.id}`, turnKey, kind: "assistantCommentary", event: e });
          }
          continue;
        }
        if (
          (e.method === "item/agentMessage/delta" && isMarkdownEvent(e) && isAnswerAgentMessageEvent(e)) ||
          e.method === "item/plan/delta"
        ) {
          pushRow({ id: `a:${e.id}`, turnKey, kind: "assistant", event: e });
          continue;
        }
        if (e.method === "item/started" || e.method === "item/completed") {
          const item = ((e.params ?? {}) as any).item;
          const type = item && typeof item === "object" ? String(item.type ?? "").trim() : "";
          if (type === "dynamicToolCall") {
            const dynamicToolItem = buildDynamicToolTimelineItemFromProtocolItem(item);
            if (dynamicToolItem) {
              if (
                dynamicToolItem.toolName === IMAGE_GENERATION_DYNAMIC_TOOL_NAME &&
                localImageGenerationCallIds.has(dynamicToolItem.callId)
              ) {
                continue;
              }
              upsertRow({
                id: `dyntool:${dynamicToolItem.callId}`,
                turnKey,
                kind: "dynamicTool",
                createdAt: e.createdAt,
                item: dynamicToolItem,
              });
            }
            continue;
          }
          if (type === "imageView" || (type === "imageGeneration" && isLocalDynamicImageGenerationEvent(e))) {
            const imageToolItem = buildImageToolItemFromProtocolItem(item, e.method);
            if (imageToolItem) {
              upsertRow({
                id: `imgtool:${imageToolItem.itemType}:${imageToolItem.itemId}`,
                turnKey,
                kind: "imageTool",
                createdAt: e.createdAt,
                item: imageToolItem,
              });
            }
            continue;
          }
          if (type === "webSearch") {
            const wsi = toWebSearchChatItem(e);
            if (wsi)
              upsertRow({
                id: `websearch:${wsi.itemId}`,
                turnKey,
                kind: "webSearch",
                createdAt: e.createdAt,
                item: wsi,
              });
            continue;
          }
        }
        if (e.method === "rawResponseItem/completed") {
          const item = ((e.params ?? {}) as any).item;
          const imageToolItem = buildImageToolItemFromProtocolItem(item, e.method);
          if (imageToolItem) {
            upsertRow({
              id: `imgtool:${imageToolItem.itemType}:${imageToolItem.itemId}`,
              turnKey,
              kind: "imageTool",
              createdAt: e.createdAt,
              item: imageToolItem,
            });
            continue;
          }
        }
        if (e.level === "error")
          pushRow({ id: `s:${e.id}`, turnKey, kind: "system", text: String(e.paramsText ?? "").trim() || e.method });
        continue;
      }
      if (node.kind === "reasoningBlock") {
        pushRow({ id: `r:${node.id}`, turnKey, kind: "reasoningBlock", item: node.item });
        continue;
      }
      if (node.kind === "fileChange") {
        pushRow({ id: `f:${node.id}`, turnKey, kind: "fileChange", item: node.item });
        continue;
      }
      if (node.kind === "commandAction") {
        pushRow({ id: `c:${node.id}`, turnKey, kind: "commandAction", item: node.item });
        continue;
      }
      if (node.kind === "commandSession") {
        pushRow({ id: `csess:${node.id}`, turnKey, kind: "commandSession", item: node.item });
        continue;
      }
      if (node.kind === "commandRead") {
        pushRow({ id: `cr:${node.id}`, turnKey, kind: "commandRead", item: node.item });
        continue;
      }
      if (node.kind === "commandList") {
        pushRow({ id: `cl:${node.id}`, turnKey, kind: "commandList", item: node.item });
        continue;
      }
      if (node.kind === "commandSearch") {
        pushRow({ id: `cs:${node.id}`, turnKey, kind: "commandSearch", item: node.item });
        continue;
      }
      if (node.kind === "mcpResourceRead") {
        pushRow({ id: `mr:${node.id}`, turnKey, kind: "mcpResourceRead", item: node.item });
        continue;
      }
      if (node.kind === "mcpToolGroup")
        pushRow({ id: `m:${node.id}`, turnKey, kind: "mcpToolGroup", group: node.group });
    }
    return rows;
  };

  const isDirectStreamingMessageEvent = (event: TimelineEventItem): boolean => {
    return DIRECT_STREAMING_MODEL_METHODS.has(event.method);
  };

  const computeEventStructureSignature = (event: TimelineEventItem) => {
    const params = toEventParamsObject(event);
    const item = params.item && typeof params.item === "object" ? (params.item as Record<string, any>) : null;
    const base = [
      event.id,
      event.method,
      event.turnId ?? "",
      event.level ?? "",
      event.localKind ?? "",
      event.localState ?? "",
      event.thinkingPhase ?? "",
      event.hidden ? "1" : "0",
      item ? String(item.type ?? "") : "",
      item ? String(item.id ?? "") : "",
      item ? String(item.phase ?? "") : "",
      item ? String(item.status ?? "") : "",
    ];
    if (!isDirectStreamingMessageEvent(event)) {
      base.push(String(event.paramsText?.length ?? 0));
      base.push(paramsObjectSignature(event.params));
    }
    return base.join(":");
  };

  const eventStructureSignature = (event: TimelineEventItem) => {
    const cached = eventSignatureCache.get(event);
    if (cached != null) return cached;
    const signature = computeEventStructureSignature(event);
    eventSignatureCache.set(event, signature);
    return signature;
  };

  // 工具定义索引由 computed 生成，未变化时对象身份稳定，可按 Map 身份缓存签名。
  const definitionsSignatureCache = new WeakMap<object, string>();
  const definitionsStructureSignature = (definitions: any) => {
    if (!(definitions instanceof Map)) return String(definitions ? "custom" : "");
    const cached = definitionsSignatureCache.get(definitions);
    if (cached != null) return cached;
    const signature = [...definitions.keys()].sort().join("|");
    definitionsSignatureCache.set(definitions, signature);
    return signature;
  };

  const eventTurnGroupKey = (event: TimelineEventItem, threadKey: string): string => {
    const turnId = String(event.turnId ?? "").trim();
    if (turnId) return `turn:${turnId}`;
    const id = String(event.id ?? "").trim();
    return `loose:${id || threadKey || "__app__"}`;
  };

  const buildRowsByTurnCache = (events: TimelineEventItem[], threadKey: string, definitions: any): ChatRow[] => {
    // 线程 / 工作区 / 工具定义变化时整体失效，签名里已包含上下文信息。
    const contextKey = [
      threadKey,
      workspaceRoot(),
      String(runtimeStore.timelineKey ?? ""),
      definitionsStructureSignature(definitions),
    ].join("\u0000");

    const turnRowsCache = turnRowsCaches.get(contextKey) ?? createTurnRowsCacheState();
    const rows = syncTurnRows(turnRowsCache, {
      events,
      contextKey,
      computeTurnKey: (event) => eventTurnGroupKey(event, threadKey),
      computeSignature: (turnKey, turnEvents) =>
        `${contextKey}\u0000${turnKey}\u0000${turnEvents.map(eventStructureSignature).join("\n")}`,
      buildTurnRows: (_turnKey, turnEvents) => {
        const nodes = buildTimelineRenderNodes({
          events: turnEvents,
          timelineKey: runtimeStore.timelineKey,
          workspaceRoot: workspaceRoot(),
          debug: false,
          mcpToolDefinitions: definitions,
        });
        return buildChatRowsFromNodes(nodes, threadKey);
      },
    });
    turnRowsCaches.set(contextKey, turnRowsCache);
    return rows;
  };

  const baseChatRows = computed<ChatRow[]>(() => {
    void contentRevision();
    const threadKey = String(runtimeStore.timelineKey ?? "__app__").trim() || "__app__";
    const events = contentEvents();
    const definitions = mcpToolDefinitions();
    return buildRowsByTurnCache(events, threadKey, definitions);
  });

  const rowsWithTokenUsageSummaries = computed<ChatRow[]>(() => {
    const threadId = String(runtimeStore.timelineKey ?? runtimeStore.currentThreadId ?? "").trim();
    if (!threadId || threadId === "__app__") return baseChatRows.value;
    const completedByTurnId = new Map(
      (threadStore.completedTurnsByThread.get(threadId) ?? []).map((entry) => [entry.turnId, entry])
    );
    if (completedByTurnId.size === 0) return baseChatRows.value;

    const appendedTurnIds = new Set<string>();
    const rows: ChatRow[] = [];
    for (let index = 0; index < baseChatRows.value.length; index += 1) {
      const row = baseChatRows.value[index];
      rows.push(row);
      if (!row.turnKey.startsWith("turn:")) continue;
      if (baseChatRows.value[index + 1]?.turnKey === row.turnKey) continue;
      const turnId = row.turnKey.slice("turn:".length).trim();
      if (!turnId || appendedTurnIds.has(turnId)) continue;
      const completed = completedByTurnId.get(turnId);
      const usage = threadStore.tokenUsageForTurn(threadId, turnId);
      if (!completed || !usage) continue;
      appendedTurnIds.add(turnId);
      rows.push({
        id: `usage:${threadId}:${turnId}`,
        turnKey: row.turnKey,
        kind: "tokenUsageSummary",
        item: {
          threadId,
          turnId,
          completedAt: Number.isFinite(completed.completedAt) ? Number(completed.completedAt) : null,
          usage,
        },
      });
    }
    return rows;
  });

  const chatRows = computed<ChatRow[]>(() => {
    const rows = rowsWithTokenUsageSummaries.value;
    const contextKey = `${runtimeStore.timelineKey}\u0000${workspaceRoot()}`;
    const auxGroupCache = auxGroupCaches.get(contextKey) ?? [];
    const grouped: ChatRow[] = [];
    let pending: ChatAuxiliaryRow[] = [];
    let groupIndex = 0;
    let auxGroupCursor = 0;
    // 读取 locale 既注册响应式依赖，也作为组缓存的有效性标记。
    const locale = String(i18n.global.locale.value ?? "");
    const activeTurnKey = (() => {
      const tid = String(runtimeStore.currentThreadId ?? "").trim();
      const activeTurnId = tid ? String(threadStore.activeTurnIdByThread.get(tid) ?? "").trim() : "";
      return activeTurnId ? `turn:${activeTurnId}` : "";
    })();
    const currentThreadRunning = (() => {
      const tid = String(runtimeStore.currentThreadId ?? "").trim();
      return Boolean(tid && threadStore.runningThreadIds.has(tid));
    })();

    const resolvePendingStartedAt = () => {
      const threadId = String(runtimeStore.timelineKey ?? runtimeStore.currentThreadId ?? "").trim();
      const turnId = String(pending[0]?.turnKey ?? "").startsWith("turn:")
        ? String(pending[0].turnKey).slice("turn:".length).trim()
        : "";
      const storedStartedAt = threadId && turnId ? threadStore.turnStartedAtByThread.get(threadId)?.get(turnId) : null;
      if (Number.isFinite(storedStartedAt) && Number(storedStartedAt) > 0) return Math.round(Number(storedStartedAt));
      const rowTimes = pending
        .map(chatAuxRowCreatedAt)
        .filter((value): value is number => Number.isFinite(value) && Number(value) > 0);
      return rowTimes.length > 0 ? Math.min(...rowTimes) : null;
    };

    const isFinalAnswerRow = (row: ChatRow | null): boolean => {
      return row?.kind === "assistant" && row.event.method === "item/agentMessage/delta";
    };

    const flushPending = (interruptedBy: ChatRow | null) => {
      if (pending.length === 0) return;
      const groupStatus = mergeAuxActivityStatus(pending);
      const matchesActiveTurn = Boolean(activeTurnKey && pending.some((row) => row.turnKey === activeTurnKey));
      const finalAnswerStarted = isFinalAnswerRow(interruptedBy);
      const shouldStayOpen =
        !finalAnswerStarted && (groupStatus === "running" || (currentThreadRunning && matchesActiveTurn));
      const startedAtMs = resolvePendingStartedAt();
      const finalAnswerEvent = finalAnswerStarted && interruptedBy?.kind === "assistant" ? interruptedBy.event : null;
      const answerStartedAtMs =
        finalAnswerEvent && Number.isFinite(finalAnswerEvent.createdAt)
          ? Math.max(startedAtMs ?? 0, Math.round(Number(finalAnswerEvent.createdAt)))
          : null;
      const elapsedLive =
        !finalAnswerStarted && (groupStatus === "running" || (currentThreadRunning && matchesActiveTurn));
      const flags = {
        groupIndex,
        locale,
        defaultCollapsed: !shouldStayOpen,
        startedAtMs,
        answerStartedAtMs,
        elapsedLive,
      };
      const cachedGroup = auxGroupCache[auxGroupCursor];
      let groupRow: ChatAuxActivityGroupRow;
      if (cachedGroup && canReuseAuxGroup(cachedGroup, flags, pending)) {
        groupRow = cachedGroup.row;
      } else {
        groupRow = buildAuxActivityGroup({ items: pending, ...flags });
        auxGroupCache[auxGroupCursor] = { row: groupRow, ...flags };
      }
      grouped.push(groupRow);
      auxGroupCursor += 1;
      groupIndex += 1;
      pending = [];
    };

    for (const row of rows) {
      if (isAuxiliaryRow(row)) {
        pending.push(row);
        continue;
      }
      flushPending(row);
      grouped.push(row);
    }
    flushPending(null);
    // 组数量可能变少，截断多余的缓存条目。
    auxGroupCache.length = auxGroupCursor;
    auxGroupCaches.set(contextKey, auxGroupCache);
    return grouped;
  });

  const chatRenderedRows = computed<ChatRenderedRow[]>(() => chatRows.value);

  const reasoningOpenById = ref(new Map<string, boolean>());
  const autoCollapsedReasoningIds = ref(new Set<string>());
  const isReasoningOpen = (b: ReasoningBlockNode) => {
    const id = String(b?.id ?? "").trim();
    if (!id) return false;
    const f = reasoningOpenById.value.get(id);
    return typeof f === "boolean" ? f : Boolean(b.openDefault);
  };
  const setReasoningOpen = (b: ReasoningBlockNode, open: boolean) => {
    const id = String(b?.id ?? "").trim();
    if (!id) return;
    reasoningOpenById.value.set(id, open);
    onLayoutChange?.();
  };

  const reasoningAutoCollapseCandidateIds = computed<string[]>(() => {
    const seen = new Set<string>(),
      candidates = new Set<string>();
    for (let idx = baseChatRows.value.length - 1; idx >= 0; idx -= 1) {
      const r = baseChatRows.value[idx];
      if (!r.turnKey) continue;
      if (r.kind === "reasoningBlock") {
        if (seen.has(r.turnKey)) {
          const id = String(r.item.id ?? "").trim();
          if (id) candidates.add(id);
        }
      } else seen.add(r.turnKey);
    }
    return [...candidates];
  });

  watch(
    reasoningAutoCollapseCandidateIds,
    (ids) => {
      let changed = false;
      for (const id of ids) {
        if (!autoCollapsedReasoningIds.value.has(id)) {
          autoCollapsedReasoningIds.value.add(id);
          reasoningOpenById.value.set(id, false);
          changed = true;
        }
      }
      if (changed) onLayoutChange?.();
    },
    { immediate: true }
  );

  const mcpToolGroupOpenByKey = ref(new Map<string, boolean>());
  const mcpToolDetailOpenByKey = ref(new Map<string, boolean>());
  const mcpResourceOpenByKey = ref(new Map<string, boolean>());
  const isMcpToolGroupOpen = (id: string) =>
    mcpToolGroupOpenByKey.value.get(`${runtimeStore.timelineKey}:${id}`) ?? false;
  const onMcpToolGroupToggle = (id: string, open: boolean) => {
    mcpToolGroupOpenByKey.value.set(`${runtimeStore.timelineKey}:${id}`, open);
    onLayoutChange?.();
  };
  const isMcpToolItemDetailOpen = (k: string) =>
    mcpToolDetailOpenByKey.value.get(`${runtimeStore.timelineKey}:${k}`) ?? false;
  const onMcpToolItemDetailToggle = (k: string, open: boolean) => {
    mcpToolDetailOpenByKey.value.set(`${runtimeStore.timelineKey}:${k}`, open);
    onLayoutChange?.();
  };
  const isMcpResourceOpen = (id: string) =>
    mcpResourceOpenByKey.value.get(`${runtimeStore.timelineKey}:${id}`) ?? false;
  const setMcpResourceOpen = (id: string, open: boolean) => {
    mcpResourceOpenByKey.value.set(`${runtimeStore.timelineKey}:${id}`, open);
    onLayoutChange?.();
  };

  return {
    chatRows,
    chatRenderedRows,
    isReasoningOpen,
    setReasoningOpen,
    isMcpToolGroupOpen,
    onMcpToolGroupToggle,
    isMcpToolItemDetailOpen,
    onMcpToolItemDetailToggle,
    isMcpResourceOpen,
    setMcpResourceOpen,
  };
}
