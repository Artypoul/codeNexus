<template>
  <div
    class="chat-inline-activity chat-terminal-action-wrap w-full max-w-full min-w-0"
    :class="{ 'is-running': item.item.status === 'running' }"
  >
    <div
      class="chat-inline-activity__line chat-inline-activity__line--compact chat-inline-activity__line--full chat-terminal-action-line inline-flex w-full max-w-full min-w-0 items-center gap-1.5 p-0 m-0 box-border border-0 bg-transparent text-xs"
      :class="{ 'is-running': item.item.status === 'running' }"
    >
      <span class="chat-inline-activity__icon ui-leading-icon-slot" aria-hidden="true">
        <TerminalSquare
          class="chat-inline-activity__svg chat-terminal-action-icon h-[14px] w-[14px] flex-none [stroke-width:2.4]"
        />
      </span>
      <ExecutionWaveText
        v-if="isRunning"
        class="chat-inline-activity__text chat-terminal-action-text"
        color="var(--accent)"
        :text="actionText"
        :cycle-max-chars="0"
      />
      <span v-else class="chat-inline-activity__text chat-terminal-action-text">{{ actionText }}</span>
      <button
        v-if="item.item.filesCount > 0"
        class="chat-terminal-action-toggle !ml-auto !inline-flex !h-[22px] !w-[22px] !items-center !justify-center !rounded-[4px] !border !border-[var(--ui-well-border)] !bg-[var(--ui-well-bg)] !p-0 !text-inherit !shadow-none opacity-80 transition-[opacity,border-color,background] duration-150 hover:opacity-100 hover:!border-[var(--ui-well-border-hover)] hover:!bg-[var(--ui-well-bg-strong)] focus-visible:!outline-none focus-visible:!ring-2 focus-visible:!ring-[var(--ui-well-focus-outline)] active:!translate-y-0"
        type="button"
        :aria-expanded="isFilesOpen ? 'true' : 'false'"
        @click.stop="$emit('toggle-files')"
      >
        <ChevronDown
          class="chat-terminal-action-toggle-icon h-[14px] w-[14px] opacity-80 transition-[transform,opacity] duration-150"
          :class="isFilesOpen ? 'rotate-180' : ''"
          aria-hidden="true"
        />
      </button>
    </div>
    <div
      v-if="item.item.filesCount > 0 && isFilesOpen"
      class="chat-terminal-action-files mx-2.5 rounded-xl border border-[var(--ui-well-border)] bg-[var(--ui-well-bg-strong)] px-2.5 py-2"
    >
      <div class="chat-terminal-action-files-title mb-1.5 text-xs mono dim">
        {{ t("chat.activity.filesTitle", { count: item.item.filesCount }) }}
      </div>
      <div
        class="chat-terminal-action-files-list app-scrollbar grid max-h-[180px] gap-0.5 overflow-y-auto text-xs text-[var(--text)] mono"
      >
        <div
          v-for="name in item.item.files.slice(0, renderLimit)"
          :key="`${item.id}:file:${name}`"
          class="chat-terminal-action-files-row truncate whitespace-nowrap"
        >
          {{ name }}
        </div>
        <div v-if="item.item.filesCount > renderLimit" class="chat-terminal-action-files-more mt-1.5 dim">
          {{ t("chat.activity.moreItemsHidden", { count: item.item.filesCount - renderLimit }) }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ChevronDown, TerminalSquare } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import ExecutionWaveText from "../ui/ExecutionWaveText.vue";
import type { CommandActionNode } from "../../features/timeline/renderModel/buildTimelineNodes";
import {
  commandGroupItemActionText,
  commandGroupItemActionDetailText,
} from "../../features/timeline/renderModel/formatters";

const props = defineProps<{
  item: CommandActionNode;
  isFilesOpen: boolean;
  renderLimit: number;
}>();

defineEmits<{
  (e: "toggle-files"): void;
}>();

const { t } = useI18n();
const actionText = computed(() => {
  const main = commandGroupItemActionText(props.item.item);
  const detail = commandGroupItemActionDetailText(props.item.item);
  return detail ? `${main} · ${detail}` : main;
});
const isRunning = computed(() => props.item.item.status === "running");
</script>

<style scoped>
.chat-terminal-action-line.is-running .chat-terminal-action-icon {
  color: var(--accent);
}

.chat-terminal-action-text {
  line-height: 20px;
}
</style>
