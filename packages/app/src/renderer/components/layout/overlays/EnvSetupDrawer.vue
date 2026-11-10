<template>
  <Teleport to="body" :disabled="isSettings">
    <Transition name="global-config-drawer">
      <div
        v-if="open"
        class="global-config-drawer-overlay"
        :class="{ 'is-settings': isSettings }"
        role="dialog"
        aria-modal="true"
        :aria-label="t('envSetup.aria')"
        @click.self="onOverlayClick"
      >
        <div v-if="!isSettings" class="global-config-drawer-backdrop" @click="close"></div>
        <section class="global-config-drawer-panel" @click.stop>
          <header class="global-config-drawer-head">
            <div class="panel-title">{{ t("envSetup.title") }}</div>
            <div class="row global-config-head-actions">
              <button class="btn-mini" type="button" :disabled="busy" @click="onRefreshDiagnostics">
                {{ t("envSetup.check") }}
              </button>
              <button v-if="!isSettings" ref="closeBtnRef" class="btn-mini" type="button" @click="close">
                {{ t("common.close") }}
              </button>
            </div>
          </header>

          <div class="global-config-drawer-body app-scrollbar" :class="{ 'is-settings': isSettings }">
            <section class="panel">
              <div class="panel-head">
                <div class="panel-title">{{ t("envSetup.results") }}</div>
                <div class="row" style="gap: 8px; align-items: center">
                  <span class="status-chip mono" :class="statusChipClass">{{ statusChipText }}</span>
                  <span v-if="busy" class="dim mono">{{ t("envSetup.processingLong") }}</span>
                </div>
              </div>

              <div class="env-path-config">
                <label class="env-path-label" for="codex-executable-path">
                  <span class="context-label dim">{{ t("envSetup.codexPath") }}</span>
                  <span class="dim">{{ t("envSetup.codexPathHint") }}</span>
                </label>
                <div class="env-path-row">
                  <input
                    id="codex-executable-path"
                    v-model="pathInput"
                    class="context-input mono"
                    type="text"
                    autocomplete="off"
                    :placeholder="t('envSetup.codexPathPlaceholder')"
                    :disabled="busy"
                  />
                  <button class="btn-mini" type="button" :disabled="busy" @click="onSavePath">
                    {{ t("envSetup.savePath") }}
                  </button>
                </div>
              </div>

              <div class="env-diag-grid">
                <div class="env-diag-item" :class="diagItemClass(diag?.codex?.ok)">
                  <div class="env-diag-key mono">codex</div>
                  <div class="env-diag-val mono">{{ diagText(diag?.codex) }}</div>
                </div>
                <div class="env-diag-item" :class="diagItemClass(diag?.node?.ok)">
                  <div class="env-diag-key mono">node</div>
                  <div class="env-diag-val mono">{{ diagText(diag?.node) }}</div>
                </div>
                <div class="env-diag-item" :class="diagItemClass(diag?.npm?.ok)">
                  <div class="env-diag-key mono">npm</div>
                  <div class="env-diag-val mono">{{ diagText(diag?.npm) }}</div>
                </div>
                <div class="env-diag-item" :class="diagItemClass(loginStatusOk)">
                  <div class="env-diag-key mono">{{ t("envSetup.loginStatus") }}</div>
                  <div class="env-diag-val mono">{{ loginStatusText }}</div>
                </div>
                <div class="env-diag-item" :class="diagItemClass(Boolean(viewModel.resolvedPath))">
                  <div class="env-diag-key mono">{{ t("envSetup.resolvedPath") }}</div>
                  <div class="env-diag-val mono">{{ viewModel.resolvedPath || t("envSetup.unknown") }}</div>
                </div>
              </div>

              <div v-if="showLoginGuide" class="env-guide">
                <div class="env-guide-title mono">{{ t("envSetup.loginGuideTitle") }}</div>
                <div class="env-guide-body">
                  <div class="env-guide-text dim">{{ t("envSetup.loginGuideText") }}</div>
                  <pre class="env-guide-cmd mono">codex login</pre>
                </div>
              </div>

              <div v-if="showManualGuide" class="env-guide">
                <div class="env-guide-title mono">{{ t("envSetup.manualGuideTitle") }}</div>
                <div class="env-guide-body">
                  <div class="env-guide-text dim">
                    <span v-if="missingNodeOrNpm">{{ t("envSetup.missingNodeOrNpm") }}</span>
                    <span v-else>{{ t("envSetup.missingCodex") }}</span>
                  </div>
                  <pre class="env-guide-cmd mono">npm i -g @openai/codex</pre>
                  <div class="env-guide-text dim">{{ t("envSetup.afterInstallHint") }}</div>
                  <pre class="env-guide-cmd mono">
node -v
npm -v
codex --version</pre
                  >
                </div>
              </div>

              <div class="env-runtime-hint">
                <div class="env-runtime-hint-title mono">{{ t("envSetup.hintTitle") }}</div>
                <div class="env-runtime-hint-text dim">
                  {{ t("envSetup.runtimeHint") }}
                </div>
                <pre class="env-guide-cmd mono">codex --version</pre>
              </div>

              <div v-if="lastResultText" class="env-last-result mono" :class="lastResultClass">
                {{ lastResultText }}
              </div>
              <div class="env-debug-hint mono dim">{{ t("envSetup.debugHint") }}</div>
            </section>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useAppShellStore } from "../../../stores/appShell.store";
import { codexDesktop } from "../../../api/codexDesktopClient";
import { getCachedUserLocalSettings, patchUserLocalSettings } from "../../../domain/localSettings";
import type { CodexDiagnosticsResult } from "@codenexus/shared/ipc/contracts";
import { buildEnvDiagnosticsViewModel } from "../../../domain/envDiagnostics";

type DiagItem = { ok: boolean; details?: string };

const appShellStore = useAppShellStore();
const { t } = useI18n();
const props = defineProps<{ mode?: "drawer" | "settings" }>();
const isSettings = computed(() => props.mode === "settings");
const open = computed(() => (isSettings.value ? true : appShellStore.envSetupDrawerOpen));

const busy = ref(false);
const diag = ref<CodexDiagnosticsResult | null>(null);
const settings = ref(getCachedUserLocalSettings().settings);
const pathInput = ref(settings.value.codex.executablePath ?? "");
const lastResultText = ref("");
const lastResultKind = ref<"info" | "warn" | "error">("info");

const closeBtnRef = ref<HTMLButtonElement | null>(null);

const viewModel = computed(() =>
  diag.value
    ? buildEnvDiagnosticsViewModel(diag.value, settings.value)
    : {
        pathInput: pathInput.value,
        resolvedPath: null,
        loginStatus: "unknown" as const,
        status: "unknown" as const,
        canStart: false,
      }
);

function close() {
  if (isSettings.value) return;
  appShellStore.setEnvSetupDrawerOpen(false);
}

function onOverlayClick() {
  if (isSettings.value) return;
  close();
}

function diagText(item?: DiagItem): string {
  if (!item) return t("envSetup.unknown");
  const head = item.ok ? t("envSetup.ok") : t("envSetup.missing");
  const details = String(item.details ?? "").trim();
  return details ? `${head}\n${details}` : head;
}

function diagItemClass(ok?: boolean) {
  if (ok === true) return "is-ok";
  if (ok === false) return "is-missing";
  return "is-unknown";
}

const hasDiagnostics = computed(() => Boolean(diag.value));
const isReady = computed(() => viewModel.value.status === "ready");
const missingNodeOrNpm = computed(() => diag.value?.node?.ok === false || diag.value?.npm?.ok === false);
const showManualGuide = computed(
  () =>
    !busy.value &&
    hasDiagnostics.value &&
    (diag.value?.codex?.ok === false || diag.value?.node?.ok === false || diag.value?.npm?.ok === false)
);
const showLoginGuide = computed(
  () =>
    !busy.value &&
    hasDiagnostics.value &&
    diag.value?.codex?.ok === true &&
    viewModel.value.loginStatus === "signed_out"
);
const loginStatusOk = computed(() =>
  viewModel.value.loginStatus === "authenticated"
    ? true
    : viewModel.value.loginStatus === "signed_out"
      ? false
      : undefined
);
const loginStatusText = computed(() => {
  const details = String(diag.value?.login?.details ?? "").trim();
  if (details) return details;
  if (viewModel.value.loginStatus === "authenticated") return t("envSetup.authenticated");
  if (viewModel.value.loginStatus === "signed_out") return t("envSetup.signedOut");
  return t("envSetup.unknown");
});

const statusChipText = computed(() => {
  if (busy.value) return t("envSetup.processing");
  if (!hasDiagnostics.value) return t("envSetup.pending");
  if (viewModel.value.status === "unknown") return t("envSetup.unknown");
  return isReady.value ? t("envSetup.ready") : t("envSetup.notReady");
});

const statusChipClass = computed(() => {
  if (busy.value) return "warn";
  if (!hasDiagnostics.value) return "warn";
  if (viewModel.value.status === "unknown") return "warn";
  return isReady.value ? "success" : "error";
});

const lastResultClass = computed(() =>
  lastResultKind.value === "error" ? "is-error" : lastResultKind.value === "warn" ? "is-warn" : "is-info"
);

async function onRefreshDiagnostics() {
  busy.value = true;
  lastResultText.value = "";
  try {
    console.info("[EnvSetup] diagnostics: start");
    const res = await codexDesktop.codexServer.getDiagnostics();
    diag.value = res;
    settings.value = getCachedUserLocalSettings().settings;
    pathInput.value = settings.value.codex.executablePath ?? "";
    console.info("[EnvSetup] diagnostics:", {
      codex: res.codex.ok,
      node: res.node.ok,
      npm: res.npm.ok,
    });
  } catch (e: any) {
    const msg = e?.message ? String(e.message) : String(e);
    lastResultKind.value = "error";
    lastResultText.value = t("envSetup.checkFailed", { message: msg });
    console.error("[EnvSetup] diagnostics: error:", msg);
  } finally {
    busy.value = false;
  }
}

async function onSavePath() {
  busy.value = true;
  lastResultText.value = "";
  try {
    const saved = await patchUserLocalSettings({
      codex: { executablePath: pathInput.value.trim() || null },
    });
    settings.value = saved.settings;
    pathInput.value = settings.value.codex.executablePath ?? "";
    lastResultKind.value = "info";
    lastResultText.value = t("envSetup.pathSaved");
    await onRefreshDiagnostics();
  } catch (e: any) {
    const msg = e?.message ? String(e.message) : String(e);
    lastResultKind.value = "error";
    lastResultText.value = t("envSetup.checkFailed", { message: msg });
  } finally {
    busy.value = false;
  }
}

watch(
  () => open.value,
  (isOpen) => {
    if (!isOpen) return;
    void onRefreshDiagnostics();
    void nextTick().then(() => {
      try {
        closeBtnRef.value?.focus();
      } catch {}
    });
  },
  { immediate: true }
);
</script>

<style scoped>
.env-diag-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.env-path-config {
  margin-bottom: 10px;
  display: grid;
  gap: 8px;
}

.env-path-label {
  display: grid;
  gap: 3px;
  font-size: 12px;
}

.env-path-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.env-path-row .context-input {
  min-width: 0;
  flex: 1;
}

@media (min-width: 560px) {
  .env-diag-grid {
    grid-template-columns: 1fr 1fr;
  }
}

.env-diag-item {
  min-width: 0;
  border-radius: 12px;
  border: 1px solid var(--card-border, var(--border));
  background: color-mix(in srgb, var(--card-bg, var(--surface-1)) 84%, transparent);
  padding: 10px 10px;
  display: grid;
  gap: 6px;
}

.env-diag-item.is-ok {
  border-color: color-mix(in srgb, var(--success) 38%, var(--card-border, var(--border)));
  background: color-mix(in srgb, var(--bg-success-soft) 42%, var(--card-bg, var(--surface-1)));
}

.env-diag-item.is-missing {
  border-color: color-mix(in srgb, var(--danger) 32%, var(--card-border, var(--border)));
  background: color-mix(in srgb, var(--bg-danger-soft) 42%, var(--card-bg, var(--surface-1)));
}

.env-diag-key {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.3px;
  color: var(--text);
}

.env-diag-val {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  font-size: 12px;
  color: color-mix(in srgb, var(--text) 76%, transparent);
}

.env-guide {
  margin-top: 10px;
  padding: 10px 10px;
  border-radius: 12px;
  border: 1px solid var(--card-border, var(--border));
  background: color-mix(in srgb, var(--card-bg, var(--surface-1)) 82%, transparent);
}

.env-guide-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.2px;
  color: var(--text);
}

.env-guide-body {
  margin-top: 8px;
  display: grid;
  gap: 8px;
}

.env-guide-text {
  font-size: 12px;
  line-height: 1.4;
}

.env-guide-cmd {
  margin: 0;
  padding: 8px 9px;
  border-radius: 10px;
  border: 1px dashed var(--border);
  background: color-mix(in srgb, var(--card-bg, var(--surface-1)) 72%, transparent);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  font-size: 12px;
  color: color-mix(in srgb, var(--text) 86%, transparent);
}

.env-runtime-hint {
  margin-top: 10px;
  padding: 10px 10px;
  border-radius: 12px;
  border: 1px solid var(--card-border, var(--border));
  background: color-mix(in srgb, var(--card-bg, var(--surface-1)) 72%, transparent);
}

.env-runtime-hint-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.2px;
  color: var(--text);
}

.env-runtime-hint-text {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.4;
}

.env-last-result {
  margin-top: 10px;
  padding: 10px 10px;
  border-radius: 12px;
  border: 1px solid var(--card-border, var(--border));
  background: color-mix(in srgb, var(--card-bg, var(--surface-1)) 78%, transparent);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.env-last-result.is-error {
  border-color: color-mix(in srgb, var(--danger) 32%, var(--card-border, var(--border)));
  background: color-mix(in srgb, var(--bg-danger-soft) 42%, var(--card-bg, var(--surface-1)));
}

.env-last-result.is-warn {
  border-color: color-mix(in srgb, var(--warning) 30%, var(--card-border, var(--border)));
  background: color-mix(in srgb, var(--bg-warning-soft, var(--accent-soft)) 56%, var(--card-bg, var(--surface-1)));
}

.env-debug-hint {
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.4;
}
</style>
