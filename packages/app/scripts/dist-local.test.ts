import { describe, expect, it } from "vitest";
import { createLocalDistArgs, LOCAL_OUTPUT_DIR } from "./dist-local.mjs";

describe("local Windows packaging", () => {
  it("disables publishing and targets x64 Windows", () => {
    expect(createLocalDistArgs()).toEqual([
      "--config",
      "electron-builder.yml",
      "--config.directories.output",
      LOCAL_OUTPUT_DIR,
      "--config.win.signAndEditExecutable",
      "false",
      "--win",
      "--x64",
      "--publish",
      "never",
    ]);
  });
});
