import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({ handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() }));
vi.mock("electron", () => ({ protocol: electron }));
import { installT3Protocol, registerT3Scheme } from "./t3Protocol";

describe("T3 local protocol", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("serves only local assets and SPA routes with a network-free policy", async () => {
    const base = "D:/Development/CodeNexus/build-cache";
    await mkdir(base, { recursive: true });
    dir = await mkdtemp(join(base, "t3-protocol-test-"));
    await writeFile(join(dir, "index.html"), "<main>ok</main>");
    await writeFile(join(dir, "test.js"), "ok");
    registerT3Scheme();
    installT3Protocol(dir);
    expect(electron.registerSchemesAsPrivileged).toHaveBeenCalledOnce();
    const handler = electron.handle.mock.calls[0][1] as (request: Request) => Promise<Response>;
    const asset = await handler(new Request("codenexus-t3://app/test.js"));
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(asset.headers.get("content-security-policy")).toContain("connect-src 'self'");
    expect(await (await handler(new Request("codenexus-t3://app/chat"))).text()).toBe("<main>ok</main>");
    expect((await handler(new Request("codenexus-t3://elsewhere/test.js"))).status).toBe(404);
    expect((await handler(new Request("codenexus-t3://app/%2e%2e%5ctest.js"))).status).toBe(400);
    expect((await handler(new Request("codenexus-t3://app/missing.js"))).status).toBe(404);
    expect((await handler(new Request("codenexus-t3://app/test.js", { method: "POST" }))).status).toBe(404);
  });
});
