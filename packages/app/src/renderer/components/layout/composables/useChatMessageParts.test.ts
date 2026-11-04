// @vitest-environment happy-dom
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatMessageParts } from "./useChatMessageParts";
import type { TimelineEventItem } from "../../../domain/types";

vi.mock("../../../api/codexDesktopClient", () => {
  const stub = {
    localState: {
      initialSettingsSnapshot: {
        path: "",
        exists: false,
        settings: {},
      },
    },
    app: {},
    workspace: {},
    history: {},
    codexServer: {},
  };
  return { codexDesktop: stub };
});

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("official skill user content", () => {
  it("keeps legacy text when content supplies only a skill", () => {
    const { userMessageParts } = useChatMessageParts(() => new Set());
    const event = {
      id: "legacy",
      method: "user",
      params: {
        role: "user",
        text: "review this",
        content: [{ type: "skill", name: "review", path: "C:/skills/review/SKILL.md" }],
      },
    } as unknown as TimelineEventItem;
    expect(userMessageParts(event)).toMatchObject([
      { type: "text", text: "review this" },
      { type: "skill", name: "review" },
    ]);
  });
  it("renders text and skill parts in original order", () => {
    const { userMessageParts } = useChatMessageParts(() => new Set());
    const event = {
      id: "event-1",
      method: "user",
      paramsText: "",
      params: {
        role: "user",
        text: "",
        content: [
          { type: "text", text: "use " },
          { type: "skill", name: "review", path: "C:/skills/review/SKILL.md" },
          { type: "text", text: " now" },
        ],
      },
    } as unknown as TimelineEventItem;

    expect(userMessageParts(event)).toMatchObject([
      { type: "text", text: "use " },
      { type: "skill", name: "review", path: "C:/skills/review/SKILL.md", label: "review" },
      { type: "text", text: " now" },
    ]);
  });
});
