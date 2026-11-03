// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, reactive, type App } from "vue";
import AgentMarkdownContent from "./AgentMarkdownContent.vue";
import { highlightCodeTokens } from "../../features/timeline/renderModel/codeSyntaxHighlight";
import { renderMermaidDiagram } from "../../features/timeline/mermaidRenderer";

vi.mock("vue-i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-i18n")>()),
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../../features/timeline/renderModel/codeSyntaxHighlight", () => ({
  normalizeCodeLanguage: (language: string) => language || "text",
  highlightCodeTokens: vi.fn(async ({ code, tone }: { code: string; tone: string }) => [
    [{ content: code, style: { color: tone === "light" ? "black" : "white" } }],
  ]),
}));
vi.mock("../../features/timeline/mermaidRenderer", () => ({
  readMermaidTone: () => (document.documentElement.dataset.tone === "light" ? "light" : "dark"),
  normalizeMermaidError: () => "render failed",
  renderMermaidDiagram: vi.fn(async () => '<svg viewBox="0 0 100 100"></svg>'),
}));

let app: App | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.stubGlobal("ResizeObserver", undefined);
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-tone");
});

function mountMarkdown(html: string) {
  const props = reactive({ html });
  const host = document.createElement("div");
  document.body.append(host);
  app = createApp(() => h(AgentMarkdownContent, props));
  app.mount(host);
  return { props, host };
}

describe("streaming Markdown enhancement", () => {
  it("does not rebuild or highlight stable code blocks when the trailing paragraph grows", async () => {
    const { props, host } = mountMarkdown('<pre><code class="language-ts">const x = 1</code></pre><p>tail</p>');
    await vi.advanceTimersByTimeAsync(250);
    const pre = host.querySelector("pre");
    const highlighted = host.querySelector("code span");
    expect(highlighted).not.toBeNull();
    expect(highlightCodeTokens).toHaveBeenCalledTimes(1);
    props.html = '<pre><code class="language-ts">const x = 1</code></pre><p>tail grows</p>';
    await nextTick();
    await vi.advanceTimersByTimeAsync(250);
    expect(host.querySelector("pre")).toBe(pre);
    expect(host.querySelector("code span")).toBe(highlighted);
    expect(highlightCodeTokens).toHaveBeenCalledTimes(1);

    document.documentElement.dataset.tone = "light";
    // MutationObserver delivery uses happy-dom's task queue.
    await vi.advanceTimersByTimeAsync(250);
    expect(host.querySelector("pre")).not.toBe(pre);
    expect(highlightCodeTokens).toHaveBeenLastCalledWith(expect.objectContaining({ tone: "light" }));
  });

  it("retains asynchronously rendered Mermaid DOM while other blocks update", async () => {
    const { props, host } = mountMarkdown(
      '<p>intro</p><pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre><p>tail</p>'
    );
    await vi.advanceTimersByTimeAsync(250);
    const intro = host.querySelector("p");
    const diagram = host.querySelector(".agent-mermaid-block");
    expect(diagram).not.toBeNull();
    expect(renderMermaidDiagram).toHaveBeenCalledTimes(1);
    props.html = '<p>intro</p><pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre><p>tail grows</p>';
    await nextTick();
    await vi.advanceTimersByTimeAsync(250);
    expect(host.querySelector("p")).toBe(intro);
    expect(host.querySelector(".agent-mermaid-block")).toBe(diagram);
    expect(renderMermaidDiagram).toHaveBeenCalledTimes(1);
  });
});

describe("path highlighting rules", () => {
  it("leaves slash-separated prose and ASCII alternatives as plain text", async () => {
    const { host } = mountMarkdown("<p>有序/无序/嵌套列表、引用、分隔线、表格。</p><p>input/output/error</p>");
    await vi.advanceTimersByTimeAsync(250);

    expect(host.querySelector("code.agent-inline-path")).toBeNull();
    expect(host.textContent).toContain("有序/无序/嵌套列表、引用、分隔线、表格。");
    expect(host.textContent).toContain("input/output/error");
  });

  it("extracts the path from CJK prose and preserves explicit inline code", async () => {
    const { host } = mountMarkdown("<p>修改src/foo.ts然后</p><p><code>foo/bar/baz</code></p>");
    await vi.advanceTimersByTimeAsync(250);

    const paths = [...host.querySelectorAll<HTMLElement>("code.agent-inline-path")];
    expect(paths).toHaveLength(2);
    expect(paths[0]?.textContent).toBe("src/foo.ts");
    expect(paths[0]?.getAttribute("title")).toBe("src/foo.ts");
    expect(host.querySelector("p")?.textContent).toBe("修改src/foo.ts然后");
    expect(paths[1]?.textContent).toBe("foo/bar/baz");
  });

  it("does not add a nested path button inside a link", async () => {
    const { host } = mountMarkdown('<p><a href="https://example.com"><code>src/foo.ts</code></a></p>');
    await vi.advanceTimersByTimeAsync(250);

    expect(host.querySelector("a code.agent-inline-path")).toBeNull();
  });
});
