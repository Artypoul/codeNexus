import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThreadMetadataRuntime, type ThreadMetadataRuntimeDeps } from "./threadMetadataRuntime";

const { rpc, merge } = vi.hoisted(() => ({ rpc: vi.fn(), merge: vi.fn() }));
vi.mock("../../api/codexDesktopClient", () => ({
  codexDesktop: { codexServer: { rpc }, history: { mergeThreadMetadata: merge } },
}));
vi.mock("../../features/history/threadMetadata", () => ({
  ALL_THREAD_SOURCE_KINDS: [],
  normalizeOptionalText: (value: unknown) => String(value ?? ""),
  buildHistoryThreadMetadataPatchFromServerThread: (thread: { id: string }) => ({ id: thread.id }),
  resolveThreadParentIdForGraph: () => "",
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  rpc.mockReset().mockImplementation(async ({ params }: { params: { cwd: string; archived: boolean } }) => ({
    result: { data: params.archived ? [] : [{ id: params.cwd }], nextCursor: null },
  }));
  merge.mockReset().mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());
function setup() {
  const servers = new Map([
    ["A", "server-A"],
    ["B", "server-B"],
  ]);
  const deps: ThreadMetadataRuntimeDeps = {
    appTimelineId: "app",
    threadStore: {} as ThreadMetadataRuntimeDeps["threadStore"],
    threadMetadataHydrationPromiseByWorkspace: new Map(),
    handoffDiagnosticsPromiseByThread: new Map(),
    threadMetadataPageSize: 100,
    normalizeWorkspacePath: (value) => value,
    getServerIdForWorkspace: (value) => servers.get(value) ?? "",
    findThreadListItem: () => undefined,
    requestThreadRead: vi.fn(),
  };
  return { runtime: createThreadMetadataRuntime(deps), servers };
}

describe("workspace metadata hydration", () => {
  it("reuses completed hydration across A → B → A, with TTL and server invalidation", async () => {
    const { runtime, servers } = setup();
    await runtime.hydrateThreadMetadataForWorkspace("A");
    await runtime.hydrateThreadMetadataForWorkspace("B");
    await runtime.hydrateThreadMetadataForWorkspace("A");
    expect(rpc).toHaveBeenCalledTimes(4);
    expect(merge).toHaveBeenCalledTimes(2);
    servers.set("A", "new-server-A");
    await runtime.hydrateThreadMetadataForWorkspace("A");
    expect(rpc).toHaveBeenCalledTimes(6);
    vi.setSystemTime(1_061_000);
    await runtime.hydrateThreadMetadataForWorkspace("A");
    expect(rpc).toHaveBeenCalledTimes(8);
  });

  it("coalesces in-flight hydration and does not merge results from a replaced server", async () => {
    let resolve!: (value: unknown) => void;
    rpc.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    const { runtime, servers } = setup();
    const a = runtime.hydrateThreadMetadataForWorkspace("A");
    const duplicate = runtime.hydrateThreadMetadataForWorkspace("A");
    expect(rpc).toHaveBeenCalledTimes(1);
    servers.set("A", "replacement");
    resolve({ result: { data: [{ id: "stale" }], nextCursor: "next-page" } });
    await Promise.all([a, duplicate]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(merge).not.toHaveBeenCalled();
    await runtime.hydrateThreadMetadataForWorkspace("A");
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});
