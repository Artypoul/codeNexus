// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, onBeforeUnmount, reactive, type App } from "vue";
import ChatAuxActivityGroup from "./ChatAuxActivityGroup.vue";
import type { ChatAuxiliaryRow } from "../layout/types/chat.types";

vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

let app: App | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function mountGroup() {
  const mounted = vi.fn();
  const unmounted = vi.fn();
  const Child = defineComponent({
    setup() {
      mounted();
      onBeforeUnmount(unmounted);
      return () => h("span", { class: "expensive-child" }, "content");
    },
  });
  const props = reactive({
    id: "group",
    items: [{ id: "activity", turnKey: "turn", kind: "activity", text: "read", createdAt: 0 }] as ChatAuxiliaryRow[],
    summaryItems: [],
    summaryText: "",
    status: "completed" as const,
    defaultCollapsed: true,
    startedAtMs: null,
    answerStartedAtMs: null,
    elapsedLive: false,
  });
  const host = document.createElement("div");
  document.body.append(host);
  app = createApp(() => h(ChatAuxActivityGroup, props, { default: () => h(Child) }));
  app.mount(host);
  const toggle = async () => {
    host.querySelector<HTMLButtonElement>("button")!.click();
    await nextTick();
  };
  return { host, props, mounted, unmounted, toggle };
}

describe("activity group lazy mounting", () => {
  it("does not create collapsed children and unloads them after the close transition", async () => {
    const { host, mounted, unmounted, toggle } = mountGroup();
    expect(mounted).not.toHaveBeenCalled();
    await toggle();
    expect(mounted).toHaveBeenCalledTimes(1);
    await toggle();
    expect(unmounted).not.toHaveBeenCalled();
    const event = new Event("transitionend", { bubbles: true });
    Object.defineProperty(event, "propertyName", { value: "grid-template-rows" });
    host.querySelector(".chat-aux-activity__body-shell")!.dispatchEvent(event);
    await nextTick();
    expect(unmounted).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".expensive-child")).toBeNull();
  });

  it("keeps children when reopened during a close and has a fallback without transitionend", async () => {
    const { mounted, unmounted, toggle } = mountGroup();
    await toggle();
    await toggle();
    await vi.advanceTimersByTimeAsync(100);
    await toggle();
    await vi.advanceTimersByTimeAsync(300);
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
    await toggle();
    await vi.advanceTimersByTimeAsync(300);
    expect(unmounted).toHaveBeenCalledTimes(1);
  });

  it("unloads immediately for reduced motion and follows automatic collapse", async () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    const { props, mounted, unmounted } = mountGroup();
    props.defaultCollapsed = false;
    await nextTick();
    expect(mounted).toHaveBeenCalledTimes(1);
    props.defaultCollapsed = true;
    await nextTick();
    expect(unmounted).toHaveBeenCalledTimes(1);
  });
});
