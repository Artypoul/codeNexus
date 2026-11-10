import { describe, expect, it } from "vitest";
import { buildSmokeApprovalResponse, buildSmokeInitializeParams, parseSmokeJsonLine } from "./appServerSmokeProtocol";

describe("app-server smoke protocol", () => {
  it("builds the supported initialize metadata", () => {
    expect(buildSmokeInitializeParams("0.1.0")).toEqual({
      clientInfo: {
        name: "codenexus-local-runtime-smoke",
        title: null,
        version: "0.1.0",
      },
      capabilities: null,
    });
  });

  it("parses blank, response, and notification JSONL lines", () => {
    expect(parseSmokeJsonLine("  ")).toBeNull();
    expect(parseSmokeJsonLine('{"id":1,"result":{"userAgent":"codex"}}')).toEqual({
      id: 1,
      result: { userAgent: "codex" },
    });
    expect(parseSmokeJsonLine('{"method":"initialized"}')).toEqual({ method: "initialized" });
  });

  it("rejects malformed or non-object JSONL lines", () => {
    expect(() => parseSmokeJsonLine("not-json")).toThrow("invalid JSONL");
    expect(() => parseSmokeJsonLine("[]")).toThrow("JSONL object");
  });

  it("builds both accept and decline approval responses", () => {
    const request = { id: 4, method: "item/commandExecution/requestApproval", params: {} };

    expect(buildSmokeApprovalResponse(request, "accept")).toEqual({
      id: 4,
      result: { decision: "accept" },
    });
    expect(buildSmokeApprovalResponse(request, "decline")).toEqual({
      id: 4,
      result: { decision: "decline" },
    });
  });
});
