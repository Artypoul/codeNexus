// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, reactive, type App } from "vue";
import DynamicToolCallCardContent from "./DynamicToolCallCardContent.vue";
import McpToolCardContent from "./McpToolCardContent.vue";
import FileChangeCardContent from "./FileChangeCardContent.vue";
import ChatReasoningBlock from "../../chat/ChatReasoningBlock.vue";
import ChatImageToolCard from "../../chat/ChatImageToolCard.vue";
import type { DynamicToolTimelineItem } from "../../../domain/dynamicTools";
import type { FileChangeNode } from "../../../features/timeline/renderModel/buildTimelineNodes";

vi.mock("vue-i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-i18n")>()),
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("./UnifiedDiffViewer.vue", () => ({ default: { template: '<div class="expensive-diff" />' } }));
vi.mock("../../ui/AgentMarkdownContent.vue", () => ({ default: { template: '<div class="expensive-markdown" />' } }));

let app: App | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function mount(render: () => ReturnType<typeof h>) {
  const host = document.createElement("div");
  document.body.append(host);
  app = createApp(render);
  app.mount(host);
  return host;
}

describe("heavy activity content", () => {
  it("does not assemble or mount raw dynamic tool results before expansion", async () => {
    const text = vi.fn(() => "full tool result");
    const item: DynamicToolTimelineItem = {
      callId: "call",
      namespace: "test",
      toolName: "tool",
      label: "Tool",
      status: "succeeded",
      approvalRequired: false,
      durationMs: null,
      argsRaw: "full args",
      argsSummary: "args summary",
      resultSummary: "result summary",
      errorText: "",
      contentItems: [
        {
          type: "inputText",
          get text() {
            return text();
          },
        },
      ],
    };
    const host = mount(() => h(DynamicToolCallCardContent, { item }));
    expect(host.querySelector("pre")).toBeNull();
    const readsBeforeOpen = text.mock.calls.length;
    host.querySelectorAll<HTMLElement>('[role="button"]')[1].click();
    await nextTick();
    expect(host.querySelector("pre")!.textContent).toBe("full tool result");
    expect(text.mock.calls.length).toBeGreaterThan(readsBeforeOpen);
    host.querySelectorAll<HTMLElement>('[role="button"]')[1].click();
    await nextTick();
    await vi.advanceTimersByTimeAsync(300);
    expect(host.querySelector("pre")).toBeNull();
  });

  it("skips all MCP item formatting while the tool group is collapsed", async () => {
    const itemTitle = vi.fn(() => "Tool title");
    const props = reactive({
      open: false,
      tagText: "MCP",
      summaryText: "summary",
      statsText: "1",
      items: [{ id: "tool", status: "completed", tool: "read", argumentsRaw: "raw", argumentsKey: "args" }] as any,
      itemClass: () => "",
      itemStatusText: () => "completed",
      itemMetricsText: () => "",
      itemTitle,
      itemMetaText: () => "",
      isDetailOpen: () => false,
      onDetailToggle: () => {},
    });
    const host = mount(() => h(McpToolCardContent, props));
    expect(itemTitle).not.toHaveBeenCalled();
    expect(host.querySelector(".mcp-tool-body")).toBeNull();
    props.open = true;
    await nextTick();
    expect(itemTitle).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".mcp-tool-body")).not.toBeNull();
    expect(host.querySelector("pre")).toBeNull();
    props.open = false;
    await nextTick();
    await vi.advanceTimersByTimeAsync(300);
    expect(host.querySelector(".mcp-tool-body")).toBeNull();
  });

  it("mounts diff viewers only for explicitly expanded files", async () => {
    const item = {
      id: "file-change",
      status: "completed",
      isStreaming: false,
      files: [{ pathAbs: "D:/file.ts", pathRel: "file.ts", kind: "modify", diffText: "@@ -1 +1 @@\n-old\n+new" }],
    } as FileChangeNode;
    const host = mount(() => h(FileChangeCardContent, { item }));
    expect(host.querySelector(".expensive-diff")).toBeNull();
    host.querySelector<HTMLButtonElement>("button")!.click();
    await nextTick();
    expect(host.querySelector(".expensive-diff")).not.toBeNull();
  });

  it("keeps raw reasoning unmounted until its nested disclosure opens", async () => {
    const host = mount(() =>
      h(ChatReasoningBlock, {
        isOpen: true,
        summaryTitle: "Reasoning",
        durationText: "",
        html: "rendered reasoning",
        rawText: "raw reasoning",
      })
    );
    expect(host.querySelector(".expensive-markdown")).not.toBeNull();
    expect(host.querySelector("pre")).toBeNull();
    host.querySelector<HTMLElement>(".reasoning-raw-trigger")!.click();
    await nextTick();
    expect(host.querySelector("pre")!.textContent).toBe("raw reasoning");
  });

  it("mounts image source details only when the native disclosure opens", async () => {
    const host = mount(() =>
      h(ChatImageToolCard, {
        item: {
          itemId: "image",
          itemType: "imageGeneration",
          title: "image",
          status: "completed",
          detailText: "source details",
          revisedPrompt: "prompt",
          errorText: "",
          images: [],
        },
        visibleImages: [],
        showTimestamps: false,
        formattedTime: "",
        workspaceRoot: "",
      })
    );
    expect(host.querySelector(".official-image-card__source")).toBeNull();
    const details = host.querySelector("details")!;
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    await nextTick();
    expect(host.querySelector(".official-image-card__source")!.textContent).toBe("source details");
    details.open = false;
    details.dispatchEvent(new Event("toggle"));
    await nextTick();
    expect(host.querySelector(".official-image-card__source")).toBeNull();
  });
});
