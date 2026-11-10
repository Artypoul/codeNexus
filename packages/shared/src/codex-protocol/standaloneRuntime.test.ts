import { describe, expect, it } from "vitest";
import {
  isStandaloneCodexAppsMethod,
  standaloneCodexAppsError,
} from "./standaloneRuntime";

describe("standalone Codex runtime boundary", () => {
  it("blocks Codex Apps RPC and notifications", () => {
    expect(isStandaloneCodexAppsMethod("app/list")).toBe(true);
    expect(isStandaloneCodexAppsMethod("app/list/updated")).toBe(true);
    expect(isStandaloneCodexAppsMethod("thread/start")).toBe(false);
  });

  it("builds an explicit local-runtime rejection", () => {
    expect(standaloneCodexAppsError(" app/list ")).toEqual({
      code: -32001,
      message:
        "Codex Apps method is disabled in standalone local runtime: app/list",
      data: { method: "app/list" },
    });
  });
});
