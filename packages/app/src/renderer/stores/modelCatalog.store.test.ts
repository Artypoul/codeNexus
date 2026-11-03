import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useModelCatalogStore } from "./modelCatalog.store";

const { rpc, runtime } = vi.hoisted(() => ({ rpc: vi.fn(), runtime: { serverId: "A" } }));
vi.mock("../api/codexDesktopClient", () => ({ codexDesktop: { codexServer: { rpc } } }));
vi.mock("./runtime.store", () => ({ useRuntimeStore: () => runtime }));
vi.mock("./configRequirements.store", () => ({ useConfigRequirementsStore: () => ({ requirements: null }) }));
const page = (model: string) => ({ result: { data: [{ id: model, model }], nextCursor: null } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  setActivePinia(createPinia());
  rpc.mockReset();
  runtime.serverId = "A";
  rpc.mockImplementation(async ({ serverId }: { serverId: string }) => page(serverId));
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe("model catalogs across workspaces", () => {
  it("restores A after A → B → A without requesting it again, and refreshes expired entries", async () => {
    const store = useModelCatalogStore();
    await store.ensureModels({ serverId: "A" });
    await store.ensureModels({ serverId: "B" });
    await store.ensureModels({ serverId: "A" });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(store.loadedServerId).toBe("A");
    expect(store.models[0].model).toBe("A");
    vi.setSystemTime(1_300_001);
    await store.ensureModels({ serverId: "A" });
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it("shares pending requests across A → B → A and ignores late results from B", async () => {
    const a = deferred<ReturnType<typeof page>>();
    const b = deferred<ReturnType<typeof page>>();
    rpc.mockImplementation(({ serverId }: { serverId: string }) => (serverId === "A" ? a.promise : b.promise));
    const store = useModelCatalogStore();
    const firstA = store.ensureModels({ serverId: "A" });
    const firstB = store.ensureModels({ serverId: "B" });
    const secondA = store.ensureModels({ serverId: "A" });
    expect(rpc).toHaveBeenCalledTimes(2);
    a.resolve(page("A"));
    await Promise.all([firstA, secondA]);
    b.resolve(page("B"));
    await firstB;
    expect(store.loadedServerId).toBe("A");
    expect(store.loadState).toBe("ready");
    await store.ensureModels({ serverId: "B" });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(store.loadedServerId).toBe("B");
  });

  it("bounds catalogs and prevents cleared requests from repopulating the cache", async () => {
    const store = useModelCatalogStore();
    for (const serverId of ["A", "B", "C", "D", "E", "F", "G"]) await store.ensureModels({ serverId });
    expect(store.cacheStats.items).toBe(6);
    await store.ensureModels({ serverId: "A" });
    expect(rpc).toHaveBeenCalledTimes(8);
    const pending = deferred<ReturnType<typeof page>>();
    rpc.mockReturnValueOnce(pending.promise);
    const task = store.ensureModels({ serverId: "H" });
    store.clearCache();
    pending.resolve(page("H"));
    await task;
    expect(store.models).toEqual([]);
    expect(store.cacheStats.items).toBe(0);
    await store.ensureModels({ serverId: "H" });
    expect(rpc).toHaveBeenCalledTimes(10);
  });

  it("does not show A models while an uncached B catalog is loading", async () => {
    const store = useModelCatalogStore();
    await store.ensureModels({ serverId: "A" });
    const b = deferred<ReturnType<typeof page>>();
    rpc.mockReturnValueOnce(b.promise);
    const task = store.ensureModels({ serverId: "B" });
    expect(store.models).toEqual([]);
    expect(store.loadState).toBe("loading");
    b.resolve(page("B"));
    await task;
    expect(store.models[0].model).toBe("B");
  });
});
