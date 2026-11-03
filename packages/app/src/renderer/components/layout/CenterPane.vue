<template>
  <section id="center-content" ref="centerContentRef" class="content content-center">
    <div class="center-workbench">
      <div
        id="timeline-pane"
        class="center-pane timeline-pane"
        :class="timelinePaneClass"
        :style="timelineViewportStyle"
      >
        <SkillsManagerOverlay v-if="skillsUiStore.managerOpen" />

        <template v-else>
          <div
            id="timeline"
            ref="timelineRef"
            class="timeline app-scrollbar"
            :style="timelineStyle"
            @scroll="onTimelineScroll"
          >
            <div v-if="isTimelineLoading || shouldShowCenterEmptyState" class="timeline-empty-state-shell">
              <CenterPaneEmptyState
                :loading="isTimelineLoading"
                :historyItems="emptyStateHistoryItems"
                :mode="emptyStateMode"
                @switch-thread="onEmptyStateSwitchThread"
              />
            </div>

            <ChatPane
              v-else
              :contentEvents="contentTimelineEvents"
              :contentRevision="timelineContentRevision"
              :workspaceRoot="workspaceRoot"
              :trailingThinkingEvent="trailingThinkingEvent"
              :trailingContextCompactionEvent="trailingContextCompactionEvent"
              :timelineKey="timelineKey"
              :scrollElement="timelineRef"
              :onLayoutChange="onPaneLayoutChange"
              :onViewportAdapterChange="setTimelineViewportAdapter"
              :inlineRewriteCloseSeq="inlineRewriteCloseSeq"
            />
          </div>

          <ComposerQueueList
            v-if="shouldShowQueueTray"
            :items="queueItems"
            @edit="onEditQueuedMessage"
            @send-now="onSendQueuedMessageNow"
            @remove="onRemoveQueuedMessage"
          />

          <ComposerPanel
            v-if="shouldShowComposerPanel"
            :composeInput="runtimeStore.composeInput"
            :composeAttachments="runtimeStore.composeAttachments"
            :composeFileMentions="runtimeStore.composeFileMentions"
            :historyRewriteActive="runtimeStore.historyRewriteActive"
            :historyRewriteSource="runtimeStore.historyRewriteSource"
            :statusText="composerStatusText"
            :composeMode="runtimeStore.composeMode"
            :model="effectiveModelValue"
            :reasoningEffort="effectiveReasoningEffort"
            :sandboxMode="runtimeStore.sandboxMode"
            :modelOptions="modelOptions"
            :sandboxModeOptions="sandboxModeOptions"
            :sandboxRiskText="sandboxRiskText"
            :serviceTierLabel="serviceTierLabel"
            :serviceTierTooltip="serviceTierTooltip"
            :contextUsageTooltip="contextUsageTooltip"
            :contextUsagePercent="contextUsagePercent"
            :contextUsageLevel="contextUsageLevel"
            :contextUsageTokensText="contextUsageTokensText"
            :isTurnRunning="isTurnRunning"
            :sendDisabled="sendDisabled"
            :sendTitle="sendTitle"
            :interruptDisabled="interruptDisabled"
            :interruptTitle="interruptTitle"
            :composerPanelRef="bindComposerPanelRef"
            :composerInputRef="bindComposerInputRef"
            :composerImageInputRef="bindComposerImageInputRef"
            @update:composeInput="onComposeInputUpdate"
            @update:composeFileMentions="onComposeFileMentionsUpdate"
            @update:model="onModelUpdate"
            @update:reasoningEffort="onReasoningEffortUpdate"
            @update:sandboxMode="onSandboxModeUpdate"
            @set-compose-mode="onComposeModeChange"
            @composer-keydown="onComposerKeydown"
            @composer-paste="onComposerPaste"
            @composer-image-change="onComposerImageInputChange"
            @preview-attachment="onPreviewComposeAttachment"
            @remove-attachment="onRemoveComposeAttachment"
            @cancel-rewrite="onCancelRewrite"
            @pick-images="onPickComposeImages"
            @send="onSendClick"
            @interrupt-turn="onInterruptTurnClick"
            @interact="onBottomComposerInteract"
          />
        </template>
      </div>
    </div>
  </section>

  <Teleport to="body">
    <Transition name="composer-slash-popover">
      <div
        v-if="slashPopoverVisible"
        ref="slashPopoverRef"
        class="composer-slash-popover app-scrollbar"
        :style="slashPopoverStyle"
        :data-dir="slashPopoverDirection"
      >
        <ComposerSlashCommandList
          :commands="filteredSlashCommands"
          :activeIndex="activeSlashIndex"
          @hover="onSlashCommandHover"
          @select="onSlashCommandClick"
        />
      </div>
    </Transition>
  </Teleport>

  <Teleport to="body">
    <Transition name="composer-lightbox">
      <div
        v-if="composeLightboxAttachment"
        class="composer-lightbox-overlay"
        role="dialog"
        aria-modal="true"
        :aria-label="t('composer.imagePreview')"
        @click.self="closeComposeLightbox"
      >
        <div class="composer-lightbox-backdrop" @click="closeComposeLightbox"></div>
        <div class="composer-lightbox-stage">
          <img
            class="composer-lightbox-image"
            :src="composeLightboxAttachment.previewUrl"
            :alt="composeLightboxAttachment.name"
          />
          <button
            ref="composeLightboxCloseRef"
            class="composer-lightbox-close"
            type="button"
            @click="closeComposeLightbox"
          >
            {{ t("common.close") }}
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import ComposerPanel from "./composer/ComposerPanel.vue";
import CenterPaneEmptyState from "./CenterPaneEmptyState.vue";
import { ChatPane, ComposerQueueList, ComposerSlashCommandList, SkillsManagerOverlay } from "../asyncViews";
import { useTimelineScrollController } from "./composables/useTimelineScrollController";
import type { TimelineViewportAdapter } from "./chat/timelineScrollPolicy";
import { hasMeaningfulComposeText, stripComposeFileTokenChars } from "../../domain/composeFileMentions";
import { getRuntimeOrchestrator } from "../../domain/runtimeOrchestrator";
import type {
  CollaborationModeKind,
  ComposeImageAttachment,
  ThreadHistoryItem,
  TimelineEventItem,
} from "../../domain/types";
import { isLocalThinkingEvent } from "../../features/timeline/eventKinds";
import { isPendingThreadId } from "../../shared/threadCreateDebug";
import { useAppShellStore } from "../../stores/appShell.store";
import { useConfigStore } from "../../stores/config.store";
import { useMessageQueueStore } from "../../stores/messageQueue.store";
import { useModelCatalogStore } from "../../stores/modelCatalog.store";
import { useRuntimeStore, type SandboxMode } from "../../stores/runtime.store";
import { useSkillsUiStore } from "../../stores/skillsUi.store";
import { useThreadStore } from "../../stores/thread.store";
import { useTimelineStore } from "../../stores/timeline.store";
import { CENTER_TIMELINE_SOFT_MIN_WIDTH_PX } from "../../domain/layoutWidthBudget";
import {
  buildModelPickerOptions,
  resolveModelSelectionValue,
  resolveReasoningEffort,
} from "@codenexus/shared/modelCatalog";
import { showToast } from "../../ui/toast";

const { t } = useI18n();

type SlashCommandDef = {
  id: string;
  code: string;
  title: string;
  hint?: string;
  disabled?: boolean;
  disabledHint?: string;
  run: () => Promise<void> | void;
};

type LocalImageFile = File & { path?: string };
type PopoverDirection = "up" | "down";

type PopoverAnchorRect = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

type PopoverPlacement = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  dir: PopoverDirection;
};

const runtime = getRuntimeOrchestrator();
const runtimeStore = useRuntimeStore();
const threadStore = useThreadStore();
const timelineStore = useTimelineStore();
const appShellStore = useAppShellStore();
const configStore = useConfigStore();
const messageQueueStore = useMessageQueueStore();
const modelCatalogStore = useModelCatalogStore();
const skillsUiStore = useSkillsUiStore();

const centerContentRef = ref<HTMLElement | null>(null);
const timelineRef = ref<HTMLDivElement | null>(null);
const timelineViewportAdapter = ref<TimelineViewportAdapter | null>(null);
const composerPanelRef = ref<HTMLDivElement | null>(null);
const composerInputRef = ref<HTMLDivElement | null>(null);
const composerImageInputRef = ref<HTMLInputElement | null>(null);
const composeLightboxCloseRef = ref<HTMLButtonElement | null>(null);
const slashPopoverRef = ref<HTMLDivElement | null>(null);
const activeSlashIndex = ref(-1);
const composeLightboxAttachmentId = ref("");
const slashPopoverPlacement = ref<PopoverPlacement | null>(null);
const composerDockHeightPx = ref(0);
const centerContentWidthPx = ref(0);
const inlineRewriteCloseSeq = ref(0);
const COMPOSER_DOCK_FALLBACK_HEIGHT_PX = 84;
const COMPOSER_DOCK_BOTTOM_INSET_PX = 14;
const COMPOSER_DOCK_GAP_PX = 8;
const TIMELINE_EDGE_FADE_PX = 15;
let pendingSlashPopoverPlacementRafId: number | null = null;
let slashPopoverResizeObserver: ResizeObserver | null = null;
let composerResizeObserver: ResizeObserver | null = null;
let centerContentResizeObserver: ResizeObserver | null = null;
let lastTimelineStatsLogAt = 0;

function bindComposerPanelRef(el: HTMLDivElement | null) {
  composerPanelRef.value = el;
}

function bindComposerInputRef(el: HTMLDivElement | null) {
  composerInputRef.value = el;
}

function bindComposerImageInputRef(el: HTMLInputElement | null) {
  composerImageInputRef.value = el;
}

function onBottomComposerInteract() {
  inlineRewriteCloseSeq.value += 1;
}

function measureComposerDockHeight() {
  const el = composerPanelRef.value;
  if (!el) {
    composerDockHeightPx.value = 0;
    return;
  }
  composerDockHeightPx.value = Math.max(0, Math.round(el.getBoundingClientRect().height));
}

function observeComposerPanelSize() {
  const el = composerPanelRef.value;
  if (!el) return;
  if (!composerResizeObserver) {
    composerResizeObserver = new ResizeObserver(() => {
      measureComposerDockHeight();
      refreshOpenPopoversPlacement();
    });
  }
  composerResizeObserver.disconnect();
  composerResizeObserver.observe(el);
  measureComposerDockHeight();
}

const sandboxModeOptions = computed(() => [
  { value: "read-only", label: t("composer.readOnlyShort") },
  { value: "workspace-write", label: t("composer.workspaceWriteShort") },
  { value: "danger-full-access", label: t("composer.dangerFullAccessShort") },
]);

const timelineKey = computed(() => String(runtimeStore.timelineKey ?? "__app__"));
const currentThreadId = computed(() => String(runtimeStore.currentThreadId ?? "").trim());
const workspaceRoot = computed(() => String(runtimeStore.workspacePath ?? "").trim());
const contentTimelineEvents = computed<TimelineEventItem[]>(() => timelineStore.eventsForThread(timelineKey.value));
const timelineContentRevision = computed(() => timelineStore.threadContentRevisionForThread(timelineKey.value));
const timelineRevision = computed(() => timelineStore.threadStructureRevisionForThread(timelineKey.value));
const timelineStats = computed(() => timelineStore.timelineStatsForThread(timelineKey.value));
const queueItems = computed(() => messageQueueStore.queueByThread.get(timelineKey.value) ?? []);
const emptyStateMode = computed<"default" | "pendingThread">(() => {
  const tid = currentThreadId.value;
  if (isPendingThreadId(tid)) return "pendingThread";
  return "default";
});
const effectiveModelValue = computed(() =>
  resolveModelSelectionValue(
    modelCatalogStore.models,
    runtimeStore.model,
    modelCatalogStore.preferredModelValue || null
  )
);
const effectiveReasoningEffort = computed(() =>
  resolveReasoningEffort(
    modelCatalogStore.models,
    effectiveModelValue.value,
    runtimeStore.reasoningEffort,
    modelCatalogStore.preferredModelEffort || null
  )
);
const modelOptions = computed(() =>
  buildModelPickerOptions({
    models: modelCatalogStore.models,
    current: runtimeStore.model || effectiveModelValue.value,
    preferredModelValue: modelCatalogStore.preferredModelValue || null,
  })
);

const sandboxRiskText = computed(() => {
  if (runtimeStore.sandboxMode === "danger-full-access") return t("composer.dangerFullAccessRisk");
  if (runtimeStore.sandboxMode === "read-only") return t("composer.readOnlyRisk");
  return t("composer.workspaceWriteRisk");
});
const isTurnRunning = computed(() => {
  const tid = currentThreadId.value;
  return Boolean(tid) && threadStore.runningThreadIds.has(tid);
});
const isTimelineLoading = computed(() => {
  const tid = currentThreadId.value;
  if (!tid) return false;
  return threadStore.loadingThreadId === tid;
});
const activeTimelineTurnId = computed(() =>
  String(threadStore.activeTurnIdByThread.get(timelineKey.value) ?? "").trim()
);
const timelineScrollController = useTimelineScrollController({
  timelineRef,
  timelineKey,
  timelineRevision,
  timelineContentRevision,
  activeTurnId: activeTimelineTurnId,
  isTimelineLoading,
  loadOlderHistoryTurns: (threadId) => runtime.loadOlderHistoryTurns(threadId),
  viewportAdapter: timelineViewportAdapter,
});
const {
  hasTopEdgeFade,
  hasBottomEdgeFade,
  forceFollowBottom,
  notifyTimelineLayoutChange,
  onTimelineScroll,
  scheduleTimelineViewportStateUpdate,
  observeTimelineElement,
} = timelineScrollController;
const emptyStateHistoryItems = computed<ThreadHistoryItem[]>(() => threadStore.threadHistory.slice(0, 8));

function setTimelineViewportAdapter(adapter: TimelineViewportAdapter | null) {
  timelineViewportAdapter.value = adapter;
}

const shouldShowComposerPanel = computed(() => {
  if (skillsUiStore.managerOpen) return false;
  return true;
});
const shouldShowQueueTray = computed(() => shouldShowComposerPanel.value && queueItems.value.length > 0);
const shouldShowCenterEmptyState = computed(() => {
  if (contentTimelineEvents.value.length > 0) return false;
  if (emptyStateMode.value === "pendingThread") return true;
  if (currentThreadId.value) return false;
  return emptyStateHistoryItems.value.length > 0;
});
const composerDockSpacePx = computed(() => {
  if (!shouldShowComposerPanel.value) return 12;
  const dockHeight = composerDockHeightPx.value > 0 ? composerDockHeightPx.value : COMPOSER_DOCK_FALLBACK_HEIGHT_PX;
  return Math.max(96, Math.round(dockHeight + COMPOSER_DOCK_BOTTOM_INSET_PX + COMPOSER_DOCK_GAP_PX));
});
const timelineViewportStyle = computed(
  () =>
    ({
      "--timeline-edge-fade-top": hasTopEdgeFade.value ? `${TIMELINE_EDGE_FADE_PX}px` : "0px",
      "--timeline-edge-fade-bottom": hasBottomEdgeFade.value ? `${TIMELINE_EDGE_FADE_PX}px` : "0px",
      "--composer-dock-space": `${composerDockSpacePx.value}px`,
      "--composer-dock-bottom-inset": `${COMPOSER_DOCK_BOTTOM_INSET_PX}px`,
    }) as Record<string, string>
);
const timelineStyle = computed(() => timelineViewportStyle.value);
const getCenterContentWidthPx = () => {
  return (
    centerContentWidthPx.value ||
    Math.max(0, Math.round(centerContentRef.value?.getBoundingClientRect().width ?? window.innerWidth))
  );
};
const measureCenterContentWidth = () => {
  centerContentWidthPx.value = getCenterContentWidthPx();
};
const effectiveTimelineWidthPx = computed(() => {
  return getCenterContentWidthPx();
});
const isTimelineCompact = computed(() => {
  return effectiveTimelineWidthPx.value < CENTER_TIMELINE_SOFT_MIN_WIDTH_PX;
});
const timelinePaneClass = computed(() => {
  if (skillsUiStore.managerOpen) return ["timeline-pane--skills-page"];
  const classes = ["timeline-pane--chat"];
  if (runtimeStore.timelineDebugEnabled) classes.push("is-debug-open");
  if (isTimelineCompact.value) classes.push("is-compact");
  return classes;
});
const currentTokenUsage = computed(() => threadStore.currentTokenUsage);
const contextUsagePercent = computed(() => {
  const usedTokens = Number(currentTokenUsage.value.usedTokens ?? 0);
  const contextWindow = Number(currentTokenUsage.value.contextWindow ?? 0);
  if (!Number.isFinite(usedTokens) || !Number.isFinite(contextWindow) || contextWindow <= 0) return 0;
  return Math.max(0, Math.min(100, (usedTokens / contextWindow) * 100));
});
const contextUsageLevel = computed(() => {
  const percent = contextUsagePercent.value;
  if (percent >= 95) return "critical";
  if (percent >= 85) return "high";
  if (percent >= 70) return "warn";
  return "normal";
});
const contextUsageTokensText = computed(() => {
  const usedTokens = currentTokenUsage.value.usedTokens;
  const contextWindow = currentTokenUsage.value.contextWindow;
  if (usedTokens == null || contextWindow == null || contextWindow <= 0) return "--/--";
  const used = Math.max(0, Math.round(usedTokens));
  const total = Math.max(0, Math.round(contextWindow));
  const fmt = new Intl.NumberFormat();
  return `${fmt.format(used)}/${fmt.format(total)}`;
});
const contextUsageTooltip = computed(() => {
  const usedTokens = currentTokenUsage.value.usedTokens;
  const contextWindow = currentTokenUsage.value.contextWindow;
  if (usedTokens == null || contextWindow == null || contextWindow <= 0) return t("composer.contextUnavailable");
  return t("composer.contextUsage", { used: usedTokens, total: contextWindow });
});

const trailingContextCompactionEvent = computed<TimelineEventItem | null>(() => {
  const events = contentTimelineEvents.value;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    // `local/contextCompaction` 是“底部提示条”事件：即使 hidden 也需要参与判定。
    // 但其它 hidden 事件（如诊断信息）应跳过，避免压缩提示被尾部 hidden 噪音遮挡。
    if (event.method === "local/contextCompaction") return event;
    if (event.hidden) continue;
    break;
  }
  return null;
});
const trailingThinkingEvent = computed<TimelineEventItem | null>(() => {
  if (trailingContextCompactionEvent.value) return null;
  const activeTurnId = String(threadStore.activeTurnIdByThread.get(currentThreadId.value) ?? "").trim();
  const events = contentTimelineEvents.value;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!isLocalThinkingEvent(event)) continue;
    if (activeTurnId && String(event.turnId ?? "").trim() !== activeTurnId) continue;
    return event;
  }
  return null;
});

const composeLightboxAttachment = computed<ComposeImageAttachment | null>(() => {
  const attachmentId = String(composeLightboxAttachmentId.value ?? "").trim();
  if (!attachmentId) return null;
  return runtimeStore.composeAttachments.find((item) => item.id === attachmentId) ?? null;
});
const hasCurrentThread = computed(() => Boolean(currentThreadId.value));
const compactCommandDisabledHint = computed(() => {
  if (!hasCurrentThread.value) return t("composer.needThread");
  if (isTurnRunning.value) return t("composer.threadRunningNoCompact");
  return "";
});
const threadContentCommandDisabledHint = computed(() => {
  if (!hasCurrentThread.value) return t("composer.needThread");
  return "";
});
const goalCommandDisabledHint = computed(() => {
  if (!hasCurrentThread.value) return t("composer.needThread");
  return "";
});
const slashQuery = computed(() => {
  const text = stripComposeFileTokenChars(String(runtimeStore.composeInput ?? ""));
  const trimmedStart = text.trimStart();
  if (!trimmedStart.startsWith("/")) return "";
  const firstLine = trimmedStart.split(/\r?\n/, 1)[0] ?? "";
  const match = firstLine.match(/^\/([^\s]*)/);
  return String(match?.[1] ?? "")
    .trim()
    .toLowerCase();
});
const slashCommands = computed<SlashCommandDef[]>(() => [
  {
    id: "compact",
    code: "compact",
    title: t("composer.slashCompactTitle"),
    hint: t("composer.slashCompactHint"),
    disabled: Boolean(compactCommandDisabledHint.value),
    disabledHint: compactCommandDisabledHint.value || undefined,
    run: async () => {
      await runtime.compactThread();
    },
  },
  {
    id: "skills",
    code: "skills",
    title: t("composer.slashSkillsTitle"),
    hint: t("composer.slashSkillsHint"),
    run: () => {
      skillsUiStore.openManager();
    },
  },
  {
    id: "goal-set",
    code: "goal-set",
    title: t("composer.slashGoalSetTitle"),
    hint: t("composer.slashGoalSetHint"),
    disabled: Boolean(goalCommandDisabledHint.value),
    disabledHint: goalCommandDisabledHint.value || undefined,
    run: async () => {
      await runtime.promptAndSetCurrentThreadGoal();
    },
  },
  {
    id: "goal-complete",
    code: "goal-complete",
    title: t("composer.slashGoalCompleteTitle"),
    hint: t("composer.slashGoalCompleteHint"),
    disabled: Boolean(goalCommandDisabledHint.value),
    disabledHint: goalCommandDisabledHint.value || undefined,
    run: async () => {
      await runtime.completeCurrentThreadGoal();
    },
  },
  {
    id: "goal-clear",
    code: "goal-clear",
    title: t("composer.slashGoalClearTitle"),
    hint: t("composer.slashGoalClearHint"),
    disabled: Boolean(goalCommandDisabledHint.value),
    disabledHint: goalCommandDisabledHint.value || undefined,
    run: async () => {
      await runtime.clearCurrentThreadGoal();
    },
  },
  {
    id: "goal-get",
    code: "goal-get",
    title: t("composer.slashGoalGetTitle"),
    hint: t("composer.slashGoalGetHint"),
    disabled: Boolean(goalCommandDisabledHint.value),
    disabledHint: goalCommandDisabledHint.value || undefined,
    run: async () => {
      const goal = await runtime.refreshThreadGoal();
      showToast({
        kind: "info",
        title: goal ? t("composer.goalCurrentTitle") : t("composer.goalEmptyTitle"),
        message: goal?.objective ?? t("composer.goalEmptyMessage"),
      });
    },
  },
  {
    id: "thread-content",
    code: "thread-content",
    title: t("composer.slashThreadContentTitle"),
    hint: t("composer.slashThreadContentHint"),
    disabled: Boolean(threadContentCommandDisabledHint.value),
    disabledHint: threadContentCommandDisabledHint.value || undefined,
    run: async () => {
      const threadId = currentThreadId.value;
      const result = await runtime.readThreadContent({
        threadId,
        messageLimit: 80,
        eventLimit: 120,
        includeAux: true,
      });
      if (!result.found) {
        showToast({
          kind: "warn",
          title: t("composer.threadNotFound"),
          message: threadId || t("composer.noReadableThread"),
        });
        return;
      }
      const messageCount = result.messages.length;
      const eventCount = result.eventsPage.entries.length;
      const totalEvents = result.eventsPage.total;
      const hasMore = result.eventsPage.hasMore;
      showToast({
        kind: "info",
        title: t("composer.threadContentRead"),
        message: t("composer.threadContentSummary", {
          messageCount,
          eventCount,
          totalEvents,
          suffix: hasMore ? t("composer.threadContentHasMore") : "",
        }),
      });
    },
  },
]);
const filteredSlashCommands = computed(() => {
  const query = slashQuery.value;
  if (!query) return slashCommands.value;
  return slashCommands.value.filter((command) => {
    const code = command.code.toLowerCase();
    const title = command.title.toLowerCase();
    const hint = String(command.hint ?? "").toLowerCase();
    return code.includes(query) || title.includes(query) || hint.includes(query);
  });
});
const slashPopoverVisible = computed(() => {
  const text = stripComposeFileTokenChars(String(runtimeStore.composeInput ?? ""));
  return shouldShowComposerPanel.value && text.trimStart().startsWith("/");
});
const slashPopoverDirection = computed<PopoverDirection>(() => slashPopoverPlacement.value?.dir ?? "up");
const slashPopoverStyle = computed(() => popoverStyleFromPlacement(slashPopoverPlacement.value));

const sendTitle = computed(() => {
  if (isPendingThreadId(currentThreadId.value)) return t("composer.sendAfterInit");
  return isTurnRunning.value ? t("composer.sendQueuedWhenRunning") : t("composer.sendMessage");
});
const sendDisabled = computed(() => {
  return (
    !effectiveModelValue.value ||
    (!hasMeaningfulComposeText(runtimeStore.composeInput) &&
      runtimeStore.composeAttachments.length === 0 &&
      runtimeStore.composeFileMentions.length === 0)
  );
});
const interruptTitle = computed(() => t("composer.stopCurrentTask"));
const interruptDisabled = computed(() => !isTurnRunning.value);
const serviceTierLabel = computed(() => {
  if (appShellStore.serverConnState !== "connected") return "";
  if (configStore.loadState !== "ready") return "";
  return configStore.snapshot.fastModeEnabled ? t("composer.fast") : t("composer.standard");
});
const serviceTierTooltip = computed(() => {
  if (!serviceTierLabel.value) return "";
  return t("composer.activeServiceTier", { tier: serviceTierLabel.value });
});

const composerStatusText = computed(() => {
  if (!effectiveModelValue.value) {
    return modelCatalogStore.loadState === "loading" ? t("composer.modelsLoading") : t("composer.noModels");
  }
  const tid = currentThreadId.value;
  if (!isPendingThreadId(tid)) return "";
  const pending = runtimeStore.pendingThreadInitSendCountByThread.get(tid) ?? 0;
  if (!Number.isFinite(pending) || pending <= 0) return "";
  return pending === 1 ? t("composer.initializingThread") : t("composer.initializingThreadQueued", { count: pending });
});

function onComposeInputUpdate(value: string) {
  runtimeStore.composeInput = value;
}

function onModelUpdate(value: string) {
  runtimeStore.model = value;
  runtimeStore.reasoningEffort = resolveReasoningEffort(
    modelCatalogStore.models,
    value,
    runtimeStore.reasoningEffort,
    modelCatalogStore.preferredModelEffort || null
  );
}

function onReasoningEffortUpdate(value: string) {
  runtimeStore.reasoningEffort = value;
}

function onSandboxModeUpdate(value: SandboxMode) {
  runtimeStore.setSandboxMode(value);
}

function onComposeModeChange(mode: CollaborationModeKind) {
  runtimeStore.setComposeMode(mode);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function popoverStyleFromPlacement(placement: PopoverPlacement | null): Record<string, string> {
  if (!placement) return { visibility: "hidden" };
  return {
    top: `${Math.round(placement.top)}px`,
    left: `${Math.round(placement.left)}px`,
    width: `${Math.round(placement.width)}px`,
    maxHeight: `${Math.round(placement.maxHeight)}px`,
  };
}

function resolvePopoverPlacement(
  anchorEl: HTMLElement,
  popoverEl: HTMLElement | null,
  opts: {
    align: "start" | "end";
    minWidth: number;
    preferredWidth: number;
    maxWidth: number;
    maxHeight: number;
    minHeight?: number;
    gap?: number;
    viewportMargin?: number;
    defaultDir?: PopoverDirection;
    anchorRectOverride?: PopoverAnchorRect;
  }
): PopoverPlacement {
  const viewportWidth = Math.max(window.innerWidth || 0, document.documentElement?.clientWidth || 0);
  const viewportHeight = Math.max(window.innerHeight || 0, document.documentElement?.clientHeight || 0);
  const margin = Math.max(8, Number(opts.viewportMargin ?? 12));
  const gap = Math.max(0, Number(opts.gap ?? 8));
  const anchorRect = opts.anchorRectOverride ?? anchorEl.getBoundingClientRect();

  const maxWidthByViewport = Math.max(220, viewportWidth - margin * 2);
  const minWidth = Math.min(Math.max(220, opts.minWidth), maxWidthByViewport);
  const maxWidth = Math.min(Math.max(minWidth, opts.maxWidth), maxWidthByViewport);
  const preferredWidth = clampNumber(opts.preferredWidth, minWidth, maxWidth);
  const width = preferredWidth;

  const leftRaw = opts.align === "end" ? anchorRect.right - width : anchorRect.left;
  const left = clampNumber(leftRaw, margin, Math.max(margin, viewportWidth - margin - width));

  const rawSpaceAbove = Math.max(0, anchorRect.top - margin - gap);
  const rawSpaceBelow = Math.max(0, viewportHeight - anchorRect.bottom - margin - gap);
  const minHeight = Math.max(48, Number(opts.minHeight ?? 120));
  const maxHeight = Math.max(120, Number(opts.maxHeight));
  const measuredHeight = popoverEl ? Math.max(popoverEl.offsetHeight, popoverEl.scrollHeight) : maxHeight;
  const desiredHeight = clampNumber(measuredHeight || maxHeight, minHeight, maxHeight);

  let dir: PopoverDirection = opts.defaultDir ?? "up";
  const canFitAbove = rawSpaceAbove >= desiredHeight;
  const canFitBelow = rawSpaceBelow >= desiredHeight;
  if (dir === "up") {
    if (!canFitAbove && (canFitBelow || rawSpaceBelow > rawSpaceAbove)) dir = "down";
  } else if (!canFitBelow && (canFitAbove || rawSpaceAbove > rawSpaceBelow)) {
    dir = "up";
  }

  const allowedHeight = Math.max(minHeight, Math.min(maxHeight, dir === "down" ? rawSpaceBelow : rawSpaceAbove));
  const displayHeight = Math.min(desiredHeight, allowedHeight);
  const renderedHeight = Math.min(measuredHeight > 0 ? measuredHeight : displayHeight, allowedHeight);
  const topRaw = dir === "down" ? anchorRect.bottom + gap : anchorRect.top - gap - renderedHeight;
  const top = clampNumber(topRaw, margin, Math.max(margin, viewportHeight - margin - renderedHeight));

  return { top, left, width, maxHeight: allowedHeight, dir };
}

function firstEnabledSlashIndex(commands: SlashCommandDef[]): number {
  return commands.findIndex((command) => !command.disabled);
}

function normalizeActiveSlashIndex(commands: SlashCommandDef[]): void {
  if (commands.length === 0) {
    activeSlashIndex.value = -1;
    return;
  }
  if (
    activeSlashIndex.value >= 0 &&
    activeSlashIndex.value < commands.length &&
    !commands[activeSlashIndex.value]?.disabled
  )
    return;
  const enabled = firstEnabledSlashIndex(commands);
  activeSlashIndex.value = enabled >= 0 ? enabled : 0;
}

function findNextEnabledSlashIndex(commands: SlashCommandDef[], startIndex: number, direction: 1 | -1): number {
  if (commands.length === 0) return -1;
  const baseIndex = startIndex >= 0 ? startIndex : direction > 0 ? -1 : 0;
  let cursor = baseIndex;
  for (let i = 0; i < commands.length; i += 1) {
    cursor =
      direction > 0
        ? (cursor + 1 + commands.length) % commands.length
        : (cursor - 1 + commands.length) % commands.length;
    if (!commands[cursor]?.disabled) return cursor;
  }
  return -1;
}

function refreshSlashPopoverPlacement() {
  if (!slashPopoverVisible.value) return;
  const anchor = composerPanelRef.value;
  if (!anchor) return;
  const anchorRect = anchor.getBoundingClientRect();
  const popoverWidth = Math.max(300, Math.round(anchorRect.width));
  slashPopoverPlacement.value = resolvePopoverPlacement(anchor, slashPopoverRef.value, {
    align: "start",
    minWidth: popoverWidth,
    preferredWidth: popoverWidth,
    maxWidth: popoverWidth,
    maxHeight: 360,
    minHeight: 52,
    gap: 4,
    defaultDir: "up",
  });
}

function scheduleSlashPopoverPlacementRefresh() {
  if (!slashPopoverVisible.value) return;
  if (pendingSlashPopoverPlacementRafId != null) cancelAnimationFrame(pendingSlashPopoverPlacementRafId);
  pendingSlashPopoverPlacementRafId = requestAnimationFrame(() => {
    pendingSlashPopoverPlacementRafId = null;
    refreshSlashPopoverPlacement();
  });
}

function observeSlashPopoverSize() {
  const element = slashPopoverRef.value;
  if (!element) return;
  if (!slashPopoverResizeObserver) {
    slashPopoverResizeObserver = new ResizeObserver(() => {
      scheduleSlashPopoverPlacementRefresh();
    });
  }
  slashPopoverResizeObserver.disconnect();
  slashPopoverResizeObserver.observe(element);
}

function stopObservingSlashPopoverSize() {
  if (slashPopoverResizeObserver) slashPopoverResizeObserver.disconnect();
  if (pendingSlashPopoverPlacementRafId != null) {
    cancelAnimationFrame(pendingSlashPopoverPlacementRafId);
    pendingSlashPopoverPlacementRafId = null;
  }
}

function refreshOpenPopoversPlacement() {
  if (!slashPopoverVisible.value) return;
  refreshSlashPopoverPlacement();
}

function onWindowKeydown(event: KeyboardEvent) {
  if (isToggleDebugTimelineShortcut(event)) {
    event.preventDefault();
    event.stopPropagation();
    runtimeStore.toggleTimelineDebugEnabled();
    return;
  }
}

function isToggleDebugTimelineShortcut(event: KeyboardEvent) {
  if (event.isComposing) return false;
  if (!(event.ctrlKey || event.metaKey) || !event.altKey) return false;
  return event.code === "KeyJ";
}

function onWindowViewportChange() {
  refreshOpenPopoversPlacement();
}

function onSlashCommandHover(index: number) {
  const command = filteredSlashCommands.value[index];
  if (!command || command.disabled) return;
  activeSlashIndex.value = index;
}

function parseImageMimeTypeFromDataUrl(value: string): string {
  const match = String(value ?? "")
    .trim()
    .match(/^data:(image\/[^;]+);base64,/i);
  return String(match?.[1] ?? "image/png").toLowerCase();
}

function imageExtensionFromMimeType(mimeTypeValue: string): string {
  const mimeType = String(mimeTypeValue ?? "")
    .trim()
    .toLowerCase();
  if (!mimeType) return "png";
  if (mimeType.includes("jpeg")) return "jpg";
  const extension = mimeType.split("/")[1] ?? "png";
  const normalized = extension.replace(/[^a-z0-9.+-]/gi, "");
  return normalized || "png";
}

function fileNameFromPathLike(value: string, fallback: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) return fallback;
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || fallback;
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("failed to read file"));
    reader.readAsDataURL(file);
  });
}

async function buildComposeAttachmentFromFile(file: File, imageIndex: number): Promise<ComposeImageAttachment | null> {
  const imageFile = file as LocalImageFile;
  const filePath = String(imageFile.path ?? "").trim();
  if (filePath) {
    return {
      id: `compose-local-image:${Date.now()}:${imageIndex}:${Math.random().toString(16).slice(2)}`,
      name: fileNameFromPathLike(filePath, file.name || `image-${imageIndex + 1}.png`),
      size: Number(file.size ?? 0),
      mimeType: String(file.type ?? "image/*") || "image/*",
      previewUrl: URL.createObjectURL(file),
      revokePreviewUrlOnDispose: true,
      input: { type: "localImage", path: filePath },
    };
  }

  const dataUrl = await readFileAsDataUrl(file);
  if (!dataUrl) return null;
  const mimeType = String(file.type ?? "").trim() || parseImageMimeTypeFromDataUrl(dataUrl);
  const extension = imageExtensionFromMimeType(mimeType);
  return {
    id: `compose-image:${Date.now()}:${imageIndex}:${Math.random().toString(16).slice(2)}`,
    name: String(file.name ?? "").trim() || `image-${imageIndex + 1}.${extension}`,
    size: Number(file.size ?? 0),
    mimeType,
    previewUrl: dataUrl,
    revokePreviewUrlOnDispose: false,
    input: { type: "image", url: dataUrl },
  };
}

function ensureComposerSelectionVisible() {
  const el = composerInputRef.value;
  if (!el) return;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  const anchorNode = range.startContainer;
  if (anchorNode !== el && !el.contains(anchorNode)) return;

  const rectList = range.getClientRects();
  const selectionRect = rectList.length > 0 ? rectList.item(rectList.length - 1) : range.getBoundingClientRect();
  if (!selectionRect) return;

  const containerRect = el.getBoundingClientRect();
  const topInset = 4;
  const bottomInset = 8;
  const minVisibleTop = containerRect.top + topInset;
  const maxVisibleBottom = containerRect.bottom - bottomInset;
  const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);

  if (selectionRect.top < minVisibleTop) {
    el.scrollTop = Math.max(0, el.scrollTop - (minVisibleTop - selectionRect.top));
    return;
  }
  if (selectionRect.bottom > maxVisibleBottom) {
    el.scrollTop = Math.min(maxScrollTop, el.scrollTop + (selectionRect.bottom - maxVisibleBottom));
  }
}

function resizeComposerInput() {
  const el = composerInputRef.value;
  if (!el) return;
  const previousMaxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
  const previousBottomOffset = Math.max(0, previousMaxScrollTop - el.scrollTop);
  const styles = window.getComputedStyle(el);
  const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
  const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
  const minHeight = 20;
  const maxHeight = Math.max(minHeight, Math.round(lineHeight * 5 + paddingTop + paddingBottom));
  el.style.height = "auto";
  const contentHeight = el.scrollHeight;
  const nextHeight = Math.min(maxHeight, Math.max(minHeight, contentHeight));
  el.style.height = `${nextHeight}px`;
  const overflow = contentHeight > maxHeight;
  el.style.overflowY = overflow ? "auto" : "hidden";
  if (!overflow) {
    el.scrollTop = 0;
    return;
  }

  const selection = window.getSelection();
  const anchorNode = selection?.rangeCount ? selection.getRangeAt(0).startContainer : null;
  const selectionInsideComposer = Boolean(anchorNode && (anchorNode === el || el.contains(anchorNode)));
  if (document.activeElement === el) {
    if (selectionInsideComposer) ensureComposerSelectionVisible();
    else el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    return;
  }

  if (previousMaxScrollTop <= 0) {
    el.scrollTop = 0;
    return;
  }

  const nextMaxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
  el.scrollTop = Math.max(0, Math.min(nextMaxScrollTop, nextMaxScrollTop - previousBottomOffset));
}

function refreshTimelineLayout(options: { resizeComposer: boolean }) {
  measureCenterContentWidth();
  if (options.resizeComposer) resizeComposerInput();
  void nextTick(() => {
    notifyTimelineLayoutChange();
    scheduleTimelineViewportStateUpdate();
  });
  refreshOpenPopoversPlacement();
}

function onPaneLayoutChange() {
  refreshTimelineLayout({ resizeComposer: false });
}

function onWindowLayoutChange() {
  refreshTimelineLayout({ resizeComposer: true });
}

async function addComposeImageFiles(files: Iterable<File>) {
  const fileList = Array.from(files ?? []).filter((file) => {
    const mimeType = String(file.type ?? "").toLowerCase();
    const name = String(file.name ?? "").toLowerCase();
    return mimeType.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name);
  });
  if (fileList.length === 0) return;

  const attachments: ComposeImageAttachment[] = [];
  let imageIndex = runtimeStore.composeAttachments.length;
  for (const file of fileList) {
    try {
      const attachment = await buildComposeAttachmentFromFile(file, imageIndex);
      if (attachment) attachments.push(attachment);
    } catch {}
    imageIndex += 1;
  }
  if (attachments.length === 0) return;
  runtimeStore.addComposeAttachments(attachments);
  await nextTick();
  resizeComposerInput();
  notifyTimelineLayoutChange();
}

function onPickComposeImages() {
  composerImageInputRef.value?.click();
}

async function onComposerImageInputChange(event: Event) {
  const input = event.target as HTMLInputElement | null;
  const files = input?.files ? Array.from(input.files) : [];
  await addComposeImageFiles(files);
  if (input) input.value = "";
}

async function onComposerPaste(event: ClipboardEvent) {
  const items = Array.from(event.clipboardData?.items ?? []);
  const files = items
    .filter((item) => item.kind === "file" && String(item.type ?? "").startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  if (files.length === 0) return;
  event.preventDefault();
  await addComposeImageFiles(files);
}

function onComposeFileMentionsUpdate(value: typeof runtimeStore.composeFileMentions) {
  runtimeStore.composeFileMentions = Array.isArray(value) ? value.map((item) => ({ ...item })) : [];
  runtimeStore.saveThreadComposeFileMentions(runtimeStore.currentThreadId);
}

function onRemoveComposeAttachment(attachmentId: string) {
  runtimeStore.removeComposeAttachment(attachmentId);
  if (composeLightboxAttachmentId.value === attachmentId) composeLightboxAttachmentId.value = "";
}

function onPreviewComposeAttachment(attachmentId: string) {
  composeLightboxAttachmentId.value = String(attachmentId ?? "").trim();
  nextTick(() => composeLightboxCloseRef.value?.focus());
}

function closeComposeLightbox() {
  composeLightboxAttachmentId.value = "";
  nextTick(() => composerInputRef.value?.focus());
}

function onComposeLightboxWindowKeydown(event: KeyboardEvent) {
  if (!composeLightboxAttachment.value) return;
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  closeComposeLightbox();
}

async function onSlashCommandClick(commandId: string) {
  const command = filteredSlashCommands.value.find((item) => item.id === commandId);
  if (!command || command.disabled) return;
  await command.run();
  runtimeStore.composeInput = "";
  await nextTick();
  resizeComposerInput();
  composerInputRef.value?.focus();
}

async function applyActiveSlashCommand() {
  const commands = filteredSlashCommands.value;
  const selected = commands[activeSlashIndex.value] ?? null;
  const command = selected && !selected.disabled ? selected : (commands.find((item) => !item.disabled) ?? null);
  if (!command) return;
  await onSlashCommandClick(command.id);
}

function onComposerKeydown(event: KeyboardEvent) {
  if (event.key === "Tab" && event.shiftKey && !event.isComposing) {
    event.preventDefault();
    const nextMode: CollaborationModeKind = runtimeStore.composeMode === "plan" ? "default" : "plan";
    runtimeStore.setComposeMode(nextMode);
    void nextTick(() => {
      composerInputRef.value?.focus({ preventScroll: true });
    });
    return;
  }
  if (slashPopoverVisible.value) {
    const commands = filteredSlashCommands.value;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex = findNextEnabledSlashIndex(commands, activeSlashIndex.value, 1);
      if (nextIndex >= 0) activeSlashIndex.value = nextIndex;
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const prevIndex = findNextEnabledSlashIndex(commands, activeSlashIndex.value, -1);
      if (prevIndex >= 0) activeSlashIndex.value = prevIndex;
      return;
    }
    if ((event.key === "Enter" || event.key === "Tab") && commands.some((command) => !command.disabled)) {
      event.preventDefault();
      void applyActiveSlashCommand();
      return;
    }
  }
  if (event.key !== "Enter") return;
  if (event.isComposing) return;
  if (event.shiftKey) return;
  event.preventDefault();
  void onSendClick();
}

async function onSendClick() {
  if (sendDisabled.value) return;
  await runtime.send();
  await nextTick();
  resizeComposerInput();
  forceFollowBottom("send");
}

async function onInterruptTurnClick() {
  if (interruptDisabled.value) return;
  await runtime.interruptTurn();
}

async function onEditQueuedMessage(messageId: string) {
  await runtime.editQueuedMessage(messageId);
  await nextTick();
  resizeComposerInput();
  composerInputRef.value?.focus();
}

async function onSendQueuedMessageNow(messageId: string) {
  await runtime.sendQueuedMessageNow(messageId);
  forceFollowBottom("send-queued");
}

async function onRemoveQueuedMessage(messageId: string) {
  await runtime.removeQueuedMessage(messageId);
}

function onCancelRewrite() {
  runtimeStore.cancelHistoryRewrite({ restoreDraft: true });
  nextTick(() => {
    resizeComposerInput();
    composerInputRef.value?.focus();
  });
}

async function onEmptyStateSwitchThread(threadId: string) {
  await runtime.switchThread(threadId);
}

watch(
  () => runtimeStore.composerFocusSeq,
  () => {
    nextTick(() => composerInputRef.value?.focus());
  }
);

watch(filteredSlashCommands, (commands) => {
  normalizeActiveSlashIndex(commands);
  if (!slashPopoverVisible.value) return;
  nextTick(() => scheduleSlashPopoverPlacementRefresh());
});

watch(
  slashPopoverVisible,
  (visible) => {
    if (!visible) {
      activeSlashIndex.value = -1;
      slashPopoverPlacement.value = null;
      stopObservingSlashPopoverSize();
      return;
    }
    nextTick(() => {
      normalizeActiveSlashIndex(filteredSlashCommands.value);
      observeSlashPopoverSize();
      scheduleSlashPopoverPlacementRefresh();
    });
  },
  { flush: "post" }
);

watch(
  () => queueItems.value.length,
  () => {
    void nextTick(() => {
      notifyTimelineLayoutChange();
      scheduleTimelineViewportStateUpdate();
    });
  }
);

watch(
  () => runtimeStore.timelineKey,
  () => {
    slashPopoverPlacement.value = null;
  },
  { flush: "post" }
);

watch(
  () => runtimeStore.timelineScrollToBottomSeq,
  () => {
    forceFollowBottom("runtime-request");
  },
  { flush: "post" }
);

watch(
  () => [runtimeStore.timelineDebugEnabled, timelineContentRevision.value, timelineRevision.value] as const,
  () => {
    if (!import.meta.env.DEV || !runtimeStore.timelineDebugEnabled) return;
    const now = Date.now();
    if (now - lastTimelineStatsLogAt < 1000) return;
    lastTimelineStatsLogAt = now;
    console.debug("[timeline:stats]", timelineKey.value, timelineStats.value);
  },
  { flush: "post" }
);

watch(
  () => runtimeStore.composeInput,
  () => {
    nextTick(() => {
      resizeComposerInput();
      if (slashPopoverVisible.value) scheduleSlashPopoverPlacementRefresh();
    });
  },
  { flush: "post" }
);

watch(
  () => runtimeStore.composeAttachments.length,
  () => {
    nextTick(() => {
      resizeComposerInput();
      if (slashPopoverVisible.value) scheduleSlashPopoverPlacementRefresh();
    });
  },
  { flush: "post" }
);

watch(
  () => runtimeStore.composeFileMentions.length,
  () => {
    nextTick(() => {
      resizeComposerInput();
      if (slashPopoverVisible.value) scheduleSlashPopoverPlacementRefresh();
    });
  },
  { flush: "post" }
);

watch(composeLightboxAttachment, (value) => {
  if (value) window.addEventListener("keydown", onComposeLightboxWindowKeydown, true);
  else window.removeEventListener("keydown", onComposeLightboxWindowKeydown, true);
});

watch(shouldShowComposerPanel, (visible) => {
  if (!visible) {
    if (composerResizeObserver) {
      composerResizeObserver.disconnect();
      composerResizeObserver = null;
    }
    composerDockHeightPx.value = 0;
    return;
  }
  void nextTick(() => {
    observeComposerPanelSize();
    resizeComposerInput();
  });
});

watch(
  () => skillsUiStore.managerOpen,
  (open, prev) => {
    if (open && !prev) {
      return;
    }
    if (!open && prev) {
      void nextTick(() => {
        scheduleTimelineViewportStateUpdate();
      });
    }
  },
  { flush: "pre" }
);

onMounted(() => {
  resizeComposerInput();
  measureCenterContentWidth();
  void nextTick(() => {
    observeComposerPanelSize();
  });
  centerContentResizeObserver = new ResizeObserver(() => {
    measureCenterContentWidth();
  });
  if (centerContentRef.value) centerContentResizeObserver.observe(centerContentRef.value);
  observeTimelineElement();
  window.addEventListener("resize", onWindowLayoutChange);
  window.addEventListener("scroll", onWindowViewportChange, true);
  window.addEventListener("keydown", onWindowKeydown);
  scheduleTimelineViewportStateUpdate();
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", onWindowLayoutChange);
  window.removeEventListener("scroll", onWindowViewportChange, true);
  window.removeEventListener("keydown", onWindowKeydown);
  window.removeEventListener("keydown", onComposeLightboxWindowKeydown, true);
  if (pendingSlashPopoverPlacementRafId != null) cancelAnimationFrame(pendingSlashPopoverPlacementRafId);
  if (centerContentResizeObserver) {
    centerContentResizeObserver.disconnect();
    centerContentResizeObserver = null;
  }
  if (slashPopoverResizeObserver) {
    slashPopoverResizeObserver.disconnect();
    slashPopoverResizeObserver = null;
  }
  if (composerResizeObserver) {
    composerResizeObserver.disconnect();
    composerResizeObserver = null;
  }
});
</script>
