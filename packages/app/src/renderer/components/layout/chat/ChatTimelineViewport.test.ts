// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, reactive, type App } from "vue";
import ChatTimelineViewport from "./ChatTimelineViewport.vue";
import type { ChatRenderedRow } from "../types/chat.types";

let app: App | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", undefined);
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("timeline scroll updates", () => {
  it("notifies layout changes when nonvirtual content resizes without a row revision", async () => {
    const observed = new Map<Element, () => void>();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(readonly callback: () => void) {}
        observe(element: Element) {
          observed.set(element, this.callback);
        }
        disconnect() {}
      }
    );
    const scroller = document.createElement("div");
    document.body.append(scroller);
    const layoutChange = vi.fn();
    app = createApp(() =>
      h(ChatTimelineViewport, {
        rows: [],
        timelineKey: "thread",
        scrollElement: scroller,
        onLayoutChange: layoutChange,
      })
    );
    app.mount(scroller);
    await nextTick();
    await vi.advanceTimersByTimeAsync(50);
    layoutChange.mockClear();
    const viewport = scroller.querySelector<HTMLElement>(".chat-timeline-viewport")!;
    expect(observed.has(viewport)).toBe(true);
    observed.get(viewport)!();
    observed.get(viewport)!();
    await vi.advanceTimersByTimeAsync(17);
    expect(layoutChange).toHaveBeenCalledExactlyOnceWith();
    app.unmount();
    app = undefined;
    layoutChange.mockClear();
    observed.get(viewport)!();
    await vi.advanceTimersByTimeAsync(50);
    expect(layoutChange).not.toHaveBeenCalled();
  });

  it("coalesces a burst of scroll events and finds the pinned user with logarithmic layout reads", async () => {
    const scroller = document.createElement("div");
    document.body.append(scroller);
    const rows = Array.from({ length: 240 }, (_, index) => ({
      id: `row-${index}`,
      turnKey: "turn",
      kind: index % 2 === 0 ? "user" : "assistant",
      event: { id: `event-${index}`, paramsText: "content" },
    })) as ChatRenderedRow[];
    const pinned = vi.fn();
    const rectangles = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement
    ) {
      const index = Number(this.dataset.rowIndex ?? 0);
      const top = this === scroller ? 0 : index * 100 - scroller.scrollTop;
      return { top, bottom: top + 80, height: 80, width: 100, left: 0, right: 100, x: 0, y: top, toJSON: () => ({}) };
    });
    app = createApp(() =>
      h(
        ChatTimelineViewport,
        { rows, timelineKey: "thread", scrollElement: scroller, onPinnedUserRowChange: pinned },
        { default: () => h("span", "row") }
      )
    );
    app.mount(scroller);
    await nextTick();
    await vi.advanceTimersByTimeAsync(50);
    pinned.mockClear();
    rectangles.mockClear();
    scroller.scrollTop = 2000;
    for (let index = 0; index < 30; index += 1) scroller.dispatchEvent(new Event("scroll"));
    expect(pinned).not.toHaveBeenCalled();
    expect(rectangles).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(17);
    expect(pinned).toHaveBeenCalledExactlyOnceWith("row-18");
    expect(rectangles.mock.calls.length).toBeLessThanOrEqual(11);
  });

  it("cancels a scheduled scroll update when unmounted", async () => {
    const scroller = document.createElement("div");
    document.body.append(scroller);
    const pinned = vi.fn();
    app = createApp(() =>
      h(ChatTimelineViewport, {
        rows: [],
        timelineKey: "thread",
        scrollElement: scroller,
        onPinnedUserRowChange: pinned,
      })
    );
    app.mount(scroller);
    await nextTick();
    await vi.advanceTimersByTimeAsync(50);
    scroller.dispatchEvent(new Event("scroll"));
    app.unmount();
    app = undefined;
    pinned.mockClear();
    await vi.advanceTimersByTimeAsync(50);
    expect(pinned).not.toHaveBeenCalled();
  });

  it("finds the pinned user from measured rows when virtualization is enabled", async () => {
    const scroller = document.createElement("div");
    Object.defineProperties(scroller, { clientHeight: { value: 150 }, scrollHeight: { value: 1200 } });
    document.body.append(scroller);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const top = this === scroller ? 0 : Number(this.dataset.rowIndex ?? 0) * 85 - scroller.scrollTop;
      return { top, bottom: top + 80, height: 80, width: 100, left: 0, right: 100, x: 0, y: top, toJSON: () => ({}) };
    });
    const rows = Array.from({ length: 12 }, (_, index) => ({
      id: `row-${index}`,
      turnKey: "turn",
      kind: index % 2 === 0 ? "user" : "assistant",
      event: { id: `event-${index}`, paramsText: "content" },
    })) as ChatRenderedRow[];
    const pinned = vi.fn();
    app = createApp(() =>
      h(
        ChatTimelineViewport,
        {
          rows,
          timelineKey: "thread",
          scrollElement: scroller,
          virtualThreshold: 0,
          onPinnedUserRowChange: pinned,
        },
        { default: () => h("span", "row") }
      )
    );
    app.mount(scroller);
    await nextTick();
    await vi.advanceTimersByTimeAsync(100);
    expect(scroller.querySelector("[data-virtualized='true']")).not.toBeNull();
    scroller.scrollTop = 350;
    scroller.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(50);
    expect(pinned).toHaveBeenLastCalledWith("row-2");
  });

  it("marks only newly appended intermediate rows for enter", async () => {
    const scroller = document.createElement("div");
    document.body.append(scroller);
    const props = reactive({
      rows: [
        {
          id: "row-0",
          turnKey: "turn",
          kind: "activity",
          text: "first",
          createdAt: 0,
        },
      ] as ChatRenderedRow[],
      timelineKey: "thread",
      scrollElement: scroller,
      followBottom: true,
      animateEnter: true,
    });
    app = createApp(() => h(ChatTimelineViewport, props, { default: () => h("div", { class: "chat-row" }, "row") }));
    app.mount(scroller);
    await nextTick();
    await vi.advanceTimersByTimeAsync(50);

    const initial = scroller.querySelector<HTMLElement>('[data-row-id="row-0"]')!;
    expect(initial.dataset.enter).toBe("false");

    props.rows.push({
      id: "row-1",
      turnKey: "turn",
      kind: "activity",
      text: "second",
      createdAt: 1,
    });
    await nextTick();

    const appended = scroller.querySelector<HTMLElement>('[data-row-id="row-1"]')!;
    expect(appended.dataset.enter).toBe("true");
    expect(appended.dataset.enterHeight).toBe("true");

    await vi.advanceTimersByTimeAsync(900);
    await nextTick();
    expect(appended.dataset.enter).toBe("false");
  });
});
