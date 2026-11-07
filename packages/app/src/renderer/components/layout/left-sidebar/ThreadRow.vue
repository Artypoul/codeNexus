<template>
  <div
    class="lsb-thread-row"
    :class="[
      {
        active: row.item.id === activeThreadId,
        'invalid-workspace': isInvalidWorkspaceItem(row.item),
      },
      threadStatusClass,
    ]"
  >
    <div class="lsb-thread-row-shell" :style="threadRowDepthStyle(row.depth)">
      <span class="lsb-thread-toggle-spacer" aria-hidden="true"></span>
      <div
        class="lsb-thread-item"
        role="button"
        tabindex="0"
        :aria-label="threadAriaLabel(row)"
        @click="onRowClick"
        @keydown="onRowKeydown"
      >
        <span class="lsb-thread-title">
          <LoadingDots
            v-if="isPendingThreadId(row.item.id)"
            class="lsb-thread-title-text"
            :baseText="t('threadRow.creating')"
            :ariaLabel="t('threadRow.creating')"
          />
          <template v-else>
            <input
              v-if="isRenaming"
              v-model="renameDraft"
              class="lsb-thread-title-input mono"
              type="text"
              :maxlength="80"
              :aria-label="t('threadRow.renameAria')"
              ref="renameInputEl"
              @click.stop
              @dblclick.stop
              @keydown="onRenameKeydown"
              @blur="commitRename"
            />
            <span
              v-else
              class="lsb-thread-title-text"
              :title="threadTitleTooltip"
              @dblclick.stop.prevent="beginRename"
              >{{ displayTitle }}</span
            >
          </template>
          <span v-if="hasUserInputQuestion" class="lsb-badge is-question">{{ t("threadRow.qa") }}</span>
          <span v-if="agentNicknameBadge" class="lsb-badge">{{ agentNicknameBadge }}</span>
          <span v-if="isInvalidWorkspaceItem(row.item)" class="lsb-badge">{{ t("threadRow.invalid") }}</span>
        </span>

        <span class="lsb-thread-right">
          <span class="lsb-thread-status">
            <MessageCircleQuestionMark
              v-if="threadVisualStatus === 'question'"
              class="lsb-thread-status-icon is-question"
              aria-hidden="true"
            />
            <ExecutionCoreIcon
              v-else-if="threadVisualStatus === 'running'"
              class="lsb-thread-status-icon is-thread-running"
              running
            />
            <button
              v-else-if="threadVisualStatus === 'attention'"
              class="lsb-thread-attention-btn"
              type="button"
              :aria-label="t('threadRow.clearAttention')"
              @click.stop="emit('clear-thread-attention', row.item.id)"
            >
              <BellRing class="lsb-thread-status-icon is-attention" aria-hidden="true" />
            </button>
            <CheckCircle2
              v-else-if="threadVisualStatus === 'completed'"
              class="lsb-thread-status-icon is-completed"
              aria-hidden="true"
            />
          </span>

          <span class="lsb-thread-time">{{ formatRelativeTime(row.item.updatedAt) }}</span>

          <button
            class="lsb-icon-btn lsb-delete"
            type="button"
            :aria-label="t('threadRow.deleteHistory')"
            @click.stop="emit('delete-thread', row.item.id)"
          >
            <Trash2 />
          </button>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import { BellRing, CheckCircle2, MessageCircleQuestionMark, Trash2 } from "lucide-vue-next";
import { useThreadStore } from "../../../stores/thread.store";
import LoadingDots from "../../ui/LoadingDots.vue";
import ExecutionCoreIcon from "../../ui/ExecutionCoreIcon.vue";

type ThreadVisualStatus = "question" | "running" | "attention" | "completed" | "idle";

type ThreadRowItem = {
  item: {
    id: string;
    title: string;
    updatedAt: number;
    cwd?: string;
    agentNickname?: string;
    gitInfoSummary?: string;
  };
  depth: number;
};

const props = defineProps<{
  row: ThreadRowItem;
  activeThreadId: string;
  isInvalidWorkspaceItem: (item: { cwd?: string }) => boolean;
  isPendingThreadId: (threadId: string) => boolean;
  shouldShowUserInputBadge: (threadId: string) => boolean;
  shouldShowThreadAttention: (threadId: string) => boolean;
  runningThreadIds: Set<string>;
  recentlyCompletedThreadIds: Set<string>;
  threadAriaLabel: (row: ThreadRowItem) => string;
  threadRowDepthStyle: (depth: number) => Record<string, string>;
  formatRelativeTime: (updatedAt: number) => string;
}>();

const emit = defineEmits<{
  (e: "open-thread", threadId: string): void;
  (e: "clear-thread-attention", threadId: string): void;
  (e: "delete-thread", threadId: string): void;
  (e: "rename-thread", threadId: string, title: string): void;
}>();

const { t } = useI18n();
const agentNicknameBadge = computed(() => {
  const raw = String(props.row.item.agentNickname ?? "").trim();
  if (!raw) return "";
  return raw.length > 12 ? `${raw.slice(0, 12)}…` : raw;
});

const threadStore = useThreadStore();
const displayTitle = computed(() => threadStore.displayThreadTitle(props.row.item.id, props.row.item.title));
const threadTitleTooltip = computed(() => {
  const git = String(props.row.item.gitInfoSummary ?? "").trim();
  return git ? `${displayTitle.value}\n${git}` : displayTitle.value;
});
const threadId = computed(() => String(props.row.item.id ?? "").trim());
const hasUserInputQuestion = computed(() => props.shouldShowUserInputBadge(threadId.value));
const threadVisualStatus = computed<ThreadVisualStatus>(() => {
  const tid = threadId.value;
  if (!tid) return "idle";
  if (hasUserInputQuestion.value) return "question";
  if (props.runningThreadIds.has(tid)) return "running";
  if (props.shouldShowThreadAttention(tid)) return "attention";
  if (props.recentlyCompletedThreadIds.has(tid)) return "completed";
  return "idle";
});
const threadStatusClass = computed(() =>
  threadVisualStatus.value === "idle" ? "" : `is-status-${threadVisualStatus.value}`
);
const isRenaming = ref(false);
const renameDraft = ref("");
const renameInputEl = ref<HTMLInputElement | null>(null);
let renameTargetThreadId = "";
let renameCancelValue = "";

const beginRename = () => {
  if (props.isPendingThreadId(props.row.item.id)) return;
  renameTargetThreadId = String(props.row.item.id ?? "").trim();
  if (!renameTargetThreadId) return;
  const current = String(displayTitle.value ?? "").trim();
  renameCancelValue = current;
  renameDraft.value = current;
  isRenaming.value = true;
  void nextTick().then(() => {
    renameInputEl.value?.focus();
    renameInputEl.value?.select();
  });
};

const cancelRename = () => {
  isRenaming.value = false;
  renameDraft.value = renameCancelValue;
  renameTargetThreadId = "";
  renameCancelValue = "";
};

const commitRename = () => {
  if (!isRenaming.value) return;
  const threadId = String(renameTargetThreadId ?? "").trim();
  const title = String(renameDraft.value ?? "");
  isRenaming.value = false;
  renameTargetThreadId = "";
  renameCancelValue = "";
  if (!threadId) return;
  emit("rename-thread", threadId, title);
};

const onRowKeydown = (event: KeyboardEvent) => {
  if (isRenaming.value) return;
  if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
  event.preventDefault();
  emit("open-thread", props.row.item.id);
};

const onRowClick = (event: MouseEvent) => {
  if (isRenaming.value) {
    event.preventDefault();
    return;
  }
  emit("open-thread", props.row.item.id);
};

const onRenameKeydown = (event: KeyboardEvent) => {
  if (!isRenaming.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    cancelRename();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    commitRename();
    return;
  }
};
</script>
