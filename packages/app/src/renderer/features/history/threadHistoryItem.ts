// 历史列表项：把 HistoryThread 转为 UI 可展示的标题与元信息。
import type { HistoryThread } from "@codenexus/shared/ipc";
import type { ThreadHistoryItem } from "../../domain/types";
import { translate } from "../../i18n/translate";
import { resolveThreadTitle } from "./threadTitle";

function basenameFromPath(value: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const normalized = raw.replace(/\//g, "\\").replace(/\\+$/, "");
  const parts = normalized.split("\\").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : normalized;
}

// 把历史存储结构转成列表 UI 可直接展示的模型。
export function toThreadHistoryItem(item: HistoryThread): ThreadHistoryItem {
  const id = String(item.id ?? "");
  const cwd = String(item.cwd ?? "").trim() || undefined;
  const modelProvider = String(item.modelProvider ?? "").trim() || undefined;
  const workspaceLabel = cwd ? basenameFromPath(cwd) : translate("runtime.noWorkspace");
  const meta = modelProvider ? `${workspaceLabel} · ${modelProvider}` : workspaceLabel;
  return {
    id,
    title: resolveThreadTitle(id, String(item.title ?? "")),
    meta,
    cwd,
    modelProvider,
    updatedAt: Number(item.updatedAt ?? Date.now()),
    running: Boolean(item.running),
    threadSourceKind: item.threadSourceKind,
    forkedFromId: String(item.forkedFromId ?? "").trim() || undefined,
    agentNickname: String(item.agentNickname ?? "").trim() || undefined,
    agentRole: String(item.agentRole ?? "").trim() || undefined,
    agentPath: String(item.agentPath ?? "").trim() || undefined,
    gitInfoSummary: String(item.gitInfoSummary ?? "").trim() || undefined,
    projectId: item.projectId,
    sectionId: item.sectionId,
    sectionName: item.sectionName,
  };
}
