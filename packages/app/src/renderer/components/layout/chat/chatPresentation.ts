import type { ChatRenderedRow } from "../types/chat.types";

export const CHAT_TIMELINE_ROW_CLASS = "chat-timeline-row";
export const CHAT_TIMELINE_ROW_ID_ATTR = "data-row-id";
export const CHAT_TIMELINE_ROW_SELECTOR = `.${CHAT_TIMELINE_ROW_CLASS}[${CHAT_TIMELINE_ROW_ID_ATTR}]`;
export const CHAT_ROW_BASE_CLASS = "chat-row flex min-w-0 m-0";
export const CHAT_ROW_ACTIVITY_CLASS = `${CHAT_ROW_BASE_CLASS} chat-row--activity`;
export const CHAT_ROW_TOOL_CLASS = `${CHAT_ROW_BASE_CLASS} chat-row--tool`;

export type ChatTimelineRowGroup = "activity" | "body" | "command";
export type ChatTimelineRowRole = "message" | "activity" | "tool" | "system";
export type ChatTimelineRowDensity = "compact" | "standard" | "spacious";
export type ChatTimelineRowStatus = "idle" | "running" | "completed" | "error" | "warning";

export type ChatTimelineRowPresentation = {
  group: ChatTimelineRowGroup;
  role: ChatTimelineRowRole;
  density: ChatTimelineRowDensity;
  status: ChatTimelineRowStatus;
  estimatedHeightPx: number;
  expandable: boolean;
  className: string;
};

const COMMAND_ROW_KINDS = new Set<ChatRenderedRow["kind"]>([
  "commandAction",
  "commandSession",
  "commandList",
  "commandRead",
  "commandSearch",
]);

const TOOL_ROW_KINDS = new Set<ChatRenderedRow["kind"]>([
  "dynamicTool",
  "fileChange",
  "imageTool",
  "mcpResourceRead",
  "mcpToolGroup",
  "webSearch",
]);

const ACTIVITY_ROW_KINDS = new Set<ChatRenderedRow["kind"]>([
  "activity",
  "assistantCommentary",
  "auxActivityGroup",
  "reasoningBlock",
]);

function rowGroup(row: ChatRenderedRow): ChatTimelineRowGroup {
  if (COMMAND_ROW_KINDS.has(row.kind)) return "command";
  if (row.kind === "tokenUsageSummary") return "activity";
  if (ACTIVITY_ROW_KINDS.has(row.kind)) return "activity";
  return "body";
}

function rowRole(row: ChatRenderedRow): ChatTimelineRowRole {
  if (row.kind === "user" || row.kind === "assistant") return "message";
  if (row.kind === "system") return "system";
  if (row.kind === "tokenUsageSummary") return "activity";
  if (ACTIVITY_ROW_KINDS.has(row.kind) || COMMAND_ROW_KINDS.has(row.kind)) return "activity";
  if (TOOL_ROW_KINDS.has(row.kind)) return "tool";
  return "tool";
}

function rowDensity(row: ChatRenderedRow): ChatTimelineRowDensity {
  if (
    COMMAND_ROW_KINDS.has(row.kind) ||
    row.kind === "activity" ||
    row.kind === "assistantCommentary" ||
    row.kind === "reasoningBlock"
  )
    return "compact";
  if (row.kind === "assistant" || row.kind === "user" || row.kind === "fileChange") return "spacious";
  if (row.kind === "tokenUsageSummary") return "compact";
  return "standard";
}

function rowStatus(row: ChatRenderedRow): ChatTimelineRowStatus {
  if (row.kind === "system") return "error";
  if (row.kind === "auxActivityGroup") return row.status === "running" ? "running" : "completed";
  if (row.kind === "activity") {
    if (row.tone === "running") return "running";
    if (row.tone === "ok") return "completed";
    if (row.tone === "error") return "error";
    if (row.tone === "warn") return "warning";
  }
  if (row.kind === "imageTool" || row.kind === "dynamicTool" || row.kind === "webSearch") {
    return row.item.status === "running" ? "running" : row.item.status === "failed" ? "error" : "completed";
  }
  if (row.kind === "fileChange") {
    if (row.item.status === "running") return "running";
    if (row.item.status === "failed" || row.item.status === "declined") return "error";
    return "completed";
  }
  if (row.kind === "mcpResourceRead") {
    if (row.item.status === "running") return "running";
    if (row.item.status === "failed") return "error";
    return "completed";
  }
  if (row.kind === "mcpToolGroup") {
    if (row.group.stats.running > 0) return "running";
    if (row.group.stats.failed > 0) return "error";
    return "completed";
  }
  if (row.kind === "tokenUsageSummary") return "completed";
  if (
    row.kind === "commandAction" ||
    row.kind === "commandSession" ||
    row.kind === "commandList" ||
    row.kind === "commandRead" ||
    row.kind === "commandSearch"
  ) {
    const status = row.kind === "commandAction" ? row.item.item.status : row.item.status;
    if (status === "running") return "running";
    if (status === "failed") return "error";
    if (status === "completed") return "completed";
  }
  return "idle";
}

function estimatedHeightPx(row: ChatRenderedRow): number {
  switch (row.kind) {
    case "activity":
    case "assistantCommentary":
    case "commandAction":
    case "commandSession":
    case "commandList":
    case "commandRead":
    case "commandSearch":
    case "reasoningBlock":
    case "tokenUsageSummary":
      return 28;
    case "auxActivityGroup":
      if (row.groups?.length) return row.defaultCollapsed ? 36 : 40 + Math.min(8, row.groups.length) * 34;
      return row.defaultCollapsed ? 36 : 180;
    case "user":
      return row.event.paramsText?.length > 260 ? 120 : 64;
    case "assistant":
      return row.event.paramsText?.length > 800 ? 240 : 96;
    case "fileChange":
      return Math.min(280, 76 + Math.max(1, row.item.files.length) * 44);
    case "imageTool":
      return row.item.images.length > 0 ? 260 : 120;
    case "dynamicTool":
    case "mcpResourceRead":
    case "mcpToolGroup":
    case "webSearch":
      return 112;
    case "system":
      return 48;
    default:
      return 80;
  }
}

function isExpandable(row: ChatRenderedRow): boolean {
  return (
    row.kind === "auxActivityGroup" ||
    row.kind === "reasoningBlock" ||
    row.kind === "mcpResourceRead" ||
    row.kind === "mcpToolGroup" ||
    row.kind === "commandAction" ||
    row.kind === "commandSession" ||
    row.kind === "tokenUsageSummary"
  );
}

export function getChatRowPresentation(row: ChatRenderedRow): ChatTimelineRowPresentation {
  const group = rowGroup(row);
  const role = rowRole(row);
  const density = rowDensity(row);
  const status = rowStatus(row);
  const expandable = isExpandable(row);
  return {
    group,
    role,
    density,
    status,
    estimatedHeightPx: estimatedHeightPx(row),
    expandable,
    className: [
      `${CHAT_TIMELINE_ROW_CLASS}--${group}`,
      `${CHAT_TIMELINE_ROW_CLASS}--${role}`,
      `${CHAT_TIMELINE_ROW_CLASS}--${density}`,
      status !== "idle" ? `${CHAT_TIMELINE_ROW_CLASS}--${status}` : "",
      expandable ? `${CHAT_TIMELINE_ROW_CLASS}--expandable` : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}
