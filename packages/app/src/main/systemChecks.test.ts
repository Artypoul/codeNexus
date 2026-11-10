import { describe, expect, it } from "vitest";
import { checkCodexLoginStatus } from "./systemChecks";

describe("checkCodexLoginStatus", () => {
  it("reports authenticated when the CLI status command succeeds", () => {
    const result = checkCodexLoginStatus("C:\\Tools\\codex.exe", () => ({
      status: 0,
      stdout: "Logged in as art@example.com",
      stderr: "",
    }));

    expect(result).toEqual({
      status: "authenticated",
      details: "Codex CLI login is active.",
    });
  });

  it("reports signed out for a normal non-zero status", () => {
    const result = checkCodexLoginStatus("C:\\Tools\\codex.cmd", () => ({
      status: 1,
      stdout: "",
      stderr: "Not logged in",
    }));

    expect(result).toEqual({
      status: "signed_out",
      details: "Codex CLI login is not active. Run codex login.",
    });
  });

  it("does not expose command output when the status check is unknown", () => {
    const result = checkCodexLoginStatus("C:\\Tools\\codex.cmd", () => ({
      status: null,
      stdout: "token=secret-value",
      stderr: "spawn failed",
      error: "timeout",
    }));

    expect(result).toEqual({
      status: "unknown",
      details: "Unable to determine Codex CLI login status.",
    });
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });
});
