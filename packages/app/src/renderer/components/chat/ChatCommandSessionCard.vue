<template>
  <div class="chat-tool-wrap command-session-wrap w-full max-w-full min-w-0">
    <article class="command-session" :class="sessionClass" :aria-busy="isRunning">
      <div class="command-session__summary">
        <span class="command-session__icon" aria-hidden="true">
          <TerminalSquare class="command-session__svg" />
        </span>

        <button
          class="command-session__main"
          type="button"
          :aria-expanded="open ? 'true' : 'false'"
          @click="toggleOpen"
        >
          <span class="command-session__title-row">
            <ExecutionWaveText
              v-if="isRunning"
              class="command-session__title"
              color="var(--accent)"
              :text="titleText"
              :cycle-max-chars="0"
            />
            <span v-else class="command-session__title">{{ titleText }}</span>
          </span>
        </button>

        <a
          v-if="primaryUrl"
          class="command-session__url"
          :href="primaryUrl"
          target="_blank"
          rel="noreferrer"
          :title="primaryUrl"
          @click.stop
        >
          <ExternalLink class="command-session__url-icon" aria-hidden="true" />
          <span>{{ urlLabel }}</span>
        </a>

        <button
          v-if="allowStop && isRunning && item.processId"
          class="command-session__stop"
          type="button"
          :disabled="stopping"
          :title="t('chat.activity.stopProcess')"
          @click.stop="$emit('stop', item)"
        >
          <Square class="command-session__button-icon" aria-hidden="true" />
          <span>{{ stopping ? t("chat.activity.stopping") : t("chat.activity.stop") }}</span>
        </button>

        <button
          class="command-session__icon-button"
          type="button"
          :aria-expanded="open ? 'true' : 'false'"
          :title="t('chat.activity.expandLog')"
          :aria-label="t('chat.activity.expandLog')"
          @click.stop="toggleOpen"
        >
          <ChevronDown class="command-session__chevron" :class="{ 'is-open': open }" aria-hidden="true" />
        </button>
      </div>

      <div v-if="open" class="command-session__details">
        <pre class="command-session__log app-scrollbar mono">{{ logText }}</pre>
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ChevronDown, ExternalLink, Square, TerminalSquare } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { useActivityItemState } from "./activityItemState";
import ExecutionWaveText from "../ui/ExecutionWaveText.vue";
import type { CommandSessionNode } from "../../features/timeline/renderModel/buildTimelineNodes";

const props = withDefaults(
  defineProps<{
    item: CommandSessionNode;
    stopping?: boolean;
    allowStop?: boolean;
  }>(),
  {
    stopping: false,
    allowStop: true,
  }
);

const emit = defineEmits<{
  (e: "stop", item: CommandSessionNode): void;
  (e: "layout-change"): void;
}>();

const { t } = useI18n();
const open = useActivityItemState(
  () => `command:${props.item.id}`,
  () => false
);
const isRunning = computed(() => props.item.status === "running");
const primaryUrl = computed(() => props.item.urls[0] ?? "");
const urlLabel = computed(() => {
  const value = primaryUrl.value;
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.host;
  } catch {
    return value;
  }
});

const titleText = computed(() => {
  return props.item.commandShort || props.item.commandFull || t("chat.activity.backgroundCommand");
});

const logText = computed(() => {
  const text = String(props.item.outputFull ?? "").trimEnd();
  return text || t("chat.activity.noOutput");
});

const sessionClass = computed(() => ({
  "is-running": props.item.status === "running",
  "is-failed": props.item.status === "failed",
}));

function toggleOpen() {
  open.value = !open.value;
  emit("layout-change");
}
</script>

<style scoped>
.command-session {
  display: grid;
  gap: 4px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 1px 2px;
  color: var(--text);
  box-shadow: none;
}

.command-session.is-running {
  color: var(--text);
}

.command-session.is-failed {
  color: var(--text);
}

.command-session__summary {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto auto 22px;
  align-items: center;
  align-content: center;
  width: 100%;
  min-height: 24px;
  gap: 6px;
  min-width: 0;
}

.command-session__icon {
  grid-column: 1;
  display: inline-flex;
  align-self: center;
  flex: none;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  line-height: 0;
  color: color-mix(in srgb, var(--chat-row-muted, var(--text-muted)) 88%, var(--chat-row-text, var(--text)) 12%);
}

.command-session__svg,
.command-session__button-icon,
.command-session__url-icon,
.command-session__chevron {
  width: 14px;
  height: 14px;
}

.command-session__main {
  grid-column: 2;
  display: flex;
  width: 100%;
  height: 24px;
  min-height: 24px;
  align-self: center;
  align-items: center;
  justify-content: flex-start;
  min-width: 0;
  border: 0;
  background: transparent;
  padding: 0;
  color: inherit;
  line-height: 24px;
  text-align: left;
}

.command-session__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 24px;
  min-width: 0;
  line-height: 24px;
}

.command-session__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.command-session__title {
  display: block;
  flex: 1 1 auto;
  font-size: 12px;
  line-height: 24px;
  color: var(--chat-row-muted, var(--text-muted));
}

.command-session__url,
.command-session__icon-button,
.command-session__stop {
  display: inline-flex;
  align-self: center;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--chat-row-muted, var(--text-muted));
  text-decoration: none;
  box-shadow: none;
}

.command-session__url {
  grid-column: 3;
}

.command-session__stop {
  grid-column: 4;
}

.command-session__url {
  max-width: 180px;
  gap: 5px;
  padding: 2px 7px;
  font-size: 11px;
}

.command-session__url span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.command-session__icon-button {
  grid-column: 5;
  justify-self: end;
  width: 22px;
  height: 22px;
  padding: 0;
  line-height: 1;
}

.command-session__stop {
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  font-size: 11px;
}

.command-session__main:hover:not(:disabled),
.command-session__url:hover,
.command-session__icon-button:hover:not(:disabled),
.command-session__stop:hover:not(:disabled) {
  border-color: transparent;
  background: transparent;
  color: var(--chat-row-muted, var(--text-muted));
}

.command-session__stop:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.command-session__chevron {
  display: block;
  flex: none;
  transition: transform 150ms ease;
}

.command-session__chevron.is-open {
  transform: rotate(180deg);
}

.command-session__details {
  display: grid;
  gap: 7px;
  padding-left: 25px;
}

.command-session__log {
  max-height: 220px;
  min-height: 44px;
  overflow: auto;
  margin: 0;
  border: 1px solid var(--ui-code-border);
  border-radius: 6px;
  background: var(--ui-code-bg);
  padding: 8px;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
  line-height: 1.45;
}
</style>
