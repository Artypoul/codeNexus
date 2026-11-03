import { describe, expect, it } from "vitest";
import { findStreamingSplitIndex } from "./useAgentMarkdownRenderer";

describe("findStreamingSplitIndex", () => {
  it("returns the offset right after the last blank line", () => {
    const text = "first paragraph\n\nsecond paragraph";
    expect(findStreamingSplitIndex(text)).toBe("first paragraph\n\n".length);
  });

  it("returns 0 when there is no blank line yet", () => {
    expect(findStreamingSplitIndex("just one growing paragraph")).toBe(0);
  });

  it("ignores blank lines inside an open code fence", () => {
    const text = "intro\n\n```ts\nline one\n\nline two";
    expect(findStreamingSplitIndex(text)).toBe("intro\n\n".length);
  });

  it("uses the trailing blank line once the fence is closed", () => {
    const text = "intro\n\n```ts\nline one\n```\n\nafter";
    expect(findStreamingSplitIndex(text)).toBe("intro\n\n```ts\nline one\n```\n\n".length);
  });

  it("handles CRLF line endings", () => {
    const text = "first\r\n\r\nsecond";
    expect(findStreamingSplitIndex(text)).toBe("first\r\n\r\n".length);
  });

  it("does not split between loose list items", () => {
    const text = "1. first item\n\n2. second item";
    expect(findStreamingSplitIndex(text)).toBe(0);
  });

  it("does not split inside an indented code block", () => {
    const text = "    line one\n\n    line two";
    expect(findStreamingSplitIndex(text)).toBe(0);
  });

  it("does not split when reference definitions could cross blocks", () => {
    const text = "[ref]: https://example.com\n\nsee [link][ref]";
    expect(findStreamingSplitIndex(text)).toBe(0);
  });

  it("does not split between contiguous blockquote paragraphs", () => {
    const text = "> first quote\n\n> second quote";
    expect(findStreamingSplitIndex(text)).toBe(0);
  });

  it("still splits before a list that starts after a paragraph", () => {
    const text = "intro\n\n- item";
    expect(findStreamingSplitIndex(text)).toBe("intro\n\n".length);
  });

  it("handles tilde fences and longer closing fences", () => {
    const text = "intro\n\n~~~~ts\n```\n\nline two\n~~~~\n\nafter";
    expect(findStreamingSplitIndex(text)).toBe("intro\n\n~~~~ts\n```\n\nline two\n~~~~\n\n".length);
  });
});
