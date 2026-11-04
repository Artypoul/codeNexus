import { describe, expect, it } from "vitest";
import type { HistoryThreadEvent } from "@codenexus/shared/ipc";
import { parseSessionReplayEvents } from "./replayParsers";

function entry(type: string, payload: unknown, lineNo = 1): HistoryThreadEvent {
  return { type, payload, lineNo, timestamp: "2026-11-04T00:00:00Z" };
}

describe("structured user message replay", () => {
  it("keeps mention-only messages and skill identity", () => {
    const events = parseSessionReplayEvents(
      [
        entry("response_item", {
          type: "message",
          role: "user",
          content: [{ type: "mention", name: "file.ts", path: "C:/repo/file.ts" }],
        }),
        ...["C:/skills/review/SKILL.md", "D:/skills/review/SKILL.md"].map((path, index) =>
          entry(
            "response_item",
            {
              type: "message",
              role: "user",
              content: [{ type: "skill", name: "review", path }],
            },
            index + 2
          )
        ),
      ],
      "thread"
    ).filter((event) => event.method === "user");
    expect(events).toHaveLength(3);
    expect(events[0].paramsText).toBe("C:/repo/file.ts");
  });

  it("does not duplicate images represented in both legacy fields and content", () => {
    const events = parseSessionReplayEvents(
      [
        entry("event_msg", {
          type: "user_message",
          message: "look",
          images: ["https://example.com/image.png"],
          local_images: ["C:/image.png"],
          content: [
            { type: "image", url: "https://example.com/image.png" },
            { type: "localImage", path: "C:/image.png" },
          ],
        }),
      ],
      "thread"
    );
    expect(events.find((event) => event.method === "user")!.params).toMatchObject({
      images: ["https://example.com/image.png"],
      local_images: ["C:/image.png"],
    });
  });

  it("loads image-only response messages using the input_image format", () => {
    const events = parseSessionReplayEvents(
      [
        entry("response_item", {
          type: "message",
          role: "user",
          content: [{ type: "input_image", image_url: "https://example.com/image.png" }],
        }),
      ],
      "thread"
    );
    expect(events.find((event) => event.method === "user")!.params).toMatchObject({
      images: ["https://example.com/image.png"],
    });
  });

  it("enriches duplicate user records with structured content without dropping existing metadata", () => {
    const text = "C:/repo/file.ts";
    const textElements = [{ byteRange: { start: 0, end: text.length }, placeholder: "file.ts", kind: "file" }];
    const events = parseSessionReplayEvents(
      [
        entry("event_msg", { type: "user_message", message: text, text_elements: textElements }),
        entry("response_item", { type: "message", role: "user", content: [{ type: "input_text", text }] }, 2),
      ],
      "thread"
    ).filter((event) => event.method === "user");
    expect(events).toHaveLength(1);
    expect(events[0].params).toMatchObject({
      text_elements: textElements,
      content: [{ type: "input_text", text }],
    });
  });
});
