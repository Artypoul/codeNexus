import type { DynamicToolCallOutputContentItem } from "@codenexus/generated/codex-app-server/v2/DynamicToolCallOutputContentItem";
import { IMAGE_GENERATION_DYNAMIC_TOOL_NAME } from "@codenexus/shared/dynamicTools";
import { translate } from "../i18n/translate";
import { safeJsonStringify } from "../utils/safeJson";

export type DynamicToolTimelineStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "awaitingApproval"
  | "rejected";

export type DynamicToolTimelineItem = {
  callId: string;
  namespace: string;
  toolName: string;
  label: string;
  status: DynamicToolTimelineStatus;
  approvalRequired: boolean;
  durationMs: number | null;
  argsRaw: string;
  argsSummary: string;
  resultSummary: string;
  errorText: string;
  contentItems: DynamicToolCallOutputContentItem[];
};

export function dynamicToolStatusText(status: DynamicToolTimelineStatus): string {
  if (status === "succeeded") return translate("dynamicTool.status.succeeded");
  if (status === "failed") return translate("dynamicTool.status.failed");
  if (status === "cancelled") return translate("dynamicTool.status.cancelled");
  if (status === "awaitingApproval") return translate("dynamicTool.status.awaitingApproval");
  if (status === "rejected") return translate("dynamicTool.status.rejected");
  return translate("dynamicTool.status.running");
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function shortenText(value: unknown, maxChars: number): string {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function toPrettyJson(value: unknown): string {
  return safeJsonStringify(value ?? {}, { space: 2 });
}

function toInlineJson(value: unknown): string {
  return safeJsonStringify(value ?? {}, { space: 0 });
}

function normalizeContentItems(value: unknown): DynamicToolCallOutputContentItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is DynamicToolCallOutputContentItem => {
    const raw = toRecord(item);
    if (raw.type === "inputText") return typeof raw.text === "string";
    if (raw.type === "inputImage") return typeof raw.imageUrl === "string";
    return false;
  });
}

function dynamicToolLabel(toolName: string): string {
  if (toolName === IMAGE_GENERATION_DYNAMIC_TOOL_NAME) return translate("dynamicTool.imageGeneration");
  return translate("dynamicTool.callTool", { tool: toolName || "unknown" });
}

function dynamicToolArgsSummary(toolName: string, args: Record<string, unknown>): string {
  if (toolName === IMAGE_GENERATION_DYNAMIC_TOOL_NAME) {
    const prompt = shortenText(args.prompt, 160);
    const size = String(args.size ?? "").trim();
    const quality = String(args.quality ?? "").trim();
    const outputFormat = String(args.output_format ?? "").trim();
    return [
      prompt ? `prompt=${prompt}` : "",
      size ? `size=${size}` : "",
      quality ? `quality=${quality}` : "",
      outputFormat ? `format=${outputFormat}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return shortenText(toInlineJson(args), 260);
}

function dynamicToolResultSummary(contentItems: DynamicToolCallOutputContentItem[]): string {
  const textItems = contentItems
    .filter((item) => item.type === "inputText")
    .map((item) => shortenText(item.text, 220))
    .filter(Boolean);
  if (textItems.length > 0) return textItems.join("\n");
  const imageCount = contentItems.filter((item) => item.type === "inputImage").length;
  if (imageCount > 0) return translate("dynamicTool.returnedImages", { count: imageCount });
  return "";
}

export function buildDynamicToolTimelineItemFromProtocolItem(item: unknown): DynamicToolTimelineItem | null {
  const raw = toRecord(item);
  if (raw.type !== "dynamicToolCall") return null;

  const callId = String(raw.id ?? "").trim();
  const namespace = String(raw.namespace ?? "").trim();
  const toolName = String(raw.tool ?? "").trim();
  if (!callId || !toolName) return null;

  const args = toRecord(raw.arguments);
  const rawStatus = String(raw.status ?? "").trim();
  const success = typeof raw.success === "boolean" ? raw.success : null;
  const contentItems = normalizeContentItems(raw.contentItems);
  const outputSummary = dynamicToolResultSummary(contentItems);

  let status: DynamicToolTimelineStatus = "running";
  if (rawStatus === "failed" || success === false) status = "failed";
  else if (rawStatus === "completed" || success === true) status = "succeeded";

  return {
    callId,
    namespace,
    toolName,
    label: namespace ? dynamicToolLabel(`${namespace}/${toolName}`) : dynamicToolLabel(toolName),
    status,
    approvalRequired: false,
    durationMs:
      typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs) && raw.durationMs >= 0
        ? Math.round(raw.durationMs)
        : null,
    argsRaw: toPrettyJson(args),
    argsSummary: dynamicToolArgsSummary(toolName, args),
    resultSummary: status === "failed" ? "" : outputSummary,
    errorText: status === "failed" ? outputSummary || translate("dynamicTool.callFailed") : "",
    contentItems,
  };
}
