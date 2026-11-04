import { describe, expect, it, vi } from "vitest";
import { createTurnInputRuntime } from "./turnInputRuntime";
import type { UserTurnInput } from "../types";

vi.mock("../../api/codexDesktopClient", () => ({ codexDesktop: {} }));

describe("structured turn input", () => {
  it("keeps skill and mention inputs in their original order for sending and display", () => {
    const runtime = createTurnInputRuntime();
    const inputs: UserTurnInput[] = [
      { type: "text", text: "use " },
      { type: "skill", name: "review", path: "C:/skills/review/SKILL.md" },
      { type: "text", text: " on " },
      { type: "mention", name: "file.ts", path: "C:/repo/file.ts" },
    ];
    const { payload, displayText } = runtime.buildTimelineUserMessagePayload(inputs);
    expect(payload.content).toEqual(inputs);
    expect(displayText).toBe("use $review on C:/repo/file.ts");
    expect(runtime.toCodexUserInputs(inputs)).toEqual([
      { type: "text", text: "use ", text_elements: [] },
      inputs[1],
      { type: "text", text: " on ", text_elements: [] },
      inputs[3],
    ]);
  });

  it("offsets file ranges across text segments using UTF-8 bytes", () => {
    const runtime = createTurnInputRuntime();
    const prefix = "你好 ";
    const filePath = "C:/repo/file.ts";
    const { payload } = runtime.buildTimelineUserMessagePayload([
      { type: "text", text: prefix },
      { type: "skill", name: "review", path: "C:/skills/review/SKILL.md" },
      {
        type: "text",
        text: filePath,
        text_elements: [{ byteRange: { start: 0, end: filePath.length }, placeholder: "file.ts" }],
      },
    ]);
    expect(payload.text).toBe(prefix + filePath);
    expect(payload.text_elements).toMatchObject([
      { byteRange: { start: 7, end: 7 + filePath.length }, placeholder: "file.ts" },
    ]);
  });
});
