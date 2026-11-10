// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installT3Transport } from "./transport";

const originalFetch = window.fetch;
const originalSocket = window.WebSocket;

afterEach(() => {
  window.fetch = originalFetch;
  window.WebSocket = originalSocket;
});

describe("T3 v0.1.7 local transport", () => {
  it("serves the captured shell shape over HTTP and preserves Effect RPC request IDs", async () => {
    // Shape captured from GET /api/orchestration/shell on the official Windows release.
    const shell = { schemaVersion: 2, snapshotSequence: 0, projects: [], threads: [], archivedThreads: [] };
    const request = vi.fn((_request, send) => send({ _tag: "Chunk", values: [{ kind: "synchronized" }] }));
    installT3Transport({ request, interrupt: vi.fn(), environment: {}, readShell: async () => shell });

    const response = await window.fetch("http://localhost:49123/api/orchestration/shell");
    expect(await response.json()).toEqual(shell);
    await expect(window.fetch("https://example.invalid/")).rejects.toThrow("External fetch");

    const ws = new window.WebSocket("ws://localhost:49123/ws");
    await new Promise<void>((resolve) => ws.addEventListener("open", () => resolve(), { once: true }));
    const result = new Promise<unknown>((resolve) => {
      ws.addEventListener("message", (event) => resolve(JSON.parse(event.data)), { once: true });
    });
    ws.send(
      JSON.stringify({ _tag: "Request", id: 6, tag: "orchestration.subscribeShell", payload: { afterSequence: 0 } })
    );
    await expect(result).resolves.toEqual({ _tag: "Chunk", requestId: 6, values: [{ kind: "synchronized" }] });
    ws.close();
  });
});
