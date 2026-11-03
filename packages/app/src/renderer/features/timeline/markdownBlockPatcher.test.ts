// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMarkdownBlockPatcher } from "./markdownBlockPatcher";

afterEach(() => document.body.replaceChildren());

describe("Markdown DOM block reuse", () => {
  it("retains completed paragraphs, code enhancements and selection while the tail grows", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const patcher = createMarkdownBlockPatcher();
    const prepare = vi.fn();
    const patch = (html: string) => {
      const template = document.createElement("div");
      template.innerHTML = html;
      patcher.patch(host, template, prepare);
    };
    patch("<p>completed</p><pre><code>const x = 1</code></pre><p>tail</p>");
    const paragraph = host.firstChild;
    const pre = host.querySelector("pre")!;
    const code = pre.querySelector("code")!;
    code.innerHTML = "<span class='highlight'>const</span> x = 1";
    const highlighted = code.firstChild;
    const button = document.createElement("button");
    button.textContent = "Copied";
    pre.append(button);
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    window.getSelection()!.addRange(range);
    prepare.mockClear();

    patch("<p>completed</p><pre><code>const x = 1</code></pre><p>tail grows</p>");

    expect(host.firstChild).toBe(paragraph);
    expect(code.firstChild).toBe(highlighted);
    expect(host.querySelector("button")).toBe(button);
    expect(window.getSelection()!.toString()).toBe("completed");
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(host.lastChild!.textContent).toBe("tail grows");
  });

  it("preserves a matching suffix when earlier Markdown changes and removes deleted blocks", () => {
    const host = document.createElement("div");
    const patcher = createMarkdownBlockPatcher();
    const patch = (html: string) => {
      const template = document.createElement("div");
      template.innerHTML = html;
      patcher.patch(host, template, () => {});
    };
    patch("<p>unresolved reference</p><p>unchanged</p>");
    const suffix = host.lastChild;
    patch('<p><a href="https://example.com">resolved reference</a></p><p>unchanged</p>');
    expect(host.lastChild).toBe(suffix);
    expect(host.querySelector("a")!.href).toBe("https://example.com/");
    patch("<p>unchanged</p>");
    expect(host.childNodes.length).toBe(1);
    expect(host.firstChild).toBe(suffix);
    patch("");
    expect(host.childNodes.length).toBe(0);
  });

  it("tracks asynchronous Mermaid replacements and errors without rebuilding adjacent blocks", () => {
    const host = document.createElement("div");
    const patcher = createMarkdownBlockPatcher();
    const patch = (tail: string) => {
      const template = document.createElement("div");
      template.innerHTML = `<p>intro</p><pre><code>diagram</code></pre><p>${tail}</p>`;
      patcher.patch(host, template, () => {});
    };
    patch("tail");
    const intro = host.firstChild;
    const pre = host.querySelector("pre")!;
    const svg = document.createElement("div");
    svg.innerHTML = "<svg></svg>";
    pre.replaceWith(svg);
    patcher.trackReplacement(pre, [svg]);
    patch("longer tail");
    expect(host.firstChild).toBe(intro);
    expect(host.children[1]).toBe(svg);
    const error = document.createElement("div");
    svg.before(error);
    patcher.trackReplacement(svg, [error, svg]);
    patch("even longer tail");
    expect(host.children[1]).toBe(error);
    expect(host.children[2]).toBe(svg);

    patcher.reset();
    patch("theme changed");
    expect(host.firstChild).not.toBe(intro);
    expect(host.querySelector("svg")).toBeNull();
  });
});
