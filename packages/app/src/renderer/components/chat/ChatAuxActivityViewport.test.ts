// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, onBeforeUnmount, reactive, type App } from "vue";
import ChatAuxActivityViewport from "./ChatAuxActivityViewport.vue";
import { provideActivityItemStates, useActivityItemState } from "./activityItemState";
import type { ChatAuxiliaryRow } from "../layout/types/chat.types";

let app: App | undefined;
let notifyResize: () => void;
let rowHeights: Map<string, number>;
let clientWidth: number;
let clientHeight: number;

beforeEach(() => {
  vi.useFakeTimers();
  rowHeights = new Map();
  clientWidth = 600;
  clientHeight = 320;
  const observers = new Set<() => void>();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        this.callback = callback;
        observers.add(callback);
      }
      callback: () => void;
      observe() {}
      unobserve() {}
      disconnect() {
        observers.delete(this.callback);
      }
    }
  );
  notifyResize = () => observers.forEach((callback) => callback());
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const height = rowHeights.get(this.dataset.auxId ?? "") ?? 28;
    return { height, width: clientWidth, top: 0, bottom: height, left: 0, right: clientWidth } as DOMRect;
  });
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const settle = async () => {
  await nextTick();
  await vi.advanceTimersByTimeAsync(100);
  await nextTick();
};

function mountViewport(count = 1000) {
  const props = reactive({
    active: true,
    items: Array.from({ length: count }, (_, index) => ({
      id: `row-${index}`,
      turnKey: "turn",
      kind: "activity",
      text: "activity",
      createdAt: 0,
    })) as ChatAuxiliaryRow[],
  });
  const mounted = vi.fn();
  const unmounted = vi.fn();
  const Child = defineComponent({
    props: { rowId: { type: String, required: true } },
    setup(childProps) {
      mounted(childProps.rowId);
      onBeforeUnmount(() => unmounted(childProps.rowId));
      const expanded = useActivityItemState(
        () => childProps.rowId,
        () => false
      );
      return () => h("button", { onClick: () => (expanded.value = !expanded.value) }, String(expanded.value));
    },
  });
  const host = document.createElement("div");
  document.body.append(host);
  app = createApp(
    defineComponent({
      setup() {
        provideActivityItemStates();
        return () =>
          h(ChatAuxActivityViewport, props, {
            default: ({ item }: { item: ChatAuxiliaryRow }) => h(Child, { rowId: item.id }),
          });
      },
    })
  );
  app.mount(host);
  const scroller = host.querySelector<HTMLElement>(".chat-aux-activity__body")!;
  let scrollTop = 0;
  Object.defineProperties(scroller, {
    clientWidth: { get: () => clientWidth },
    clientHeight: { get: () => clientHeight },
    scrollHeight: {
      get: () =>
        Number.parseFloat(host.querySelector<HTMLElement>(".chat-aux-activity__items")!.style.height) ||
        props.items.length * 33 - 5,
    },
    scrollTop: {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.max(0, Math.min(value, scroller.scrollHeight - scroller.clientHeight));
      },
    },
  });
  const scrollTo = async (top: number) => {
    scroller.scrollTop = top;
    scroller.dispatchEvent(new Event("scroll"));
    await settle();
  };
  return { host, scroller, props, mounted, unmounted, scrollTo };
}

describe("activity group virtual viewport", () => {
  it("bounds mounted children for a thousand records and initially shows the latest record", async () => {
    const { host, mounted, scroller } = mountViewport();
    await settle();
    expect(scroller.dataset.virtualized).toBe("true");
    expect(host.querySelectorAll("[data-aux-id]").length).toBeLessThan(40);
    expect(mounted.mock.calls.length).toBeLessThan(50);
    expect(host.querySelector('[data-aux-id="row-999"]')).not.toBeNull();
    expect(host.querySelector('[data-aux-id="row-0"]')).toBeNull();
    expect(scroller.scrollTop).toBe(scroller.scrollHeight - scroller.clientHeight);
  });

  it("unmounts offscreen children and restores their expansion state on return", async () => {
    const { host, scrollTo, scroller, unmounted } = mountViewport();
    await settle();
    host.querySelector<HTMLButtonElement>('[data-aux-id="row-999"] button')!.click();
    await nextTick();
    await scrollTo(0);
    expect(host.querySelector('[data-aux-id="row-0"]')).not.toBeNull();
    expect(host.querySelector('[data-aux-id="row-999"]')).toBeNull();
    expect(unmounted).toHaveBeenCalledWith("row-999");
    await scrollTo(scroller.scrollHeight);
    expect(host.querySelector('[data-aux-id="row-999"] button')!.textContent).toBe("true");
  });

  it("does not pull readers down on append, and resumes following when they return to the bottom", async () => {
    const { props, scroller, scrollTo, host } = mountViewport(100);
    await settle();
    await scrollTo(660);
    const append = (index: number) =>
      props.items.push({ id: `row-${index}`, turnKey: "turn", kind: "activity", text: "new", createdAt: 0 });
    append(100);
    notifyResize();
    await settle();
    expect(scroller.scrollTop).toBe(660);
    await scrollTo(scroller.scrollHeight);
    append(101);
    notifyResize();
    await settle();
    expect(scroller.scrollTop).toBe(scroller.scrollHeight - scroller.clientHeight);
    expect(host.querySelector('[data-aux-id="row-101"]')).not.toBeNull();
  });

  it("preserves the visible anchor when a preceding measured row grows", async () => {
    const { scroller, scrollTo } = mountViewport(100);
    await settle();
    await scrollTo(330);
    rowHeights.set("row-0", 128);
    notifyResize();
    await settle();
    expect(scroller.scrollTop).toBe(430);
  });

  it("remeasures on viewport resize and cleans up pending callbacks", async () => {
    const { scroller, host } = mountViewport(100);
    await settle();
    clientWidth = 400;
    clientHeight = 180;
    rowHeights.set("row-99", 100);
    notifyResize();
    await settle();
    expect(scroller.scrollTop).toBe(scroller.scrollHeight - 180);
    expect(host.querySelector('[data-aux-id="row-99"]')).not.toBeNull();
    notifyResize();
    app!.unmount();
    app = undefined;
    await settle();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stays at the bottom when only the scroll container height changes", async () => {
    const { scroller } = mountViewport(100);
    await settle();
    clientHeight = 180;
    notifyResize();
    await settle();
    expect(scroller.scrollTop).toBe(scroller.scrollHeight - 180);
  });

  it("preserves anchors in small groups as well", async () => {
    const { scroller, scrollTo } = mountViewport(30);
    await settle();
    await scrollTo(330);
    rowHeights.set("row-0", 128);
    notifyResize();
    await settle();
    expect(scroller.scrollTop).toBe(430);
  });

  it("uses normal flow for small groups and can cross the virtualization threshold", async () => {
    const { props, scroller, host } = mountViewport(10);
    await settle();
    expect(scroller.dataset.virtualized).toBe("false");
    expect(host.querySelectorAll("[data-aux-id]")).toHaveLength(10);
    props.items = Array.from({ length: 60 }, (_, index) => ({
      id: `row-${index}`,
      turnKey: "turn",
      kind: "activity",
      text: "activity",
      createdAt: 0,
    }));
    await settle();
    expect(scroller.dataset.virtualized).toBe("true");
    expect(host.querySelectorAll("[data-aux-id]").length).toBeLessThan(40);
    expect(host.querySelector('[data-aux-id="row-59"]')).not.toBeNull();
  });
});
