import { describe, expect, it, vi } from "vitest";
import { GigmaAppServerService } from "./GigmaAppServerService";

describe("GigmaAppServerService", () => {
  it("does not start a Codex process before Gigma authentication", async () => {
    const codex = {
      start: vi.fn(),
      stop: vi.fn(),
      stopAll: vi.fn(),
      request: vi.fn(),
      notify: vi.fn(),
      respond: vi.fn(),
    };
    const auth = { status: vi.fn().mockResolvedValue({ available: true, loggedIn: false }) };
    const service = new GigmaAppServerService(codex as never, auth as never);

    await expect(service.start({ cwd: "D:\\workspace", onMessage: vi.fn() })).rejects.toThrow(
      "authentication is required"
    );
    expect(codex.start).not.toHaveBeenCalled();
  });

  it("starts one owned Codex process after Gigma authentication", async () => {
    const codex = {
      start: vi.fn().mockResolvedValue({ serverId: "server-1", capabilities: { experimentalApi: true } }),
      stop: vi.fn(),
      stopAll: vi.fn(),
      request: vi.fn(),
      notify: vi.fn(),
      respond: vi.fn(),
    };
    const auth = { status: vi.fn().mockResolvedValue({ available: true, loggedIn: true }) };
    const service = new GigmaAppServerService(codex as never, auth as never);

    await expect(service.start({ cwd: "D:\\workspace", onMessage: vi.fn() })).resolves.toMatchObject({
      serverId: "server-1",
    });
    expect(codex.start).toHaveBeenCalledTimes(1);
  });
});
