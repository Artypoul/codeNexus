// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, createApp, h, nextTick, ref, type App } from "vue";
import { useTimelineScrollController } from "./useTimelineScrollController";

let app: App | undefined;
let observers: TestResizeObserver[];

class TestResizeObserver {
  readonly elements = new Set<Element>();

  constructor(readonly callback: ResizeObserverCallback) {
    observers.push(this);
  }

  observe(element: Element) {
    this.elements.add(element);
  }

  disconnect() {
    this.elements.clear();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  observers = [];
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function settle() {
  await nextTick();
  await vi.advanceTimersByTimeAsync(150);
}

function deferredLoad() {
  let complete!: (loaded: boolean) => void;
  const load = vi.fn(() => new Promise<boolean>((resolve) => (complete = resolve)));
  return { load, complete: (loaded: boolean) => complete(loaded) };
}

async function mountController(loadOlderHistoryTurns: (threadId: string) => Promise<boolean> = async () => false) {
  const element = document.createElement("div");
  const dimensions = { height: 1200, client: 600 };
  Object.defineProperties(element, {
    scrollHeight: { get: () => dimensions.height },
    clientHeight: { get: () => dimensions.client },
  });
  const scrollTo = vi.fn((options?: ScrollToOptions | number, offsetTop?: number) => {
    const top = typeof options === "number" ? offsetTop : options?.top;
    element.scrollTop = Math.max(0, Math.min(dimensions.height - dimensions.client, top ?? 0));
  });
  element.scrollTo = scrollTo;
  const timelineRef = ref<HTMLElement | null>(element);
  const key = ref("thread-a");
  const revision = ref(0);
  const loading = ref(false);
  let controller!: ReturnType<typeof useTimelineScrollController>;
  app = createApp({
    setup() {
      controller = useTimelineScrollController({
        timelineRef,
        timelineKey: computed(() => key.value),
        timelineRevision: computed(() => revision.value),
        activeTurnId: computed(() => "turn"),
        isTimelineLoading: computed(() => loading.value),
        loadOlderHistoryTurns,
      });
      return () => h("div");
    },
  });
  const host = document.createElement("div");
  document.body.append(host, element);
  app.mount(host);
  await settle();
  scrollTo.mockClear();
  function scrollManually(top: number) {
    element.scrollTop = top;
    controller.onTimelineScroll();
  }
  function resize() {
    for (const observer of observers) {
      if (observer.elements.has(element)) observer.callback([], observer as unknown as ResizeObserver);
    }
  }
  return { element, dimensions, scrollTo, controller, timelineRef, key, revision, loading, scrollManually, resize };
}

describe("timeline follow intent", () => {
  it("keeps following streamed content without treating a state refresh as user scrolling", async () => {
    const harness = await mountController();
    harness.dimensions.height = 1500;
    harness.controller.scheduleTimelineViewportStateUpdate();
    await settle();
    expect(harness.controller.autoFollowEnabled.value).toBe(true);
    harness.revision.value += 1;
    await settle();
    expect(harness.element.scrollTop).toBe(900);
  });

  it("cancels queued following when the reader scrolls away, then resumes at the bottom", async () => {
    const harness = await mountController();
    harness.controller.requestFollowBottom();
    harness.scrollManually(200);
    await settle();
    expect(harness.scrollTo).not.toHaveBeenCalled();
    expect(harness.element.scrollTop).toBe(200);
    harness.dimensions.height = 1500;
    harness.revision.value += 1;
    await settle();
    expect(harness.element.scrollTop).toBe(200);
    harness.scrollManually(900);
    harness.dimensions.height = 1800;
    harness.revision.value += 1;
    await settle();
    expect(harness.element.scrollTop).toBe(1200);
  });

  it("retains the existing 56px threshold", async () => {
    const harness = await mountController();
    harness.scrollManually(560);
    expect(harness.controller.autoFollowEnabled.value).toBe(true);
    harness.revision.value += 1;
    await settle();
    expect(harness.element.scrollTop).toBe(600);
  });

  it("detaches after small trackpad movements accumulate beyond the threshold", async () => {
    const harness = await mountController();
    for (let top = 599; top >= 500; top -= 1) harness.scrollManually(top);
    expect(harness.controller.autoFollowEnabled.value).toBe(false);
    harness.revision.value += 1;
    await settle();
    expect(harness.element.scrollTop).toBe(500);
  });

  it("does not reenable following during the first frames of smooth row navigation", async () => {
    const harness = await mountController();
    const row = document.createElement("div");
    row.className = "chat-timeline-row";
    row.dataset.rowId = "older-row";
    row.getBoundingClientRect = () => ({ top: -400, bottom: -300 }) as DOMRect;
    harness.element.append(row);
    harness.controller.requestFollowBottom();
    harness.scrollTo.mockImplementationOnce(() => {});
    expect(harness.controller.scrollRowToTop("older-row", 0, "smooth")).toBe(true);
    harness.scrollManually(595);
    expect(harness.controller.autoFollowEnabled.value).toBe(false);
    harness.scrollTo.mockClear();
    harness.revision.value += 1;
    await settle();
    expect(harness.scrollTo).not.toHaveBeenCalled();
  });

  it("keeps bottom alignment when the viewport gets shorter without content growth", async () => {
    const harness = await mountController();
    harness.dimensions.client = 400;
    harness.resize();
    await settle();
    expect(harness.element.scrollTop).toBe(800);
    expect(harness.controller.autoFollowEnabled.value).toBe(true);
    harness.scrollManually(200);
    harness.dimensions.client = 300;
    harness.resize();
    await settle();
    expect(harness.element.scrollTop).toBe(200);
  });

  it("does not detach on delayed programmatic scroll events or native layout anchoring", async () => {
    const harness = await mountController();
    harness.dimensions.height = 1500;
    harness.revision.value += 1;
    await settle();
    harness.dimensions.height = 1800;
    harness.controller.onTimelineScroll();
    expect(harness.controller.autoFollowEnabled.value).toBe(true);
    harness.element.scrollTop = 1200;
    harness.controller.onTimelineScroll();
    expect(harness.controller.autoFollowEnabled.value).toBe(true);
    harness.dimensions.height = 800;
    harness.element.scrollTop = 200;
    harness.controller.onTimelineScroll();
    expect(harness.controller.autoFollowEnabled.value).toBe(true);
  });

  it("does not restore an outdated layout anchor after the reader moves", async () => {
    const harness = await mountController();
    harness.scrollManually(200);
    harness.controller.notifyTimelineLayoutChange();
    harness.scrollManually(350);
    await settle();
    expect(harness.element.scrollTop).toBe(350);
  });
});

describe("timeline navigation and lifecycle", () => {
  it("lets the reader cancel initial positioning while a thread layout settles", async () => {
    const harness = await mountController();
    harness.key.value = "thread-b";
    await nextTick();
    harness.scrollManually(100);
    await settle();
    expect(harness.element.scrollTop).toBe(100);
    expect(harness.controller.autoFollowEnabled.value).toBe(false);
  });

  it("ignores an old thread's queued scroll while the next thread is loading", async () => {
    const harness = await mountController();
    harness.controller.requestFollowBottom();
    harness.loading.value = true;
    harness.key.value = "thread-b";
    await settle();
    expect(harness.scrollTo).not.toHaveBeenCalled();
    harness.loading.value = false;
    await settle();
    expect(harness.element.scrollTop).toBe(600);
  });

  it("rebinds the size observer when the timeline is removed and recreated", async () => {
    const harness = await mountController();
    harness.timelineRef.value = null;
    await nextTick();
    expect(observers.every((observer) => !observer.elements.has(harness.element))).toBe(true);
    const replacement = document.createElement("div");
    replacement.scrollTo = vi.fn();
    harness.timelineRef.value = replacement;
    await settle();
    expect(observers.some((observer) => observer.elements.has(replacement))).toBe(true);
    harness.scrollTo.mockClear();
    harness.resize();
    await settle();
    expect(harness.scrollTo).not.toHaveBeenCalled();
  });

  it("does not run queued scrolling or layout restoration after unmount", async () => {
    const harness = await mountController();
    harness.controller.requestFollowBottom();
    harness.controller.notifyTimelineLayoutChange();
    app!.unmount();
    app = undefined;
    await settle();
    expect(harness.scrollTo).not.toHaveBeenCalled();
    expect(observers.every((observer) => observer.elements.size === 0)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("older history scroll restoration", () => {
  it("compensates for prepended history without a reader interaction", async () => {
    const pending = deferredLoad();
    const harness = await mountController(pending.load);
    harness.scrollManually(0);
    expect(pending.load).toHaveBeenCalledExactlyOnceWith("thread-a");
    harness.dimensions.height += 600;
    pending.complete(true);
    await settle();
    expect(harness.element.scrollTop).toBe(600);
  });

  it("preserves the reader's latest position when they scroll during loading", async () => {
    const pending = deferredLoad();
    const harness = await mountController(pending.load);
    harness.scrollManually(0);
    harness.scrollManually(300);
    harness.dimensions.height += 600;
    pending.complete(true);
    await settle();
    expect(harness.element.scrollTop).toBe(900);
    expect(harness.controller.autoFollowEnabled.value).toBe(false);
  });

  it("restores a real visible row instead of including unrelated tail growth", async () => {
    const pending = deferredLoad();
    const harness = await mountController(pending.load);
    const row = document.createElement("div");
    row.className = "chat-timeline-row";
    row.dataset.rowId = "visible-row";
    harness.element.append(row);
    let rowTop = 0;
    row.getBoundingClientRect = () => ({ top: rowTop, bottom: rowTop + 100 }) as DOMRect;
    harness.scrollManually(0);
    harness.dimensions.height += 900;
    rowTop = 600;
    pending.complete(true);
    await settle();
    expect(harness.element.scrollTop).toBe(600);
  });

  it("discards a history restoration superseded by an explicit bottom request", async () => {
    const pending = deferredLoad();
    const harness = await mountController(pending.load);
    harness.scrollManually(0);
    harness.controller.forceFollowBottom();
    await settle();
    harness.dimensions.height += 600;
    harness.revision.value += 1;
    pending.complete(true);
    await settle();
    expect(harness.element.scrollTop).toBe(1200);
  });

  it("does not apply a history response after navigating away and back", async () => {
    const pending = deferredLoad();
    const harness = await mountController(pending.load);
    harness.scrollManually(0);
    harness.key.value = "thread-b";
    await settle();
    harness.key.value = "thread-a";
    await settle();
    harness.scrollManually(300);
    harness.dimensions.height += 600;
    pending.complete(true);
    await settle();
    expect(harness.element.scrollTop).toBe(300);
  });
});
