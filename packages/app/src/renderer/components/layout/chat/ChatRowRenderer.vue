<template>
  <ChatUserMessage
    v-if="renderedRow.kind === 'user'"
    :event="renderedRow.event"
    :workspaceRoot="workspaceRoot"
    :messageParts="userMessageParts(renderedRow.event)"
    :imageCount="userMessageImageCount(renderedRow.event)"
    :visibleImages="visibleUserMessageImageEntries(renderedRow.event)"
    :showTimestamps="viewPrefs.showTimestamps"
    :formattedTime="formatTime(renderedRow.event.createdAt)"
    :inlineRewriteDraft="inlineRewriteDraft?.anchorEventId === renderedRow.event.id ? inlineRewriteDraft : null"
    :modelOptions="modelOptions"
    :sandboxModeOptions="sandboxModeOptions"
    :sendDisabled="isTurnRunning"
    @click="handleUserBubbleClick"
    @file-token-click="handleUserFileTokenClick"
    @thumb-load-error="handleThumbLoadError"
    @preview-image="handlePreviewImage"
    @inline-rewrite-update="onInlineRewriteUpdate?.($event)"
    @inline-rewrite-cancel="onInlineRewriteCancel?.()"
    @inline-rewrite-send="onInlineRewriteSend?.()"
  />

  <ChatAssistantMessage
    v-else-if="renderedRow.kind === 'assistant'"
    :event="renderedRow.event"
    :isStructuredFinalAnswer="isStructuredFinalAnswerEvent(renderedRow.event)"
    :markdownHtml="assistantMarkdownHtml(renderedRow.event)"
    :execState="planExecStateByEventId[renderedRow.event.id] ?? null"
    :modelOptions="modelOptions"
    :isTurnRunning="isTurnRunning"
    :reasoningEffortOptions="reasoningEffortOptions"
    :sandboxModeOptions="sandboxModeOptions"
    @execute-plan="executePlanFromPlanDelta"
    @update:model="(value) => updatePlanExecModel(renderedRow.event.id, value)"
    @update:reasoning-effort="(value) => updatePlanExecReasoningEffort(renderedRow.event.id, value)"
    @update:sandbox-mode="(value) => updatePlanExecSandboxMode(renderedRow.event.id, value)"
  />

  <ChatSystemRow v-else-if="renderedRow.kind === 'system'" :text="renderedRow.text" />

  <ChatAuxActivityGroup
    v-else-if="renderedRow.kind === 'auxActivityGroup'"
    :id="renderedRow.id"
    :items="renderedRow.items"
    :groups="renderedRow.groups"
    :summaryItems="renderedRow.summaryItems"
    :summaryText="renderedRow.summaryText"
    :status="renderedRow.status"
    :defaultCollapsed="renderedRow.defaultCollapsed"
    :startedAtMs="renderedRow.startedAtMs"
    :answerStartedAtMs="renderedRow.answerStartedAtMs"
    :elapsedLive="renderedRow.elapsedLive"
    @layout-change="handleLayoutChange?.()"
  >
    <template #default="{ item }">
      <ChatRowRenderer
        :renderedRow="item"
        :workspaceRoot="workspaceRoot"
        :viewPrefs="viewPrefs"
        :planExecStateByEventId="planExecStateByEventId"
        :modelOptions="modelOptions"
        :isTurnRunning="isTurnRunning"
        :reasoningEffortOptions="reasoningEffortOptions"
        :sandboxModeOptions="sandboxModeOptions"
        :userMessageParts="userMessageParts"
        :userMessageImageCount="userMessageImageCount"
        :visibleUserMessageImageEntries="visibleUserMessageImageEntries"
        :visibleImageToolEntries="visibleImageToolEntries"
        :handleThumbLoadError="handleThumbLoadError"
        :handleUserFileTokenClick="handleUserFileTokenClick"
        :handleUserBubbleClick="handleUserBubbleClick"
        :handlePreviewImage="handlePreviewImage"
        :handleLayoutChange="handleLayoutChange"
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
        :executePlanFromPlanDelta="executePlanFromPlanDelta"
        :updatePlanExecModel="updatePlanExecModel"
        :updatePlanExecReasoningEffort="updatePlanExecReasoningEffort"
        :updatePlanExecSandboxMode="updatePlanExecSandboxMode"
        :inlineRewriteDraft="inlineRewriteDraft"
        :onInlineRewriteUpdate="onInlineRewriteUpdate"
        :onInlineRewriteCancel="onInlineRewriteCancel"
        :onInlineRewriteSend="onInlineRewriteSend"
      />
    </template>
  </ChatAuxActivityGroup>

  <ChatActivityRow
    v-else-if="renderedRow.kind === 'activity'"
    :text="renderedRow.text"
    :activityDotClass="activityDotClass(renderedRow.tone)"
  />

  <div v-else-if="renderedRow.kind === 'assistantCommentary'" :class="CHAT_ROW_ACTIVITY_CLASS">
    <AgentMarkdownContent
      class="chat-assistant-commentary agent-markdown-body min-w-0"
      :html="assistantMarkdownHtml(renderedRow.event)"
    />
  </div>

  <ChatTokenUsageSummary
    v-else-if="renderedRow.kind === 'tokenUsageSummary'"
    :usage="(renderedRow as any).item.usage"
    @layout-change="handleLayoutChange?.()"
  />

  <ChatImageToolCard
    v-else-if="renderedRow.kind === 'imageTool'"
    :item="(renderedRow as any).item"
    :visibleImages="visibleImageToolEntries((renderedRow as any).item)"
    :showTimestamps="viewPrefs.showTimestamps"
    :formattedTime="formatTime((renderedRow as any).createdAt)"
    :workspaceRoot="workspaceRoot"
    @load-error="handleThumbLoadError"
    @preview="handlePreviewImage($event)"
    :class="CHAT_ROW_TOOL_CLASS"
  />

  <ChatWebSearchCard
    v-else-if="renderedRow.kind === 'webSearch'"
    :item="(renderedRow as any).item"
    :class="CHAT_ROW_TOOL_CLASS"
  />

  <div v-else-if="renderedRow.kind === 'dynamicTool'" :class="CHAT_ROW_TOOL_CLASS">
    <div class="chat-tool-wrap w-full max-w-full min-w-0">
      <DynamicToolCallCardContent
        class="dynamic-tool-chat-card w-full rounded-xl border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] p-3"
        :item="(renderedRow as any).item"
      />
    </div>
  </div>

  <ChatReasoningBlock
    v-else-if="renderedRow.kind === 'reasoningBlock'"
    :stateKey="renderedRow.id"
    :isOpen="isReasoningOpen((renderedRow as any).item)"
    :summaryTitle="(renderedRow as any).item.title || t('chat.reasoning')"
    :durationText="reasoningDurationText((renderedRow as any).item.durationMs)"
    :html="isReasoningOpen((renderedRow as any).item) ? toReasoningHtml((renderedRow as any).item.text) : ''"
    :text="(renderedRow as any).item.text"
    :rawText="(renderedRow as any).item.rawText"
    :rawContentCount="(renderedRow as any).item.rawContentCount"
    @toggle="(next) => setReasoningOpen((renderedRow as any).item, next)"
  />

  <div v-else-if="renderedRow.kind === 'fileChange'" :class="CHAT_ROW_TOOL_CLASS">
    <div class="chat-tool-wrap w-full max-w-full min-w-0">
      <FileChangeCardContent
        :item="(renderedRow as any).item"
        mode="chat"
        :wrapDiffLines="false"
        @layout-change="handleLayoutChange?.()"
      />
    </div>
  </div>

  <ChatCommandActionRow
    v-else-if="renderedRow.kind === 'commandAction'"
    :item="(renderedRow as any).item"
    :isFilesOpen="isCommandFilesOpen((renderedRow as any).item.id)"
    :renderLimit="COMMAND_FILES_RENDER_LIMIT"
    @toggle-files="toggleCommandFilesOpen((renderedRow as any).item.id)"
    :class="CHAT_ROW_ACTIVITY_CLASS"
  />

  <div v-else-if="renderedRow.kind === 'commandSession'" :class="CHAT_ROW_TOOL_CLASS">
    <ChatCommandSessionCard
      :item="(renderedRow as any).item"
      :stopping="isCommandSessionStopping((renderedRow as any).item.processId)"
      @stop="stopCommandSession"
      @layout-change="handleLayoutChange?.()"
    />
  </div>

  <div v-else-if="renderedRow.kind === 'commandRead'" :class="CHAT_ROW_TOOL_CLASS">
    <CommandReadActivityRow :item="(renderedRow as any).item" />
  </div>

  <div v-else-if="renderedRow.kind === 'commandList'" :class="CHAT_ROW_TOOL_CLASS">
    <CommandListActivityRow :item="(renderedRow as any).item" />
  </div>

  <div v-else-if="renderedRow.kind === 'commandSearch'" :class="CHAT_ROW_TOOL_CLASS">
    <CommandSearchActivityRow :item="(renderedRow as any).item" />
  </div>

  <div v-else-if="renderedRow.kind === 'mcpResourceRead'" :class="CHAT_ROW_TOOL_CLASS">
    <div class="chat-tool-wrap w-full max-w-full min-w-0">
      <McpResourceReadCardContent
        :open="isMcpResourceOpen((renderedRow as any).item.id)"
        :item="(renderedRow as any).item"
        :onOpenInPanel="openMcpResourceInPanel"
        @update:open="setMcpResourceOpen((renderedRow as any).item.id, $event)"
      />
    </div>
  </div>

  <div v-else-if="renderedRow.kind === 'mcpToolGroup'" :class="CHAT_ROW_TOOL_CLASS">
    <ChatSshToolActivity v-if="isSshMcpToolGroup((renderedRow as any).group)" :group="(renderedRow as any).group" />
    <div v-else class="chat-tool-wrap w-full max-w-full min-w-0">
      <McpToolCardContent
        :open="isMcpToolGroupOpen((renderedRow as any).group.id)"
        :tagText="mcpToolGroupTagText((renderedRow as any).group)"
        :summaryText="mcpToolGroupSummaryText((renderedRow as any).group)"
        :statsText="mcpToolGroupStatsText((renderedRow as any).group)"
        :items="(renderedRow as any).group.items"
        :itemClass="mcpToolItemClass as any"
        :itemStatusText="mcpToolItemStatusText as any"
        :itemMetricsText="mcpToolItemMetricsText as any"
        :itemTitle="mcpToolItemTitle as any"
        :itemMetaText="mcpToolItemMetaText as any"
        :isDetailOpen="isMcpToolItemDetailOpen"
        :onDetailToggle="onMcpToolItemDetailToggle"
        :onOpenRelatedResource="onOpenRelatedMcpResource"
        @update:open="onMcpToolGroupToggle((renderedRow as any).group.id, $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import ChatUserMessage from "../../chat/ChatUserMessage.vue";
import ChatAssistantMessage from "../../chat/ChatAssistantMessage.vue";
import ChatActivityRow from "../../chat/ChatActivityRow.vue";
import ChatAuxActivityGroup from "../../chat/ChatAuxActivityGroup.vue";
import ChatReasoningBlock from "../../chat/ChatReasoningBlock.vue";
import ChatSystemRow from "../../chat/ChatSystemRow.vue";
import ChatImageToolCard from "../../chat/ChatImageToolCard.vue";
import ChatWebSearchCard from "../../chat/ChatWebSearchCard.vue";
import ChatSshToolActivity from "../../chat/ChatSshToolActivity.vue";
import ChatTokenUsageSummary from "../../chat/ChatTokenUsageSummary.vue";
import ChatCommandActionRow from "../../chat/ChatCommandActionRow.vue";
import ChatCommandSessionCard from "../../chat/ChatCommandSessionCard.vue";
import AgentMarkdownContent from "../../ui/AgentMarkdownContent.vue";
import DynamicToolCallCardContent from "../../timeline/cards/DynamicToolCallCardContent.vue";
import FileChangeCardContent from "../../timeline/cards/FileChangeCardContent.vue";
import McpResourceReadCardContent from "../../timeline/cards/McpResourceReadCardContent.vue";
import McpToolCardContent from "../../timeline/cards/McpToolCardContent.vue";
import CommandReadActivityRow from "../../timeline/activities/CommandReadActivityRow.vue";
import CommandListActivityRow from "../../timeline/activities/CommandListActivityRow.vue";
import CommandSearchActivityRow from "../../timeline/activities/CommandSearchActivityRow.vue";
import { CHAT_ROW_ACTIVITY_CLASS, CHAT_ROW_TOOL_CLASS } from "./chatPresentation";
import { chatActivityToneClass } from "./chatStyle";

import type { TimelineEventItem } from "../../../domain/types";
import { tryParseStructuredFinalAnswerV1 } from "../../../domain/structuredFinalAnswer";
import { stripInlineMemoryCitation } from "../../../domain/taggedMessageBlocks";
import { renderMarkdownToSafeHtml } from "../../../features/timeline/markdownRenderer";
import { useMarkdownRendererRefresh } from "../../../features/timeline/useMarkdownRendererRefresh";
import type {
  CommandSessionNode,
  McpResourceReadNode,
  McpToolGroupNode,
} from "../../../features/timeline/renderModel/buildTimelineNodes";
import {
  formatTime,
  mcpToolGroupStatsText,
  mcpToolGroupSummaryText,
  mcpToolGroupTagText,
  mcpToolItemClass,
  mcpToolItemMetaText,
  mcpToolItemMetricsText,
  mcpToolItemStatusText,
  mcpToolItemTitle,
} from "../../../features/timeline/renderModel/formatters";
import type { SandboxMode } from "../../../stores/runtime.store";
import type { McpToolItem } from "../../timeline/cards/McpToolCardContent.vue";
import type {
  ChatImageEntry,
  ChatInlineRewriteDraft,
  ChatRenderedRow,
  ChatUserMessagePart,
  ImagePreviewPayload,
  PlanDeltaExecUiState,
  ThumbLoadErrorPayload,
} from "../types/chat.types";
import type { ModelPickerOption } from "@codenexus/shared/modelCatalog";

defineOptions({ name: "ChatRowRenderer" });

type OptionInput = string | { value: string; label: string; disabled?: boolean };
type AnyFn = (...args: any[]) => any;

const COMMAND_FILES_RENDER_LIMIT = 1000;
const { markdownRendererTick, refreshWhenReady } = useMarkdownRendererRefresh();
const { t } = useI18n();

const isSshMcpToolGroup = (group: McpToolGroupNode | null | undefined): boolean => {
  return (group?.items ?? []).some((item) => {
    const server = String(item?.server ?? "")
      .trim()
      .toLowerCase();
    return server.includes("ssh");
  });
};

const props = defineProps<{
  renderedRow: ChatRenderedRow;
  workspaceRoot: string;
  viewPrefs: { showTimestamps: boolean };
  planExecStateByEventId: Record<string, PlanDeltaExecUiState | undefined>;
  modelOptions: readonly ModelPickerOption[];
  isTurnRunning: boolean;
  sandboxModeOptions: readonly OptionInput[];
  userMessageParts: (event: TimelineEventItem) => ChatUserMessagePart[];
  userMessageImageCount: (event: TimelineEventItem) => number;
  visibleUserMessageImageEntries: (event: TimelineEventItem) => ChatImageEntry[];
  visibleImageToolEntries: AnyFn;
  handleThumbLoadError: (err: ThumbLoadErrorPayload) => void;
  handleUserFileTokenClick: (path: string) => void;
  handleUserBubbleClick: (event: TimelineEventItem) => void;
  handlePreviewImage: (payload: ImagePreviewPayload) => void;
  handleLayoutChange?: () => void;
  getMarkdownEventHtml: (event: TimelineEventItem) => string;
  isReasoningOpen: AnyFn;
  setReasoningOpen: AnyFn;
  isCommandFilesOpen: (nodeId: string) => boolean;
  toggleCommandFilesOpen: (nodeId: string) => void;
  isCommandSessionStopping: (processId: string) => boolean;
  stopCommandSession: (item: CommandSessionNode) => void;
  isMcpToolGroupOpen: (id: string) => boolean;
  onMcpToolGroupToggle: (id: string, open: boolean) => void;
  isMcpToolItemDetailOpen: AnyFn;
  onMcpToolItemDetailToggle: AnyFn;
  isMcpResourceOpen: (id: string) => boolean;
  setMcpResourceOpen: (id: string, open: boolean) => void;
  openMcpResourceInPanel: (item: Pick<McpResourceReadNode, "server" | "uri" | "sourceTab" | "templateKey">) => void;
  onOpenRelatedMcpResource: (item: McpToolItem) => void;
  executePlanFromPlanDelta: (event: TimelineEventItem) => void;
  updatePlanExecModel: (eventId: string, value: string) => void;
  updatePlanExecReasoningEffort: (eventId: string, value: string) => void;
  updatePlanExecSandboxMode: (eventId: string, value: SandboxMode) => void;
  inlineRewriteDraft?: ChatInlineRewriteDraft | null;
  onInlineRewriteUpdate?: (patch: Partial<ChatInlineRewriteDraft>) => void;
  onInlineRewriteCancel?: () => void;
  onInlineRewriteSend?: () => void;
}>();

const reasoningDurationText = (durationMs: number | null | undefined) => {
  if (durationMs == null) return "";
  return `${Math.max(1, Math.round(durationMs / 1000))}s`;
};

// 思考块收起时不参与渲染，展开后同一段文本会重复取用；只保留当前文本即可。
let reasoningHtmlCache: { source: string; html: string; tick: number } | null = null;
const toReasoningHtml = (text: string) => {
  const source = String(text ?? "").trim();
  if (!source) return `<p>${t("chat.emptyContent")}</p>`;
  const tick = markdownRendererTick.value;
  if (reasoningHtmlCache?.tick === tick && reasoningHtmlCache.source === source) {
    return reasoningHtmlCache.html;
  }
  const html = renderMarkdownToSafeHtml(source);
  refreshWhenReady();
  reasoningHtmlCache = { source, html, tick };
  return html;
};

const activityDotClass = chatActivityToneClass;
const isStructuredFinalAnswerEvent = (event: TimelineEventItem): boolean => {
  if (event.method === "item/plan/delta") return false;
  return Boolean(tryParseStructuredFinalAnswerV1(stripInlineMemoryCitation(event.paramsText)));
};

const assistantMarkdownHtml = (event: TimelineEventItem): string => {
  if (event.method === "item/plan/delta") return "";
  if (isStructuredFinalAnswerEvent(event)) return "";
  return props.getMarkdownEventHtml(event);
};
</script>

<style scoped>
.chat-async-card-loading {
  display: grid;
  min-height: 44px;
  width: 100%;
  gap: 8px;
  border: 1px solid color-mix(in srgb, var(--border) 68%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-1) 72%, transparent);
  padding: 10px;
}

.chat-async-card-loading__line {
  height: 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-muted) 18%, transparent);
}

.chat-async-card-loading__line--wide {
  width: min(260px, 72%);
}

.chat-async-card-loading__line--short {
  width: min(160px, 46%);
}
</style>
