<template>
  <Teleport to="body" :disabled="isSettings">
    <Transition name="global-config-drawer">
      <div
        v-if="open"
        class="global-config-drawer-overlay"
        :class="{ 'is-settings': isSettings }"
        role="dialog"
        aria-modal="true"
        :aria-label="t('globalConfig.title')"
        @click.self="onOverlayClick"
      >
        <div v-if="!isSettings" class="global-config-drawer-backdrop" @click="onRequestClose"></div>
        <section class="global-config-drawer-panel" @click.stop>
          <header class="global-config-drawer-head">
            <div class="panel-title">{{ t("globalConfig.title") }}</div>
            <div class="row global-config-head-actions">
              <div class="global-config-status global-config-status--inline" :class="['is-' + globalConfigStatusKind]">
                <span class="global-config-status-text">{{ globalConfigStatusText }}</span>
                <span
                  v-if="globalConfigRefreshFxNonce > 0"
                  :key="globalConfigRefreshFxNonce"
                  class="global-config-status-refresh-fx"
                  aria-hidden="true"
                >
                  <RotateCw class="global-config-status-refresh-icon" />
                </span>
              </div>
              <button class="btn-mini" type="button" :disabled="!canResetGlobalConfig" @click="onResetGlobalConfig">
                {{ t("common.reset") }}
              </button>
              <button class="btn-mini" type="button" :disabled="!canRefreshGlobalConfig" @click="onRefreshGlobalConfig">
                {{ t("common.refresh") }}
              </button>
              <button
                v-if="!isSettings"
                ref="closeBtnRef"
                class="btn-mini"
                type="button"
                :disabled="globalConfigActionPending || configStore.saving"
                @click="onRequestClose"
              >
                {{ t("common.close") }}
              </button>
            </div>
          </header>

          <div class="global-config-drawer-body app-scrollbar" :class="{ 'is-settings': isSettings }">
            <div v-if="configStore.isDirty" class="global-config-topbar">
              <div class="global-config-dirty-badge mono">
                {{ t("globalConfig.dirtyCount", { count: globalConfigDirtyCount }) }}
              </div>
            </div>

            <section class="global-config-guide-entry global-config-local-entry">
              <div class="guide-entry-text">
                <div class="guide-entry-title">{{ t("globalConfig.typographyTitle") }}</div>
                <div class="guide-entry-desc">{{ t("globalConfig.typographyDesc") }}</div>
              </div>
              <div class="typography-controls">
                <label class="typography-row">
                  <span class="typography-label dim">{{ t("globalConfig.font") }}</span>
                  <SelectDropdown
                    id="sel-ui-font-family"
                    class="context-input mono"
                    :modelValue="typographyStore.fontFamilyPreset"
                    :options="uiFontFamilyPresetOptions"
                    @update:modelValue="onUiFontFamilyPresetChanged"
                  />
                </label>
                <label class="typography-row">
                  <span class="typography-label dim">{{ t("globalConfig.fontSize") }}</span>
                  <SelectDropdown
                    id="sel-ui-font-size"
                    class="context-input mono"
                    :modelValue="typographyStore.fontSizePreset"
                    :options="uiFontSizePresetOptions"
                    @update:modelValue="onUiFontSizePresetChanged"
                  />
                </label>
              </div>
            </section>

            <section class="global-config-guide-entry global-config-local-entry">
              <div class="guide-entry-text">
                <div class="guide-entry-title">{{ t("globalConfig.languageTitle") }}</div>
                <div class="guide-entry-desc">{{ t("globalConfig.languageDesc") }}</div>
              </div>
              <div class="typography-controls">
                <label class="typography-row">
                  <span class="typography-label dim">{{ t("common.language") }}</span>
                  <SelectDropdown
                    id="sel-ui-language"
                    class="context-input mono"
                    :modelValue="appShellStore.language"
                    :options="uiLanguageOptions"
                    @update:modelValue="onUiLanguageChanged"
                  />
                </label>
              </div>
            </section>

            <section class="global-config-guide-entry global-config-local-entry">
              <div class="guide-entry-text">
                <div class="guide-entry-title">{{ t("globalConfig.modelManagedTitle") }}</div>
                <div class="guide-entry-desc">{{ t("globalConfig.modelManagedDesc") }}</div>
              </div>
            </section>

            <div class="global-config-grid">
              <section class="global-config-section">
                <div
                  v-if="configRequirementsSummaryText"
                  class="global-config-requirements-summary"
                  :class="configRequirementsSummaryClass"
                >
                  {{ configRequirementsSummaryText }}
                </div>
                <label class="global-row" :class="{ 'is-dirty': isGlobalConfigFieldDirty('approvalPolicy') }">
                  <span class="context-label dim">{{ t("globalConfig.approvalPolicy") }}</span>
                  <div class="global-field-stack">
                    <SelectDropdown
                      id="sel-global-approval-policy"
                      :modelValue="approvalPolicySelectValue"
                      class="context-input mono"
                      :disabled="approvalPolicySelectDisabled"
                      :options="approvalPolicyOptions"
                      @update:modelValue="onApprovalPolicyChanged"
                    />
                    <div v-if="approvalPolicyHintText" class="global-model-manage-hint">
                      {{ approvalPolicyHintText }}
                    </div>
                    <div v-if="approvalPolicySelectValue === 'granular'" class="global-toggle-list">
                      <label class="global-toggle-row">
                        <div class="global-toggle-copy">
                          <span class="global-toggle-title">{{ t("globalConfig.granularSandboxApproval") }}</span>
                          <span class="global-toggle-note mono">sandbox_approval</span>
                        </div>
                        <span class="skill-switch">
                          <input
                            class="skill-switch-input"
                            type="checkbox"
                            :checked="granularApprovalPolicy.granular.sandbox_approval"
                            :disabled="globalControlsDisabled"
                            @change="onGranularApprovalFlagChanged('sandbox_approval', $event)"
                          />
                          <span class="skill-switch-track" aria-hidden="true"
                            ><span class="skill-switch-thumb"></span
                          ></span>
                        </span>
                      </label>
                      <label class="global-toggle-row">
                        <div class="global-toggle-copy">
                          <span class="global-toggle-title">{{ t("globalConfig.granularRules") }}</span>
                          <span class="global-toggle-note mono">rules</span>
                        </div>
                        <span class="skill-switch">
                          <input
                            class="skill-switch-input"
                            type="checkbox"
                            :checked="granularApprovalPolicy.granular.rules"
                            :disabled="globalControlsDisabled"
                            @change="onGranularApprovalFlagChanged('rules', $event)"
                          />
                          <span class="skill-switch-track" aria-hidden="true"
                            ><span class="skill-switch-thumb"></span
                          ></span>
                        </span>
                      </label>
                      <label class="global-toggle-row">
                        <div class="global-toggle-copy">
                          <span class="global-toggle-title">{{ t("globalConfig.granularSkillApproval") }}</span>
                          <span class="global-toggle-note mono">skill_approval</span>
                        </div>
                        <span class="skill-switch">
                          <input
                            class="skill-switch-input"
                            type="checkbox"
                            :checked="granularApprovalPolicy.granular.skill_approval"
                            :disabled="globalControlsDisabled"
                            @change="onGranularApprovalFlagChanged('skill_approval', $event)"
                          />
                          <span class="skill-switch-track" aria-hidden="true"
                            ><span class="skill-switch-thumb"></span
                          ></span>
                        </span>
                      </label>
                      <label class="global-toggle-row">
                        <div class="global-toggle-copy">
                          <span class="global-toggle-title">{{ t("globalConfig.granularRequestPermissions") }}</span>
                          <span class="global-toggle-note mono">request_permissions</span>
                        </div>
                        <span class="skill-switch">
                          <input
                            class="skill-switch-input"
                            type="checkbox"
                            :checked="granularApprovalPolicy.granular.request_permissions"
                            :disabled="globalControlsDisabled"
                            @change="onGranularApprovalFlagChanged('request_permissions', $event)"
                          />
                          <span class="skill-switch-track" aria-hidden="true"
                            ><span class="skill-switch-thumb"></span
                          ></span>
                        </span>
                      </label>
                      <label class="global-toggle-row">
                        <div class="global-toggle-copy">
                          <span class="global-toggle-title">{{ t("globalConfig.granularMcpElicitations") }}</span>
                          <span class="global-toggle-note mono">mcp_elicitations</span>
                        </div>
                        <span class="skill-switch">
                          <input
                            class="skill-switch-input"
                            type="checkbox"
                            :checked="granularApprovalPolicy.granular.mcp_elicitations"
                            :disabled="globalControlsDisabled"
                            @change="onGranularApprovalFlagChanged('mcp_elicitations', $event)"
                          />
                          <span class="skill-switch-track" aria-hidden="true"
                            ><span class="skill-switch-thumb"></span
                          ></span>
                        </span>
                      </label>
                    </div>
                  </div>
                </label>
                <label class="global-row" :class="{ 'is-dirty': isGlobalConfigFieldDirty('approvalsReviewer') }">
                  <span class="context-label dim">{{ t("globalConfig.approvalsReviewer") }}</span>
                  <div class="global-field-stack">
                    <SelectDropdown
                      id="sel-global-approvals-reviewer"
                      v-model="configStore.draft.approvalsReviewer"
                      class="context-input mono"
                      :disabled="approvalsReviewerSelectDisabled"
                      :options="approvalsReviewerOptions"
                    />
                    <div v-if="approvalsReviewerHintText" class="global-model-manage-hint">
                      {{ approvalsReviewerHintText }}
                    </div>
                  </div>
                </label>
                <label class="global-row" :class="{ 'is-dirty': isGlobalConfigFieldDirty('sandboxMode') }">
                  <span class="context-label dim">{{ t("globalConfig.sandboxMode") }}</span>
                  <div class="global-field-stack">
                    <SelectDropdown
                      id="sel-global-sandbox-mode"
                      v-model="configStore.draft.sandboxMode"
                      class="context-input mono"
                      :disabled="sandboxModeSelectDisabled"
                      :options="sandboxModeOptions"
                    />
                    <div v-if="sandboxModeHintText" class="global-model-manage-hint">{{ sandboxModeHintText }}</div>
                  </div>
                </label>

                <div class="global-toggle-list global-advanced-body">
                  <label
                    class="global-toggle-row"
                    :class="{ 'is-dirty': isGlobalConfigFieldDirty('windowsElevatedSandboxEnabled') }"
                  >
                    <div class="global-toggle-copy">
                      <span class="global-toggle-title">{{ t("globalConfig.elevatedSandbox") }}</span>
                      <span class="global-toggle-note mono">{{ t("globalConfig.elevatedSandboxNote") }}</span>
                    </div>
                    <span class="skill-switch">
                      <input
                        v-model="configStore.draft.windowsElevatedSandboxEnabled"
                        class="skill-switch-input"
                        type="checkbox"
                        :disabled="globalControlsDisabled"
                      />
                      <span class="skill-switch-track" aria-hidden="true"
                        ><span class="skill-switch-thumb"></span
                      ></span>
                    </span>
                  </label>
                  <label
                    class="global-toggle-row"
                    :class="{ 'is-dirty': isGlobalConfigFieldDirty('unifiedExecEnabled') }"
                  >
                    <div class="global-toggle-copy">
                      <span class="global-toggle-title">{{ t("globalConfig.unifiedExec") }}</span>
                      <span class="global-toggle-note mono">{{ t("globalConfig.unifiedExecNote") }}</span>
                    </div>
                    <span class="skill-switch">
                      <input
                        v-model="configStore.draft.unifiedExecEnabled"
                        class="skill-switch-input"
                        type="checkbox"
                        :disabled="globalControlsDisabled"
                      />
                      <span class="skill-switch-track" aria-hidden="true"
                        ><span class="skill-switch-thumb"></span
                      ></span>
                    </span>
                  </label>
                  <label
                    class="global-toggle-row"
                    :class="{ 'is-dirty': isGlobalConfigFieldDirty('applyPatchStreamingEventsEnabled') }"
                  >
                    <div class="global-toggle-copy">
                      <span class="global-toggle-title">{{ t("globalConfig.patchStream") }}</span>
                      <span class="global-toggle-note mono">{{ t("globalConfig.patchStreamNote") }}</span>
                    </div>
                    <span class="skill-switch">
                      <input
                        v-model="configStore.draft.applyPatchStreamingEventsEnabled"
                        class="skill-switch-input"
                        type="checkbox"
                        :disabled="globalControlsDisabled"
                      />
                      <span class="skill-switch-track" aria-hidden="true"
                        ><span class="skill-switch-thumb"></span
                      ></span>
                    </span>
                  </label>
                </div>
              </section>
            </div>

            <div class="global-config-actions">
              <div class="global-config-actions-meta">
                <div class="global-config-actions-summary">{{ globalConfigActionsSummary }}</div>
                <div class="global-config-actions-hint">{{ globalConfigActionsHint }}</div>
              </div>
              <div class="global-config-actions-buttons">
                <button class="btn-mini" type="button" :disabled="!canSaveGlobalConfig" @click="onSaveGlobalConfig">
                  {{ t("common.save") }}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RotateCw } from "lucide-vue-next";
import SelectDropdown from "../../ui/SelectDropdown.vue";
import { getRuntimeOrchestrator } from "../../../domain/runtimeOrchestrator";
import { actionModal, confirmModal } from "../../../ui/modal";
import { useRuntimeStore } from "../../../stores/runtime.store";
import { useAppShellStore } from "../../../stores/appShell.store";
import { useConfigStore } from "../../../stores/config.store";
import { useConfigRequirementsStore } from "../../../stores/configRequirements.store";
import {
  UI_FONT_FAMILY_PRESET_OPTIONS,
  UI_FONT_SIZE_PRESET_OPTIONS,
  useTypographyStore,
} from "../../../stores/typography.store";
import {
  OFFICIAL_APPROVALS_REVIEWER_OPTIONS,
  OFFICIAL_APPROVAL_POLICY_OPTIONS,
  OFFICIAL_SANDBOX_MODE_OPTIONS,
  createDefaultGranularApprovalPolicy,
  createDefaultGlobalConfigDraft,
  isGranularApprovalPolicy,
  normalizeApprovalPolicy,
} from "../../../domain/serverInterop";
import type { GlobalConfigDraft } from "../../../domain/types";
import { type UiLanguage } from "@codenexus/shared/localSettings";

const runtime = getRuntimeOrchestrator();
const { t } = useI18n();
const runtimeStore = useRuntimeStore();
const appShellStore = useAppShellStore();
const configStore = useConfigStore();
const configRequirementsStore = useConfigRequirementsStore();
const typographyStore = useTypographyStore();

const props = defineProps<{ mode?: "drawer" | "settings" }>();
const isSettings = computed(() => props.mode === "settings");
const open = computed(() => (isSettings.value ? true : appShellStore.globalConfigDrawerOpen));
const closeBtnRef = ref<HTMLButtonElement | null>(null);
const uiFontFamilyPresetOptions = computed(() =>
  UI_FONT_FAMILY_PRESET_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))
);
const uiFontSizePresetOptions = computed(() =>
  UI_FONT_SIZE_PRESET_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))
);
const uiLanguageOptions = computed<Array<{ value: UiLanguage; label: string }>>(() => [
  { value: "zh-CN", label: t("common.chinese") },
  { value: "en-US", label: t("common.english") },
]);

const closeDrawer = () => {
  if (isSettings.value) {
    appShellStore.closeSettings();
    return;
  }
  appShellStore.setGlobalConfigDrawerOpen(false);
};

const onOverlayClick = () => {
  if (isSettings.value) return;
  void onRequestClose();
};

const onUiLanguageChanged = (value: unknown) => {
  const normalized: UiLanguage = value === "en-US" ? "en-US" : "zh-CN";
  appShellStore.setLanguage(normalized);
};

type GlobalConfigPendingActionKey = "close" | "refresh";

const globalConfigPendingActionCopy = (key: GlobalConfigPendingActionKey) => {
  if (key === "refresh") {
    return {
      title: t("globalConfig.pending.refreshTitle"),
      message: t("globalConfig.pending.refreshMessage"),
      saveLabel: t("globalConfig.pending.refreshSave"),
      discardLabel: t("globalConfig.pending.refreshDiscard"),
      unsavableMessage: t("globalConfig.pending.refreshUnsavable"),
    };
  }
  return {
    title: t("globalConfig.pending.closeTitle"),
    message: t("globalConfig.pending.closeMessage"),
    saveLabel: t("globalConfig.pending.closeSave"),
    discardLabel: t("globalConfig.pending.closeDiscard"),
    unsavableMessage: t("globalConfig.pending.closeUnsavable"),
  };
};

const globalConfigActionPending = ref(false);

const saveGlobalConfigManually = async (options?: { silentSuccessToast?: boolean }): Promise<boolean> => {
  if (!canSaveGlobalConfig.value) return false;
  await runtime.saveGlobalConfig({ source: "manual", silentSuccessToast: options?.silentSuccessToast });
  return !configStore.isDirty && configStore.loadState !== "error";
};

const discardGlobalConfigDraft = () => {
  runtime.resetGlobalConfig();
};

const runWithGlobalConfigDirtyGuard = async (
  actionKey: GlobalConfigPendingActionKey,
  callback: () => void | Promise<void>
) => {
  if (globalConfigActionPending.value || configStore.saving) return;
  if (!configStore.isDirty) {
    await callback();
    return;
  }

  const copy = globalConfigPendingActionCopy(actionKey);
  globalConfigActionPending.value = true;
  try {
    if (!canSaveGlobalConfig.value) {
      const confirmedDiscard = await confirmModal({
        title: t("globalConfig.pending.discardTitle"),
        message: copy.unsavableMessage,
        detail: t("globalConfig.pending.unsavableMessage"),
        confirmText: copy.discardLabel,
        cancelText: t("globalConfig.pending.continueEditing"),
        danger: true,
      });
      if (!confirmedDiscard) return;
      discardGlobalConfigDraft();
      await callback();
      return;
    }

    const decision = await actionModal({
      title: copy.title,
      message: copy.message,
      detail: t("globalConfig.pending.saveRequired"),
      cancelKey: "cancel",
      buttons: [
        { key: "cancel", label: t("globalConfig.pending.continueEditing") },
        { key: "discard", label: copy.discardLabel, kind: "danger" },
        { key: "save", label: copy.saveLabel, autoFocus: true },
      ],
    });

    if (decision === "cancel") return;
    if (decision === "discard") {
      discardGlobalConfigDraft();
      await callback();
      return;
    }

    const saved = await saveGlobalConfigManually();
    if (!saved) return;
    await callback();
  } finally {
    globalConfigActionPending.value = false;
  }
};

const requestClose = async () => {
  await runWithGlobalConfigDirtyGuard("close", () => {
    closeDrawer();
  });
};

const onRequestClose = () => {
  void requestClose();
};

const onUiFontFamilyPresetChanged = (next: string) => {
  typographyStore.setFontFamilyPreset(next);
};

const onUiFontSizePresetChanged = (next: string) => {
  typographyStore.setFontSizePreset(next);
};

const onWindowKeydown = (event: KeyboardEvent) => {
  if (event.key !== "Escape") return;
  if (!open.value) return;
  void requestClose();
};

onMounted(() => {
  window.addEventListener("keydown", onWindowKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onWindowKeydown);
});

watch(
  () => [open.value, runtimeStore.serverId] as const,
  async ([next, serverId], previous) => {
    if (!next) return;
    await nextTick();
    closeBtnRef.value?.focus();

    if (!serverId) return;
    if (previous?.[0] === true && previous[1] === serverId) return;
    if (configStore.saving || globalConfigActionPending.value || configStore.loadState === "loading") return;
    if (configStore.isDirty) return;
    await runtime.refreshGlobalConfig();
  },
  { immediate: true }
);

const globalConfigRefreshFxNonce = ref(0);
const onRefreshGlobalConfig = () => {
  void runWithGlobalConfigDirtyGuard("refresh", async () => {
    globalConfigRefreshFxNonce.value += 1;
    await runtime.refreshGlobalConfig();
  });
};

const globalControlsDisabled = computed(
  () =>
    globalConfigActionPending.value || !runtimeStore.serverId || configStore.loadState !== "ready" || configStore.saving
);
const canRefreshGlobalConfig = computed(
  () => Boolean(runtimeStore.serverId) && !configStore.saving && !globalConfigActionPending.value
);

type RestrictedSelectState = {
  hasRestrictions: boolean;
  hasUnsupported: boolean;
  values: string[] | null;
};

const approvalsReviewerLabels = computed<Record<string, string>>(() => ({
  user: t("globalConfig.reviewerUser"),
}));

const approvalPolicyLabels = computed<Record<string, string>>(() => ({
  untrusted: "untrusted",
  "on-request": "on-request",
  never: "never",
  granular: t("globalConfig.approvalPolicyGranular"),
}));

const sandboxModeLabels = computed<Record<string, string>>(() => ({
  "read-only": t("globalConfig.sandboxReadOnly"),
  "workspace-write": t("globalConfig.sandboxWorkspaceWrite"),
  "danger-full-access": t("globalConfig.sandboxDangerFullAccess"),
}));

const buildRestrictedSelectState = (
  allowedValues: readonly unknown[] | null | undefined,
  officialOptions: readonly string[]
): RestrictedSelectState => {
  if (!Array.isArray(allowedValues)) {
    return { hasRestrictions: false, hasUnsupported: false, values: null };
  }

  const values: string[] = [];
  let hasUnsupported = false;
  for (const entry of allowedValues) {
    if (typeof entry !== "string") {
      hasUnsupported = true;
      continue;
    }
    const normalized = officialOptions.find((option) => option === entry);
    if (!normalized) {
      hasUnsupported = true;
      continue;
    }
    if (!values.includes(normalized)) values.push(normalized);
  }

  return { hasRestrictions: true, hasUnsupported, values };
};

const toApprovalPolicyOptionValue = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (isGranularApprovalPolicy(value)) return "granular";
  return null;
};

const approvalPolicySelectValue = computed(() =>
  isGranularApprovalPolicy(configStore.draft.approvalPolicy) ? "granular" : String(configStore.draft.approvalPolicy)
);

type GranularApprovalFlag = keyof ReturnType<typeof createDefaultGranularApprovalPolicy>["granular"];

const granularApprovalPolicy = computed(() =>
  isGranularApprovalPolicy(configStore.draft.approvalPolicy)
    ? configStore.draft.approvalPolicy
    : createDefaultGranularApprovalPolicy()
);

const onApprovalPolicyChanged = (value: string) => {
  configStore.setDraft({
    approvalPolicy: value === "granular" ? createDefaultGranularApprovalPolicy() : normalizeApprovalPolicy(value),
  });
};

const onGranularApprovalFlagChanged = (key: GranularApprovalFlag, event: Event) => {
  const target = event.target as HTMLInputElement | null;
  const current = granularApprovalPolicy.value;
  configStore.setDraft({
    approvalPolicy: {
      granular: {
        ...current.granular,
        [key]: Boolean(target?.checked),
      },
    },
  });
};

const formatRestrictedValues = (values: string[], labels?: Record<string, string>) => {
  return values.map((value) => labels?.[value] ?? value).join(" / ");
};

const buildRestrictedSelectOptions = (
  currentValue: string,
  officialOptions: readonly string[],
  restriction: RestrictedSelectState,
  labels?: Record<string, string>
) => {
  const options: Array<{ value: string; label: string; disabled?: boolean }> = [];
  const effectiveValues = restriction.values ?? [...officialOptions];
  const seen = new Set<string>();
  const labelFor = (value: string) => labels?.[value] ?? value;

  if (currentValue && !effectiveValues.includes(currentValue)) {
    options.push({
      value: currentValue,
      label: t("globalConfig.currentValue", { label: labelFor(currentValue) }),
      disabled: true,
    });
    seen.add(currentValue);
  }

  for (const value of effectiveValues) {
    if (seen.has(value)) continue;
    options.push({ value, label: labelFor(value) });
    seen.add(value);
  }

  return options;
};

const buildRestrictedHintText = (restriction: RestrictedSelectState, labels?: Record<string, string>) => {
  if (!restriction.hasRestrictions) return "";
  if (!restriction.values || restriction.values.length === 0) {
    return restriction.hasUnsupported
      ? t("globalConfig.requirements.unsupportedOnly")
      : t("globalConfig.requirements.noAllowedValues");
  }
  const allowedText = formatRestrictedValues(restriction.values, labels);
  return restriction.hasUnsupported
    ? t("globalConfig.requirements.allowedWithUnsupported", { values: allowedText })
    : t("globalConfig.requirements.allowed", { values: allowedText });
};

const approvalPolicyRestriction = computed(() =>
  buildRestrictedSelectState(
    configRequirementsStore.requirements?.allowedApprovalPolicies?.map(toApprovalPolicyOptionValue),
    OFFICIAL_APPROVAL_POLICY_OPTIONS
  )
);
const approvalsReviewerRestriction = computed(() =>
  buildRestrictedSelectState(
    configRequirementsStore.requirements?.allowedApprovalsReviewers,
    OFFICIAL_APPROVALS_REVIEWER_OPTIONS
  )
);
const sandboxModeRestriction = computed(() =>
  buildRestrictedSelectState(configRequirementsStore.requirements?.allowedSandboxModes, OFFICIAL_SANDBOX_MODE_OPTIONS)
);

const approvalPolicyOptions = computed(() =>
  buildRestrictedSelectOptions(
    approvalPolicySelectValue.value,
    OFFICIAL_APPROVAL_POLICY_OPTIONS,
    approvalPolicyRestriction.value,
    approvalPolicyLabels.value
  )
);
const approvalsReviewerOptions = computed(() =>
  buildRestrictedSelectOptions(
    String(configStore.draft.approvalsReviewer ?? ""),
    OFFICIAL_APPROVALS_REVIEWER_OPTIONS,
    approvalsReviewerRestriction.value,
    approvalsReviewerLabels.value
  )
);
const sandboxModeOptions = computed(() =>
  buildRestrictedSelectOptions(
    String(configStore.draft.sandboxMode ?? ""),
    OFFICIAL_SANDBOX_MODE_OPTIONS,
    sandboxModeRestriction.value,
    sandboxModeLabels.value
  )
);

const approvalPolicySelectDisabled = computed(
  () =>
    globalControlsDisabled.value ||
    (approvalPolicyRestriction.value.hasRestrictions && (approvalPolicyRestriction.value.values?.length ?? 0) === 0)
);
const approvalsReviewerSelectDisabled = computed(
  () =>
    globalControlsDisabled.value ||
    (approvalsReviewerRestriction.value.hasRestrictions &&
      (approvalsReviewerRestriction.value.values?.length ?? 0) === 0)
);
const sandboxModeSelectDisabled = computed(
  () =>
    globalControlsDisabled.value ||
    (sandboxModeRestriction.value.hasRestrictions && (sandboxModeRestriction.value.values?.length ?? 0) === 0)
);

const configRequirementsSummaryClass = computed(() => {
  if (configRequirementsStore.loadState === "error") return "is-error";
  if (configRequirementsStore.loadState === "loading") return "is-loading";
  return "is-ready";
});

const configRequirementsSummaryText = computed(() => {
  if (!runtimeStore.serverId) return "";
  if (configRequirementsStore.loadState === "loading") return t("globalConfig.requirements.loading");
  if (configRequirementsStore.loadState === "error") {
    return configRequirementsStore.statusText || t("globalConfig.requirements.loadFailed");
  }
  if (!configRequirementsStore.requirements) {
    return configRequirementsStore.statusText || t("globalConfig.requirements.none");
  }
  if (
    approvalPolicyRestriction.value.hasRestrictions ||
    approvalsReviewerRestriction.value.hasRestrictions ||
    sandboxModeRestriction.value.hasRestrictions
  ) {
    return t("globalConfig.requirements.restricted");
  }
  return configRequirementsStore.statusText || t("globalConfig.requirements.unrestricted");
});

const approvalPolicyHintText = computed(() => {
  if (configRequirementsStore.loadState === "error") return "";
  return buildRestrictedHintText(approvalPolicyRestriction.value, approvalPolicyLabels.value);
});

const sandboxModeHintText = computed(() => {
  if (configRequirementsStore.loadState === "error") return "";
  return buildRestrictedHintText(sandboxModeRestriction.value, sandboxModeLabels.value);
});

const approvalsReviewerHintText = computed(() => {
  if (!runtimeStore.serverId) return "";
  if (configRequirementsStore.loadState === "loading") return t("globalConfig.requirements.loading");
  if (configRequirementsStore.loadState === "error") {
    return configRequirementsStore.statusText || t("globalConfig.requirements.reviewerLoadFailed");
  }

  const restriction = approvalsReviewerRestriction.value;
  if (!restriction.hasRestrictions) {
    return t("globalConfig.requirements.reviewerDefault");
  }
  if (!restriction.values || restriction.values.length === 0) {
    return restriction.hasUnsupported
      ? t("globalConfig.requirements.reviewerUnsupportedOnly")
      : t("globalConfig.requirements.reviewerNoAllowed");
  }

  const allowedText = formatRestrictedValues(restriction.values, approvalsReviewerLabels.value);
  const suffix = restriction.hasUnsupported ? t("globalConfig.requirements.reviewerUnsupportedSuffix") : "";
  return t("globalConfig.requirements.reviewerAllowed", { values: allowedText, suffix });
});

const isGlobalConfigFieldDirty = (key: keyof GlobalConfigDraft): boolean => {
  return JSON.stringify(configStore.draft[key]) !== JSON.stringify(configStore.snapshot[key]);
};

const GLOBAL_CONFIG_DIRTY_KEYS: Array<keyof GlobalConfigDraft> = [
  "approvalPolicy",
  "approvalsReviewer",
  "sandboxMode",
  "windowsElevatedSandboxEnabled",
  "unifiedExecEnabled",
  "applyPatchStreamingEventsEnabled",
];

const globalConfigDirtyCount = computed(
  () => GLOBAL_CONFIG_DIRTY_KEYS.filter((key) => isGlobalConfigFieldDirty(key)).length
);

const canSaveGlobalConfig = computed(
  () =>
    Boolean(runtimeStore.serverId) && !configStore.saving && configStore.loadState === "ready" && configStore.isDirty
);

const canResetGlobalConfig = computed(
  () =>
    Boolean(runtimeStore.serverId) && !configStore.saving && configStore.loadState === "ready" && configStore.isDirty
);

const globalConfigStatusKind = computed(() => {
  if (!runtimeStore.serverId) return "neutral";
  if (configStore.loadState === "error") return "error";
  if (configStore.saving || configStore.loadState === "loading") return "info";
  if (configStore.isDirty) return "warning";
  return "success";
});

const globalConfigStatusText = computed(() => {
  if (!runtimeStore.serverId) return t("globalConfig.status.disconnected");
  if (configStore.saving) return t("globalConfig.status.saving");
  if (configStore.loadState === "loading") return t("globalConfig.status.loading");
  if (configStore.loadState === "error") return configStore.statusText || t("globalConfig.status.loadFailed");
  return configStore.isDirty ? t("globalConfig.status.dirty") : t("globalConfig.status.synced");
});

const globalConfigActionsSummary = computed(() => {
  if (!runtimeStore.serverId) return t("globalConfig.actionsSummary.disconnected");
  if (configStore.saving) return t("globalConfig.actionsSummary.saving");
  if (configStore.isDirty) return t("globalConfig.actionsSummary.dirty", { count: globalConfigDirtyCount.value });
  return t("globalConfig.actionsSummary.synced");
});

const globalConfigActionsHint = computed(() => {
  if (!runtimeStore.serverId) return t("globalConfig.actionsHint.disconnected");
  return t("globalConfig.actionsHint.saveManually");
});

const onSaveGlobalConfig = () => {
  void saveGlobalConfigManually();
};

const onResetGlobalConfig = () => {
  runtime.resetGlobalConfig();
};

// 断连时给 store 一个可用的 baseline，避免首次打开抽屉时表单空态闪烁。
if (!configStore.snapshot) configStore.applySnapshot(createDefaultGlobalConfigDraft());
</script>

<style scoped>
.global-config-guide-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px;
  border-radius: 5px;
  border: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
  background: color-mix(in srgb, var(--surface-2) 30%, transparent);
  margin-bottom: 10px;
}

.guide-entry-text {
  display: grid;
  gap: 6px;
}

.guide-entry-title {
  font-weight: 600;
  font-size: 14.5px;
  color: var(--text-1);
}

.guide-entry-desc {
  font-size: 13px;
  color: var(--text-2);
}

.global-config-local-entry {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}

.global-model-manage-hint {
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--text-2);
}

.global-config-requirements-summary {
  margin-bottom: 10px;
  padding: 10px;
  border-radius: 5px;
  border: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
  background: color-mix(in srgb, var(--surface-1) 80%, transparent);
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-2);
}

.global-config-requirements-summary.is-loading {
  border-color: color-mix(in srgb, var(--accent) 30%, transparent);
}

.global-config-requirements-summary.is-error {
  border-color: color-mix(in srgb, var(--danger) 40%, transparent);
  color: var(--danger);
}

.typography-controls {
  display: grid;
  gap: 10px;
  width: min(100%, 320px);
}

.typography-row {
  display: grid;
  gap: 8px;
}

.typography-label {
  font-size: 12.5px;
  color: var(--text-2);
}
</style>
