<template>
  <div
    class="center-empty-state flex flex-col w-full max-w-[860px] mx-auto pt-[8vh] pb-10 px-6 max-[1500px]:max-w-[720px] max-[1500px]:pt-[6vh] animate-enter-pop"
  >
    <div v-if="loading" class="mono dim flex w-full items-center justify-center gap-3 my-12">
      <span class="running-indicator is-muted" aria-hidden="true"></span>
      <span class="text-sm">{{ t("centerEmpty.loadingMemory") }}</span>
    </div>

    <template v-else>
      <div v-if="mode === 'pendingThread'" class="center-thread-create-state" role="status" aria-live="polite">
        <span class="running-indicator is-accent center-thread-create-state__spinner" aria-hidden="true"></span>
        <div class="center-thread-create-state__copy">
          <LoadingDots
            class="center-thread-create-state__title"
            :baseText="t('centerEmpty.creatingThread')"
            as="div"
            :ariaLabel="t('centerEmpty.creatingThread')"
          />
          <div class="center-thread-create-state__meta">{{ t("centerEmpty.initializingContext") }}</div>
        </div>
      </div>

      <div
        v-else-if="historyItems.length > 0"
        class="center-empty-history w-full animate-enter-slide-up"
        style="animation-delay: 100ms"
      >
        <div class="flex items-center justify-between mb-4 px-1">
          <h2 class="text-sm max-[1500px]:text-[13px] font-bold text-[var(--text-muted)] flex items-center gap-2">
            <History class="w-4 h-4" /> {{ t("centerEmpty.history") }}
          </h2>
          <span class="text-[12px] max-[1500px]:text-[11px] text-[var(--text-muted)] opacity-60">{{
            t("centerEmpty.recentCount", { count: historyItems.length })
          }}</span>
        </div>

        <div class="grid grid-cols-2 gap-3 max-[1500px]:gap-2.5">
          <button
            v-for="(item, index) in historyItems"
            :key="item.id"
            type="button"
            :style="{ animationDelay: `${index * 40 + 150}ms` }"
            class="group flex flex-col items-start justify-center h-[72px] max-[1500px]:h-[64px] px-4 max-[1500px]:px-3 rounded-xl border border-[var(--border)] bg-[var(--surface-1)]/50 hover:bg-[var(--surface-1)] text-left transition-all duration-200 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-[color:var(--border-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/30 active:scale-[0.98] opacity-0 animate-enter-slide-up"
            @click="$emit('switch-thread', item.id)"
          >
            <span
              class="title font-medium text-[14px] max-[1500px]:text-[13px] text-[var(--text)] group-hover:text-[var(--accent)] transition-colors w-full truncate mb-1"
            >
              {{ item.title }}
            </span>
            <span
              class="text-[11px] max-[1500px]:text-[10px] text-[var(--text-muted)] font-mono opacity-70 flex items-center gap-1"
            >
              <MessageSquareText class="w-3 h-3" /> {{ t("centerEmpty.chatThread") }}
            </span>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { ThreadHistoryItem } from "../../domain/types";
import LoadingDots from "../ui/LoadingDots.vue";
import { History, MessageSquareText } from "lucide-vue-next";
import { useI18n } from "vue-i18n";

defineProps<{
  loading: boolean;
  historyItems: ThreadHistoryItem[];
  mode: "default" | "pendingThread";
}>();

defineEmits<{
  (event: "switch-thread", threadId: string): void;
}>();

const { t } = useI18n();
</script>

<style scoped>
.center-thread-create-state {
  width: min(100%, 360px);
  min-height: 64px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  margin: 10vh auto 0;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--border) 82%, var(--accent) 18%);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-2) 88%, transparent);
  box-shadow: 0 10px 30px color-mix(in srgb, var(--theme-seed-shadow-source) 14%, transparent);
  animation: center-thread-create-enter 160ms ease-out both;
}

.center-thread-create-state__spinner {
  width: 16px;
  height: 16px;
  border-width: 2px;
}

.center-thread-create-state__copy {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.center-thread-create-state__title {
  min-width: 0;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
  white-space: nowrap;
}

.center-thread-create-state__meta {
  min-width: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes center-thread-create-enter {
  from {
    opacity: 0;
    transform: translate3d(0, 4px, 0);
  }

  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}
</style>
