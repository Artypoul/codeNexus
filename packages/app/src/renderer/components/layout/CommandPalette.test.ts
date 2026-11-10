// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref, type App } from "vue";
import CommandPalette from "./CommandPalette.vue";

const mocks = vi.hoisted(() => ({
  switchThread: vi.fn(),
  createThread: vi.fn(),
  closeSettings: vi.fn(),
  setMainView: vi.fn(),
  openSettings: vi.fn(),
  clearThreadAttention: vi.fn(),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../../domain/runtimeOrchestrator", () => ({ getRuntimeOrchestrator: () => mocks }));
vi.mock("../../stores/appShell.store", () => ({ useAppShellStore: () => mocks }));
vi.mock("../../stores/thread.store", () => ({
  useThreadStore: () => ({
    threadHistory: [
      { id: "one", title: "Original" },
      { id: "two", title: "Second" },
    ],
    displayThreadTitle: (id: string, title: string) => (id === "one" ? "Renamed" : title),
    clearThreadAttention: mocks.clearThreadAttention,
  }),
}));
let app: App | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.replaceChildren();
  vi.clearAllMocks();
});
function mountPalette() {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  const host = document.createElement("div");
  document.body.append(host);
  const open = ref(true);
  app = createApp({
    setup: () => () =>
      open.value
        ? h(CommandPalette, {
            onClose: () => {
              open.value = false;
            },
          })
        : null,
  });
  app.mount(host);
  return { trigger };
}
describe("command palette", () => {
  it("searches renamed titles and opens a result from another view", async () => {
    mountPalette();
    await nextTick();
    const input = document.querySelector<HTMLInputElement>(".palette-input")!;
    input.value = "renamed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await nextTick();
    expect(mocks.closeSettings).toHaveBeenCalled();
    expect(mocks.setMainView).toHaveBeenCalledWith("chat");
    expect(mocks.switchThread).toHaveBeenCalledWith("one");
  });
  it("scrolls the active result into view when arrows wrap", async () => {
    mountPalette();
    await nextTick();
    const input = document.querySelector<HTMLInputElement>(".palette-input")!;
    const target = document.getElementById("palette-option-3")!;
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    await nextTick();
    expect(input.getAttribute("aria-activedescendant")).toBe("palette-option-3");
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
  });
  it("ignores composing Enter and restores focus on Escape", async () => {
    const { trigger } = mountPalette();
    await nextTick();
    const input = document.querySelector<HTMLInputElement>(".palette-input")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }));
    expect(mocks.createThread).not.toHaveBeenCalled();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await nextTick();
    expect(document.activeElement).toBe(trigger);
  });
});
