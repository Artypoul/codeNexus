import { defineStore } from "pinia";
import type { Model } from "@codenexus/generated/codex-app-server/v2/Model";
import type { ModelListParams } from "@codenexus/generated/codex-app-server/v2/ModelListParams";
import { collectModelPages, resolveDefaultModel } from "@codenexus/shared/modelCatalog";
import { codexDesktop } from "../api/codexDesktopClient";
import { useConfigRequirementsStore } from "./configRequirements.store";
import { useRuntimeStore } from "./runtime.store";

type ModelCatalogLoadState = "idle" | "loading" | "ready" | "error";

let activeRefresh: { serverId: string; promise: Promise<boolean> } | null = null;

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
      return {
        items: state.models.length,
        bytes: JSON.stringify(state.models).length,
      };
    },
  },
  actions: {
    resetCatalog() {
      activeRefresh = null;
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
      if (activeRefresh?.serverId === serverId) {
        return await activeRefresh.promise;
      }

      const seq = this.requestSeq + 1;
      this.requestSeq = seq;
      this.loadState = "loading";
      this.loadingServerId = serverId;
      this.errorText = "";

      let promise!: Promise<boolean>;
      promise = (async () => {
        try {
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

          if (seq !== this.requestSeq) return false;
          this.models = models;
          this.loadedServerId = serverId;
          this.loadedAt = Date.now();
          this.loadState = "ready";
          return true;
        } catch (error: unknown) {
          if (seq !== this.requestSeq) return false;
          this.loadState = "error";
          this.errorText = error instanceof Error ? error.message : String(error ?? "unknown error");
          return false;
        } finally {
          if (this.loadingServerId === serverId) this.loadingServerId = "";
          if (activeRefresh?.promise === promise) activeRefresh = null;
        }
      })();

      activeRefresh = { serverId, promise };
      return await promise;
    },
    async ensureModels(options?: { maxAgeMs?: number; serverId?: string }): Promise<boolean> {
      const runtimeStore = useRuntimeStore();
      const serverId = String(options?.serverId ?? runtimeStore.serverId ?? "").trim();
      if (!serverId) {
        this.resetCatalog();
        return false;
      }
      if (this.loadState === "loading" && this.loadingServerId === serverId && activeRefresh) {
        return await activeRefresh.promise;
      }

      const maxAgeMs = Math.max(5_000, Number(options?.maxAgeMs ?? 5 * 60_000));
      const stale = !this.loadedAt || Date.now() - this.loadedAt > maxAgeMs;
      const serverChanged = this.loadedServerId !== serverId;
      const shouldReload = serverChanged || stale || this.loadState === "idle" || this.loadState === "error";
      if (!shouldReload) return false;

      return await this.refreshModels({ serverId });
    },
    clearCache() {
      this.resetCatalog();
    },
  },
});
