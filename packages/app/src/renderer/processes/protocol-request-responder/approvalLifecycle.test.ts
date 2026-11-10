import { afterEach, describe, expect, it, vi } from "vitest";
import { createApprovalLifecycleController } from "./approvalLifecycle";

describe("approval lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-declines an unanswered approval after five minutes", async () => {
    vi.useFakeTimers();
    const responses: unknown[] = [];
    const removed: string[] = [];
    const lifecycle = createApprovalLifecycleController({
      respond: async (args) => {
        responses.push(args);
      },
      remove: (serverId, requestId) => removed.push(`${serverId}:${requestId}`),
    });

    lifecycle.schedule({
      serverId: "server-1",
      requestId: 4,
      method: "item/commandExecution/requestApproval",
    });
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(responses).toEqual([
      {
        serverId: "server-1",
        id: 4,
        method: "item/commandExecution/requestApproval",
        result: { decision: "decline" },
      },
    ]);
    expect(removed).toEqual(["server-1:4"]);
    lifecycle.dispose();
  });

  it("clears duplicate and server-exit timers", async () => {
    vi.useFakeTimers();
    const responses: unknown[] = [];
    const removed: string[] = [];
    const lifecycle = createApprovalLifecycleController({
      respond: async (args) => responses.push(args),
      remove: (serverId, requestId) => removed.push(`${serverId}:${requestId}`),
    });

    lifecycle.schedule({ serverId: "server-1", requestId: 1, method: "item/fileChange/requestApproval" });
    lifecycle.schedule({ serverId: "server-1", requestId: 1, method: "item/fileChange/requestApproval" });
    lifecycle.schedule({ serverId: "server-1", requestId: 2, method: "item/permissions/requestApproval" });
    lifecycle.clearServer("server-1");
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(responses).toEqual([
      {
        serverId: "server-1",
        id: 1,
        method: "item/fileChange/requestApproval",
        result: { decision: "decline" },
      },
      {
        serverId: "server-1",
        id: 2,
        method: "item/permissions/requestApproval",
        error: { code: 4001, message: "permissions request timed out" },
      },
    ]);
    expect(removed).toEqual(["server-1:1", "server-1:2"]);
    lifecycle.dispose();
  });

  it("uses an error response for permissions timeouts", async () => {
    vi.useFakeTimers();
    const responses: unknown[] = [];
    const lifecycle = createApprovalLifecycleController({
      respond: async (args) => responses.push(args),
      remove: () => undefined,
    });

    lifecycle.schedule({ serverId: "server-2", requestId: "p-1", method: "item/permissions/requestApproval" });
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(responses[0]).toEqual({
      serverId: "server-2",
      id: "p-1",
      method: "item/permissions/requestApproval",
      error: { code: 4001, message: "permissions request timed out" },
    });
    lifecycle.dispose();
  });

  it("does not extend the deadline when a duplicate request arrives", async () => {
    vi.useFakeTimers();
    const responses: unknown[] = [];
    const lifecycle = createApprovalLifecycleController({
      respond: async (args) => responses.push(args),
      remove: () => undefined,
    });

    lifecycle.schedule({ serverId: "server-3", requestId: 1, method: "item/commandExecution/requestApproval" });
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    lifecycle.schedule({ serverId: "server-3", requestId: 1, method: "item/commandExecution/requestApproval" });
    expect(responses).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(responses).toHaveLength(1);
    lifecycle.dispose();
  });
});
