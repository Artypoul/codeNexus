import { describe, expect, it } from "vitest";
import { buildDeveloperInstructionsForProfile } from "../codexInstructionProfiles";
import { IMAGE_GENERATION_DYNAMIC_TOOL_DEVELOPER_INSTRUCTIONS } from "../dynamicTools";

describe("codex instruction profiles", () => {
  it("只返回自定义工具说明，不覆盖协作模式内置指令", () => {
    const instructions = buildDeveloperInstructionsForProfile("chat");

    expect(instructions).toBe(
      IMAGE_GENERATION_DYNAMIC_TOOL_DEVELOPER_INSTRUCTIONS,
    );
    expect(instructions).not.toContain("Plan Mode");
  });
});
