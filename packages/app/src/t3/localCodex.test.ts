import { describe, expect, it, vi } from "vitest";
import type { CodexDesktopApi } from "@codenexus/shared/ipc/contracts";
import { createLocalCodex } from "./localCodex";

function harness() {
  let listener: (event: any) => void = () => {};
  const unsubscribe = vi.fn();
  const start = vi.fn(async () => ({ serverId: "server-1" }));
  const stop = vi.fn(async () => ({ ok: true as const }));
  const rpc = vi.fn(async ({ method, params }: any) => {
    switch (method) {
      case "thread/list":
        return { result: { data: [{ id: "t1", cwd: "C:\\repo" }], nextCursor: null } };
      case "thread/read":
        return { result: { thread: { id: params.threadId, cwd: "C:\\repo" } } };
      case "thread/start":
        return { result: { thread: { id: "new" } } };
      case "turn/start":
        return { result: { turn: { id: "turn-1" } } };
      case "model/list":
        return { result: { data: [{ id: "model" }], nextCursor: null } };
      case "account/read":
        return { result: { account: null, requiresOpenaiAuth: true } };
      default:
        return { result: {} };
    }
  });
  const api = {
    workspace: { select: vi.fn(async () => "C:\\repo") },
    codexServer: {
      start,
      stop,
      rpc,
      onEvent: (cb: typeof listener) => {
        listener = cb;
        return unsubscribe;
      },
    },
  } as unknown as CodexDesktopApi;
  const onEvent = vi.fn();
  return {
    adapter: createLocalCodex(api, onEvent),
    start,
    stop,
    rpc,
    emit: (event: any) => listener(event),
    onEvent,
    unsubscribe,
  };
}

describe("local Codex adapter", () => {
  it("shares a workspace session, paginates and scopes history, and filters events", async () => {
    const h = harness();
    await Promise.all([h.adapter.listThreads("C:\\repo"), h.adapter.listModels("C:\\repo")]);
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith(
      expect.objectContaining({ method: "thread/list", params: expect.objectContaining({ cwd: "C:\\repo" }) })
    );
    h.emit({ serverId: "foreign", msg: { kind: "local", method: "codex/stderr", params: { text: "x" } } });
    h.emit({ serverId: "server-1", msg: { kind: "local", method: "codex/stderr", params: { text: "x" } } });
    expect(h.onEvent).toHaveBeenCalledTimes(1);
    h.adapter.dispose();
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    expect(h.stop).toHaveBeenCalledWith({ serverId: "server-1" });
  });

  it("resumes scoped threads before sending and preserves approval safeguards", async () => {
    const h = harness();
    expect(await h.adapter.send("C:\\repo", "t1", "hello", "model")).toEqual({ id: "turn-1" });
    expect(h.rpc.mock.calls.map(([arg]) => arg.method)).toEqual(["thread/read", "thread/resume", "turn/start"]);
    expect(h.rpc).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "turn/start",
        params: expect.objectContaining({
          threadId: "t1",
          input: [{ type: "text", text: "hello", text_elements: [] }],
          approvalPolicy: "on-request",
        }),
      })
    );
    await expect(h.adapter.readThread("C:\\other", "t1")).rejects.toThrow(/workspace/i);
  });

  it("stops a session whose startup finishes after disposal", async () => {
    const h = harness();
    let resolve!: (value: { serverId: string }) => void;
    h.start.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    const operation = h.adapter.account("C:\\repo");
    h.adapter.dispose();
    resolve({ serverId: "late" });
    await expect(operation).rejects.toThrow(/disposed/i);
    expect(h.stop).toHaveBeenCalledWith({ serverId: "late" });
  });
});
