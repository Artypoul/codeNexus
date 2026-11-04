<template>
  <Teleport to="body">
    <Transition name="usage-stats-drawer">
      <div v-if="open" class="usage-stats-overlay" role="presentation" @click.self="closeDrawer">
        <div class="usage-stats-backdrop" @click="closeDrawer"></div>
        <section
          class="usage-stats-panel"
          role="dialog"
          aria-modal="true"
          :aria-label="t('usageStats.aria')"
          :aria-busy="loading ? 'true' : 'false'"
        >
          <header class="usage-stats-head">
            <div class="usage-stats-head-title">
              <span class="usage-stats-head-icon" aria-hidden="true">
                <BarChart3 />
              </span>
              <div class="usage-stats-head-copy">
                <div class="usage-stats-title">{{ t("usageStats.title") }}</div>
                <div class="usage-stats-subtitle">{{ t("usageStats.subtitle") }}</div>
              </div>
            </div>
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
          </header>

          <div class="usage-stats-body app-scrollbar">
            <section class="usage-stats-filters" :aria-label="t('usageStats.dateRangeAria')">
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

              <div class="usage-stats-date-controls">
                <label class="usage-stats-date-field">
                  <span>{{ t("usageStats.startDate") }}</span>
                  <input v-model="draftStartDate" type="date" :max="todayYmd" />
                </label>
                <span class="usage-stats-date-separator" aria-hidden="true">—</span>
                <label class="usage-stats-date-field">
                  <span>{{ t("usageStats.endDate") }}</span>
                  <input v-model="draftEndDate" type="date" :max="todayYmd" />
                </label>
                <button class="usage-stats-apply-btn" type="button" :disabled="loading" @click="applyCustomRange">
                  {{ t("usageStats.query") }}
                </button>
                <button
                  class="usage-stats-icon-btn usage-stats-refresh-btn"
                  type="button"
                  :disabled="loading"
                  :aria-label="t('common.refresh')"
                  :title="t('common.refresh')"
                  @click="refresh"
                >
                  <RefreshCw :class="{ spin: loading }" aria-hidden="true" />
                </button>
              </div>

              <div class="usage-stats-filter-meta">
                <span class="mono">{{ appliedStartDate }} — {{ appliedEndDate }}</span>
                <span v-if="stats" class="mono">
                  {{ t("usageStats.updatedAt", { time: formatUpdatedAt(stats.generatedAt) }) }}
                </span>
              </div>
              <div v-if="rangeError" class="usage-stats-inline-error" role="alert">{{ rangeError }}</div>
            </section>

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
                  <span class="usage-stats-metric-label">{{ t("usageStats.cachedInputTokens") }}</span>
                  <strong class="usage-stats-metric-value mono">{{
                    formatCount(stats.summary.cachedInputTokens)
                  }}</strong>
                  <span class="usage-stats-metric-note">
                    {{ t("usageStats.cacheWriteTokens", { count: formatCount(stats.summary.cacheWriteInputTokens) }) }}
                  </span>
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
                    <div>
                      <h3>{{ t("usageStats.dailyTitle") }}</h3>
                      <p>{{ t("usageStats.dailyDesc") }}</p>
                    </div>
                    <CalendarDays class="usage-stats-section-icon" aria-hidden="true" />
                  </header>
                  <div class="usage-stats-table-wrap app-scrollbar">
                    <table class="usage-stats-table">
                      <thead>
                        <tr>
                          <th>{{ t("usageStats.date") }}</th>
                          <th class="is-numeric">{{ t("usageStats.requests") }}</th>
                          <th class="is-numeric">{{ t("usageStats.total") }}</th>
                          <th class="is-numeric">{{ t("usageStats.input") }}</th>
                          <th class="is-numeric">{{ t("usageStats.output") }}</th>
                          <th class="is-numeric">{{ t("usageStats.cacheInput") }}</th>
                          <th class="is-numeric">{{ t("usageStats.cacheWrite") }}</th>
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
                          <td class="is-numeric mono">{{ formatCount(row.inputTokens) }}</td>
                          <td class="is-numeric mono">{{ formatCount(row.outputTokens) }}</td>
                          <td class="is-numeric mono">{{ formatCount(row.cachedInputTokens) }}</td>
                          <td class="is-numeric mono">{{ formatCount(row.cacheWriteInputTokens) }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>

                <section class="usage-stats-section">
                  <header class="usage-stats-section-head">
                    <div>
                      <h3>{{ t("usageStats.modelTitle") }}</h3>
                      <p>{{ t("usageStats.modelDesc") }}</p>
                    </div>
                    <Cpu class="usage-stats-section-icon" aria-hidden="true" />
                  </header>
                  <div class="usage-stats-table-wrap app-scrollbar">
                    <table class="usage-stats-table">
                      <thead>
                        <tr>
                          <th>{{ t("usageStats.model") }}</th>
                          <th class="is-numeric">{{ t("usageStats.requests") }}</th>
                          <th class="is-numeric">{{ t("usageStats.total") }}</th>
                          <th class="is-numeric">{{ t("usageStats.input") }}</th>
                          <th class="is-numeric">{{ t("usageStats.output") }}</th>
                          <th class="is-numeric">{{ t("usageStats.cacheInput") }}</th>
                          <th class="is-numeric">{{ t("usageStats.cacheWrite") }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="row in stats.models" :key="row.model">
                          <td class="usage-stats-model-cell mono" :title="row.model">
                            {{ displayModel(row.model) }}
                          </td>
                          <td class="is-numeric mono">{{ formatCount(row.requestCount) }}</td>
                          <td class="is-numeric mono">{{ formatCount(row.totalTokens) }}</td>
                          <td class="is-numeric mono">{{ formatCount(row.inputTokens) }}</td>
                          <td class="is-numeric mono">{{ formatCount(row.outputTokens) }}</td>
                          <td class="is-numeric mono">{{ formatCount(row.cachedInputTokens) }}</td>
                          <td class="is-numeric mono">{{ formatCount(row.cacheWriteInputTokens) }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>
              </template>

              <p class="usage-stats-note">{{ t("usageStats.note") }}</p>
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
import { BarChart3, CalendarDays, Cpu, LoaderCircle, RefreshCw, X } from "lucide-vue-next";
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
const rangeError = ref("");
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

function isValidYmd(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return (
    date.getFullYear() === Number(match[1]) &&
    date.getMonth() === Number(match[2]) - 1 &&
    date.getDate() === Number(match[3])
  );
}

const todayYmd = toYmd(new Date());
const initialEndDate = todayYmd;
const initialStartDate = addDaysYmd(todayYmd, -6);
const draftStartDate = ref(initialStartDate);
const draftEndDate = ref(initialEndDate);
const appliedStartDate = ref(initialStartDate);
const appliedEndDate = ref(initialEndDate);

const activeQuickRange = computed(() => {
  if (draftStartDate.value === addDaysYmd(todayYmd, -6) && draftEndDate.value === todayYmd) return 7;
  if (draftStartDate.value === addDaysYmd(todayYmd, -29) && draftEndDate.value === todayYmd) return 30;
  return 0;
});

const numberFormatter = computed(() => new Intl.NumberFormat(appShellStore.language, { maximumFractionDigits: 0 }));

function formatCount(value: number): string {
  return numberFormatter.value.format(Math.max(0, Math.round(Number(value) || 0)));
}

function formatUpdatedAt(value: number): string {
  try {
    return new Intl.DateTimeFormat(appShellStore.language, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
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

function validateDraftRange(): boolean {
  rangeError.value = "";
  if (!isValidYmd(draftStartDate.value) || !isValidYmd(draftEndDate.value)) {
    rangeError.value = t("usageStats.invalidDate");
    return false;
  }
  if (draftStartDate.value > draftEndDate.value) {
    rangeError.value = t("usageStats.invalidRange");
    return false;
  }
  return true;
}

async function loadStats(): Promise<void> {
  if (!validateDraftRange()) return;
  appliedStartDate.value = draftStartDate.value;
  appliedEndDate.value = draftEndDate.value;
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
  draftEndDate.value = todayYmd;
  draftStartDate.value = addDaysYmd(todayYmd, -(Math.max(1, days) - 1));
  void loadStats();
}

function applyCustomRange(): void {
  void loadStats();
}

function refresh(): void {
  if (!validateDraftRange()) return;
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
    draftStartDate.value = appliedStartDate.value;
    draftEndDate.value = appliedEndDate.value;
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
  position: fixed;
  inset: calc(var(--topbar-h) + 8px) 10px calc(var(--bottombar-h) + 8px) 10px;
  z-index: 1220;
  display: flex;
  justify-content: flex-end;
}

.usage-stats-backdrop {
  position: absolute;
  inset: -100px;
  background: color-mix(in srgb, var(--surface-1) 36%, transparent);
  backdrop-filter: var(--frost-soft);
}

.usage-stats-panel {
  position: relative;
  width: min(1040px, 82vw);
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border) 52%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--surface-1) 88%, transparent);
  box-shadow:
    0 32px 90px rgb(from var(--ui-shadow-source) r g b / 0.42),
    inset 0 1px 0 color-mix(in srgb, white 5%, transparent);
  backdrop-filter: var(--frost-strong);
}

.usage-stats-head {
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 48%, transparent);
  background: color-mix(in srgb, var(--surface-2) 48%, transparent);
}

.usage-stats-head-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.usage-stats-head-icon {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border: 1px solid color-mix(in srgb, var(--accent) 34%, var(--border));
  border-radius: 6px;
  background: var(--bg-accent-soft);
  color: var(--accent);
}

.usage-stats-head-icon svg {
  width: 17px;
  height: 17px;
}

.usage-stats-head-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.usage-stats-title {
  color: var(--text);
  font-size: 16px;
  font-weight: 760;
  line-height: 1.2;
}

.usage-stats-subtitle {
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.usage-stats-body {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  padding: 12px;
}

.usage-stats-filters {
  display: grid;
  gap: 9px;
  padding: 11px;
  border: 1px solid color-mix(in srgb, var(--border) 52%, transparent);
  border-radius: 5px;
  background: color-mix(in srgb, var(--surface-2) 30%, transparent);
}

.usage-stats-quick-ranges {
  display: flex;
  align-items: center;
  gap: 6px;
}

.usage-stats-quick-btn,
.usage-stats-apply-btn,
.usage-stats-icon-btn {
  border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
  background: color-mix(in srgb, var(--button-bg, var(--surface-1)) 88%, transparent);
  color: var(--text-muted);
  cursor: pointer;
}

.usage-stats-quick-btn {
  height: 26px;
  padding: 0 10px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 650;
}

.usage-stats-quick-btn:hover:not(:disabled),
.usage-stats-apply-btn:hover:not(:disabled),
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

.usage-stats-date-controls {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.usage-stats-date-field {
  display: grid;
  gap: 4px;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.usage-stats-date-field input {
  height: 30px;
  min-width: 142px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
  border-radius: 4px;
  background: var(--control-surface, var(--surface-1));
  color: var(--text);
  font-family: inherit;
  font-size: 12px;
  color-scheme: dark;
}

:root[data-tone="light"] .usage-stats-date-field input {
  color-scheme: light;
}

.usage-stats-date-field input:focus-visible {
  outline: none;
  border-color: var(--border-accent-hover, var(--border-accent));
  box-shadow: 0 0 0 2px var(--focus-ring, var(--accent-soft));
}

.usage-stats-date-separator {
  height: 30px;
  display: inline-flex;
  align-items: center;
  color: var(--text-muted);
  font-size: 12px;
}

.usage-stats-apply-btn {
  height: 30px;
  padding: 0 13px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 680;
}

.usage-stats-icon-btn {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: 4px;
}

.usage-stats-icon-btn svg {
  width: 14px;
  height: 14px;
}

.usage-stats-icon-btn:disabled,
.usage-stats-apply-btn:disabled {
  cursor: default;
  opacity: 0.48;
}

.usage-stats-filter-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 4px 12px;
  color: color-mix(in srgb, var(--text-muted) 82%, transparent);
  font-size: 10px;
}

.usage-stats-inline-error {
  padding: 7px 9px;
  border: 1px solid color-mix(in srgb, var(--danger) 42%, var(--border));
  border-radius: 4px;
  background: var(--bg-danger-soft);
  color: var(--danger);
  font-size: 11px;
  line-height: 1.4;
}

.usage-stats-state {
  min-height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  border: 1px dashed color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 5px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

.usage-stats-state.is-error {
  border-style: solid;
  border-color: color-mix(in srgb, var(--danger) 28%, var(--border));
  color: var(--danger);
}

.usage-stats-state-icon {
  width: 22px;
  height: 22px;
  color: var(--accent);
}

.usage-stats-summary {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.usage-stats-metric {
  min-width: 0;
  min-height: 88px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  padding: 11px 12px;
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
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.usage-stats-metric-value {
  overflow: hidden;
  color: var(--text);
  font-size: clamp(18px, 2vw, 25px);
  font-weight: 750;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.usage-stats-metric.is-primary .usage-stats-metric-value {
  color: var(--accent);
}

.usage-stats-metric-note {
  overflow: hidden;
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 44%, transparent);
}

.usage-stats-section-head h3 {
  margin: 0;
  color: var(--text);
  font-size: 13px;
  font-weight: 720;
}

.usage-stats-section-head p {
  margin: 2px 0 0;
  color: var(--text-muted);
  font-size: 10px;
}

.usage-stats-section-icon {
  width: 15px;
  height: 15px;
  color: var(--text-muted);
}

.usage-stats-table-wrap {
  min-width: 0;
  overflow-x: auto;
}

.usage-stats-table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.usage-stats-table th,
.usage-stats-table td {
  padding: 8px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 32%, transparent);
  text-align: left;
  white-space: nowrap;
}

.usage-stats-table th {
  color: var(--text-muted);
  font-size: 9px;
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
  min-width: 92px;
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
  max-width: 300px;
  overflow: hidden;
  color: var(--text);
  text-overflow: ellipsis;
}

.usage-stats-note {
  margin: 0;
  color: color-mix(in srgb, var(--text-muted) 84%, transparent);
  font-size: 10px;
  line-height: 1.45;
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
  transform: translateX(28px) scale(0.985);
}

@media (max-width: 1100px) {
  .usage-stats-summary {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .usage-stats-overlay {
    inset: 8px;
  }

  .usage-stats-panel {
    width: 100%;
  }

  .usage-stats-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .usage-stats-date-field {
    flex: 1 1 140px;
  }

  .usage-stats-date-field input {
    width: 100%;
  }
}
</style>
