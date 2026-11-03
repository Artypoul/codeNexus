<template>
  <div :class="[CHAT_ROW_BASE_CLASS, 'chat-row--assistant']">
    <div class="chat-bubble chat-bubble-assistant w-full max-w-full min-w-0">
      <MarkdownPlanOutputCard v-if="isPlanDelta" :rawText="event.paramsText" :forceCollapsed="shouldCollapsePlan">
        <template v-if="execState" #headerActions>
          <ChatPlanDeltaActions
            :execState="execState"
            :modelOptions="modelOptions"
            :sandboxModeOptions="sandboxModeOptions"
            :disabled="planActionDisabled"
            embedded
            compact
            @execute-plan="$emit('execute-plan', event)"
            @update:model="(value) => $emit('update:model', value)"
            @update:reasoning-effort="(value) => $emit('update:reasoning-effort', value)"
            @update:sandbox-mode="(value) => $emit('update:sandbox-mode', value)"
          />
        </template>
        <template v-if="execState" #actions>
          <ChatPlanDeltaActions
            :execState="execState"
            :modelOptions="modelOptions"
            :sandboxModeOptions="sandboxModeOptions"
            :disabled="planActionDisabled"
            :embedded="true"
            @execute-plan="$emit('execute-plan', event)"
            @update:model="(value) => $emit('update:model', value)"
            @update:reasoning-effort="(value) => $emit('update:reasoning-effort', value)"
            @update:sandbox-mode="(value) => $emit('update:sandbox-mode', value)"
          />
        </template>
      </MarkdownPlanOutputCard>
      <StructuredFinalAnswerCard
        v-else-if="isStructuredFinalAnswer"
        class="chat-bubble-body min-w-0"
        :rawText="assistantDisplayText"
      />
      <AgentMarkdownContent v-else class="chat-bubble-body agent-markdown-body min-w-0" :html="markdownHtml" />
      <details v-if="memoryCitationSummary" class="assistant-memory-citation">
        <summary class="assistant-memory-citation__summary mono">{{ memoryCitationSummary }}</summary>
        <div class="assistant-memory-citation__body">
          <ul v-if="memoryCitationEntries.length > 0" class="assistant-memory-citation__entries">
            <li v-for="entry in memoryCitationEntries" :key="`${entry.path}:${entry.lineStart}:${entry.lineEnd}`">
              <div class="assistant-memory-citation__path mono">{{ memoryCitationEntryLine(entry) }}</div>
              <div v-if="entry.note" class="assistant-memory-citation__note">{{ entry.note }}</div>
            </li>
          </ul>
          <div v-if="memoryCitationThreadIds.length > 0" class="assistant-memory-citation__threads mono">
            {{ t("chat.memoryCitation.threadIds") }} {{ memoryCitationThreadIds.join(", ") }}
          </div>
          <pre
            v-if="memoryCitationEntries.length === 0 && memoryCitationThreadIds.length === 0 && memoryCitationRaw"
            class="assistant-memory-citation__raw mono"
            >{{ memoryCitationRaw }}</pre
          >
        </div>
      </details>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, defineComponent, h } from "vue";
import { useI18n } from "vue-i18n";
import AgentMarkdownContent from "../ui/AgentMarkdownContent.vue";
import ChatPlanDeltaActions from "./ChatPlanDeltaActions.vue";
import type { TimelineEventItem } from "../../domain/types";
import type { PlanDeltaExecUiState } from "../layout/types/chat.types";
import type { SandboxMode } from "../../stores/runtime.store";
import { CHAT_ROW_BASE_CLASS } from "../layout/chat/chatPresentation";
import {
  extractInlineMemoryCitation,
  stripInlineMemoryCitation,
  type ParsedMemoryCitation,
} from "../../domain/taggedMessageBlocks";
import type { MemoryCitation, MemoryCitationEntry } from "@codenexus/generated/codex-app-server/v2";
import type { ModelPickerOption } from "@codenexus/shared/modelCatalog";

type OptionInput =
  | string
  | {
      value: string;
      label: string;
      disabled?: boolean;
    };

const AssistantCardLoading = defineComponent({
  name: "AssistantCardLoading",
  setup() {
    return () =>
      h("div", { class: "assistant-card-loading", "aria-hidden": "true" }, [
        h("div", { class: "assistant-card-loading__line assistant-card-loading__line--wide" }),
        h("div", { class: "assistant-card-loading__line assistant-card-loading__line--short" }),
      ]);
  },
});

const MarkdownPlanOutputCard = defineAsyncComponent({
  loader: () => import("../ui/MarkdownPlanOutputCard.vue"),
  loadingComponent: AssistantCardLoading,
  delay: 120,
});
const StructuredFinalAnswerCard = defineAsyncComponent({
  loader: () => import("../ui/StructuredFinalAnswerCard.vue"),
  loadingComponent: AssistantCardLoading,
  delay: 120,
});

const props = defineProps<{
  event: TimelineEventItem;
  isStructuredFinalAnswer: boolean;
  markdownHtml: string;
  execState: PlanDeltaExecUiState | null;
  modelOptions: readonly ModelPickerOption[];
  isTurnRunning: boolean;
  sandboxModeOptions: readonly OptionInput[];
}>();

const { t } = useI18n();
const isPlanDelta = computed(() => props.event.method === "item/plan/delta");
const assistantDisplayText = computed(() => stripInlineMemoryCitation(props.event.paramsText));
const planActionDisabled = computed(() => props.isTurnRunning || Boolean(props.execState?.executing));
const shouldCollapsePlan = computed(() => {
  const state = props.execState;
  if (!state?.collapseWhileExecuting) return false;
  return Boolean(state.executing || props.isTurnRunning);
});
const normalizeMemoryCitation = (value: unknown): ParsedMemoryCitation | null => {
  const citation = value && typeof value === "object" && !Array.isArray(value) ? (value as MemoryCitation) : null;
  if (!citation) return null;
  const entries = Array.isArray(citation.entries) ? citation.entries : [];
  const threadIds = Array.isArray(citation.threadIds) ? citation.threadIds : [];
  if (entries.length <= 0 && threadIds.length <= 0) return null;
  return { entries, threadIds, raw: "" };
};

const memoryCitation = computed<ParsedMemoryCitation | null>(() => {
  const params = props.event.params as any;
  const citation = params?.item?.memoryCitation;
  return normalizeMemoryCitation(citation) ?? extractInlineMemoryCitation(props.event.paramsText);
});
const memoryCitationSummary = computed(() => {
  const citation = memoryCitation.value;
  if (!citation) return "";
  const entries = Array.isArray(citation.entries) ? citation.entries.length : 0;
  const threads = Array.isArray(citation.threadIds) ? citation.threadIds.length : 0;
  if (entries <= 0 && threads <= 0 && !citation.raw) return "";
  return t("chat.memoryCitation.summary", { entries, threads });
});
const memoryCitationEntries = computed(() => memoryCitation.value?.entries ?? []);
const memoryCitationThreadIds = computed(() => memoryCitation.value?.threadIds ?? []);
const memoryCitationRaw = computed(() => memoryCitation.value?.raw ?? "");
const memoryCitationEntryLine = (entry: MemoryCitationEntry) => {
  const path = String(entry?.path ?? "").trim();
  const start = Number(entry?.lineStart ?? 0);
  const end = Number(entry?.lineEnd ?? 0);
  const range = start > 0 && end > 0 ? `${start}-${end}` : "";
  return range ? `${path}:${range}` : path;
};

defineEmits<{
  (e: "execute-plan", event: TimelineEventItem): void;
  (e: "update:model", value: string): void;
  (e: "update:reasoning-effort", value: string): void;
  (e: "update:sandbox-mode", value: SandboxMode): void;
}>();
</script>

<style scoped>
.assistant-card-loading {
  display: grid;
  min-height: 64px;
  gap: 8px;
  border: 1px solid color-mix(in srgb, var(--ui-well-border) 76%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--ui-well-bg) 82%, transparent);
  padding: 12px;
}

.assistant-card-loading__line {
  height: 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-muted) 18%, transparent);
}

.assistant-card-loading__line--wide {
  width: min(300px, 76%);
}

.assistant-card-loading__line--short {
  width: min(190px, 48%);
}

.assistant-memory-citation {
  margin-top: 8px;
  border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  padding-top: 6px;
  color: var(--text-muted);
  font-size: 11px;
}

.assistant-memory-citation__summary {
  cursor: pointer;
  user-select: none;
}

.assistant-memory-citation__body {
  margin-top: 6px;
  max-height: 180px;
  overflow: auto;
  border-radius: 4px;
  background: var(--ui-code-bg);
  padding: 8px;
  color: var(--ui-code-text);
}

.assistant-memory-citation__entries {
  display: grid;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.assistant-memory-citation__path {
  overflow-wrap: anywhere;
  color: var(--ui-code-text);
  font-size: 11px;
}

.assistant-memory-citation__note {
  margin-top: 2px;
  overflow-wrap: anywhere;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.assistant-memory-citation__threads {
  margin-top: 8px;
  overflow-wrap: anywhere;
  color: var(--text-muted);
  font-size: 11px;
}

.assistant-memory-citation__raw {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--ui-code-text);
  font-size: 11px;
}
</style>
