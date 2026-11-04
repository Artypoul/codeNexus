// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, onBeforeUnmount, reactive, type App } from "vue";
import Collapsible from "./Collapsible.vue";

let app: App | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function mountCollapsible(options = {}) {
  const mounted = vi.fn();
  const unmounted = vi.fn();
  const Child = defineComponent({
    setup() {
      mounted();
      onBeforeUnmount(unmounted);
      return () => h("pre", "expensive content");
    },
  });
  const props = reactive({ open: false, lazy: true, keepMounted: false, ...options });
  const host = document.createElement("div");
  document.body.append(host);
  app = createApp(() => h(Collapsible, props, { default: () => h(Child) }));
  app.mount(host);
  return { host, props, mounted, unmounted };
}

describe("lazy height disclosures", () => {
  it("creates content only on demand and unloads after the closing animation", async () => {
    const { props, mounted, unmounted, host } = mountCollapsible();
    expect(mounted).not.toHaveBeenCalled();
    props.open = true;
    await nextTick();
    expect(mounted).toHaveBeenCalledTimes(1);
    props.open = false;
    await nextTick();
    expect(unmounted).not.toHaveBeenCalled();
    const event = new Event("transitionend", { bubbles: true });
    Object.defineProperty(event, "propertyName", { value: "grid-template-rows" });
    host.querySelector(".ui-collapsible-content")!.dispatchEvent(event);
    await nextTick();
    expect(unmounted).toHaveBeenCalledTimes(1);
  });

  it("cancels pending unmount on reopen and falls back when transitionend is missing", async () => {
    const { props, mounted, unmounted } = mountCollapsible({ open: true });
    props.open = false;
    await nextTick();
    await vi.advanceTimersByTimeAsync(100);
    props.open = true;
    await nextTick();
    await vi.advanceTimersByTimeAsync(300);
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
    props.open = false;
    await nextTick();
    await vi.advanceTimersByTimeAsync(300);
    expect(unmounted).toHaveBeenCalledTimes(1);
  });

  it("honors keepMounted after the first open", async () => {
    const { props, mounted, unmounted } = mountCollapsible({ keepMounted: true });
    expect(mounted).not.toHaveBeenCalled();
    props.open = true;
    await nextTick();
    props.open = false;
    await nextTick();
    await vi.advanceTimersByTimeAsync(300);
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
  });

  it("unloads immediately for reduced motion and preserves the default non-lazy behavior", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    const { props, unmounted } = mountCollapsible({ open: true });
    props.open = false;
    await nextTick();
    expect(unmounted).toHaveBeenCalledTimes(1);
    app!.unmount();
    const { mounted } = mountCollapsible({ lazy: false });
    expect(mounted).toHaveBeenCalledTimes(1);
  });
});
