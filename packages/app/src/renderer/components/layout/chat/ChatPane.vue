<template>
  <div class="chat-pane flex flex-col">
    <div v-if="handoffDiagnosticsBanner" :class="CHAT_ROW_ACTIVITY_CLASS">
      <div class="chat-activity-line inline-flex w-full max-w-full items-center gap-2.5 px-2.5 py-0.5 text-xs dim">
        <span
          v-if="handoffDiagnosticsBanner.tone !== 'running'"
          class="chat-activity-dot h-1.5 w-1.5 flex-none rounded-full bg-[var(--ui-activity-dot-bg)] shadow-[var(--ui-activity-dot-shadow)]"
          :class="activityDotClass(handoffDiagnosticsBanner.tone)"
          aria-hidden="true"
        ></span>
        <span class="mono whitespace-nowrap">{{ t("chatPane.handoffRecord") }}</span>
        <ExecutionWaveText v-if="handoffDiagnosticsBanner.tone === 'running'" :text="handoffDiagnosticsBanner.text" />
        <span v-else>{{ handoffDiagnosticsBanner.text }}</span>
      </div>
    </div>

    <div ref="pinnedPromptLayerRef" class="chat-pinned-prompt-layer">
      <Transition name="chat-pinned-prompt">
        <ChatPinnedUserPromptBox
          v-if="pinnedUserMessage"
          :contentKey="pinnedUserMessage.rowId"
          :text="pinnedUserMessage.text"
          :messageParts="pinnedUserMessage.parts"
          :title="pinnedUserMessage.title"
          :fileCount="pinnedUserMessage.fileCount"
          :imageCount="pinnedUserMessage.imageCount"
          :transitionDirection="pinnedPromptTransitionDirection"
          :showTimestamp="viewPrefs.showTimestamps"
          :formattedTime="pinnedUserMessage.formattedTime"
          @locate="onPinnedUserClick"
          @file-token-click="onUserFileTokenClick"
        />
      </Transition>
    </div>

    <ChatTimelineViewport
      :rows="chatRenderedRows"
      :timelineKey="timelineKey"
      :scrollElement="scrollElement"
      :onLayoutChange="onLayoutChange"
      :onViewportAdapterChange="setLocalViewportAdapter"
      :onPinnedUserRowChange="setPinnedUserRowId"
      #default="{ row: renderedRow }"
    >
      <ChatRowRenderer
        :renderedRow="renderedRow"
        :workspaceRoot="workspaceRoot"
        :viewPrefs="viewPrefs"
        :planExecStateByEventId="planExecStateByEventId"
        :modelOptions="modelOptions"
        :isTurnRunning="isTurnRunning"
        :sandboxModeOptions="sandboxModeOptions"
        :userMessageParts="userMessageParts"
        :userMessageImageCount="userMessageImageCount"
        :visibleUserMessageImageEntries="visibleUserMessageImageEntries"
        :visibleImageToolEntries="visibleImageToolEntries"
        :handleThumbLoadError="onThumbLoadError"
        :handleUserFileTokenClick="onUserFileTokenClick"
        :handleUserBubbleClick="onUserBubbleClick"
        :handlePreviewImage="onPreviewImage"
        :inlineRewriteDraft="inlineRewriteDraft"
        :onInlineRewriteUpdate="updateInlineRewriteDraft"
        :onInlineRewriteCancel="closeInlineRewrite"
        :onInlineRewriteSend="sendInlineRewriteDraft"
        :handleLayoutChange="onLayoutChange"
        :getMarkdownEventHtml="getMarkdownEventHtml"
        :isReasoningOpen="isReasoningOpen"
        :setReasoningOpen="setReasoningOpen"
        :isCommandFilesOpen="isCommandFilesOpen"
        :toggleCommandFilesOpen="toggleCommandFilesOpen"
        :isCommandSessionStopping="isCommandSessionStopping"
        :stopCommandSession="stopCommandSession"
        :isMcpToolGroupOpen="isMcpToolGroupOpen"
        :onMcpToolGroupToggle="onMcpToolGroupToggle"
        :isMcpToolItemDetailOpen="isMcpToolItemDetailOpen"
        :onMcpToolItemDetailToggle="onMcpToolItemDetailToggle"
        :isMcpResourceOpen="isMcpResourceOpen"
        :setMcpResourceOpen="setMcpResourceOpen"
        :openMcpResourceInPanel="openMcpResourceInPanel"
        :onOpenRelatedMcpResource="onOpenRelatedMcpResource"
        :executePlanFromPlanDelta="onExecutePlanFromPlanDelta"
        :updatePlanExecModel="updatePlanExecModel"
        :updatePlanExecReasoningEffort="updatePlanExecReasoningEffort"
        :updatePlanExecSandboxMode="updatePlanExecSandboxMode"
      />
    </ChatTimelineViewport>

    <div
      v-if="trailingContextCompactionEvent"
      :class="[CHAT_ROW_BASE_CLASS, 'chat-row--tail', 'chat-row--context-compaction']"
    >
      <div
        class="chat-context-compaction-line flex w-full max-w-full items-center justify-center px-2.5 py-0.5 text-center"
      >
        <WaveText
          v-if="isContextCompactionRunning"
          as="div"
          class="chat-context-compaction-text mono"
          color="var(--text-muted)"
          :text="trailingContextCompactionEvent.paramsText"
        />
        <div v-else class="chat-context-compaction-text is-completed mono">
          {{ trailingContextCompactionEvent.paramsText }}
        </div>
      </div>
    </div>

    <div
      v-if="showTrailingThinkingEvent && trailingThinkingEvent"
      :class="[CHAT_ROW_BASE_CLASS, 'chat-row--tail', 'chat-row--thinking']"
    >
      <div class="chat-thinking-line flex w-full max-w-full items-center justify-start pr-2.5">
        <WaveText class="mono dim" :text="trailingThinkingEvent.paramsText" />
      </div>
    </div>

    <Teleport to="body">
      <Transition name="composer-lightbox">
        <div
          v-if="imageLightboxOpen"
          class="composer-lightbox-overlay composer-lightbox-overlay--image"
          role="dialog"
          aria-modal="true"
          :aria-label="imageLightboxTitle || t('lazyImage.previewTitle')"
        >
          <div class="composer-lightbox-backdrop" aria-hidden="true" @click="closeImageLightbox"></div>
          <div class="composer-lightbox-stage composer-lightbox-stage--image" @click.self="closeImageLightbox">
            <div
              class="composer-lightbox-viewport"
              :class="{ 'is-dragging': imageLightboxDragging }"
              @wheel="onImageLightboxWheel"
              @pointerdown="onImageLightboxPointerDown"
              @pointermove="onImageLightboxPointerMove"
              @pointerup="finishImageLightboxDrag"
              @pointercancel="finishImageLightboxDrag"
              @lostpointercapture="finishImageLightboxDrag"
            >
              <img
                class="composer-lightbox-image composer-lightbox-image--interactive"
                :src="imageLightboxSrc"
                :alt="imageLightboxTitle || t('lazyImage.previewTitle')"
                :style="imageLightboxTransformStyle"
                draggable="false"
              />
            </div>
            <div class="composer-lightbox-toolbar app-scrollbar" @pointerdown.stop @click.stop>
              <span class="composer-lightbox-zoom mono">{{ Math.round(imageLightboxZoom * 100) }}%</span>
              <button class="composer-lightbox-action" type="button" @click="zoomImageLightboxOut">
                <ZoomOut aria-hidden="true" />
              </button>
              <button class="composer-lightbox-action" type="button" @click="zoomImageLightboxIn">
                <ZoomIn aria-hidden="true" />
              </button>
              <button class="composer-lightbox-action" type="button" @click="resetImageLightboxView">
                <RotateCcw aria-hidden="true" />
              </button>
              <button class="composer-lightbox-action" type="button" @click="downloadImageLightboxImage">
                <Download aria-hidden="true" />
              </button>
              <button
                ref="imageLightboxCloseButtonRef"
                class="composer-lightbox-action composer-lightbox-action--close"
                type="button"
                @click="closeImageLightbox"
              >
                <X aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Download, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-vue-next";
import ChatTimelineViewport from "./ChatTimelineViewport.vue";
import ChatRowRenderer from "./ChatRowRenderer.vue";
import ChatPinnedUserPromptBox from "../../chat/ChatPinnedUserPromptBox.vue";
import { chatActivityToneClass } from "./chatStyle";
import { CHAT_ROW_ACTIVITY_CLASS, CHAT_ROW_BASE_CLASS } from "./chatPresentation";
import ExecutionWaveText from "../../ui/ExecutionWaveText.vue";
import WaveText from "../../ui/WaveText.vue";

import type { TimelineEventItem } from "../../../domain/types";
import type { TimelineViewportAdapter } from "./timelineScrollPolicy";
import { useAppShellStore } from "../../../stores/appShell.store";
import { useMcpResourceStore } from "../../../stores/mcpResource.store";
import { useMcpStore } from "../../../stores/mcp.store";
import { useRuntimeStore } from "../../../stores/runtime.store";
import { useModelCatalogStore } from "../../../stores/modelCatalog.store";
import { useViewPrefsStore } from "../../../stores/viewPrefs.store";
import { useAgentMarkdownRenderer } from "../../../features/timeline/useAgentMarkdownRenderer";
import { buildMcpToolDefinitionIndex } from "../../../features/timeline/renderModel/buildTimelineNodes";
import { formatTime } from "../../../features/timeline/renderModel/formatters";
import { buildModelPickerOptions } from "@codenexus/shared/modelCatalog";
import { codexDesktop } from "../../../api/codexDesktopClient";
import { showToast } from "../../../ui/toast";

import { useChatTimeline } from "../composables/useChatTimeline";
import { usePlanExecution } from "../composables/usePlanExecution";
import { useImageLightbox } from "../composables/useImageLightbox";
import { useChatLayout } from "../composables/useChatLayout";
import { useChatMessageParts } from "../composables/useChatMessageParts";
import { useChatRenderModel } from "../composables/useChatRenderModel";
import { useInlineHistoryRewrite } from "../composables/useInlineHistoryRewrite";
import type {
  CommandSessionNode,
  McpResourceReadNode,
} from "../../../features/timeline/renderModel/buildTimelineNodes";
import type { McpToolItem } from "../../timeline/cards/McpToolCardContent.vue";

const props = defineProps<{
  contentEvents: TimelineEventItem[];
  contentRevision: number;
  workspaceRoot: string;
  trailingThinkingEvent: TimelineEventItem | null;
  trailingContextCompactionEvent: TimelineEventItem | null;
  timelineKey: string;
  scrollElement: HTMLElement | null;
  onLayoutChange?: () => void;
  onViewportAdapterChange?: (adapter: TimelineViewportAdapter | null) => void;
  inlineRewriteCloseSeq?: number;
}>();

const appShellStore = useAppShellStore();
const { t } = useI18n();
const mcpStore = useMcpStore();
const mcpResourceStore = useMcpResourceStore();
const runtimeStore = useRuntimeStore();
const viewPrefs = useViewPrefsStore();
const modelCatalogStore = useModelCatalogStore();
const localViewportAdapter = ref<TimelineViewportAdapter | null>(null);
const pinnedUserRowId = ref("");
const pinnedPromptTransitionDirection = ref<"up" | "down">("up");
const pinnedPromptLayerRef = ref<HTMLElement | null>(null);
const PINNED_PROMPT_TOP_GAP_PX = 0;

const { getMarkdownEventHtml } = useAgentMarkdownRenderer({ key: () => runtimeStore.timelineKey });
const mcpToolDefinitions = computed(() => buildMcpToolDefinitionIndex(mcpStore.servers));

const { isTurnRunning } = useChatTimeline();

const { hiddenImageIds, handoffDiagnosticsBanner } = useChatLayout();

const {
  userMessageParts,
  userMessageImageCount,
  visibleUserMessageImageEntries,
  visibleImageToolEntries,
  onThumbLoadError,
  onUserFileTokenClick,
  getUserMessageSnapshot,
} = useChatMessageParts(() => hiddenImageIds.value, props.onLayoutChange);

const {
  inlineRewriteDraft,
  openInlineRewrite: onUserBubbleClick,
  updateInlineRewriteDraft,
  closeInlineRewrite,
  sendInlineRewriteDraft,
} = useInlineHistoryRewrite({
  closeSeq: () => props.inlineRewriteCloseSeq,
  getUserMessageSnapshot,
});

const {
  chatRenderedRows,
  isReasoningOpen,
  setReasoningOpen,
  isMcpToolGroupOpen,
  onMcpToolGroupToggle,
  isMcpToolItemDetailOpen,
  onMcpToolItemDetailToggle,
  isMcpResourceOpen,
  setMcpResourceOpen,
} = useChatRenderModel(
  () => props.contentEvents,
  () => props.contentRevision,
  () => props.workspaceRoot,
  () => mcpToolDefinitions.value,
  props.onLayoutChange
);

const {
  planExecStateByEventId,
  onExecutePlanFromPlanDelta,
  updatePlanExecModel,
  updatePlanExecReasoningEffort,
  updatePlanExecSandboxMode,
} = usePlanExecution(
  () => props.contentEvents,
  () => isTurnRunning.value
);

const {
  imageLightboxOpen,
  imageLightboxSrc,
  imageLightboxTitle,
  imageLightboxCloseButtonRef,
  imageLightboxZoom,
  imageLightboxDragging,
  imageLightboxTransformStyle,
  closeImageLightbox,
  resetImageLightboxView,
  zoomImageLightboxIn,
  zoomImageLightboxOut,
  onImageLightboxWheel,
  onImageLightboxPointerDown,
  onImageLightboxPointerMove,
  finishImageLightboxDrag,
  downloadImageLightboxImage,
  onPreviewImage,
} = useImageLightbox();

const commandFilesOpenById = ref(new Map<string, boolean>());
const isCommandFilesOpen = (nodeId: string) => commandFilesOpenById.value.get(String(nodeId ?? "")) ?? false;
function toggleCommandFilesOpen(nodeId: string) {
  const id = String(nodeId ?? "").trim();
  if (!id) return;
  commandFilesOpenById.value.set(id, !isCommandFilesOpen(id));
}

const stoppingCommandProcessIds = ref(new Set<string>());
const isCommandSessionStopping = (processId: string) =>
  stoppingCommandProcessIds.value.has(String(processId ?? "").trim());

async function stopCommandSession(item: CommandSessionNode) {
  const processId = String(item?.processId ?? "").trim();
  const serverId = String(runtimeStore.serverId ?? "").trim();
  if (!processId || !serverId || isCommandSessionStopping(processId)) return;

  stoppingCommandProcessIds.value.add(processId);
  try {
    await codexDesktop.codexServer
      .rpc({ serverId, method: "command/exec/terminate", params: { processId } })
      .catch(async () => {
        await codexDesktop.codexServer.rpc({
          serverId,
          method: "process/kill",
          params: { processHandle: processId },
        });
      });
    showToast({ kind: "success", title: t("chatPane.stopCommandRequested"), message: processId });
  } catch (error: any) {
    showToast({
      kind: "error",
      title: t("chatPane.stopCommandFailed"),
      message: String(error?.message ?? error),
    });
  } finally {
    stoppingCommandProcessIds.value.delete(processId);
  }
}

const contextCompactionPhase = computed(() => {
  const event = props.trailingContextCompactionEvent;
  const phase = (event?.params as any)?.phase;
  return phase === "started" || phase === "completed" ? phase : "";
});
const isContextCompactionRunning = computed(() => contextCompactionPhase.value === "started");
const showTrailingThinkingEvent = computed(
  () => !!props.trailingThinkingEvent && !props.trailingContextCompactionEvent
);

const openMcpResourceInPanel = (item: Pick<McpResourceReadNode, "server" | "uri" | "sourceTab" | "templateKey">) => {
  const threadId = String(runtimeStore.timelineKey ?? "").trim();
  const serverId = String(item?.server ?? "").trim();
  const uri = String(item?.uri ?? "").trim();
  if (!threadId || !serverId || !uri) return;
  const sourceTab = item?.sourceTab === "templates" ? "templates" : "resources";
  mcpResourceStore.requestOpen(serverId, sourceTab);
  if (sourceTab === "templates" && String(item?.templateKey ?? "").trim()) {
    mcpResourceStore.selectTemplate(serverId, String(item.templateKey).trim());
  } else {
    mcpResourceStore.selectResource(serverId, uri);
  }
  mcpResourceStore.hydrateFromCache(threadId, serverId, uri);
  appShellStore.openSettings("integrations", { integrationsTab: "mcp" });
};

const onOpenRelatedMcpResource = (item: McpToolItem) => {
  if (!item.relatedResourceUri) return;
  openMcpResourceInPanel({
    server: item.server,
    uri: item.relatedResourceUri,
    sourceTab: item.relatedResourceSourceTab,
    templateKey: item.relatedResourceTemplateKey,
  });
};

const activityDotClass = chatActivityToneClass;

function setLocalViewportAdapter(adapter: TimelineViewportAdapter | null) {
  localViewportAdapter.value = adapter;
  props.onViewportAdapterChange?.(adapter);
}

function setPinnedUserRowId(rowId: string) {
  const nextRowId = String(rowId ?? "").trim();
  const previousRowId = pinnedUserRowId.value;
  if (nextRowId && previousRowId && nextRowId !== previousRowId) {
    const previousIndex = chatRenderedRows.value.findIndex((item) => item.id === previousRowId);
    const nextIndex = chatRenderedRows.value.findIndex((item) => item.id === nextRowId);
    if (previousIndex >= 0 && nextIndex >= 0) {
      pinnedPromptTransitionDirection.value = nextIndex > previousIndex ? "up" : "down";
    }
  }
  pinnedUserRowId.value = nextRowId;
}

const pinnedUserRow = computed(() => {
  const rowId = pinnedUserRowId.value;
  if (!rowId) return null;
  const row = chatRenderedRows.value.find((item) => item.id === rowId) ?? null;
  return row?.kind === "user" ? row : null;
});

const pinnedUserMessage = computed(() => {
  const row = pinnedUserRow.value;
  if (!row) return null;
  const parts = userMessageParts(row.event);
  const textParts = parts
    .filter((part) => part.type === "text")
    .map((part) => part.text.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const fileCount = parts.filter((part) => part.type === "file").length;
  const imageCount = userMessageImageCount(row.event);
  const titleParts = parts
    .map((part) => {
      if (part.type === "file") return part.label;
      if (part.type === "text") return part.text.replace(/\s+/g, " ").trim();
      return "";
    })
    .filter(Boolean);
  const suffix = [
    fileCount > 0 ? t("chatPane.fileCount", { count: fileCount }) : "",
    imageCount > 0 ? t("chatPane.imageCount", { count: imageCount }) : "",
  ].filter(Boolean);
  const summary = textParts.join(" ").trim() || t("chatPane.userMessage");
  const title = [titleParts.join(" ").trim() || summary, ...suffix].filter(Boolean).join(" · ");
  return {
    rowId: row.id,
    text: summary,
    parts,
    title,
    fileCount,
    imageCount,
    formattedTime: formatTime(row.event.createdAt),
  };
});

function pinnedPromptLocateOffsetPx() {
  const prompt = pinnedPromptLayerRef.value?.querySelector<HTMLElement>(".chat-pinned-prompt") ?? null;
  const promptHeight = Math.ceil(prompt?.getBoundingClientRect().height ?? 0);
  return Math.max(8, promptHeight + PINNED_PROMPT_TOP_GAP_PX + 15);
}

function scrollDomRowToTop(rowId: string, offsetPx = 0) {
  const element = props.scrollElement;
  if (!element) return false;
  const row = Array.from(element.querySelectorAll<HTMLElement>(".chat-timeline-row")).find(
    (item) => String(item.dataset.rowId ?? "").trim() === rowId
  );
  if (!row) return false;
  const elementRect = element.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const delta = rowRect.top - elementRect.top - Math.max(0, Math.round(offsetPx));
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
  element.scrollTo({ top: Math.max(0, Math.min(maxScrollTop, element.scrollTop + delta)), behavior: "smooth" });
  return true;
}

function onPinnedUserClick() {
  const rowId = pinnedUserMessage.value?.rowId ?? "";
  if (!rowId) return;
  const offsetPx = pinnedPromptLocateOffsetPx();
  if (localViewportAdapter.value?.scrollRowToTop(rowId, offsetPx, "smooth")) return;
  scrollDomRowToTop(rowId, offsetPx);
}

const sandboxModeOptions = computed(
  () =>
    [
      { value: "read-only", label: t("composer.readOnlyShort") },
      { value: "workspace-write", label: t("composer.workspaceWriteShort") },
      { value: "danger-full-access", label: t("composer.dangerFullAccessShort") },
    ] as const
);
const modelOptions = computed(() =>
  buildModelPickerOptions({
    models: modelCatalogStore.models,
    current: runtimeStore.model,
    preferredModelValue: modelCatalogStore.preferredModelValue || null,
  })
);
</script>
