import {
  IMAGE_GENERATION_DYNAMIC_TOOL_DEVELOPER_INSTRUCTIONS,
  IMAGE_GENERATION_DYNAMIC_TOOL_NAME,
} from "./dynamicTools";

/**
 * 把主界面场景映射成 Codex app-server 可理解的 instruction profile。
 *
 * 这些 profile 是 shared 层和功能包之间的窄接口，避免调用侧直接拼接各工作台的提示词细节。
 */
export type CodexInstructionProfile = "chat";

/** 当前只剩聊天/图片两种主视图，均使用同一套 chat 指令。 */
export function codexInstructionProfileForMainView(): CodexInstructionProfile {
  return "chat";
}

/** 根据 profile 输出最终注入 Codex 会话的 developer instructions。 */
export function buildDeveloperInstructionsForProfile(
  profile: CodexInstructionProfile | null | undefined,
): string | null {
  if (profile === "chat")
    return IMAGE_GENERATION_DYNAMIC_TOOL_DEVELOPER_INSTRUCTIONS;
  return null;
}

/** chat profile 才默认注入图片生成工具，其他工作台先保持能力边界更窄。 */
export function buildDynamicToolNamesForInstructionProfile(
  profile: CodexInstructionProfile | null | undefined,
): string[] {
  if (profile === "chat") return [IMAGE_GENERATION_DYNAMIC_TOOL_NAME];
  return [];
}
