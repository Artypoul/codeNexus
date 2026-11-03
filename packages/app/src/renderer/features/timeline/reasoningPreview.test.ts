import { describe, expect, it } from "vitest";
import { toReasoningPreviewLine } from "./reasoningPreview";

describe("toReasoningPreviewLine", () => {
  it("returns the last visible line and strips block markers", () => {
    const text = "# Plan\n\n> quoted **line**\n\n- final `item`";
    expect(toReasoningPreviewLine(text)).toBe("final item");
  });

  it("ignores fenced code blocks", () => {
    const text = "before\n\n```ts\nconst value = 1;\n```\n\n```\nlast code\n```";
    expect(toReasoningPreviewLine(text)).toBe("before");
  });

  it("ignores indented code blocks", () => {
    const text = "paragraph\n\n    const value = 1;\n    second line";
    expect(toReasoningPreviewLine(text)).toBe("paragraph");
  });

  it("strips links, images and emphasis", () => {
    const text = "see [docs](https://example.com) and ![diagram](diagram.png) for **details**";
    expect(toReasoningPreviewLine(text)).toBe("see docs and diagram for details");
  });

  it("keeps snake_case identifiers intact", () => {
    expect(toReasoningPreviewLine("check foo_bar_baz value")).toBe("check foo_bar_baz value");
  });

  it("converts table rows and skips separators", () => {
    const text = "| name | value |\n| --- | --- |\n| alpha | 1 |";
    expect(toReasoningPreviewLine(text)).toBe("alpha 1");
  });

  it("truncates very long lines", () => {
    const result = toReasoningPreviewLine("x".repeat(400));
    expect(result.length).toBe(240);
    expect(result.endsWith("…")).toBe(true);
  });
});
