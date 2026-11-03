<template>
  <template v-for="node in timelineNodes" :key="node.id">
    <template v-if="node.kind === 'event'">
      <Collapsible
        v-if="runtimeStore.timelineDebugEnabled"
        class="event"
        :class="eventShellClass(node.event)"
        :open="isDebugEventExpanded(node.event.id)"
        :keepMounted="true"
        @update:open="(next) => setDebugEventExpanded(node.event.id, next)"
      >
        <template #trigger="{ triggerProps }">
          <div :class="eventMetaClass(node.event, true)" v-bind="triggerProps">
            <span :class="eventTagClass(node.event)">{{ eventTagText(node.event) }}</span>
            <span
              v-if="viewPrefs.showTimestamps"
              class="mono dim text-[11px] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
              >{{ formatTime(node.event.createdAt) }}</span
            >
            <button class="btn-mini ml-auto" type="button" @click.stop="onToggleEventJsonDebug(node.event.id)">
              {{ isEventDebugExpanded(node.event.id) ? t("timeline.collapseJson") : t("timeline.expandJson") }}
            </button>
          </div>
        </template>

        <div v-if="isTurnDiffUpdatedEvent(node.event)" class="mt-2">
          <UnifiedDiffViewer
            :diffText="getTurnDiffText(node.event)"
            :diffKey="node.event.id"
            ariaLabel="turn-diff-view"
          />
        </div>
        <WorkspaceFileSaveCardContent
          v-else-if="isWorkspaceFileSaveEvent(node.event)"
          :item="workspaceFileSaveTimelineItem(node.event)!"
        />
        <div v-else-if="isMarkdownEvent(node.event)">
          <StructuredFinalAnswerCard
            v-if="tryParseStructuredFinalAnswerV1(node.event.paramsText)"
            class="body min-w-0"
            :class="eventBodyClass(node.event)"
            :rawText="node.event.paramsText"
          />
          <AgentMarkdownContent
            v-else
            class="body agent-markdown-body min-w-0 text-[13px] leading-[1.55] whitespace-normal [overflow-wrap:normal] break-normal max-[1500px]:text-[12px] max-[1500px]:leading-[1.5]"
            :class="eventBodyClass(node.event)"
            :html="getMarkdownEventHtml(node.event)"
          />
        </div>
        <div
          v-else-if="isLocalThinkingEvent(node.event)"
          class="body min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] break-words text-[13px] leading-[1.45] max-[1500px]:text-[12px] max-[1500px]:leading-[1.4]"
        >
          <WaveText class="mono dim" :class="eventBodyClass(node.event)" :text="node.event.paramsText" />
        </div>
        <div
          v-else
          class="body mono min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] break-words text-[13px] leading-[1.45] max-[1500px]:text-[12px] max-[1500px]:leading-[1.4]"
          :class="eventBodyClass(node.event)"
        >
          {{ eventPrimaryText(node.event) }}
        </div>
        <pre
          v-if="isEventDebugExpanded(node.event.id)"
          class="event-debug app-scrollbar m-0 mt-2 max-h-[280px] overflow-y-auto rounded-[4px] border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] p-2.5 text-[var(--ui-code-text)] whitespace-pre-wrap [overflow-wrap:anywhere] break-words mono"
          >{{ toEventDebugJson(node.event) }}</pre
        >
      </Collapsible>

      <div v-else class="event" :class="eventShellClass(node.event)">
        <div :class="eventMetaClass(node.event, false)">
          <span :class="eventTagClass(node.event)">{{ eventTagText(node.event) }}</span>
          <span
            v-if="viewPrefs.showTimestamps"
            class="mono dim text-[11px] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
            >{{ formatTime(node.event.createdAt) }}</span
          >
          <button
            v-if="runtimeStore.timelineDebugEnabled"
            class="btn-mini ml-auto"
            type="button"
            @click="toggleEventDebug(node.event.id)"
          >
            {{ isEventDebugExpanded(node.event.id) ? t("timeline.collapseJson") : t("timeline.expandJson") }}
          </button>
        </div>
        <div v-if="isTurnDiffUpdatedEvent(node.event)" class="mt-2">
          <UnifiedDiffViewer
            :diffText="getTurnDiffText(node.event)"
            :diffKey="node.event.id"
            ariaLabel="turn-diff-view"
          />
        </div>
        <WorkspaceFileSaveCardContent
          v-else-if="isWorkspaceFileSaveEvent(node.event)"
          :item="workspaceFileSaveTimelineItem(node.event)!"
        />
        <div v-else-if="isMarkdownEvent(node.event)">
          <StructuredFinalAnswerCard
            v-if="tryParseStructuredFinalAnswerV1(node.event.paramsText)"
            class="body min-w-0"
            :class="eventBodyClass(node.event)"
            :rawText="node.event.paramsText"
          />
          <AgentMarkdownContent
            v-else
            class="body agent-markdown-body min-w-0 text-[13px] leading-[1.55] whitespace-normal [overflow-wrap:normal] break-normal max-[1500px]:text-[12px] max-[1500px]:leading-[1.5]"
            :class="eventBodyClass(node.event)"
            :html="getMarkdownEventHtml(node.event)"
          />
        </div>
        <div
          v-else-if="isLocalThinkingEvent(node.event)"
          class="body min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] break-words text-[13px] leading-[1.45] max-[1500px]:text-[12px] max-[1500px]:leading-[1.4]"
        >
          <WaveText class="mono dim" :class="eventBodyClass(node.event)" :text="node.event.paramsText" />
        </div>
        <div
          v-else
          class="body mono min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] break-words text-[13px] leading-[1.45] max-[1500px]:text-[12px] max-[1500px]:leading-[1.4]"
          :class="eventBodyClass(node.event)"
        >
          {{ eventPrimaryText(node.event) }}
        </div>
        <pre
          v-if="runtimeStore.timelineDebugEnabled && isEventDebugExpanded(node.event.id)"
          class="event-debug app-scrollbar m-0 mt-2 max-h-[280px] overflow-y-auto rounded-[4px] border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] p-2.5 text-[var(--ui-code-text)] whitespace-pre-wrap [overflow-wrap:anywhere] break-words mono"
          >{{ toEventDebugJson(node.event) }}</pre
        >
      </div>
    </template>

    <Collapsible
      v-else-if="node.kind === 'reasoningBlock'"
      class="reasoning-summary-event w-full"
      :open="isReasoningOpen(node.item)"
      @update:open="(next) => setReasoningOpen(node.item, next)"
    >
      <template #trigger="{ triggerProps, open }">
        <div
          class="reasoning-summary-meta flex w-full min-w-0 items-center gap-2.5 text-xs dim cursor-pointer select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-warning-hover)] focus-visible:outline-offset-2"
          v-bind="triggerProps"
        >
          <span class="inline-flex min-w-0 items-center gap-1.5">
            <span class="ui-leading-icon-slot" aria-hidden="true">
              <Brain class="h-3 w-3 flex-none text-[var(--fg-warning)] [stroke-width:2.2]" />
            </span>
            <span class="min-w-0 truncate">{{ node.item.title ?? t("chat.reasoning") }}</span>
            <span v-if="reasoningDurationText(node.item.durationMs)" class="mono dim whitespace-nowrap">{{
              reasoningDurationText(node.item.durationMs)
            }}</span>
          </span>
          <ChevronDown
            class="ml-auto h-3.5 w-3.5 flex-none opacity-80 transition-transform duration-150 [stroke-width:2.4]"
            :class="{ 'rotate-180': open }"
            aria-hidden="true"
          />
        </div>
      </template>
      <AgentMarkdownContent
        class="body agent-markdown-body mt-1 text-[var(--text-muted)]"
        :html="toReasoningHtml(node.item.text)"
      />
      <Collapsible
        v-if="node.item.rawText"
        class="reasoning-raw mt-2 w-full"
        :open="isRawReasoningOpen(node.item)"
        @update:open="(next) => setRawReasoningOpen(node.item, next)"
      >
        <template #trigger="{ triggerProps, open }">
          <div
            class="reasoning-raw-trigger inline-flex max-w-full items-center gap-1.5 rounded-[4px] border border-[var(--ui-well-border)] bg-[var(--ui-well-bg)] px-2 py-1 text-[11px] text-[var(--text-muted)] cursor-pointer select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-warning-hover)] focus-visible:outline-offset-2"
            v-bind="triggerProps"
          >
            <span class="min-w-0 truncate">{{ t("timeline.rawReasoning") }}</span>
            <span class="mono dim whitespace-nowrap">{{ rawReasoningCountText(node.item) }}</span>
            <ChevronDown
              class="h-3 w-3 flex-none opacity-80 transition-transform duration-150 [stroke-width:2.4]"
              :class="{ 'rotate-180': open }"
              aria-hidden="true"
            />
          </div>
        </template>
        <pre
          class="reasoning-raw-body app-scrollbar m-0 mt-1.5 max-h-[280px] overflow-auto rounded-[4px] border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] p-2.5 text-[12px] leading-[1.5] text-[var(--ui-code-text)] whitespace-pre-wrap [overflow-wrap:anywhere] break-words mono"
          >{{ node.item.rawText }}</pre
        >
      </Collapsible>
    </Collapsible>

    <template v-else-if="node.kind === 'fileChange'">
      <FileChangeCardContent
        mode="timeline"
        class="mb-2.5 last:mb-0"
        :item="node.item"
        :wrapDiffLines="false"
        @layout-change="props.onLayoutChange?.()"
      />
    </template>

    <div v-else-if="node.kind === 'commandAction'" class="terminal-action-wrap w-full">
      <div
        class="terminal-action-line inline-flex w-full min-w-0 items-center gap-1.5 p-0 m-0 box-border border-0 bg-transparent text-xs dim"
      >
        <span class="ui-leading-icon-slot" aria-hidden="true">
          <TerminalSquare class="terminal-action-icon h-3 w-3 flex-none text-[var(--text-muted)] [stroke-width:2.2]" />
        </span>
        <ExecutionWaveText
          v-if="node.item.item.status === 'running'"
          class="terminal-action-text min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
          color="var(--accent)"
          :text="commandActionDisplayText(node.item)"
          :cycle-max-chars="0"
        />
        <template v-else>
          <span class="terminal-action-text min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{{
            commandGroupItemActionText(node.item.item)
          }}</span>
          <span v-if="commandGroupItemActionDetailText(node.item.item)" class="mono dim">{{
            commandGroupItemActionDetailText(node.item.item)
          }}</span>
        </template>
        <button
          v-if="node.item.item.filesCount > 0"
          class="terminal-action-toggle !ml-auto !inline-flex !h-[22px] !w-[22px] !items-center !justify-center !rounded-[4px] !border !border-[var(--ui-well-border)] !bg-[var(--ui-well-bg)] !p-0 !text-inherit !shadow-none opacity-80 transition-[opacity,border-color,background] duration-150 hover:opacity-100 hover:!border-[var(--ui-well-border-hover)] hover:!bg-[var(--ui-well-bg-strong)] focus-visible:!outline-none focus-visible:!ring-2 focus-visible:!ring-[var(--ui-well-focus-outline)] active:!translate-y-0"
          type="button"
          :aria-expanded="isCommandFilesOpen(node.item.id) ? 'true' : 'false'"
          @click.stop="toggleCommandFilesOpen(node.item.id)"
        >
          <ChevronDown
            class="terminal-action-toggle-icon h-[14px] w-[14px] opacity-80 transition-[transform,opacity] duration-150"
            :class="{ 'rotate-180': isCommandFilesOpen(node.item.id) }"
            aria-hidden="true"
          />
        </button>
      </div>
      <div
        v-if="node.item.item.filesCount > 0 && isCommandFilesOpen(node.item.id)"
        class="terminal-action-files mt-1.5 ml-[18px] rounded-[4px] border border-[var(--ui-well-border)] bg-[var(--ui-well-bg-strong)] px-2.5 py-2"
      >
        <div class="terminal-action-files-title mb-1.5 text-xs mono dim">
          {{ t("timeline.filesTitle", { count: node.item.item.filesCount }) }}
        </div>
        <div
          class="terminal-action-files-list app-scrollbar grid max-h-[180px] gap-0.5 overflow-y-auto text-xs text-[var(--text)] mono"
        >
          <div
            v-for="name in node.item.item.files.slice(0, COMMAND_FILES_RENDER_LIMIT)"
            :key="`${node.item.id}:file:${name}`"
            class="terminal-action-files-row truncate whitespace-nowrap"
          >
            {{ name }}
          </div>
          <div
            v-if="node.item.item.filesCount > COMMAND_FILES_RENDER_LIMIT"
            class="terminal-action-files-more mt-1.5 dim"
          >
            {{ t("timeline.moreFilesNotRendered", { count: node.item.item.filesCount - COMMAND_FILES_RENDER_LIMIT }) }}
          </div>
        </div>
      </div>
    </div>

    <ChatCommandSessionCard
      v-else-if="node.kind === 'commandSession'"
      :item="node.item"
      :allowStop="false"
      @layout-change="props.onLayoutChange?.()"
    />

    <McpResourceReadCardContent
      v-else-if="node.kind === 'mcpResourceRead'"
      :open="isMcpResourceOpen(node.item.id)"
      :item="node.item"
      :onOpenInPanel="openMcpResourceInPanel"
      @update:open="onMcpResourceToggle(node.item.id, $event)"
    />

    <CommandReadActivityRow v-else-if="node.kind === 'commandRead'" :item="node.item" />

    <CommandListActivityRow v-else-if="node.kind === 'commandList'" :item="node.item" />

    <CommandSearchActivityRow v-else-if="node.kind === 'commandSearch'" :item="node.item" />

    <McpToolCardContent
      v-else-if="node.kind === 'mcpToolGroup'"
      :open="isMcpToolGroupOpen(node.group.id)"
      :tagText="mcpToolGroupTagText(node.group)"
      :summaryText="mcpToolGroupSummaryText(node.group)"
      :statsText="mcpToolGroupStatsText(node.group)"
      :items="node.group.items"
      :itemClass="mcpToolItemClass"
      :itemStatusText="mcpToolItemStatusText"
      :itemMetricsText="mcpToolItemMetricsText"
      :itemTitle="mcpToolItemTitle"
      :itemMetaText="mcpToolItemMetaText"
      :isDetailOpen="isMcpToolItemDetailOpen"
      :onDetailToggle="onMcpToolItemDetailToggle"
      :onOpenRelatedResource="onOpenRelatedMcpResource"
      @update:open="onMcpToolGroupToggle(node.group.id, $event)"
    />
  </template>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import CommandListActivityRow from "../../timeline/activities/CommandListActivityRow.vue";
import CommandReadActivityRow from "../../timeline/activities/CommandReadActivityRow.vue";
import CommandSearchActivityRow from "../../timeline/activities/CommandSearchActivityRow.vue";
import ChatCommandSessionCard from "../../chat/ChatCommandSessionCard.vue";
import FileChangeCardContent from "../../timeline/cards/FileChangeCardContent.vue";
import McpResourceReadCardContent from "../../timeline/cards/McpResourceReadCardContent.vue";
import McpToolCardContent from "../../timeline/cards/McpToolCardContent.vue";
import type { McpToolItem } from "../../timeline/cards/McpToolCardContent.vue";
import WorkspaceFileSaveCardContent from "../../timeline/cards/WorkspaceFileSaveCardContent.vue";
import AgentMarkdownContent from "../../ui/AgentMarkdownContent.vue";
import StructuredFinalAnswerCard from "../../ui/StructuredFinalAnswerCard.vue";
import UnifiedDiffViewer from "../../timeline/cards/UnifiedDiffViewer.vue";
import Collapsible from "../../ui/Collapsible.vue";
import ExecutionWaveText from "../../ui/ExecutionWaveText.vue";
import WaveText from "../../ui/WaveText.vue";
import { Brain, ChevronDown, TerminalSquare } from "lucide-vue-next";
import { useAppShellStore } from "../../../stores/appShell.store";
import { useMcpResourceStore } from "../../../stores/mcpResource.store";
import { useMcpStore } from "../../../stores/mcp.store";
import { useRuntimeStore } from "../../../stores/runtime.store";
import { useViewPrefsStore } from "../../../stores/viewPrefs.store";
import { safeJsonStringify } from "../../../utils/safeJson";
import type { TimelineEventItem } from "../../../domain/types";
import { tryParseStructuredFinalAnswerV1 } from "../../../domain/structuredFinalAnswer";
import { getWorkspaceFileSaveTimelineItemFromEvent } from "../../../domain/workspaceFiles";
import { useAgentMarkdownRenderer } from "../../../features/timeline/useAgentMarkdownRenderer";
import { renderMarkdownToSafeHtml } from "../../../features/timeline/markdownRenderer";
import { useMarkdownRendererRefresh } from "../../../features/timeline/useMarkdownRendererRefresh";
import { isGuardianApprovalReviewMethod } from "../../../features/guardian/guardianApprovalReview";
import {
  buildMcpToolDefinitionIndex,
  buildTimelineRenderNodes,
  type McpResourceReadNode,
  type TimelineRenderNode,
  type ReasoningBlockNode,
} from "../../../features/timeline/renderModel/buildTimelineNodes";
import {
  commandGroupItemActionText,
  commandGroupItemActionDetailText,
  formatTime,
  isLocalThinkingEvent,
  isMarkdownEvent,
  isReasoningStreamEvent,
  isLocalUserEvent,
  mcpToolGroupStatsText,
  mcpToolGroupSummaryText,
  mcpToolGroupTagText,
  mcpToolItemClass,
  mcpToolItemMetaText,
  mcpToolItemMetricsText,
  mcpToolItemStatusText,
  mcpToolItemTitle,
} from "../../../features/timeline/renderModel/formatters";

const props = defineProps<{
  contentEvents: TimelineEventItem[];
  workspaceRoot: string;
  onLayoutChange?: () => void;
}>();

const appShellStore = useAppShellStore();
const { t } = useI18n();
const mcpStore = useMcpStore();
const mcpResourceStore = useMcpResourceStore();
const runtimeStore = useRuntimeStore();
const viewPrefs = useViewPrefsStore();
const { getMarkdownEventHtml } = useAgentMarkdownRenderer({ key: () => runtimeStore.timelineKey });
const { markdownRendererTick, refreshWhenReady } = useMarkdownRendererRefresh();
const mcpToolDefinitions = computed(() => buildMcpToolDefinitionIndex(mcpStore.servers));

const timelineNodes = computed<TimelineRenderNode[]>(() => {
  return buildTimelineRenderNodes({
    events: props.contentEvents,
    timelineKey: runtimeStore.timelineKey,
    workspaceRoot: props.workspaceRoot,
    debug: runtimeStore.timelineDebugEnabled,
    mcpToolDefinitions: mcpToolDefinitions.value,
  });
});

const expandedEventDebugIds = ref(new Set<string>());
const expandedDebugEventIds = ref(new Set<string>());
const reasoningOpenById = ref(new Map<string, boolean>());
const rawReasoningOpenById = ref(new Map<string, boolean>());
const commandFilesOpenById = ref(new Map<string, boolean>());
const COMMAND_FILES_RENDER_LIMIT = 1000;

const workspaceFileSaveTimelineItem = (event: TimelineEventItem) => {
  return getWorkspaceFileSaveTimelineItemFromEvent(event);
};

const isWorkspaceFileSaveEvent = (event: TimelineEventItem) => {
  return Boolean(workspaceFileSaveTimelineItem(event));
};

function setDebugEventExpanded(eventId: string, next: boolean) {
  const id = String(eventId ?? "").trim();
  if (!id) return;
  if (next) expandedDebugEventIds.value.add(id);
  else expandedDebugEventIds.value.delete(id);
}

function isDebugEventExpanded(eventId: string): boolean {
  const id = String(eventId ?? "").trim();
  if (!id) return false;
  return expandedDebugEventIds.value.has(id);
}

function ensureDebugEventExpanded(eventId: string) {
  setDebugEventExpanded(eventId, true);
}

const autoExpandedPlanDeltaEventIds = new Set<string>();
let hasScannedAllPlanDeltaEventsOnce = false;
const PLAN_DELTA_AUTO_EXPAND_TAIL_SCAN_LIMIT = 200;

watch(
  () => runtimeStore.timelineKey,
  () => {
    autoExpandedPlanDeltaEventIds.clear();
    hasScannedAllPlanDeltaEventsOnce = false;
  }
);

watch(
  () => props.contentEvents,
  (events) => {
    if (!runtimeStore.timelineDebugEnabled) return;
    const start = hasScannedAllPlanDeltaEventsOnce
      ? Math.max(0, events.length - PLAN_DELTA_AUTO_EXPAND_TAIL_SCAN_LIMIT)
      : 0;
    for (let i = start; i < events.length; i += 1) {
      const event = events[i];
      if (event.method !== "item/plan/delta") continue;
      const id = String(event.id ?? "").trim();
      if (!id || autoExpandedPlanDeltaEventIds.has(id)) continue;
      autoExpandedPlanDeltaEventIds.add(id);
      ensureDebugEventExpanded(id);
    }
    hasScannedAllPlanDeltaEventsOnce = true;
  },
  { immediate: true }
);

const isReasoningOpen = (block: ReasoningBlockNode) => {
  const id = String(block?.id ?? "").trim();
  if (!id) return false;
  const forced = reasoningOpenById.value.get(id);
  return typeof forced === "boolean" ? forced : Boolean(block.openDefault);
};

function setReasoningOpen(block: ReasoningBlockNode, nextOpen: boolean) {
  const id = String(block?.id ?? "").trim();
  if (!id) return;
  reasoningOpenById.value.set(id, Boolean(nextOpen));
  props.onLayoutChange?.();
}

const isRawReasoningOpen = (block: ReasoningBlockNode) => {
  const id = String(block?.id ?? "").trim();
  if (!id) return false;
  return rawReasoningOpenById.value.get(id) ?? false;
};

function setRawReasoningOpen(block: ReasoningBlockNode, nextOpen: boolean) {
  const id = String(block?.id ?? "").trim();
  if (!id) return;
  rawReasoningOpenById.value.set(id, Boolean(nextOpen));
  props.onLayoutChange?.();
}

const rawReasoningCountText = (block: ReasoningBlockNode) => {
  const count = Math.max(0, Math.round(Number(block?.rawContentCount) || 0));
  return t("timeline.segmentCount", { count: Math.max(1, count) });
};

const isCommandFilesOpen = (nodeId: string) => commandFilesOpenById.value.get(String(nodeId ?? "")) ?? false;

function toggleCommandFilesOpen(nodeId: string) {
  const id = String(nodeId ?? "").trim();
  if (!id) return;
  const next = !isCommandFilesOpen(id);
  commandFilesOpenById.value.set(id, next);
}

function parseJson(value: string): { ok: true; value: unknown } | { ok: false } {
  const text = String(value ?? "").trim();
  if (!text) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

// 优先使用结构化 params，必要时从 paramsText 回退解析。
function toEventParamsObject(event: TimelineEventItem): Record<string, any> | null {
  if (event.params && typeof event.params === "object") return event.params as Record<string, any>;
  const text = String(event.paramsText ?? "").trim();
  if (!text || !text.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed as Record<string, any>;
  } catch {}
  return null;
}

// 输出调试面板可读 JSON，补齐 createdAtIso 等辅助字段。
function toEventDebugJson(event: TimelineEventItem): string {
  const parsed = parseJson(event.paramsText);
  const createdAtNumber = typeof event.createdAt === "number" ? event.createdAt : Number(event.createdAt);
  const createdAtDate = Number.isFinite(createdAtNumber) ? new Date(createdAtNumber) : null;
  const createdAtIso = createdAtDate && Number.isFinite(createdAtDate.getTime()) ? createdAtDate.toISOString() : null;
  const payload: Record<string, unknown> = {
    id: event.id,
    method: event.method,
    level: event.level,
    createdAt: event.createdAt,
    createdAtIso,
    threadId: event.threadId ?? null,
    turnId: event.turnId ?? null,
    localKind: event.localKind ?? null,
    localState: event.localState ?? null,
    thinkingPhase: event.thinkingPhase ?? null,
    hidden: event.hidden ?? false,
  };
  if (event.params !== undefined) payload.params = event.params;
  else if (parsed.ok) payload.params = parsed.value;
  else payload.paramsRaw = event.paramsText;
  return safeJsonStringify(payload, { space: 2 });
}

function toggleEventDebug(eventId: string) {
  if (!runtimeStore.timelineDebugEnabled) return;
  if (expandedEventDebugIds.value.has(eventId)) expandedEventDebugIds.value.delete(eventId);
  else expandedEventDebugIds.value.add(eventId);
}

function isEventDebugExpanded(eventId: string): boolean {
  return expandedEventDebugIds.value.has(eventId);
}

function onToggleEventJsonDebug(eventId: string) {
  if (!runtimeStore.timelineDebugEnabled) return;
  const isOpening = !isEventDebugExpanded(eventId);
  if (isOpening) ensureDebugEventExpanded(eventId);
  toggleEventDebug(eventId);
}

const isTurnDiffUpdatedEvent = (event: TimelineEventItem) => event.method === "turn/diff/updated";

const getTurnDiffText = (event: TimelineEventItem) => {
  if (typeof (event.params as any)?.diff === "string") return String((event.params as any).diff);
  const payload = toEventParamsObject(event);
  if (typeof payload?.diff === "string") return String(payload.diff);
  return String(event.paramsText ?? "");
};

const eventShellClass = (event: TimelineEventItem) => {
  const isLocalUser = isLocalUserEvent(event);
  const isThinking = isLocalThinkingEvent(event);
  const isReasoningStream = isReasoningStreamEvent(event);
  const workspaceFileSave = workspaceFileSaveTimelineItem(event);
  const localState = event.localState ?? null;
  const phase = event.thinkingPhase ?? null;

  const base = [
    "group",
    "min-w-0",
    "max-w-full",
    "rounded-[4px]",
    "border",
    "border-[var(--ui-well-border)]",
    "bg-[var(--ui-timeline-card-bg)]",
    "shadow-[var(--ui-timeline-card-shadow)]",
    "last:mb-0",
  ];

  if (isThinking) {
    let borderColorClass = "border-[var(--border-accent)]";
    let bgClass = "bg-[var(--bg-accent-soft)]";

    if (phase === "reasoning") {
      borderColorClass = "border-[var(--border-warning)]";
      bgClass = "bg-[var(--bg-warning-soft)]";
    } else if (phase === "waiting_more") {
      borderColorClass = "border-[var(--ui-well-border)]";
      bgClass = "bg-[var(--ui-well-bg)]";
    } else if (phase === "completed") {
      borderColorClass = "border-[var(--border-success)]";
      bgClass = "bg-[var(--bg-success-soft)]";
    } else if (phase === "failed") {
      borderColorClass = "border-[var(--border-danger)]";
      bgClass = "bg-[var(--bg-danger-soft)]";
    }

    const classes = [
      ...base,
      "mb-0.5",
      "w-fit",
      "max-w-[min(100%,420px)]",
      "border-dashed",
      "px-2",
      "py-1",
      borderColorClass,
      bgClass,
    ];

    return classes.join(" ");
  }

  if (isLocalUser) {
    let borderColorClass = "border-[var(--border-accent)]";
    if (localState === "queued") borderColorClass = "border-[var(--border-warning)]";
    else if (localState === "sent") borderColorClass = "border-[var(--border-success)]";
    else if (localState === "failed") borderColorClass = "border-[var(--border-danger)]";

    const classes = [...base, "mb-2.5", "p-[var(--timeline-card-padding,10px)]", borderColorClass];

    return classes.join(" ");
  }

  if (isReasoningStream) {
    return [...base, "mb-2.5", "p-[var(--timeline-card-padding,10px)]", "border-[var(--border-warning)]"].join(" ");
  }

  if (workspaceFileSave) {
    const borderColorClass =
      workspaceFileSave.status === "failed" ? "border-[var(--border-danger)]" : "border-[var(--border-warning)]";
    return [...base, "mb-2.5", "p-[var(--timeline-card-padding,10px)]", borderColorClass].join(" ");
  }

  return [...base, "mb-2.5", "p-[var(--timeline-card-padding,10px)]"].join(" ");
};

const eventMetaClass = (event: TimelineEventItem, interactive: boolean) => {
  const isThinking = isLocalThinkingEvent(event);
  const classes = [
    "flex",
    "min-w-0",
    "flex-wrap",
    "items-center",
    isThinking ? "gap-1.5" : "gap-2",
    isThinking ? "mb-0.5" : "mb-1.5",
  ];

  if (interactive) {
    classes.push(
      "cursor-pointer",
      "select-none",
      "focus-visible:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-[var(--ui-well-focus-outline)]",
      "focus-visible:ring-offset-2",
      "focus-visible:ring-offset-transparent"
    );
  }

  return classes.join(" ");
};

const eventTagClass = (event: TimelineEventItem) => {
  const isLocalUser = isLocalUserEvent(event);
  const isThinking = isLocalThinkingEvent(event);
  const isReasoningStream = isReasoningStreamEvent(event);
  const workspaceFileSave = workspaceFileSaveTimelineItem(event);
  const localState = event.localState ?? null;
  const phase = event.thinkingPhase ?? null;
  const isDanger = event.level === "error";

  const base = [
    "inline-flex",
    "items-center",
    "max-w-full",
    "overflow-hidden",
    "text-ellipsis",
    "whitespace-nowrap",
    "rounded-[4px]",
    "border",
    "text-[11px]",
    "tracking-[0.2px]",
  ];

  if (isThinking) {
    let borderColorClass = "border-[var(--border-accent)]";
    let bgClass = "bg-[var(--bg-accent-soft)]";
    let textClass = "text-[var(--fg-accent)]";

    if (phase === "reasoning") {
      borderColorClass = "border-[var(--border-warning)]";
      bgClass = "bg-[var(--bg-warning-soft)]";
      textClass = "text-[var(--fg-warning)]";
    } else if (phase === "completed") {
      borderColorClass = "border-[var(--border-success)]";
      bgClass = "bg-[var(--bg-success-soft)]";
      textClass = "text-[var(--fg-success)]";
    } else if (phase === "failed") {
      borderColorClass = "border-[var(--border-danger)]";
      bgClass = "bg-[var(--bg-danger-soft)]";
      textClass = "text-[var(--fg-danger)]";
    }

    return [...base, "h-5", "px-2", borderColorClass, bgClass, textClass].join(" ");
  }

  if (isReasoningStream) {
    return [
      ...base,
      "h-[22px]",
      "px-[9px]",
      "border-[var(--border-warning)]",
      "bg-[var(--bg-warning-soft)]",
      "text-[var(--fg-warning)]",
    ].join(" ");
  }

  if (isLocalUser) {
    let borderColorClass = "border-[var(--border-accent)]";
    let bgClass = "bg-[var(--bg-accent-soft)]";
    let textClass = "text-[var(--fg-accent)]";

    if (localState === "sent") {
      borderColorClass = "border-[var(--border-success)]";
      bgClass = "bg-[var(--bg-success-soft)]";
      textClass = "text-[var(--fg-success)]";
    } else if (localState === "failed") {
      borderColorClass = "border-[var(--border-danger)]";
      bgClass = "bg-[var(--bg-danger-soft)]";
      textClass = "text-[var(--fg-danger)]";
    }

    return [...base, "h-[22px]", "px-[9px]", borderColorClass, bgClass, textClass].join(" ");
  }

  if (workspaceFileSave) {
    if (workspaceFileSave.status === "failed") {
      return [
        ...base,
        "h-[22px]",
        "px-[9px]",
        "border-[var(--border-danger)]",
        "bg-[var(--bg-danger-soft)]",
        "text-[var(--fg-danger)]",
      ].join(" ");
    }
    return [
      ...base,
      "h-[22px]",
      "px-[9px]",
      "border-[var(--border-warning)]",
      "bg-[var(--bg-warning-soft)]",
      "text-[var(--fg-warning)]",
    ].join(" ");
  }

  if (isDanger) {
    return [
      ...base,
      "h-[22px]",
      "px-[9px]",
      "border-[var(--border-danger)]",
      "bg-[var(--bg-danger-soft)]",
      "text-[var(--fg-danger)]",
    ].join(" ");
  }

  return [
    ...base,
    "h-[22px]",
    "px-[9px]",
    "border-[var(--ui-well-border)]",
    "bg-[var(--ui-well-bg-strong)]",
    "text-[var(--text-muted)]",
  ].join(" ");
};

const eventBodyClass = (event: TimelineEventItem) => {
  if (isWorkspaceFileSaveEvent(event)) return "";
  if (isReasoningStreamEvent(event)) return "text-[var(--fg-warning)]";
  if (isLocalThinkingEvent(event)) return "text-[12px] leading-[1.35] text-[var(--text)]";
  return "";
};

const eventTagText = (event: TimelineEventItem) => {
  if (isLocalThinkingEvent(event)) {
    if (!event.thinkingPhase) return t("timeline.thinkingReasoning");
    const key = `timeline.thinking.${event.thinkingPhase}`;
    return t(key) === key ? t("timeline.thinkingReasoning") : t(key);
  }
  if (isWorkspaceFileSaveEvent(event)) return t("timeline.filePanel");
  if (isGuardianApprovalReviewMethod(event.method)) return t("timeline.guardianReview");
  if (event.method === "history/contextInjected") return t("timeline.contextInjected");
  return event.method;
};

const eventPrimaryText = (event: TimelineEventItem) => {
  return String(event.paramsText ?? "");
};

const commandActionDisplayText = (node: { item: Parameters<typeof commandGroupItemActionText>[0] }) => {
  const main = commandGroupItemActionText(node.item);
  const detail = commandGroupItemActionDetailText(node.item);
  return detail ? `${main} · ${detail}` : main;
};

// MCP 工具卡片开合状态：按“线程 + 节点 key”隔离记忆。
const mcpToolGroupOpenByKey = ref(new Map<string, boolean>());
const mcpToolDetailOpenByKey = ref(new Map<string, boolean>());
const mcpResourceOpenByKey = ref(new Map<string, boolean>());

const toMcpToolGroupStateKey = (groupId: string) => `${runtimeStore.timelineKey}:${groupId}`;
const toMcpToolDetailStateKey = (detailKey: string) => `${runtimeStore.timelineKey}:${detailKey}`;
const toMcpResourceStateKey = (itemId: string) => `${runtimeStore.timelineKey}:${itemId}`;

const isMcpToolGroupOpen = (groupId: string) =>
  mcpToolGroupOpenByKey.value.get(toMcpToolGroupStateKey(groupId)) ?? false;
const onMcpToolGroupToggle = (groupId: string, nextOpen: boolean) => {
  mcpToolGroupOpenByKey.value.set(toMcpToolGroupStateKey(groupId), Boolean(nextOpen));
  props.onLayoutChange?.();
};

const isMcpToolItemDetailOpen = (detailKey: string) =>
  mcpToolDetailOpenByKey.value.get(toMcpToolDetailStateKey(detailKey)) ?? false;
const onMcpToolItemDetailToggle = (detailKey: string, nextOpen: boolean) => {
  mcpToolDetailOpenByKey.value.set(toMcpToolDetailStateKey(detailKey), Boolean(nextOpen));
  props.onLayoutChange?.();
};

const isMcpResourceOpen = (itemId: string) => mcpResourceOpenByKey.value.get(toMcpResourceStateKey(itemId)) ?? false;
const onMcpResourceToggle = (itemId: string, nextOpen: boolean) => {
  mcpResourceOpenByKey.value.set(toMcpResourceStateKey(itemId), Boolean(nextOpen));
  props.onLayoutChange?.();
};

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

const reasoningDurationText = (durationMs: number | null | undefined) => {
  if (durationMs == null) return "";
  const sec = Math.max(1, Math.round(durationMs / 1000));
  return t("timeline.seconds", { count: sec });
};

const toReasoningHtml = (text: string) => {
  const source = String(text ?? "");
  if (!source.trim()) return `<p>${t("common.none")}</p>`;
  void markdownRendererTick.value;
  const html = renderMarkdownToSafeHtml(source);
  refreshWhenReady();
  return html;
};
</script>
