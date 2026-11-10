import { afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm, writeFile } from "node:fs/promises";
import { GigmaAuthClient, resolveGigmaTokenFile } from "./GigmaAuthClient";

afterEach(() => vi.unstubAllGlobals());

const response = (data: unknown, code = 0) =>
  new Response(JSON.stringify({ code, data, msg: code === 0 ? "" : "denied" }), { status: code === 0 ? 200 : 403 });

describe("GigmaAuthClient", () => {
  it("uses the default Kimi home token when no override is configured", async () => {
    expect(resolveGigmaTokenFile(undefined, "C:\\Users\\Art\\.kimi-code")).toBe(
      "C:\\Users\\Art\\.kimi-code\\server.token"
    );
  });

  it("reads status without exposing credentials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        response({ provider: "gigma-account", configured: true, logged_in: true, login_method: "desktop_callback" })
      );
    vi.stubGlobal("fetch", fetchMock);

    const status = await new GigmaAuthClient(
      "http://127.0.0.1:58627",
      join(tmpdir(), `codenexus-missing-gigma-token-${Date.now()}`)
    ).status();
    expect(status).toEqual({
      provider: "gigma-account",
      configured: true,
      loggedIn: true,
      loginMethod: "desktop_callback",
      available: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:58627/api/v1/oauth/status?provider=gigma-account",
      expect.objectContaining({ method: "GET" })
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("Bearer");
  });

  it("fails closed when the local auth service is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(new GigmaAuthClient("http://127.0.0.1:58627").startLogin()).rejects.toThrow("offline");
    await expect(new GigmaAuthClient("http://127.0.0.1:58627").status()).resolves.toMatchObject({
      available: false,
      loggedIn: false,
    });
  });

  it("rejects non-loopback auth origins", () => {
    expect(() => new GigmaAuthClient("https://api.auth.gigma.ru")).toThrow("loopback");
  });

  it("reads the local daemon bearer only in main-process request headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response({ provider: "gigma-account", configured: false, logged_in: false }));
    vi.stubGlobal("fetch", fetchMock);
    const tokenFile = join(tmpdir(), `codenexus-gigma-token-${Date.now()}`);
    await writeFile(tokenFile, "test-token\n", "utf8");
    const client = new GigmaAuthClient("http://127.0.0.1:58627", tokenFile);
    await client.status();
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({ authorization: expect.stringMatching(/^Bearer /) })
    );
    await rm(tokenFile, { force: true });
  });
});
