// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UiLanguage } from "@codenexus/shared/localSettings";
import { installDomI18nFallback, refreshDomI18nFallback } from "./domFallback";

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
let dispose: (() => void) | undefined;
const deliverMutations = () => new Promise((resolve) => setTimeout(resolve, 0));
const flushFrames = () => {
  const callbacks = [...frames.values()];
  frames.clear();
  for (const callback of callbacks) callback(performance.now());
};

beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  frames.clear();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("incremental DOM translation", () => {
  it("walks only added subtrees and consumes its own translation records", async () => {
    document.body.innerHTML = "<aside>保存</aside><main></main>";
    dispose = installDomI18nFallback(() => "en-US");
    flushFrames();
    await deliverMutations();
    expect(document.querySelector("aside")!.textContent).toBe("Save");
    expect(frames.size).toBe(0);
    const walk = vi.spyOn(document, "createTreeWalker");
    const button = document.createElement("button");
    button.textContent = "取消";
    button.title = "保存";
    document.querySelector("main")!.append(button);
    await deliverMutations();
    flushFrames();
    await deliverMutations();
    expect(button.textContent).toBe("Cancel");
    expect(button.title).toBe("Save");
    expect(walk).toHaveBeenCalledTimes(1);
    expect(walk.mock.calls[0][0]).toBe(button);
    expect(frames.size).toBe(0);
  });

  it("prunes skipped content and does not schedule work for streamed Markdown", async () => {
    document.body.innerHTML = '<div class="agent-markdown-body"><p>保存</p></div><button>保存</button>';
    dispose = installDomI18nFallback(() => "en-US");
    flushFrames();
    await deliverMutations();
    expect(document.querySelector("p")!.textContent).toBe("保存");
    expect(document.querySelector("button")!.textContent).toBe("Save");
    document.querySelector("p")!.textContent = "取消";
    await deliverMutations();
    expect(frames.size).toBe(0);
  });

  it("handles changed text, input attributes and switching back to Chinese", async () => {
    let language: UiLanguage = "en-US";
    document.body.innerHTML = '<span>保存</span><input placeholder="取消"><textarea>保存</textarea>';
    dispose = installDomI18nFallback(() => language);
    flushFrames();
    await deliverMutations();
    const span = document.querySelector("span")!;
    span.firstChild!.nodeValue = "删除";
    document.querySelector("input")!.placeholder = "保存";
    await deliverMutations();
    flushFrames();
    expect(span.textContent).toBe("Delete");
    expect(document.querySelector("input")!.placeholder).toBe("Save");
    expect(document.querySelector("textarea")!.textContent).toBe("保存");
    language = "zh-CN";
    refreshDomI18nFallback(language);
    expect(span.textContent).toBe("删除");
    expect(document.querySelector("input")!.placeholder).toBe("保存");
  });

  it("cancels pending animation frames on disposal", () => {
    dispose = installDomI18nFallback(() => "en-US");
    expect(frames.size).toBe(1);
    dispose();
    expect(frames.size).toBe(0);
  });
});
