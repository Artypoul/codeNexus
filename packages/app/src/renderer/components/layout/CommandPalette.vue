<template>
  <Teleport to="body">
    <div class="palette-backdrop" @mousedown.self="emit('close')">
      <div
        class="palette"
        role="dialog"
        aria-modal="true"
        :aria-label="t('commandActivity.search')"
        @keydown="onKeydown"
      >
        <input
          ref="input"
          v-model="query"
          class="palette-input"
          :placeholder="t('commandActivity.search')"
          :aria-label="t('commandActivity.search')"
          role="combobox"
          aria-autocomplete="list"
          aria-controls="palette-results"
          :aria-expanded="true"
          :aria-activedescendant="results[selected] ? `palette-option-${selected}` : undefined"
        />
        <div id="palette-results" class="palette-results" role="listbox">
          <template v-for="(item, index) in results" :key="item.key">
            <div v-if="index === 0 || item.group !== results[index - 1].group" class="palette-group">
              {{ item.group === "commands" ? t("structuredAnswer.commands") : t("threadHistory.title") }}
            </div>
            <button
              :id="`palette-option-${index}`"
              type="button"
              role="option"
              :aria-selected="index === selected"
              :class="{ selected: index === selected }"
              @mousemove="selected = index"
              @click="run(item)"
            >
              <component :is="item.group === 'commands' ? Terminal : MessageSquare" aria-hidden="true" />
              <span>{{ item.label }}</span>
            </button>
          </template>
          <div v-if="results.length === 0" class="palette-empty">{{ t("threadHistory.empty") }}</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { MessageSquare, Terminal } from "lucide-vue-next";
import { getRuntimeOrchestrator } from "../../domain/runtimeOrchestrator";
import { useAppShellStore } from "../../stores/appShell.store";
import { useThreadStore } from "../../stores/thread.store";

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const shell = useAppShellStore();
const threads = useThreadStore();
const runtime = getRuntimeOrchestrator();
const input = ref<HTMLInputElement | null>(null);
const query = ref("");
const selected = ref(0);
const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
type Result = { key: string; label: string; group: "commands" | "threads"; action: () => void };
const revealChat = () => {
  shell.closeSettings();
  shell.setMainView("chat");
};
const results = computed<Result[]>(() => {
  const items: Result[] = [
    {
      key: "new",
      group: "commands",
      label: t("threadHistory.newThread"),
      action: () => {
        revealChat();
        void runtime.createThread();
      },
    },
    { key: "settings", group: "commands", label: t("topbar.openSettings"), action: () => shell.openSettings() },
    ...threads.threadHistory.map((thread) => ({
      key: `thread:${thread.id}`,
      group: "threads",
      label: threads.displayThreadTitle(thread.id, thread.title),
      action: () => {
        revealChat();
        threads.clearThreadAttention(thread.id);
        void runtime.switchThread(thread.id);
      },
    })),
  ];
  const needle = query.value.trim().toLocaleLowerCase();
  return items.filter((item) => item.label.toLocaleLowerCase().includes(needle));
});
watch(query, () => {
  selected.value = 0;
});
const run = (item: Result) => {
  emit("close");
  item.action();
};
const onKeydown = (event: KeyboardEvent) => {
  if (event.isComposing) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("close");
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (results.value.length) {
      selected.value =
        (selected.value + (event.key === "ArrowDown" ? 1 : -1) + results.value.length) % results.value.length;
      void nextTick(() =>
        document.getElementById(`palette-option-${selected.value}`)?.scrollIntoView({ block: "nearest" })
      );
    }
  } else if (event.key === "Enter" && results.value[selected.value]) {
    event.preventDefault();
    run(results.value[selected.value]);
  } else if (event.key === "Tab") {
    event.preventDefault();
    input.value?.focus();
  }
};
onMounted(() => {
  void nextTick(() => input.value?.focus());
});
onBeforeUnmount(() => {
  if (previousFocus?.isConnected) previousFocus.focus();
});
</script>

<style scoped>
.palette-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 12vh 20px 20px;
  background: rgb(0 0 0 / 48%);
}
.palette {
  width: min(560px, 100%);
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-1);
  color: var(--text);
  box-shadow: 0 18px 55px rgb(0 0 0 / 35%);
}
.palette-input {
  box-sizing: border-box;
  width: 100%;
  padding: 16px;
  border: 0;
  border-bottom: 1px solid var(--border);
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
}
.palette-results {
  max-height: min(420px, 60vh);
  overflow-y: auto;
  padding: 6px;
}
.palette-results button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  overflow: hidden;
  padding: 9px 10px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.palette-results button svg {
  width: 15px;
  height: 15px;
  flex: none;
  color: var(--text-muted);
}
.palette-results button span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.palette-group {
  padding: 8px 10px 4px;
  font-size: 11px;
  color: var(--text-muted);
}
.palette-results button.selected {
  background: var(--control-surface-hover);
}
.palette-empty {
  padding: 16px;
  color: var(--text-muted);
  text-align: center;
}
</style>
