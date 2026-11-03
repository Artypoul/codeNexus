// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, h, ref, type App } from "vue";
import { useAgentMarkdownRenderer } from "./useAgentMarkdownRenderer";
import type { TimelineEventItem } from "../../domain/types";

const { render, version } = vi.hoisted(() => ({
  render: vi.fn((text: string) => `<p>${text}</p>`),
  version: { value: 1 },
}));
vi.mock("./markdownRenderer", () => ({
  renderMarkdownToSafeHtml: render,
  getMarkdownRendererVersion: () => version.value,
  whenMarkdownRendererReady: () => Promise.resolve(),
}));
let app: App | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  render.mockClear();
  version.value = 1;
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.useRealTimers();
  document.body.replaceChildren();
});
function setup() {
  const key = ref("A");
  let renderer!: ReturnType<typeof useAgentMarkdownRenderer>;
  const host = document.createElement("div");
  document.body.append(host);
  app = createApp({
    setup() {
      renderer = useAgentMarkdownRenderer({ key: () => key.value });
      return () => h("div");
    },
  });
  app.mount(host);
  const event = (paramsText: string) =>
    ({
      id: "same-event-id",
      paramsText,
      method: "item/agentMessage/delta",
      createdAt: 0,
      level: "info",
    }) as TimelineEventItem;
  return { key, renderer, event };
}

describe("Markdown caches across threads", () => {
  it("reuses A after switching through B and keeps identical event ids isolated", () => {
    const { key, renderer, event } = setup();
    expect(renderer.getMarkdownEventHtml(event("A text"))).toBe("<p>A text</p>");
    key.value = "B";
    expect(renderer.getMarkdownEventHtml(event("B text"))).toBe("<p>B text</p>");
    key.value = "A";
    expect(renderer.getMarkdownEventHtml(event("A text"))).toBe("<p>A text</p>");
    expect(render).toHaveBeenCalledTimes(2);
    version.value = 2;
    renderer.getMarkdownEventHtml(event("A text"));
    expect(render).toHaveBeenCalledTimes(3);
  });

  it("stops inactive rendering timers, resumes fresh text and bounds cached threads", async () => {
    const { key, renderer, event } = setup();
    renderer.getMarkdownEventHtml(event("first"));
    renderer.getMarkdownEventHtml(event("first grows"));
    key.value = "B";
    await vi.advanceTimersByTimeAsync(1000);
    expect(render).toHaveBeenCalledTimes(1);
    key.value = "A";
    expect(renderer.getMarkdownEventHtml(event("first grows"))).toBe("<p>first grows</p>");
    for (const thread of ["B", "C", "D", "E"]) {
      key.value = thread;
      renderer.getMarkdownEventHtml(event(thread));
    }
    const previous = render.mock.calls.length;
    key.value = "A";
    renderer.getMarkdownEventHtml(event("first grows"));
    expect(render).toHaveBeenCalledTimes(previous + 1);
    renderer.clear();
    key.value = "E";
    renderer.getMarkdownEventHtml(event("E"));
    expect(render).toHaveBeenCalledTimes(previous + 2);
  });
});
