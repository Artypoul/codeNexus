// aux 活动组的跨帧复用判断。
// 组成员（行对象）与影响展示的标记都没变时，直接复用上一帧构建好的组对象，
// 避免每帧重新统计、翻译、拼摘要（长会话下这是下游最固定的重复开销）。
import type { ChatAuxActivityGroupRow, ChatAuxiliaryRow } from "../types/chat.types";

export type AuxGroupCacheEntry = {
  row: ChatAuxActivityGroupRow;
  groupIndex: number;
  /** 摘要文案依赖当前语言，切换语言时必须重建。 */
  locale: string;
  defaultCollapsed: boolean;
  startedAtMs: number | null;
  answerStartedAtMs: number | null;
  elapsedLive: boolean;
};

export type AuxGroupFlags = Omit<AuxGroupCacheEntry, "row">;

export function canReuseAuxGroup(
  entry: AuxGroupCacheEntry | undefined,
  flags: AuxGroupFlags,
  members: readonly ChatAuxiliaryRow[]
): boolean {
  if (!entry) return false;
  if (entry.groupIndex !== flags.groupIndex) return false;
  if (entry.locale !== flags.locale) return false;
  if (entry.defaultCollapsed !== flags.defaultCollapsed) return false;
  if (entry.startedAtMs !== flags.startedAtMs) return false;
  if (entry.answerStartedAtMs !== flags.answerStartedAtMs) return false;
  if (entry.elapsedLive !== flags.elapsedLive) return false;
  const previous = entry.row.items;
  if (previous.length !== members.length) return false;
  for (let index = 0; index < members.length; index += 1) {
    if (previous[index] !== members[index]) return false;
  }
  return true;
}
