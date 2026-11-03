<template>
  <Collapsible
    class="chat-inline-activity mcp-tool-activity"
    :class="{ 'is-running': isRunning }"
    :aria-busy="isRunning"
    :open="open"
    motion="height"
    @update:open="emit('update:open', $event)"
  >
    <template #trigger="{ triggerProps, open: isOpen }">
      <div
        class="chat-inline-activity__line chat-inline-activity__line--compact chat-inline-activity__line--full mcp-tool-line"
        v-bind="triggerProps"
      >
        <span class="chat-inline-activity__icon mcp-tool-icon-wrap" aria-hidden="true">
          <ModelContextProtocolIcon class="chat-inline-activity__svg mcp-tool-icon" />
        </span>
        <span class="mcp-tool-tag">{{ tagText }}</span>
        <ExecutionWaveText
          v-if="isRunning"
          class="chat-inline-activity__text mcp-tool-summary"
          color="var(--accent)"
          :text="summaryText"
          :cycle-max-chars="0"
        />
        <span v-else class="chat-inline-activity__text mcp-tool-summary">{{ summaryText }}</span>
        <span class="chat-inline-activity__meta mcp-tool-stats mono">{{ statsText }}</span>
        <ChevronDown class="mcp-tool-chevron" :class="{ 'rotate-180': isOpen }" aria-hidden="true" />
      </div>
    </template>

    <div class="mcp-tool-body">
      <ol class="mcp-tool-list">
        <li v-for="item in items" :key="item.id" class="mcp-tool-item" :class="itemClass(item)">
          <div class="mcp-tool-item-head">
            <span class="mcp-tool-item-status inline-flex min-w-0 items-center gap-1.5 text-[11px]">
              <ExecutionWaveText
                v-if="item.status === 'running'"
                class="mono"
                color="var(--accent)"
                :text="item.tool"
                :cycle-max-chars="0"
              />
              <span v-else class="mono">{{ item.tool }}</span>
            </span>
            <span class="mono dim flex-none whitespace-nowrap text-[10px]">
              {{ itemStatusText(item) }} · {{ itemMetricsText(item) }}
            </span>
          </div>
          <div class="mono dim whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[10px]">
            {{ itemTitle(item) }}
          </div>
          <div class="mono dim whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[10px]">
            {{ itemMetaText(item) }}
          </div>
          <div
            class="mono whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[11px] leading-[1.4] text-[var(--text)]"
          >
            {{ item.argumentsSummary }}
          </div>
          <div
            v-if="item.resultSummary"
            class="mono dim whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[11px] leading-[1.4]"
          >
            {{ item.resultSummary }}
          </div>
          <div
            v-if="item.pageSummary"
            class="mono dim whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[11px] leading-[1.4]"
          >
            {{ item.pageSummary }}
          </div>
          <div
            v-if="item.snapshotSummary"
            class="mono dim whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[11px] leading-[1.4]"
          >
            {{ item.snapshotSummary }}
          </div>
          <div
            v-if="item.errorText"
            class="mono whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[11px] leading-[1.4] text-[var(--text)]"
          >
            {{ item.errorText }}
          </div>
          <div v-if="item.relatedResourceLabel && onOpenRelatedResource" class="flex flex-wrap items-center gap-2">
            <button type="button" class="btn-mini" @click.stop="onOpenRelatedResource(item)">
              {{ item.relatedResourceLabel }}
            </button>
          </div>
          <DetailDisclosure
            v-if="item.argumentsRaw"
            :open="isDetailOpen(item.argumentsKey)"
            motion="fade"
            summaryClass="mono text-[11px] dim"
            @update:open="(next) => onDetailToggle(item.argumentsKey, next)"
          >
            <template #summary>{{ t("dynamicTool.viewFullArgs") }}</template>
            <pre
              class="mono mt-1.5 max-h-[240px] overflow-y-auto app-scrollbar rounded-[4px] border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] p-2 text-[var(--ui-code-text)] whitespace-pre-wrap [overflow-wrap:anywhere] break-words"
              >{{ item.argumentsRaw }}</pre
            >
          </DetailDisclosure>
          <DetailDisclosure
            v-if="item.resultRaw"
            :open="isDetailOpen(item.resultKey)"
            motion="fade"
            summaryClass="mono text-[11px] dim"
            @update:open="(next) => onDetailToggle(item.resultKey, next)"
          >
            <template #summary>{{ t("dynamicTool.viewFullResult") }}</template>
            <pre
              class="mono mt-1.5 max-h-[240px] overflow-y-auto app-scrollbar rounded-[4px] border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] p-2 text-[var(--ui-code-text)] whitespace-pre-wrap [overflow-wrap:anywhere] break-words"
              >{{ item.resultRaw }}</pre
            >
          </DetailDisclosure>
          <DetailDisclosure
            v-if="item.structuredContentRaw"
            :open="isDetailOpen(item.structuredContentKey)"
            motion="fade"
            summaryClass="mono text-[11px] dim"
            @update:open="(next) => onDetailToggle(item.structuredContentKey, next)"
          >
            <template #summary>{{ t("mcpTool.viewStructuredContent") }}</template>
            <pre
              class="mono mt-1.5 max-h-[240px] overflow-y-auto app-scrollbar rounded-[4px] border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] p-2 text-[var(--ui-code-text)] whitespace-pre-wrap [overflow-wrap:anywhere] break-words"
              >{{ item.structuredContentRaw }}</pre
            >
          </DetailDisclosure>
          <DetailDisclosure
            v-if="item.metaRaw"
            :open="isDetailOpen(item.metaKey)"
            motion="fade"
            summaryClass="mono text-[11px] dim"
            @update:open="(next) => onDetailToggle(item.metaKey, next)"
          >
            <template #summary>{{ t("mcpTool.viewMeta") }}</template>
            <pre
              class="mono mt-1.5 max-h-[240px] overflow-y-auto app-scrollbar rounded-[4px] border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] p-2 text-[var(--ui-code-text)] whitespace-pre-wrap [overflow-wrap:anywhere] break-words"
              >{{ item.metaRaw }}</pre
            >
          </DetailDisclosure>
          <DetailDisclosure
            v-if="item.outputSchemaRaw"
            :open="isDetailOpen(item.outputSchemaKey)"
            motion="fade"
            summaryClass="mono text-[11px] dim"
            @update:open="(next) => onDetailToggle(item.outputSchemaKey, next)"
          >
            <template #summary>{{ t("mcpTool.viewOutputSchema") }}</template>
            <pre
              class="mono mt-1.5 max-h-[240px] overflow-y-auto app-scrollbar rounded-[4px] border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] p-2 text-[var(--ui-code-text)] whitespace-pre-wrap [overflow-wrap:anywhere] break-words"
              >{{ item.outputSchemaRaw }}</pre
            >
          </DetailDisclosure>
        </li>
      </ol>
    </div>
  </Collapsible>
</template>

<script setup lang="ts">
// MCP tool row: inline activity header with expandable tool call details.
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { ChevronDown } from "lucide-vue-next";
import Collapsible from "../../ui/Collapsible.vue";
import DetailDisclosure from "../../ui/DetailDisclosure.vue";
import ExecutionWaveText from "../../ui/ExecutionWaveText.vue";
import ModelContextProtocolIcon from "../../ui/ModelContextProtocolIcon.vue";

export type McpToolCallStatus = "running" | "completed" | "failed" | "unknown";

export type McpToolItem = {
  id: string;
  status: McpToolCallStatus;
  server: string;
  tool: string;
  argumentsSummary: string;
  argumentsRaw: string;
  argumentsKey: string;
  resultSummary: string;
  resultRaw: string;
  resultKey: string;
  structuredContentRaw: string;
  structuredContentKey: string;
  metaRaw: string;
  metaKey: string;
  outputSchemaRaw: string;
  outputSchemaKey: string;
  pageSummary: string;
  snapshotSummary: string;
  errorText: string;
  relatedResourceUri: string;
  relatedResourceSourceTab: "resources" | "templates";
  relatedResourceTemplateKey: string;
  relatedResourceLabel: string;
};

// Business data and behavior are injected by the parent; this component only renders UI.
const props = defineProps<{
  open: boolean;
  tagText: string;
  summaryText: string;
  statsText: string;
  items: McpToolItem[];
  itemClass: (item: McpToolItem) => any;
  itemStatusText: (item: McpToolItem) => string;
  itemMetricsText: (item: McpToolItem) => string;
  itemTitle: (item: McpToolItem) => string;
  itemMetaText: (item: McpToolItem) => string;
  isDetailOpen: (detailKey: string) => boolean;
  onDetailToggle: (detailKey: string, next: boolean) => void;
  onOpenRelatedResource?: (item: McpToolItem) => void;
}>();

const emit = defineEmits<{
  (event: "update:open", value: boolean): void;
}>();

const { t } = useI18n();
const isRunning = computed(() => props.items.some((item) => item.status === "running"));
</script>
