<template>
  <Teleport to=".main">
    <Transition name="usage-stats-drawer">
      <div v-if="open" class="usage-stats-overlay">
        <section
          class="usage-stats-panel"
          role="dialog"
          :aria-label="t('usageStats.aria')"
          :aria-busy="loading ? 'true' : 'false'"
        >
          <header class="usage-stats-head">
            <div class="usage-stats-head-title">
              <BarChart3 class="usage-stats-head-icon" aria-hidden="true" />
              <div class="usage-stats-title">{{ t("usageStats.title") }}</div>
            </div>
            <div class="usage-stats-head-actions">
              <div class="usage-stats-quick-ranges">
                <button
                  class="usage-stats-quick-btn"
                  :class="{ 'is-active': activeQuickRange === 7 }"
                  type="button"
                  @click="applyQuickRange(7)"
                >
                  {{ t("usageStats.last7Days") }}
                </button>
                <button
                  class="usage-stats-quick-btn"
                  :class="{ 'is-active': activeQuickRange === 30 }"
                  type="button"
                  @click="applyQuickRange(30)"
                >
                  {{ t("usageStats.last30Days") }}
                </button>
              </div>
              <button
                class="usage-stats-icon-btn"
                type="button"
                :disabled="loading"
                :aria-label="t('common.refresh')"
                :title="t('common.refresh')"
                @click="refresh"
              >
                <RefreshCw :class="{ spin: loading }" aria-hidden="true" />
              </button>
              <button
                ref="closeButtonRef"
                class="usage-stats-icon-btn"
                type="button"
                :aria-label="t('common.close')"
                :title="t('common.close')"
                @click="closeDrawer"
              >
                <X aria-hidden="true" />
              </button>
            </div>
          </header>

          <div class="usage-stats-body app-scrollbar">
            <div v-if="loading && !stats" class="usage-stats-state" aria-live="polite">
              <LoaderCircle class="usage-stats-state-icon spin" aria-hidden="true" />
              <span>{{ t("usageStats.loading") }}</span>
            </div>

            <div v-else-if="loadError && !stats" class="usage-stats-state is-error" role="alert">
              <span>{{ loadError }}</span>
              <button class="usage-stats-apply-btn" type="button" @click="refresh">{{ t("common.retry") }}</button>
            </div>

            <template v-else-if="stats">
              <div v-if="loadError" class="usage-stats-inline-error" role="alert">{{ loadError }}</div>

              <section class="usage-stats-summary" :aria-label="t('usageStats.summaryAria')">
                <article class="usage-stats-metric is-primary">
                  <span class="usage-stats-metric-label">{{ t("usageStats.totalTokens") }}</span>
                  <strong class="usage-stats-metric-value mono">{{ formatCount(stats.summary.totalTokens) }}</strong>
                  <span class="usage-stats-metric-note">{{ t("usageStats.tokens") }}</span>
                </article>
                <article class="usage-stats-metric">
                  <span class="usage-stats-metric-label">{{ t("usageStats.inputTokens") }}</span>
                  <strong class="usage-stats-metric-value mono">{{ formatCount(stats.summary.inputTokens) }}</strong>
                </article>
                <article class="usage-stats-metric">
                  <span class="usage-stats-metric-label">{{ t("usageStats.outputTokens") }}</span>
                  <strong class="usage-stats-metric-value mono">{{ formatCount(stats.summary.outputTokens) }}</strong>
                </article>
                <article class="usage-stats-metric">
                  <span class="usage-stats-metric-label">{{ t("usageStats.requestCount") }}</span>
                  <strong class="usage-stats-metric-value mono">{{ formatCount(stats.summary.requestCount) }}</strong>
                  <span class="usage-stats-metric-note">{{ t("usageStats.modelCalls") }}</span>
                </article>
              </section>

              <div v-if="stats.summary.requestCount <= 0" class="usage-stats-state">
                <span>{{ t("usageStats.empty") }}</span>
              </div>

              <template v-else>
                <section class="usage-stats-section">
                  <header class="usage-stats-section-head">
                    <h3>{{ t("usageStats.dailyTitle") }}</h3>
                  </header>
                  <div class="usage-stats-table-wrap app-scrollbar">
                    <table class="usage-stats-table">
                      <thead>
                        <tr>
                          <th>{{ t("usageStats.date") }}</th>
                          <th class="is-numeric">{{ t("usageStats.requests") }}</th>
                          <th class="is-numeric">{{ t("usageStats.total") }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="row in stats.daily" :key="row.date">
                          <td class="mono">{{ row.date }}</td>
                          <td class="is-numeric mono">{{ formatCount(row.requestCount) }}</td>
                          <td class="is-numeric">
                            <div class="usage-stats-total-cell">
                              <span
                                class="usage-stats-total-bar"
                                :style="{ width: dailyBarWidth(row.totalTokens) }"
                                aria-hidden="true"
                              ></span>
                              <span class="mono">{{ formatCount(row.totalTokens) }}</span>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>

                <section class="usage-stats-section">
                  <header class="usage-stats-section-head">
                    <h3>{{ t("usageStats.modelTitle") }}</h3>
                  </header>
                  <div class="usage-stats-table-wrap app-scrollbar">
                    <table class="usage-stats-table">
                      <thead>
                        <tr>
                          <th>{{ t("usageStats.model") }}</th>
                          <th class="is-numeric">{{ t("usageStats.requests") }}</th>
                          <th class="is-numeric">{{ t("usageStats.total") }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="row in stats.models" :key="row.model">
                          <td class="usage-stats-model-cell mono" :title="row.model">
                            {{ displayModel(row.model) }}
                          </td>
                          <td class="is-numeric mono">{{ formatCount(row.requestCount) }}</td>
                          <td class="is-numeric mono">{{ formatCount(row.totalTokens) }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>
              </template>
            </template>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { BarChart3, LoaderCircle, RefreshCw, X } from "lucide-vue-next";
import type { TokenUsageStatsResult } from "@codenexus/shared/ipc/contracts";
import { codexDesktop } from "../../../api/codexDesktopClient";
import { useAppShellStore } from "../../../stores/appShell.store";

const appShellStore = useAppShellStore();
const { t } = useI18n();

const open = computed(() => appShellStore.usageStatsOpen);
const closeButtonRef = ref<HTMLButtonElement | null>(null);
const stats = ref<TokenUsageStatsResult | null>(null);
const loading = ref(false);
const loadError = ref("");
let requestId = 0;

function toYmd(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysYmd(ymd: string, days: number): string {
  const match = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return ymd;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setDate(date.getDate() + days);
  return toYmd(date);
}

const todayYmd = toYmd(new Date());
const initialEndDate = todayYmd;
const initialStartDate = addDaysYmd(todayYmd, -6);
const appliedStartDate = ref(initialStartDate);
const appliedEndDate = ref(initialEndDate);

const activeQuickRange = computed(() => {
  if (appliedStartDate.value === addDaysYmd(todayYmd, -6) && appliedEndDate.value === todayYmd) return 7;
  if (appliedStartDate.value === addDaysYmd(todayYmd, -29) && appliedEndDate.value === todayYmd) return 30;
  return 0;
});

const numberFormatter = computed(() => new Intl.NumberFormat(appShellStore.language, { maximumFractionDigits: 0 }));

function formatCount(value: number): string {
  return numberFormatter.value.format(Math.max(0, Math.round(Number(value) || 0)));
}

function displayModel(model: string): string {
  return model === "unknown" ? t("usageStats.unknownModel") : model;
}

const maxDailyTotal = computed(() =>
  Math.max(0, ...(stats.value?.daily ?? []).map((row) => Number(row.totalTokens) || 0))
);

function dailyBarWidth(totalTokens: number): string {
  if (maxDailyTotal.value <= 0) return "0%";
  return `${Math.max(0, Math.min(100, (Number(totalTokens) / maxDailyTotal.value) * 100))}%`;
}

async function loadStats(startDate = appliedStartDate.value, endDate = appliedEndDate.value): Promise<void> {
  appliedStartDate.value = startDate;
  appliedEndDate.value = endDate;
  const currentRequestId = ++requestId;
  loading.value = true;
  loadError.value = "";
  try {
    const next = await codexDesktop.usage.getTokenStats({
      startDate: appliedStartDate.value,
      endDate: appliedEndDate.value,
    });
    if (currentRequestId === requestId) stats.value = next;
  } catch (error: any) {
    if (currentRequestId === requestId) {
      loadError.value = String(error?.message || error || t("usageStats.loadFailed"));
    }
  } finally {
    if (currentRequestId === requestId) loading.value = false;
  }
}

function applyQuickRange(days: number): void {
  const endDate = todayYmd;
  const startDate = addDaysYmd(todayYmd, -(Math.max(1, days) - 1));
  void loadStats(startDate, endDate);
}

function refresh(): void {
  void loadStats();
}

function closeDrawer(): void {
  appShellStore.setUsageStatsOpen(false);
}

function onKeydown(event: KeyboardEvent): void {
  if (!open.value || event.key !== "Escape") return;
  event.preventDefault();
  closeDrawer();
}

watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    void nextTick(() => closeButtonRef.value?.focus());
    void loadStats();
  },
  { flush: "post" }
);

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
});
</script>

<style scoped>
.usage-stats-overlay {
  position: absolute;
  left: calc(var(--left-sidebar-w, 0px) + 12px);
  bottom: 12px;
  z-index: 1220;
  width: min(440px, 48vw, calc(100vw - var(--left-sidebar-w, 0px) - 24px));
  pointer-events: none;
}

.usage-stats-panel {
  position: relative;
  pointer-events: auto;
  width: 100%;
  max-height: min(64vh, 520px);
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border) 68%, transparent);
  border-radius: 8px;
  background: var(--surface-elevated, var(--surface-1));
  box-shadow:
    0 18px 48px rgb(from var(--ui-shadow-source) r g b / 0.34),
    inset 0 1px 0 color-mix(in srgb, white 5%, transparent);
  backdrop-filter: var(--frost-soft);
}

.usage-stats-head {
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 8px;
  padding: 7px 9px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 42%, transparent);
  background: color-mix(in srgb, var(--surface-2) 48%, transparent);
}

.usage-stats-head-title {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.usage-stats-head-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  color: var(--accent);
}

.usage-stats-title {
  overflow: hidden;
  color: var(--text);
  font-size: 12px;
  font-weight: 720;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.usage-stats-head-actions {
  display: flex;
  align-items: center;
  gap: 5px;
}

.usage-stats-body {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 9px;
  overflow-y: auto;
  padding: 9px;
}

.usage-stats-quick-ranges {
  display: flex;
  align-items: center;
  gap: 4px;
}

.usage-stats-quick-btn,
.usage-stats-icon-btn {
  border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
  background: color-mix(in srgb, var(--button-bg, var(--surface-1)) 88%, transparent);
  color: var(--text-muted);
  cursor: pointer;
}

.usage-stats-quick-btn {
  height: 24px;
  padding: 0 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 650;
}

.usage-stats-quick-btn:hover:not(:disabled),
.usage-stats-icon-btn:hover:not(:disabled) {
  border-color: var(--border-accent-hover, var(--border-accent));
  background: var(--button-bg-hover, var(--surface-2));
  color: var(--text);
}

.usage-stats-quick-btn.is-active {
  border-color: var(--border-accent);
  background: var(--bg-accent-soft);
  color: var(--accent);
}

.usage-stats-icon-btn {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: 4px;
}

.usage-stats-icon-btn svg {
  width: 13px;
  height: 13px;
}

.usage-stats-icon-btn:disabled {
  cursor: default;
  opacity: 0.48;
}

.usage-stats-inline-error {
  padding: 6px 8px;
  border: 1px solid color-mix(in srgb, var(--danger) 42%, var(--border));
  border-radius: 4px;
  background: var(--bg-danger-soft);
  color: var(--danger);
  font-size: 10px;
  line-height: 1.4;
}

.usage-stats-state {
  min-height: 96px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  border: 1px dashed color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 5px;
  color: var(--text-muted);
  font-size: 11px;
  text-align: center;
}

.usage-stats-state.is-error {
  border-style: solid;
  border-color: color-mix(in srgb, var(--danger) 28%, var(--border));
  color: var(--danger);
}

.usage-stats-state-icon {
  width: 18px;
  height: 18px;
  color: var(--accent);
}

.usage-stats-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.usage-stats-metric {
  min-width: 0;
  min-height: 60px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  padding: 7px 8px;
  border: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  border-radius: 5px;
  background: color-mix(in srgb, var(--surface-2) 34%, transparent);
}

.usage-stats-metric.is-primary {
  border-color: color-mix(in srgb, var(--accent) 36%, var(--border));
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 11%, transparent), transparent 70%),
    color-mix(in srgb, var(--surface-2) 38%, transparent);
}

.usage-stats-metric-label {
  overflow: hidden;
  color: var(--text-muted);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.usage-stats-metric-value {
  overflow: hidden;
  color: var(--text);
  font-size: 16px;
  font-weight: 750;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.usage-stats-metric.is-primary .usage-stats-metric-value {
  color: var(--accent);
  font-size: 18px;
}

.usage-stats-section {
  min-width: 0;
  display: grid;
  gap: 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  border-radius: 5px;
  background: color-mix(in srgb, var(--surface-2) 20%, transparent);
}

.usage-stats-section-head {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 44%, transparent);
}

.usage-stats-section-head h3 {
  margin: 0;
  color: var(--text);
  font-size: 11px;
  font-weight: 720;
}

.usage-stats-table-wrap {
  min-width: 0;
  overflow-x: auto;
}

.usage-stats-table {
  width: 100%;
  min-width: 0;
  border-collapse: collapse;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.usage-stats-table th,
.usage-stats-table td {
  padding: 5px 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 32%, transparent);
  text-align: left;
  white-space: nowrap;
}

.usage-stats-table th {
  color: var(--text-muted);
  font-size: 8px;
  font-weight: 650;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.usage-stats-table tbody tr:last-child td {
  border-bottom: 0;
}

.usage-stats-table tbody tr:hover {
  background: color-mix(in srgb, var(--accent) 5%, transparent);
}

.usage-stats-table .is-numeric {
  text-align: right;
}

.usage-stats-total-cell {
  position: relative;
  min-width: 68px;
  display: flex;
  justify-content: flex-end;
  padding: 2px 4px;
  overflow: hidden;
  border-radius: 3px;
}

.usage-stats-total-cell > span:last-child {
  position: relative;
  z-index: 1;
}

.usage-stats-total-bar {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 3px;
  background: color-mix(in srgb, var(--accent) 17%, transparent);
}

.usage-stats-model-cell {
  max-width: 180px;
  overflow: hidden;
  color: var(--text);
  text-overflow: ellipsis;
}

.usage-stats-drawer-enter-active,
.usage-stats-drawer-leave-active {
  transition: opacity 220ms ease;
}

.usage-stats-drawer-enter-active .usage-stats-panel,
.usage-stats-drawer-leave-active .usage-stats-panel {
  transition:
    transform 260ms cubic-bezier(0.16, 1, 0.3, 1),
    opacity 180ms ease;
}

.usage-stats-drawer-enter-from,
.usage-stats-drawer-leave-to {
  opacity: 0;
}

.usage-stats-drawer-enter-from .usage-stats-panel,
.usage-stats-drawer-leave-to .usage-stats-panel {
  opacity: 0;
  transform: translateY(10px) scale(0.985);
}

@media (max-width: 560px) {
  .usage-stats-overlay {
    left: 8px;
    bottom: 8px;
    width: calc(100vw - 16px);
  }

  .usage-stats-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
