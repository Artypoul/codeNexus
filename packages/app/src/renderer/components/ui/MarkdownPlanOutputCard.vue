<template>
  <section
    class="markdown-plan-card chat-bubble-body min-w-0 overflow-hidden rounded-xl border border-[var(--ui-well-border)] bg-[var(--ui-well-bg)] shadow-[var(--chat-row-shadow)]"
    :class="{
      'is-executing': forceCollapsed,
      'is-expanded': isExpanded,
    }"
    :aria-label="t('planOutput.aria')"
  >
    <header
      class="markdown-plan-card-head grid min-w-0 select-none grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-3 border-b border-[color:var(--ui-well-border)] px-3 py-2.5 transition-[background,border-color] duration-150"
    >
      <div
        class="markdown-plan-card-toggle grid min-w-0 gap-1"
        role="button"
        tabindex="0"
        :aria-expanded="isExpanded ? 'true' : 'false'"
        @click="toggleExpanded"
        @keydown="onHeaderKeydown"
      >
        <div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 class="markdown-plan-card-title m-0 min-w-0 text-[15px] leading-[1.25] font-semibold text-[var(--text)]">
            {{ parsed.title }}
          </h2>
          <p
            v-if="parsed.description"
            class="markdown-plan-card-description m-0 min-w-[180px] flex-1 text-[12px] leading-[1.4] text-[var(--text-muted)] [overflow-wrap:anywhere]"
          >
            {{ parsed.description }}
          </p>
        </div>
        <div v-if="forceCollapsed" class="mono text-[11px] text-[var(--fg-warning)]">
          {{ t("markdownPlan.executing") }}
        </div>
      </div>
      <div
        v-if="$slots.headerActions && !isExpanded"
        class="markdown-plan-card-head-actions"
        @click.stop
        @keydown.stop
        @pointerdown.stop
      >
        <slot name="headerActions" />
      </div>
      <button
        class="markdown-plan-card-chevron-button"
        type="button"
        :aria-expanded="isExpanded ? 'true' : 'false'"
        @click.stop="toggleExpanded"
      >
        <ChevronDown
          class="markdown-plan-card-chevron h-4 w-4 flex-none text-[var(--text-muted)] transition-[transform,color] duration-200 [stroke-width:2.2]"
          :class="isExpanded ? 'rotate-180 text-[var(--text)]' : ''"
          aria-hidden="true"
        />
      </button>
    </header>

    <div class="markdown-plan-card-body-shell" :class="{ 'is-expanded': isExpanded, 'is-collapsed': !isExpanded }">
      <div class="markdown-plan-card-body grid min-w-0 gap-3 px-3 py-3">
        <AgentMarkdownContent class="agent-markdown-body min-w-0" :html="bodyHtml" />
      </div>
    </div>

    <div
      v-if="$slots.actions && isExpanded"
      class="markdown-plan-card-actions border-t border-[var(--border)] px-3 py-2.5"
    >
      <slot name="actions" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { ChevronDown } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { renderMarkdownToSafeHtml } from "../../features/timeline/markdownRenderer";
import { useMarkdownRendererRefresh } from "../../features/timeline/useMarkdownRendererRefresh";
import AgentMarkdownContent from "./AgentMarkdownContent.vue";

type ParsedMarkdownPlan = {
  title: string;
  description: string;
  body: string;
};

type HeadingHit = {
  level: number;
  lineIndex: number;
  title: string;
};

const props = withDefaults(
  defineProps<{
    rawText: string;
    forceCollapsed?: boolean;
  }>(),
  {}
);

const isExpanded = ref(!props.forceCollapsed);
const { t } = useI18n();
const { markdownRendererTick, refreshWhenReady } = useMarkdownRendererRefresh();

function toggleExpanded() {
  isExpanded.value = !isExpanded.value;
}

function onHeaderKeydown(event: KeyboardEvent) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  toggleExpanded();
}

function stripInlineMarkdown(value: string): string {
  return String(value ?? "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isFenceLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("```") || trimmed.startsWith("~~~");
}

function headingFromLine(line: string): { level: number; title: string } | null {
  const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.trim());
  if (!match) return null;
  const title = stripInlineMarkdown(match[2]);
  if (!title) return null;
  return { level: match[1].length, title };
}

function isDescriptionBoundary(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (headingFromLine(trimmed)) return true;
  if (isFenceLine(trimmed)) return true;
  if (/^([-*+]|\d+[.)])\s+/.test(trimmed)) return true;
  if (/^>/.test(trimmed)) return true;
  if (/^\|.+\|$/.test(trimmed)) return true;
  return false;
}

function findBestHeading(lines: string[]): HeadingHit | null {
  let best: HeadingHit | null = null;
  let fenced = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (isFenceLine(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = headingFromLine(line);
    if (!heading) continue;
    if (!best || heading.level < best.level) {
      best = { level: heading.level, lineIndex: i, title: heading.title };
    }
  }
  return best;
}

function parseMarkdownPlan(rawText: string): ParsedMarkdownPlan {
  const source = String(rawText ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!source) return { title: t("planOutput.title"), description: "", body: t("common.none") };

  const lines = source.split("\n");
  const heading = findBestHeading(lines);
  if (!heading) return { title: t("planOutput.title"), description: "", body: source };

  let descriptionStart = -1;
  let descriptionEnd = -1;
  for (let i = heading.lineIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      if (descriptionStart >= 0) break;
      continue;
    }
    if (isDescriptionBoundary(line)) break;
    if (descriptionStart < 0) descriptionStart = i;
    descriptionEnd = i;
  }

  const description =
    descriptionStart >= 0 && descriptionEnd >= descriptionStart
      ? stripInlineMarkdown(lines.slice(descriptionStart, descriptionEnd + 1).join(" "))
      : "";

  const bodyLines = lines.filter((_, index) => {
    if (index === heading.lineIndex) return false;
    if (descriptionStart >= 0 && index >= descriptionStart && index <= descriptionEnd) return false;
    return true;
  });
  const body = bodyLines.join("\n").trim() || description || heading.title;

  return {
    title: heading.title || t("planOutput.title"),
    description,
    body,
  };
}

function renderMarkdownHtml(text: string): string {
  void markdownRendererTick.value;
  const html = renderMarkdownToSafeHtml(text);
  refreshWhenReady();
  return html;
}

const parsed = computed(() => parseMarkdownPlan(props.rawText));
const bodyHtml = computed(() => renderMarkdownHtml(parsed.value.body));

watch(
  () => props.forceCollapsed,
  (next, prev) => {
    if (!prev && next) isExpanded.value = false;
  }
);

watch(
  () => props.rawText,
  () => {
    isExpanded.value = !props.forceCollapsed;
  }
);
</script>

<style scoped>
.markdown-plan-card-head {
  align-items: start;
}

.markdown-plan-card-toggle {
  cursor: pointer;
}

.markdown-plan-card-head:hover,
.markdown-plan-card-head:focus-within {
  background: color-mix(in srgb, var(--ui-well-bg-strong) 68%, transparent);
}

.markdown-plan-card-toggle:focus-visible,
.markdown-plan-card-chevron-button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent, var(--text)) 54%, transparent);
  outline-offset: 2px;
}

.markdown-plan-card-head-actions {
  display: flex;
  min-width: 0;
  max-width: min(540px, 52vw);
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.markdown-plan-card-chevron-button {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  justify-self: end;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.markdown-plan-card-chevron-button:hover {
  background: color-mix(in srgb, var(--text-muted) 12%, transparent);
}

.markdown-plan-card-chevron {
  justify-self: end;
}

.markdown-plan-card-body-shell {
  position: relative;
  display: grid;
  grid-template-rows: 1fr;
  overflow: hidden;
  opacity: 1;
  transition:
    max-height 0.24s ease,
    opacity 0.18s ease;
  max-height: none;
}

.markdown-plan-card-body-shell.is-expanded {
  overflow: visible;
}

.markdown-plan-card-body-shell.is-collapsed {
  max-height: 0;
  opacity: 0;
  pointer-events: none;
}

.markdown-plan-card.is-expanded .markdown-plan-card-head {
  border-bottom-color: color-mix(in srgb, var(--ui-well-border) 86%, var(--text-muted) 14%);
}

.markdown-plan-card.is-executing .markdown-plan-card-head {
  border-color: color-mix(in srgb, var(--border-warning) 58%, var(--ui-well-border) 42%);
  background: color-mix(in srgb, var(--bg-warning-soft) 36%, var(--ui-well-bg) 64%);
}

@media (max-width: 1180px) {
  .markdown-plan-card-head {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .markdown-plan-card-head-actions {
    grid-column: 1 / -1;
    justify-content: flex-start;
    max-width: 100%;
  }

  .markdown-plan-card-chevron-button {
    grid-column: 2;
    grid-row: 1;
  }
}
</style>
