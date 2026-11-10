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
        @contextmenu.prevent.stop="openContextMenu"
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
              @contextmenu.stop
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
            ref="menuTrigger"
            class="lsb-icon-btn lsb-delete"
            type="button"
            :aria-label="t('threadRow.renameAria') + ' / ' + t('threadRow.deleteHistory')"
            :aria-expanded="menuOpen"
            aria-haspopup="menu"
            @click.stop="toggleMenu"
            @keydown="onMenuKeydown"
            @focusout="onMenuFocusOut"
          >
            <MoreHorizontal aria-hidden="true" />
          </button>
        </span>
      </div>
    </div>
    <Teleport to="body">
      <div
        v-if="menuOpen"
        ref="menuEl"
        class="lsb-thread-menu-popup"
        role="menu"
        :style="menuStyle"
        @click.stop
        @keydown="onMenuKeydown"
        @focusout="onMenuFocusOut"
      >
        <button type="button" role="menuitem" :disabled="isPendingThreadId(row.item.id)" @click="closeMenuAndRename">
          {{ t("threadRow.renameAria") }}
        </button>
        <button type="button" role="menuitem" @click="closeMenuAndDelete">{{ t("threadRow.deleteHistory") }}</button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { BellRing, CheckCircle2, MessageCircleQuestionMark, MoreHorizontal } from "lucide-vue-next";
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

const menuEl = ref<HTMLElement | null>(null);
const menuTrigger = ref<HTMLButtonElement | null>(null);
const menuOpen = ref(false);
const menuStyle = ref<Record<string, string>>({});
const closeMenu = () => {
  menuOpen.value = false;
  document.removeEventListener("pointerdown", closeMenuOutside);
  window.removeEventListener("resize", closeMenu);
  window.removeEventListener("scroll", closeMenu, true);
};
const closeMenuOutside = (event: PointerEvent) => {
  const target = event.target as Node;
  if (!menuEl.value?.contains(target) && !menuTrigger.value?.contains(target)) closeMenu();
};
const onMenuFocusOut = (event: FocusEvent) => {
  const target = event.relatedTarget;
  if (target instanceof Node && !menuEl.value?.contains(target) && !menuTrigger.value?.contains(target)) closeMenu();
};
const openContextMenu = () => {
  if (!menuTrigger.value) return;
  const anchor = menuTrigger.value.getBoundingClientRect();
  menuStyle.value = { left: `${anchor.left}px`, top: `${anchor.bottom}px`, visibility: "hidden" };
  menuOpen.value = true;
  document.addEventListener("pointerdown", closeMenuOutside);
  window.addEventListener("resize", closeMenu);
  window.addEventListener("scroll", closeMenu, true);
  void nextTick(() => {
    if (!menuOpen.value || !menuEl.value) return;
    const rect = menuEl.value.getBoundingClientRect();
    const padding = 8;
    const left = Math.max(padding, Math.min(anchor.right - rect.width, window.innerWidth - rect.width - padding));
    const top = Math.max(padding, Math.min(anchor.bottom, window.innerHeight - rect.height - padding));
    menuStyle.value = { left: `${left}px`, top: `${top}px` };
    void nextTick(() => {
      if (menuOpen.value) menuEl.value?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    });
  });
};
const toggleMenu = () => {
  if (menuOpen.value) closeMenu();
  else openContextMenu();
};
onBeforeUnmount(closeMenu);
const closeMenuAndRename = () => {
  closeMenu();
  beginRename();
};
const closeMenuAndDelete = () => {
  closeMenu();
  emit("delete-thread", props.row.item.id);
};
const onMenuKeydown = (event: KeyboardEvent) => {
  if (event.key === "Escape" && menuOpen.value) {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    menuTrigger.value?.focus();
  } else if (menuOpen.value && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    event.preventDefault();
    event.stopPropagation();
    const buttons = [...(menuEl.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    if (buttons.length) {
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  } else if (event.key === "Tab" && menuOpen.value) {
    closeMenu();
    menuTrigger.value?.focus();
  } else if (event.currentTarget === menuTrigger.value && (event.key === "Enter" || event.key === " ")) {
    event.stopPropagation();
  }
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
