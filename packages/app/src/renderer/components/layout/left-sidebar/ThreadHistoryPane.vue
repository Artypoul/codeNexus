<template>
  <div class="lsb-pane-content">
    <div class="lsb-pane-head">
      <div class="lsb-pane-head-row">
        <div class="lsb-pane-title">{{ t("threadHistory.title") }}</div>
        <div class="lsb-head-badges">
          <span class="lsb-head-badge is-accent mono">{{ threadsCountText }}</span>
          <span v-if="runningThreadsCount > 0" class="lsb-head-badge is-success mono">
            {{ t("threadHistory.runningCount", { count: runningThreadsCount }) }}
          </span>
        </div>
      </div>

      <div class="lsb-pane-toolbar lsb-thread-toolbar">
        <button class="lsb-nav-row lsb-search-btn" type="button" @click="emit('open-search')">
          <Search class="lsb-nav-icon" aria-hidden="true" />
          <span class="lsb-nav-text">{{ t("commandActivity.search") }}</span>
          <span class="lsb-shortcut">Ctrl K</span>
        </button>
        <button
          id="btn-add-thread"
          class="lsb-icon-btn"
          type="button"
          :aria-label="t('threadHistory.newThread')"
          :title="t('threadHistory.newThread')"
          @click="runtime.createThread"
        >
          <SquarePen aria-hidden="true" />
        </button>
        <button
          class="lsb-icon-btn"
          type="button"
          :aria-label="t('topbarExtra.selectWorkspace')"
          :title="t('topbarExtra.selectWorkspace')"
          @click="runtime.selectWorkspace"
        >
          <FolderOpen aria-hidden="true" />
        </button>
        <button
          id="btn-refresh-history"
          class="lsb-icon-btn lsb-thread-refresh-btn"
          type="button"
          :aria-label="t('common.refresh')"
          :disabled="isRefreshingHistory"
          @click="onRefreshHistoryClick"
        >
          <span class="inline-flex" :class="{ spin: isRefreshingHistory }">
            <RefreshCw aria-hidden="true" />
          </span>
        </button>
      </div>
    </div>

    <div id="thread-history" class="lsb-scroll app-scrollbar">
      <div class="lsb-thread-groups">
        <template v-if="isProjectGroupingLoading">
          <div class="lsb-empty lsb-thread-empty mono">
            <div class="dim">{{ t("threadHistory.loadingProjects") }}</div>
          </div>
        </template>
        <template
          v-else-if="
            totalThreadListCount === 0 && primaryThreadGroups.length === 0 && otherWorkspaceGroups.length === 0
          "
        >
          <div class="lsb-empty lsb-thread-empty mono">
            <div class="dim">{{ t("threadHistory.empty") }}</div>
            <button class="lsb-nav-row lsb-nav-row--workspace" type="button" @click="runtime.createThread">
              <span class="lsb-nav-text">{{ t("threadHistory.newThread") }}</span>
            </button>
          </div>
        </template>
        <template v-else>
          <div v-if="projectGroupingNotice" class="lsb-project-notice mono">
            {{ projectGroupingNotice }}
          </div>
          <section v-for="group in primaryThreadGroups" :key="group.key" class="lsb-section">
            <Collapsible
              class="lsb-section-collapsible"
              :open="isThreadGroupExpanded(group.key)"
              @update:open="(next) => onThreadGroupOpenChange(group.key, next)"
            >
              <template #trigger="{ open, triggerProps }">
                <div role="heading" aria-level="3">
                  <button class="lsb-group-head lsb-group-head-toggle" type="button" v-bind="triggerProps">
                    <span class="lsb-group-head-left">
                      <Folder class="lsb-group-icon" aria-hidden="true" />
                      <span class="lsb-group-title">{{ group.title }}</span>
                    </span>
                    <ChevronDown class="lsb-chevron" :class="{ open }" aria-hidden="true" />
                  </button>
                </div>
              </template>

              <div class="lsb-group-body">
                <ThreadRow
                  v-for="row in group.rows"
                  :key="`row:${row.item.id}`"
                  :row="row"
                  :active-thread-id="runtimeStore.currentThreadId"
                  :is-invalid-workspace-item="isInvalidWorkspaceItem"
                  :is-pending-thread-id="isPendingThreadId"
                  :should-show-user-input-badge="shouldShowUserInputBadge"
                  :should-show-thread-attention="shouldShowThreadAttention"
                  :running-thread-ids="threadStore.runningThreadIds"
                  :recently-completed-thread-ids="threadStore.recentlyCompletedThreadIds"
                  :thread-aria-label="threadAriaLabel"
                  :thread-row-depth-style="threadRowDepthStyle"
                  :format-relative-time="formatRelativeTime"
                  @open-thread="onThreadItemClick"
                  @clear-thread-attention="onClearThreadAttention"
                  @rename-thread="onRenameThread"
                  @delete-thread="onDeleteThread"
                />
                <div v-for="section in group.sections" :key="section.key" class="lsb-thread-section-group">
                  <div class="lsb-thread-section-title">{{ section.title }}</div>
                  <ThreadRow
                    v-for="row in section.rows"
                    :key="`row:${row.item.id}`"
                    :row="row"
                    :active-thread-id="runtimeStore.currentThreadId"
                    :is-invalid-workspace-item="isInvalidWorkspaceItem"
                    :is-pending-thread-id="isPendingThreadId"
                    :should-show-user-input-badge="shouldShowUserInputBadge"
                    :should-show-thread-attention="shouldShowThreadAttention"
                    :running-thread-ids="threadStore.runningThreadIds"
                    :recently-completed-thread-ids="threadStore.recentlyCompletedThreadIds"
                    :thread-aria-label="threadAriaLabel"
                    :thread-row-depth-style="threadRowDepthStyle"
                    :format-relative-time="formatRelativeTime"
                    @open-thread="onThreadItemClick"
                    @clear-thread-attention="onClearThreadAttention"
                    @rename-thread="onRenameThread"
                    @delete-thread="onDeleteThread"
                  />
                </div>
              </div>
            </Collapsible>
          </section>
          <template v-if="otherWorkspaceGroups.length > 0">
            <div class="lsb-thread-area-label mono">{{ t("threadHistory.otherWorkspaces") }}</div>
            <section v-for="group in otherWorkspaceGroups" :key="group.key" class="lsb-section">
              <Collapsible
                class="lsb-section-collapsible"
                :open="isThreadGroupExpanded(group.key)"
                @update:open="(next) => onThreadGroupOpenChange(group.key, next)"
              >
                <template #trigger="{ open, triggerProps }">
                  <div role="heading" aria-level="3">
                    <button class="lsb-group-head lsb-group-head-toggle" type="button" v-bind="triggerProps">
                      <span class="lsb-group-head-left">
                        <Folder class="lsb-group-icon" aria-hidden="true" />
                        <span class="lsb-group-title">{{ group.title }}</span>
                      </span>
                      <ChevronDown class="lsb-chevron" :class="{ open }" aria-hidden="true" />
                    </button>
                  </div>
                </template>

                <div class="lsb-group-body">
                  <ThreadRow
                    v-for="row in group.rows"
                    :key="`row:${row.item.id}`"
                    :row="row"
                    :active-thread-id="runtimeStore.currentThreadId"
                    :is-invalid-workspace-item="isInvalidWorkspaceItem"
                    :is-pending-thread-id="isPendingThreadId"
                    :should-show-user-input-badge="shouldShowUserInputBadge"
                    :should-show-thread-attention="shouldShowThreadAttention"
                    :running-thread-ids="threadStore.runningThreadIds"
                    :recently-completed-thread-ids="threadStore.recentlyCompletedThreadIds"
                    :thread-aria-label="threadAriaLabel"
                    :thread-row-depth-style="threadRowDepthStyle"
                    :format-relative-time="formatRelativeTime"
                    @open-thread="onThreadItemClick"
                    @clear-thread-attention="onClearThreadAttention"
                    @rename-thread="onRenameThread"
                    @delete-thread="onDeleteThread"
                  />
                </div>
              </Collapsible>
            </section>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ChevronDown, Folder, FolderOpen, RefreshCw, Search, SquarePen } from "lucide-vue-next";
import type { ThreadHistoryItem } from "../../../domain/types";
import { getRuntimeOrchestrator } from "../../../domain/runtimeOrchestrator";
import { codexDesktop } from "../../../api/codexDesktopClient";
import { useAppShellStore } from "../../../stores/appShell.store";
import { useRuntimeStore } from "../../../stores/runtime.store";
import { useThreadStore } from "../../../stores/thread.store";
import { useUserInputStore } from "../../../stores/userInput.store";
import { useProjectStore } from "../../../stores/project.store";
import { normalizeThreadTitleOverride } from "../../../features/history/threadTitle";
import { buildThreadHistoryGroups, type ThreadHistoryGroup } from "../../../features/history/projectThreadGroups";
import { isPendingThreadId } from "../../../shared/threadCreateDebug";
import Collapsible from "../../ui/Collapsible.vue";
import ThreadRow from "./ThreadRow.vue";
import { showToast } from "../../../ui/toast";

const emit = defineEmits<{ "open-search": [] }>();

type ThreadListItem = Pick<
  ThreadHistoryItem,
  | "id"
  | "title"
  | "meta"
  | "updatedAt"
  | "cwd"
  | "forkedFromId"
  | "agentNickname"
  | "agentRole"
  | "agentPath"
  | "gitInfoSummary"
  | "projectId"
  | "sectionId"
  | "sectionName"
  | "createdAt"
  | "status"
>;
type ThreadRowModel = ThreadHistoryGroup<ThreadListItem>["rows"][number];
type ThreadGroup = ThreadHistoryGroup<ThreadListItem>;

const runtime = getRuntimeOrchestrator();
const appShellStore = useAppShellStore();
const runtimeStore = useRuntimeStore();
const threadStore = useThreadStore();
const userInputStore = useUserInputStore();
const projectStore = useProjectStore();
const { t } = useI18n();

const isRefreshingHistory = ref(false);
const nowMs = ref(Date.now());
let intervalId: number | null = null;

const onRefreshHistoryClick = async () => {
  if (isRefreshingHistory.value) return;
  isRefreshingHistory.value = true;
  try {
    await runtime.refreshHistory(true);
  } finally {
    isRefreshingHistory.value = false;
  }
};

function normalizeFsPath(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let s = raw.replace(/\//g, "\\");
  while (s.endsWith("\\") && s.length > 3) s = s.slice(0, -1);
  return s.toLowerCase();
}

function normalizeThreadId(value: unknown): string {
  return String(value ?? "").trim();
}

const sortByUpdatedAtDesc = (a: ThreadListItem, b: ThreadListItem) =>
  a.updatedAt !== b.updatedAt ? b.updatedAt - a.updatedAt : a.title.localeCompare(b.title);

const visibleThreadItems = computed<ThreadListItem[]>(() => {
  const map = new Map<string, ThreadListItem>();
  for (const item of threadStore.threadHistory) {
    const id = normalizeThreadId(item.id);
    if (id) map.set(id, item);
  }
  return [...map.values()].sort(sortByUpdatedAtDesc);
});

const threadHistoryById = computed(() => {
  const map = new Map<string, ThreadListItem>();
  for (const item of visibleThreadItems.value) {
    const id = normalizeThreadId(item.id);
    if (id) map.set(id, item);
  }
  return map;
});

const activeProjectWorkspace = computed(() => normalizeFsPath(runtimeStore.workspacePath));
const hasProjectSnapshot = computed(() =>
  projectStore.hasSnapshotForWorkspace(String(runtimeStore.workspacePath ?? ""))
);
const isProjectGroupingLoading = computed(() => {
  if (hasProjectSnapshot.value || !activeProjectWorkspace.value) return false;
  if (projectStore.status === "loading") return true;
  return (
    projectStore.status !== "error" &&
    (appShellStore.serverConnState === "connecting" || appShellStore.serverConnState === "connected")
  );
});
const projectGroupingMode = computed<"project" | "workspace">(() =>
  hasProjectSnapshot.value ? "project" : "workspace"
);
const projectGroupingNotice = computed(() => {
  if (projectStore.status !== "error") return "";
  return hasProjectSnapshot.value
    ? t("threadHistory.projectRefreshFailed")
    : t("threadHistory.projectUnavailableFallback");
});

const threadGrouping = computed(() => {
  const items = visibleThreadItems.value.map((sourceItem) => ({
    ...sourceItem,
    title: threadStore.displayThreadTitle(sourceItem.id, sourceItem.title),
  }));
  return buildThreadHistoryGroups({
    mode: projectGroupingMode.value,
    items,
    projects: projectGroupingMode.value === "project" ? projectStore.projects : [],
    sections: projectGroupingMode.value === "project" ? projectStore.sections : [],
    currentWorkspace: String(runtimeStore.workspacePath ?? "").trim(),
    labels: {
      unassigned: t("threadHistory.unassigned"),
      noWorkspace: t("threadHistory.noWorkspace"),
    },
  });
});
const primaryThreadGroups = computed<ThreadGroup[]>(() => threadGrouping.value.primaryGroups);
const otherWorkspaceGroups = computed<ThreadGroup[]>(() => threadGrouping.value.otherWorkspaceGroups);

const runningThreadsCount = computed(() => threadStore.runningThreadIds.size);
const totalThreadListCount = computed(() => visibleThreadItems.value.length);
const threadsCountText = computed(() => t("threadHistory.totalCount", { count: totalThreadListCount.value }));
const visibleThreadGroupKeys = computed(() => {
  return new Set(
    [...primaryThreadGroups.value, ...otherWorkspaceGroups.value]
      .map((group) => String(group.key ?? "").trim())
      .filter(Boolean)
  );
});

const currentThreadGroupKey = computed(() => {
  const currentId = normalizeThreadId(runtimeStore.currentThreadId);
  if (!currentId) return "";

  const currentThread = threadHistoryById.value.get(currentId);
  if (currentThread) {
    if (projectGroupingMode.value === "project") {
      const projectId = String(currentThread.projectId ?? "").trim();
      if (projectId && projectStore.projectById.has(projectId)) return `project:${projectId}`;
      const cwd = normalizeFsPath(currentThread.cwd);
      if (!cwd || cwd === activeProjectWorkspace.value) {
        return `unassigned:${activeProjectWorkspace.value || "__no_workspace__"}`;
      }
      return `other:${cwd || "__no_workspace__"}`;
    }
    const cwd = String(currentThread.cwd ?? "").trim();
    return `workspace:${cwd ? normalizeFsPath(cwd) : "__no_workspace__"}`;
  }

  const fallbackWorkspace = String(threadStore.currentWorkspace ?? runtimeStore.workspacePath ?? "").trim();
  if (projectGroupingMode.value === "project") {
    return `unassigned:${activeProjectWorkspace.value || "__no_workspace__"}`;
  }
  return `workspace:${fallbackWorkspace ? normalizeFsPath(fallbackWorkspace) : "__no_workspace__"}`;
});

watch(
  [currentThreadGroupKey, visibleThreadGroupKeys],
  ([groupKey, visibleKeys]) => {
    if (!groupKey || !visibleKeys.has(groupKey)) return;
    appShellStore.ensureThreadWorkspaceGroupExpanded(groupKey);
  },
  { immediate: true }
);

const isThreadGroupExpanded = (groupKeyValue: string) => !appShellStore.isThreadWorkspaceGroupCollapsed(groupKeyValue);
const onThreadGroupOpenChange = (groupKeyValue: string, open: boolean) =>
  appShellStore.setThreadWorkspaceGroupCollapsed(groupKeyValue, !open);
function extractInvalidWorkspacePathFromError(errorText: string): string {
  const text = String(errorText ?? "");
  for (const re of [
    /Workspace directory does not exist:\s*([^\r\n.]+)(?:\.|$)/i,
    /Workspace path is not a directory:\s*([^\r\n.]+)(?:\.|$)/i,
    /Workspace directory is not accessible:\s*([^\r\n(]+)(?:\(|\.|$)/i,
  ]) {
    const candidate = String(text.match(re)?.[1] ?? "").trim();
    if (candidate) return candidate;
  }
  return "";
}
const invalidWorkspacePath = computed(() =>
  appShellStore.serverConnState !== "failed" ? "" : extractInvalidWorkspacePathFromError(appShellStore.serverError)
);
const isInvalidWorkspaceItem = (item: { cwd?: string }) => {
  const bad = normalizeFsPath(invalidWorkspacePath.value);
  const cwd = normalizeFsPath(String(item?.cwd ?? ""));
  return Boolean(bad && cwd && cwd === bad);
};
const shouldShowUserInputBadge = (threadIdValue: string) =>
  userInputStore.queueSizeForThread(String(threadIdValue ?? "").trim()) > 0;
const threadAriaLabel = (row: ThreadRowModel) => {
  const title = threadStore.displayThreadTitle(row.item.id, row.item.title);
  const git = String(row.item.gitInfoSummary ?? "").trim();
  return git
    ? `${t("threadHistory.openThreadAria", { title })} · ${git}`
    : t("threadHistory.openThreadAria", { title });
};
const shouldShowThreadAttention = (threadId: string) => {
  const tid = String(threadId ?? "").trim();
  return Boolean(tid && tid !== runtimeStore.currentThreadId && threadStore.attentionThreadIds.has(tid));
};
const onClearThreadAttention = (threadId: string) => threadStore.clearThreadAttention(threadId);
const onDeleteThread = async (threadId: string) => {
  const item = threadHistoryById.value.get(threadId);
  if (!item) return;
  try {
    const { confirmModal } = await import("../../../ui/modal");
    const confirmed = await confirmModal({
      title: t("common.confirm"),
      message: `${t("threadRow.deleteHistory")}?`,
      detail: threadStore.displayThreadTitle(item.id, item.title),
      confirmText: t("common.delete"),
      cancelText: t("common.cancel"),
      danger: true,
    });
    if (confirmed) await runtime.deleteHistoryThread(threadId);
  } catch (error) {
    showToast({
      kind: "error",
      title: t("runtime.confirmModalOpenFailedTitle"),
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
const onRenameThread = async (threadIdValue: string, titleValue: string) => {
  const threadId = normalizeThreadId(threadIdValue);
  if (!threadId) return;

  const normalized = normalizeThreadTitleOverride(titleValue);
  const previous = threadStore.threadTitleOverridesByThreadId.get(threadId) ?? "";

  if (normalized) threadStore.setThreadTitleOverride(threadId, normalized);
  else threadStore.clearThreadTitleOverride(threadId);

  try {
    if (normalized) {
      await codexDesktop.history.setThreadTitleOverride({ threadId, title: normalized });
    } else {
      await codexDesktop.history.clearThreadTitleOverride({ threadId });
    }
  } catch (error) {
    if (previous) threadStore.setThreadTitleOverride(threadId, previous);
    else threadStore.clearThreadTitleOverride(threadId);
    showToast({
      kind: "error",
      title: t("threadHistory.renameFailed"),
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
const threadRowDepthStyle = (depth: number) =>
  ({ "--lsb-thread-depth": String(Math.max(0, Math.round(depth))) }) as Record<string, string>;
const onThreadItemClick = (threadId: string) => {
  const tid = String(threadId ?? "").trim();
  if (!tid) return;
  threadStore.clearThreadAttention(tid);
  if (tid === runtimeStore.currentThreadId) return;
  runtime.switchThread(tid);
};

onMounted(() => {
  intervalId = window.setInterval(() => {
    nowMs.value = Date.now();
  }, 30_000);
});
onBeforeUnmount(() => {
  if (intervalId != null) window.clearInterval(intervalId);
});

function formatRelativeTime(updatedAt: number): string {
  const ts = Number(updatedAt);
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const deltaSec = Math.floor(Math.max(0, nowMs.value - ts) / 1000);
  if (deltaSec < 90) return "Now";
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m`;
  const deltaH = Math.floor(deltaMin / 60);
  if (deltaH < 24) return `${deltaH}h`;
  return `${Math.floor(deltaH / 24)}d`;
}
</script>
