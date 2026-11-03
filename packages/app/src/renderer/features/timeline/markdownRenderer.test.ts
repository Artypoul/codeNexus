// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";
import { renderMarkdownToSafeHtml, whenMarkdownRendererReady } from "./markdownRenderer";

beforeAll(async () => {
  await whenMarkdownRendererReady();
});

describe("CJK-friendly Markdown emphasis", () => {
  it("renders bold text that ends with CJK punctuation before following text", () => {
    const html = renderMarkdownToSafeHtml("**你当前安装的版本里，它确实还没有被标记为稳定。**我刚查了本机信息：");

    expect(html).toContain("<strong>你当前安装的版本里，它确实还没有被标记为稳定。</strong>我刚查了本机信息：");
    expect(html).not.toContain("**");
  });

  it("renders bold text that starts after CJK text and begins with punctuation", () => {
    const html = renderMarkdownToSafeHtml("他说**“你好”**。");

    expect(html).toContain("<strong>“你好”</strong>。");
  });

  it("keeps ASCII emphasis and intraword underscores compatible", () => {
    expect(renderMarkdownToSafeHtml("这是 **bold** 文本")).toContain("<strong>bold</strong>");
    expect(renderMarkdownToSafeHtml("中文_重点_内容")).not.toContain("<em>");
  });
});

describe("Markdown feature coverage", () => {
  it("renders headings, emphasis, strikethrough, lists and blockquotes", () => {
    const html = renderMarkdownToSafeHtml(
      [
        "# H1",
        "## H2",
        "### H3",
        "#### H4",
        "##### H5",
        "###### H6",
        "",
        "**bold** *italic* ***both*** ~~strike~~",
        "",
        "- one",
        "  - nested",
        "",
        "1. first",
        "2. second",
        "",
        "> quote",
      ].join("\n")
    );

    expect(html).toContain("<h1>H1</h1>");
    expect(html).toContain("<h6>H6</h6>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<s>strike</s>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<blockquote>");
  });

  it("renders fenced code, tables, links and images", () => {
    const html = renderMarkdownToSafeHtml(
      [
        "```ts",
        "const value = 1;",
        "```",
        "",
        "| Left | Center | Right |",
        "| :--- | :----: | ----: |",
        "| a | b | c |",
        "",
        "[link](https://example.com) ![alt](https://example.com/a.png)",
      ].join("\n")
    );

    expect(html).toContain('<code class="language-ts">');
    expect(html).toContain('class="agent-table-scroll app-scrollbar"');
    expect(html).toContain('class="agent-align-left"');
    expect(html).toContain('class="agent-align-center"');
    expect(html).toContain('class="agent-align-right"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('<img src="https://example.com/a.png" alt="alt">');
  });

  it("escapes raw HTML and dangerous links", () => {
    const html = renderMarkdownToSafeHtml("<script>alert(1)</script> [bad](javascript:alert(1))");

    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("&lt;script&gt;");
  });
});
