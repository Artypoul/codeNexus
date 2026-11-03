import { defineStore } from "pinia";
import type { Model } from "@codenexus/generated/codex-app-server/v2/Model";
import type { ModelListParams } from "@codenexus/generated/codex-app-server/v2/ModelListParams";
import { collectModelPages, resolveDefaultModel } from "@codenexus/shared/modelCatalog";
import { codexDesktop } from "../api/codexDesktopClient";
import { useConfigRequirementsStore } from "./configRequirements.store";
import { useRuntimeStore } from "./runtime.store";
import { createLruCache } from "../shared/lruCache";

type ModelCatalogLoadState = "idle" | "loading" | "ready" | "error";

type CatalogSnapshot = { models: Model[]; loadedAt: number };
function createCatalogCache() {
  return {
    snapshots: createLruCache<string, CatalogSnapshot>(6, 6_000, (snapshot) => snapshot.models.length),
    pending: new Map<string, Promise<CatalogSnapshot>>(),
    generation: 0,
  };
}
const cacheByStore = new WeakMap<object, ReturnType<typeof createCatalogCache>>();
function catalogCache(store: object) {
  let cache = cacheByStore.get(store);
  if (!cache) {
    cache = createCatalogCache();
    cacheByStore.set(store, cache);
  }
  return cache;
}

export const useModelCatalogStore = defineStore("modelCatalog", {
  state: () => ({
    loadState: "idle" as ModelCatalogLoadState,
    errorText: "",
    models: [] as Model[],
    loadingServerId: "",
    loadedServerId: "",
    loadedAt: 0,
    requestSeq: 0,
  }),
  getters: {
    visibleModels(state): Model[] {
      return state.models.filter((model) => !model.hidden);
    },
    hasModels(state): boolean {
      return state.models.some((model) => !model.hidden);
    },
    preferredModelValue(): string {
      const configRequirementsStore = useConfigRequirementsStore();
      return String(configRequirementsStore.requirements?.models?.newThread?.model ?? "").trim();
    },
    preferredModelEffort(): string {
      const configRequirementsStore = useConfigRequirementsStore();
      return String(configRequirementsStore.requirements?.models?.newThread?.modelReasoningEffort ?? "").trim();
    },
    defaultModel(state): Model | null {
      return resolveDefaultModel(state.models, this.preferredModelValue);
    },
    defaultModelValue(): string {
      return this.defaultModel?.model ?? "";
    },
    cacheStats(state): { items: number; bytes: number } {
      void state.loadedAt;
      const snapshots = catalogCache(this).snapshots.values();
      return {
        items: snapshots.reduce((count, entry) => count + entry.models.length, 0),
        bytes: JSON.stringify(snapshots.length ? snapshots : [state.models]).length,
      };
    },
  },
  actions: {
    resetCatalog() {
      this.requestSeq += 1;
      this.loadState = "idle";
      this.errorText = "";
      this.models = [];
      this.loadingServerId = "";
      this.loadedServerId = "";
      this.loadedAt = 0;
    },
    async refreshModels(options?: { serverId?: string }): Promise<boolean> {
      const runtimeStore = useRuntimeStore();
      const serverId = String(options?.serverId ?? runtimeStore.serverId ?? "").trim();
      if (!serverId) {
        this.resetCatalog();
        return false;
      }
      const cache = catalogCache(this);
      const generation = cache.generation;
      if (this.loadedServerId !== serverId) {
        const cached = cache.snapshots.get(serverId);
        this.models = cached?.models ?? [];
        this.loadedServerId = cached ? serverId : "";
        this.loadedAt = cached?.loadedAt ?? 0;
      }
      const seq = this.requestSeq + 1;
      this.requestSeq = seq;
      this.loadState = "loading";
      this.loadingServerId = serverId;
      this.errorText = "";

      let pending = cache.pending.get(serverId);
      if (!pending) {
        const task = (async () => {
          const models = await collectModelPages(async (cursor) => {
            const params: ModelListParams = {
              cursor,
              limit: 200,
              includeHidden: true,
            };
            const { result } = await codexDesktop.codexServer.rpc({
              serverId,
              method: "model/list",
              params,
            });
            const record =
              result && typeof result === "object" ? (result as { data?: unknown; nextCursor?: unknown }) : null;
            return {
              data: record?.data,
              nextCursor: record?.nextCursor,
            };
          });

          const snapshot = { models, loadedAt: Date.now() };
          if (generation === cache.generation) cache.snapshots.set(serverId, snapshot);
          return snapshot;
        })();
        pending = task.finally(() => {
          if (cache.pending.get(serverId) === pending) cache.pending.delete(serverId);
        });
        cache.pending.set(serverId, pending);
      }
      try {
        const snapshot = await pending;
        if (seq !== this.requestSeq || generation !== cache.generation) return false;
        this.models = snapshot.models;
        this.loadedServerId = serverId;
        this.loadedAt = snapshot.loadedAt;
        this.loadState = "ready";
        return true;
      } catch (error: unknown) {
        if (seq !== this.requestSeq) return false;
        this.loadState = "error";
        this.errorText = error instanceof Error ? error.message : String(error ?? "unknown error");
        return false;
      } finally {
        if (seq === this.requestSeq) this.loadingServerId = "";
      }
    },
    async ensureModels(options?: { maxAgeMs?: number; serverId?: string }): Promise<boolean> {
      const runtimeStore = useRuntimeStore();
      const serverId = String(options?.serverId ?? runtimeStore.serverId ?? "").trim();
      if (!serverId) {
        this.resetCatalog();
        return false;
      }
      const maxAgeMs = Math.max(5_000, Number(options?.maxAgeMs ?? 5 * 60_000));
      if (catalogCache(this).pending.has(serverId)) return this.refreshModels({ serverId });
      const cached = catalogCache(this).snapshots.get(serverId);
      if (cached && Date.now() - cached.loadedAt <= maxAgeMs) {
        this.requestSeq += 1;
        this.models = cached.models;
        this.loadedServerId = serverId;
        this.loadedAt = cached.loadedAt;
        this.loadingServerId = "";
        this.loadState = "ready";
        this.errorText = "";
        return false;
      }

      return await this.refreshModels({ serverId });
    },
    clearCache() {
      const cache = catalogCache(this);
      cache.generation += 1;
      cache.snapshots.clear();
      cache.pending.clear();
      this.resetCatalog();
    },
  },
});
