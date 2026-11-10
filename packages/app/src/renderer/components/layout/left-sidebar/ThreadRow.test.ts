// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, type App } from "vue";
import ThreadRow from "./ThreadRow.vue";
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../../../stores/thread.store", () => ({
  useThreadStore: () => ({ displayThreadTitle: (_id: string, title: string) => title }),
}));
let app: App | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
function mountRow() {
  const open = vi.fn();
  const remove = vi.fn();
  const rename = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  app = createApp(() =>
    h(ThreadRow, {
      row: { item: { id: "one", title: "Thread", updatedAt: 0 }, depth: 0 },
      activeThreadId: "",
      isInvalidWorkspaceItem: () => false,
      isPendingThreadId: () => false,
      shouldShowUserInputBadge: () => false,
      shouldShowThreadAttention: () => false,
      runningThreadIds: new Set<string>(),
      recentlyCompletedThreadIds: new Set<string>(),
      threadAriaLabel: () => "Open thread",
      threadRowDepthStyle: () => ({}),
      formatRelativeTime: () => "",
      onOpenThread: open,
      onDeleteThread: remove,
      onRenameThread: rename,
    })
  );
  app.mount(host);
  return {
    host,
    open,
    remove,
    rename,
    trigger: host.querySelector<HTMLButtonElement>(".lsb-delete")!,
    row: host.querySelector<HTMLElement>(".lsb-thread-item")!,
  };
}
it("places the teleported menu within the viewport and preserves menu keyboard behavior", async () => {
  const { trigger, row, open, remove } = mountRow();
  vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
    left: 990,
    right: 1010,
    top: 740,
    bottom: 760,
    width: 20,
    height: 20,
    x: 990,
    y: 740,
    toJSON: () => ({}),
  });
  const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    right: 150,
    top: 0,
    bottom: 80,
    width: 150,
    height: 80,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  await nextTick();
  await nextTick();
  const menu = document.querySelector<HTMLElement>(".lsb-thread-menu-popup")!;
  expect(menu.parentElement).toBe(document.body);
  expect(parseFloat(menu.style.top) + 80).toBeLessThanOrEqual(window.innerHeight - 8);
  expect(parseFloat(menu.style.left) + 150).toBeLessThanOrEqual(window.innerWidth - 8);
  const buttons = menu.querySelectorAll<HTMLButtonElement>("button");
  await nextTick();
  expect(document.activeElement).toBe(buttons[0]);
  buttons[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  expect(document.activeElement).toBe(buttons[1]);
  buttons[1].click();
  expect(remove).toHaveBeenCalledWith("one");
  expect(open).not.toHaveBeenCalled();
  await nextTick();
  trigger.click();
  await nextTick();
  await nextTick();
  document
    .querySelector<HTMLButtonElement>(".lsb-thread-menu-popup button")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(document.activeElement).toBe(trigger);
  expect(open).not.toHaveBeenCalled();
  rect.mockRestore();
});
it("closes on outside pointer and keeps the native rename input context menu", async () => {
  const { row, trigger, rename } = mountRow();
  trigger.click();
  await nextTick();
  await nextTick();
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  await nextTick();
  expect(document.querySelector(".lsb-thread-menu-popup")).toBeNull();
  row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  await nextTick();
  await nextTick();
  document.querySelector<HTMLButtonElement>(".lsb-thread-menu-popup button")!.click();
  await nextTick();
  await nextTick();
  const input = document.querySelector<HTMLInputElement>(".lsb-thread-title-input")!;
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  await nextTick();
  expect(event.defaultPrevented).toBe(false);
  expect(document.querySelector(".lsb-thread-menu-popup")).toBeNull();
  expect(rename).not.toHaveBeenCalled();
});
