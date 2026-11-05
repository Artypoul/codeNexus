<template>
  <article
    class="event simple-file-change-event file-change-card group min-w-0 max-w-full"
    :class="[fileChangeEventClass(item), modeClass, stateClass]"
    :aria-busy="isRunning"
  >
    <div class="file-change-file-list">
      <section
        v-for="entry in fileEntries"
        :key="entry.key"
        class="file-change-file-item"
        :class="{
          'is-expanded': entry.isExpanded,
          'is-running': isRunning,
          'is-empty': !entry.file,
        }"
      >
        <header class="file-change-file-header">
          <div class="file-change-file-main">
            <div class="file-change-path-line">
              <span class="file-change-path mono" :title="entry.pathTitle">{{ entry.pathText }}</span>
              <span v-if="entry.file" class="file-change-kind-badge" :class="fileChangeKindClass(entry.file.kind)">
                {{ fileChangeKindText(entry.file.kind) }}
              </span>
            </div>
          </div>

          <div class="file-change-stat-cluster mono" :aria-label="entry.lineStatsAriaLabel">
            <template v-if="entry.lineStats.kind === 'lines'">
              <span class="file-change-stat file-change-stat--add" :class="{ 'is-zero': entry.lineStats.add === 0 }">
                +{{ entry.lineStats.add }}
              </span>
              <span class="file-change-stat file-change-stat--del" :class="{ 'is-zero': entry.lineStats.del === 0 }">
                -{{ entry.lineStats.del }}
              </span>
            </template>
            <span v-else class="file-change-stat file-change-stat--plain">{{ entry.lineStats.text }}</span>
          </div>

          <button
            v-if="entry.canExpandDiff"
            type="button"
            class="file-change-expand-button"
            :aria-label="entry.isExpanded ? t('fileChange.collapseDiff') : t('fileChange.expandDiff')"
            :aria-expanded="entry.isExpanded ? 'true' : 'false'"
            @click="toggleEntryExpanded(entry.key)"
          >
            <ChevronDown class="file-change-expand-icon" :class="{ 'is-open': entry.isExpanded }" aria-hidden="true" />
            <span class="file-change-expand-text mono">
              {{ entry.isExpanded ? t("fileChange.collapse") : t("fileChange.expand") }}
            </span>
          </button>
        </header>

        <Transition
          :css="false"
          @enter="onDiffBodyEnter"
          @after-enter="onDiffBodyAfterTransition"
          @leave="onDiffBodyLeave"
          @after-leave="onDiffBodyAfterTransition"
        >
          <section v-if="entry.shouldShowDiffBody" :key="`${entry.key}:diff`" class="file-change-diff-body">
            <UnifiedDiffViewer
              v-if="entry.file"
              :diffText="entry.file.diffText"
              :diffKey="entry.file.pathAbs || entry.key"
              :filePathHint="entry.file.pathRelTo || entry.file.pathRel || entry.file.pathAbsTo || entry.file.pathAbs"
              :fileKind="entry.file.kind"
              maxHeightClass="max-h-[170px]"
              :wrapLines="wrapDiffLines"
              ariaLabel="diff-view"
            />
          </section>
        </Transition>
      </section>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useActivityItemState } from "../../chat/activityItemState";
import { useI18n } from "vue-i18n";
import { ChevronDown } from "lucide-vue-next";
import UnifiedDiffViewer from "./UnifiedDiffViewer.vue";
import { getDiffLineStats } from "../../../features/timeline/renderModel/diff";
import type { FileChangeFile, FileChangeNode } from "../../../features/timeline/renderModel/buildTimelineNodes";
import {
  fileChangeDiffMetaText,
  fileChangeEventClass,
  fileChangeKindClass,
  fileChangeKindText,
} from "../../../features/timeline/renderModel/formatters";

const props = withDefaults(
  defineProps<{
    item: FileChangeNode;
    mode?: "timeline" | "chat";
    wrapDiffLines?: boolean;
  }>(),
  {
    mode: "timeline",
    wrapDiffLines: true,
  }
);

const emit = defineEmits<{
  (e: "layout-change"): void;
}>();

const { t } = useI18n();
type LineStats = { kind: "lines"; add: number; del: number } | { kind: "text"; text: string };
type RenderableFile = FileChangeFile | null;

const userExpandedByKey = useActivityItemState<Record<string, boolean>>(
  () => `diff:${props.item.id}`,
  () => ({})
);
const diffTransitionTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
const DIFF_COLLAPSE_MS = 220;
const DIFF_COLLAPSE_EASING = "cubic-bezier(0.25, 1, 0.5, 1)";

const isRunning = computed(() => Boolean(props.item.isStreaming));
const modeClass = computed(() => (props.mode === "chat" ? "file-change-card--chat" : ""));
const renderableFiles = computed<RenderableFile[]>(() =>
  Array.isArray(props.item.files) && props.item.files.length > 0 ? props.item.files : [null]
);

const fileIdentity = (file: RenderableFile, index: number) => {
  if (!file) return `${props.item.id}:empty:${index}`;
  return [
    props.item.id,
    file.pathAbs || file.pathRel || "unknown",
    file.pathAbsTo || file.pathRelTo || "",
    file.kind,
    index,
  ].join(":");
};

const hasFileDiff = (file: RenderableFile) => Boolean(file?.diffText?.trim());

const pathTextForFile = (file: RenderableFile) => {
  if (!file) return isRunning.value ? t("fileChange.waitingPath") : t("fileChange.noStructuredPath");
  const from = String(file.pathRel ?? file.pathAbs ?? "").trim() || file.pathAbs;
  const to = String(file.pathRelTo ?? file.pathAbsTo ?? "").trim();
  if (file.kind === "rename" && to) return `${from} -> ${to}`;
  return from;
};

const pathTitleForFile = (file: RenderableFile) => {
  if (!file) return pathTextForFile(file);
  const from = String(file.pathAbs ?? file.pathRel ?? "").trim() || file.pathRel;
  const to = String(file.pathAbsTo ?? file.pathRelTo ?? "").trim();
  if (file.kind === "rename" && to) return `${from} -> ${to}`;
  return from;
};

const lineStatsForFile = (file: RenderableFile): LineStats => {
  if (!file) return { kind: "text", text: "--" };
  const stats = getDiffLineStats(file.diffText, file.kind);
  if (stats.add > 0 || stats.del > 0) return { kind: "lines", add: stats.add, del: stats.del };
  return { kind: "text", text: fileChangeDiffMetaText(file.diffText, file.kind) };
};

const stateClass = computed(() => ({
  "is-streaming": isRunning.value,
  "has-multiple-files": renderableFiles.value.length > 1,
}));

const fileEntries = computed(() =>
  renderableFiles.value.map((file, index) => {
    const key = fileIdentity(file, index);
    const hasDiff = hasFileDiff(file);
    const canExpandDiff = hasDiff && !isRunning.value;
    const isExpanded = canExpandDiff && Boolean(userExpandedByKey.value[key]);
    const lineStats = lineStatsForFile(file);
    return {
      file,
      key,
      pathText: pathTextForFile(file),
      pathTitle: pathTitleForFile(file),
      lineStats,
      lineStatsAriaLabel:
        lineStats.kind === "lines"
          ? t("fileChange.lineStats", { add: lineStats.add, del: lineStats.del })
          : t("fileChange.diffScale", { text: lineStats.text }),
      hasDiff,
      canExpandDiff,
      isExpanded,
      shouldShowDiffBody: canExpandDiff && isExpanded,
    };
  })
);

const toggleEntryExpanded = (key: string) => {
  const entry = fileEntries.value.find((candidate) => candidate.key === key);
  if (!entry?.canExpandDiff) return;
  userExpandedByKey.value = {
    ...userExpandedByKey.value,
    [key]: !entry.isExpanded,
  };
};

const requestLayoutChange = () => {
  emit("layout-change");
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => emit("layout-change"));
  }
};

const clearElementTransitionTimer = (element: Element) => {
  const timer = diffTransitionTimers.get(element);
  if (timer == null) return;
  clearTimeout(timer);
  diffTransitionTimers.delete(element);
};

const finishElementTransitionAfter = (element: Element, done: () => void) => {
  clearElementTransitionTimer(element);
  const timer = setTimeout(() => {
    diffTransitionTimers.delete(element);
    done();
  }, DIFF_COLLAPSE_MS + 40);
  diffTransitionTimers.set(element, timer);
};

const clearDiffBodyTransitionStyles = (element: Element) => {
  clearElementTransitionTimer(element);
  const el = element as HTMLElement;
  el.style.height = "";
  el.style.opacity = "";
  el.style.overflow = "";
  el.style.transition = "";
};

const onDiffBodyEnter = (element: Element, done: () => void) => {
  const el = element as HTMLElement;
  clearElementTransitionTimer(el);
  el.style.overflow = "hidden";
  el.style.height = "0px";
  el.style.opacity = "0";
  el.style.transition = `height ${DIFF_COLLAPSE_MS}ms ${DIFF_COLLAPSE_EASING}, opacity 150ms ease`;
  requestLayoutChange();
  requestAnimationFrame(() => {
    el.style.height = `${el.scrollHeight}px`;
    el.style.opacity = "1";
    requestLayoutChange();
  });
  finishElementTransitionAfter(el, done);
};

const onDiffBodyLeave = (element: Element, done: () => void) => {
  const el = element as HTMLElement;
  clearElementTransitionTimer(el);
  el.style.overflow = "hidden";
  el.style.height = `${el.scrollHeight}px`;
  el.style.opacity = "1";
  el.style.transition = `height ${DIFF_COLLAPSE_MS}ms ${DIFF_COLLAPSE_EASING}, opacity 150ms ease`;
  requestLayoutChange();
  requestAnimationFrame(() => {
    el.style.height = "0px";
    el.style.opacity = "0";
    requestLayoutChange();
  });
  finishElementTransitionAfter(el, done);
};

const onDiffBodyAfterTransition = (element: Element) => {
  clearDiffBodyTransitionStyles(element);
  requestLayoutChange();
};

watch(
  () => props.item.id,
  () => {
    userExpandedByKey.value = {};
  }
);
</script>

<style scoped>
.simple-file-change-event {
  --file-change-add-fg: color-mix(in srgb, var(--success, var(--fg-success)) 86%, var(--text) 14%);
  --file-change-del-fg: color-mix(in srgb, var(--danger, var(--fg-danger)) 86%, var(--text) 14%);
  --file-change-card-bg: color-mix(in srgb, var(--ui-timeline-card-bg) 94%, var(--ui-well-bg) 6%);

  position: relative;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--ui-well-border);
  border-radius: 7px;
  background: var(--file-change-card-bg);
  box-shadow: var(--ui-timeline-card-shadow);
  transition:
    border-color 220ms ease,
    box-shadow 220ms ease,
    background-color 220ms ease;
}

.simple-file-change-event::before {
  content: "";
  position: absolute;
  inset-block: 0;
  left: 0;
  width: 2px;
  background: color-mix(in srgb, var(--text-muted) 34%, transparent);
}

.file-change-card--chat {
  border-radius: 6px;
}

.file-change-card.is-streaming {
  border-color: color-mix(in srgb, var(--accent) 34%, var(--ui-well-border));
}

.file-change-card.is-streaming::before {
  background: color-mix(in srgb, var(--accent) 82%, var(--text) 18%);
}

.file-change-file-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.file-change-path-line {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.file-change-stat-cluster {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  color: var(--text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.file-change-stat {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 0;
  padding: 0;
  background: transparent;
  box-shadow: none;
  font-weight: 700;
}

.file-change-stat--add {
  color: var(--file-change-add-fg);
}

.file-change-stat--del {
  color: var(--file-change-del-fg);
}

.file-change-stat.is-zero {
  opacity: 0.48;
}

.file-change-stat--plain {
  min-width: 0;
  color: var(--text-muted);
  background: transparent;
  box-shadow: none;
}

.file-change-file-list {
  display: grid;
  gap: 1px;
  background: color-mix(in srgb, var(--ui-well-border) 55%, transparent);
}

.file-change-file-item {
  min-width: 0;
  background: color-mix(in srgb, var(--file-change-card-bg) 92%, var(--ui-code-bg) 8%);
  transition: background-color 220ms ease;
}

.file-change-file-item.is-expanded {
  background: color-mix(in srgb, var(--file-change-card-bg) 86%, var(--ui-code-bg) 14%);
}

.file-change-file-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px 10px 8px 12px;
}

.file-change-path {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 12px;
  font-weight: 620;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-change-kind-badge {
  display: inline-flex;
  flex: none;
  align-items: center;
  height: 18px;
  border-radius: 4px;
  border-width: 1px;
  padding: 0 6px;
  font-size: 10px;
  line-height: 1;
}

.file-change-expand-button {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  height: 24px;
  gap: 3px;
  border: 1px solid color-mix(in srgb, var(--text-muted) 18%, transparent);
  border-radius: 5px;
  padding: 0 7px 0 5px;
  color: var(--text-muted);
  background: color-mix(in srgb, var(--ui-well-bg) 58%, transparent);
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    color 160ms ease;
}

.file-change-expand-button:hover {
  color: var(--text);
  border-color: color-mix(in srgb, var(--accent) 34%, transparent);
  background: color-mix(in srgb, var(--accent) 8%, var(--ui-well-bg));
}

.file-change-expand-icon {
  width: 13px;
  height: 13px;
  stroke-width: 2.4;
  transition: transform 160ms ease;
}

.file-change-expand-icon.is-open {
  transform: rotate(180deg);
}

.file-change-expand-text {
  font-size: 10px;
  line-height: 1;
}

.file-change-diff-body {
  padding: 0 10px 10px 12px;
  transform-origin: top;
}

@media (max-width: 640px) {
  .file-change-file-header {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .file-change-stat-cluster {
    grid-column: 1 / -1;
    justify-self: start;
  }

  .file-change-expand-button {
    grid-column: 2;
    grid-row: 1;
  }
}
</style>
