import { describe, expect, it } from "vitest";
import { createMenuKeyHandler } from "./windowsMenu";

type Input = Parameters<ReturnType<typeof createMenuKeyHandler>>[0];
const input = (key: string, type: "keyDown" | "keyUp", overrides: Partial<Input> = {}): Input => ({
  key,
  type,
  isAutoRepeat: false,
  isComposing: false,
  shift: false,
  control: false,
  alt: false,
  meta: false,
  ...overrides,
});

describe("Windows menu keyboard trigger", () => {
  it("opens on bare Alt release and F10 press", () => {
    const handle = createMenuKeyHandler();
    expect(handle(input("Alt", "keyDown", { alt: true }))).toBe(false);
    expect(handle(input("Alt", "keyUp"))).toBe(true);
    expect(handle(input("F10", "keyDown"))).toBe(true);
    expect(handle(input("F10", "keyUp"))).toBe(false);
  });

  it("does not intercept shortcuts, AltGr, composition or repeat", () => {
    const handle = createMenuKeyHandler();
    for (const key of ["F4", "Tab", "x"]) {
      handle(input("Alt", "keyDown", { alt: true }));
      expect(handle(input(key, "keyDown", { alt: true }))).toBe(false);
      expect(handle(input("Alt", "keyUp"))).toBe(false);
    }
    expect(handle(input("Alt", "keyDown", { alt: true, control: true }))).toBe(false);
    expect(handle(input("Alt", "keyUp", { control: true }))).toBe(false);
    expect(handle(input("F10", "keyDown", { isAutoRepeat: true }))).toBe(false);
    expect(handle(input("F10", "keyDown", { shift: true }))).toBe(false);
    expect(handle(input("F10", "keyDown", { isComposing: true }))).toBe(false);
  });
});
