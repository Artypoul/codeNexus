import { describe, expect, it } from "vitest";
import { resolveGigmaRuntimeCommand } from "./GigmaAuthProcessSupervisor";

describe("resolveGigmaRuntimeCommand", () => {
  it("prefers an explicitly configured auth daemon", () => {
    expect(
      resolveGigmaRuntimeCommand({
        explicitCommand: "C:\\Tools\\gigma.exe",
        resourcesPath: "C:\\Program Files\\CodeNexus\\resources",
        exists: () => true,
      })
    ).toEqual({ command: "C:\\Tools\\gigma.exe", bundled: false });
  });

  it("finds the packaged Gigma runtime before the development fallback", () => {
    expect(
      resolveGigmaRuntimeCommand({
        resourcesPath: "C:\\Program Files\\CodeNexus\\resources",
        devRuntimeDir: "D:\\Development\\CodeNexus\\native-runtime",
        exists: (path) => path.endsWith("resources\\gigma-runtime\\gigma.exe"),
      })
    ).toEqual({
      command: "C:\\Program Files\\CodeNexus\\resources\\gigma-runtime\\gigma.exe",
      bundled: true,
    });
  });

  it("uses the development runtime when the packaged binary is unavailable", () => {
    expect(
      resolveGigmaRuntimeCommand({
        devRuntimeDir: "D:\\Development\\CodeNexus\\native-runtime",
        exists: (path) => path.endsWith("native-runtime\\gigma.exe"),
      })
    ).toEqual({
      command: "D:\\Development\\CodeNexus\\native-runtime\\gigma.exe",
      bundled: true,
    });
  });
});
