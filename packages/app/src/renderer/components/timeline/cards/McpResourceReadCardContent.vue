<template>
  <TimelineCardShell
    class="w-full"
    :tagText="t('mcpResourceRead.tag')"
    :statusText="''"
    :statusKind="''"
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <template #icon>
      <Database class="h-[13px] w-[13px] flex-none text-[color:var(--accent)] [stroke-width:2.2]" aria-hidden="true" />
    </template>
    <template #summary>
      <div class="mono dim whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[11px]">
        {{ summaryText }}
      </div>
    </template>
    <div class="grid gap-2 px-2.5 pb-2.5">
      <ExecutionWaveText
        v-if="isRunning"
        class="mono inline-flex items-center gap-2 text-[11px]"
        :text="t('mcpResourceRead.readingResource')"
      />
      <div class="grid gap-1">
        <div class="text-[12px] font-medium text-[color:var(--text-muted)]">{{ t("mcpResources.resourceName") }}</div>
        <div class="mono whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[11px] text-[var(--text)]">
          {{ displayResourceLabel }}
        </div>
      </div>
      <div class="grid gap-1">
        <div class="text-[12px] font-medium text-[color:var(--text-muted)]">{{ t("mcpResources.tools") }}</div>
        <div v-if="displayToolNames.length === 0" class="mono dim text-[11px]">{{ t("mcpResources.noTools") }}</div>
        <div v-else class="flex flex-wrap gap-1.5">
          <span
            v-for="toolName in displayToolNames"
            :key="toolName"
            class="inline-flex items-center rounded-[6px] border border-[var(--ui-well-border)] bg-[var(--ui-well-bg)] px-2 py-1 mono text-[11px] text-[var(--text)]"
          >
            {{ toolName }}
          </span>
        </div>
      </div>
      <div class="grid gap-1">
        <div class="text-[12px] font-medium text-[color:var(--text-muted)]">{{ t("mcpResources.parameters") }}</div>
        <div v-if="displayParameterEntries.length === 0" class="mono dim text-[11px]">
          {{ t("mcpResources.noParameters") }}
        </div>
        <div v-else class="grid gap-1">
          <div
            v-for="entry in displayParameterEntries"
            :key="`${entry.key}:${entry.value}`"
            class="rounded-[6px] border border-[var(--ui-well-border)] bg-[var(--ui-well-bg)] px-2.5 py-2"
          >
            <div class="mono dim whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[11px]">
              {{ entry.key }}
            </div>
            <div class="mono whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[11px] text-[var(--text)]">
              {{ entry.value || t("mcpResources.notFilled") }}
            </div>
          </div>
        </div>
      </div>
      <div
        v-if="item.errorText"
        class="mono whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[11px] leading-[1.4] text-[var(--text)]"
      >
        {{ item.errorText }}
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class="btn-mini" @click.stop="props.onOpenInPanel(item)">
          {{ t("mcpResourceRead.openInPanel") }}
        </button>
      </div>
    </div>
  </TimelineCardShell>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Database } from "lucide-vue-next";
import TimelineCardShell from "../TimelineCardShell.vue";
import ExecutionWaveText from "../../ui/ExecutionWaveText.vue";
import type { McpResourceReadNode } from "../../../features/timeline/renderModel/buildTimelineNodes";

const props = defineProps<{
  open: boolean;
  item: McpResourceReadNode;
  onOpenInPanel: (item: McpResourceReadNode) => void;
}>();

const emit = defineEmits<{
  (event: "update:open", value: boolean): void;
}>();

const { t } = useI18n();
const isRunning = computed(() => props.item.status === "running");
// Tool events expose no success/failure text; only running state uses the shimmer label.

const displayResourceLabel = computed(
  () => props.item.resourceLabel || props.item.uri || t("mcpResources.untitledResource")
);
const displayToolNames = computed(() => props.item.toolNames ?? []);
const displayParameterEntries = computed(() => props.item.parameterEntries ?? []);

const summaryText = computed(() => displayResourceLabel.value);
</script>
