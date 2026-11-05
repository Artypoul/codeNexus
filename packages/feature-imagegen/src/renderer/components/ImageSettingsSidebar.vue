<template>
  <aside
    class="sidebar sidebar-right image-settings-sidebar"
    :aria-label="t('imageSidebar.aria')"
  >
    <header class="image-settings-sidebar__header">
      <div>
        <div class="image-settings-sidebar__eyebrow">Images</div>
        <h2 class="image-settings-sidebar__title">
          {{ t("imageSidebar.title") }}
        </h2>
      </div>
      <button class="btn-mini" type="button" @click="openApiSettings">
        <Settings2 class="btn-mini__icon" aria-hidden="true" />
        <span>API</span>
      </button>
    </header>

    <div class="image-settings-sidebar__scroll app-scrollbar">
      <div class="image-workbench__control-grid">
        <div class="image-workbench__prompt-quality">
          <label class="image-workbench__field image-workbench__field--full">
            <span class="image-workbench__label">{{
              t("imageSidebar.prompt")
            }}</span>
            <textarea
              v-model="workbench.prompt"
              class="image-workbench__textarea context-input mono"
              rows="8"
              :placeholder="t('imageSidebar.promptPlaceholder')"
            />
          </label>

          <div class="image-workbench__quality-panel">
            <div class="image-workbench__quality-head">
              <span>{{ t("imageSidebar.quality") }}</span>
              <span class="mono">{{ selectedQualityLabel }}</span>
            </div>
            <div class="image-workbench__quality-body">
              <div class="image-workbench__quality-labels" aria-hidden="true">
                <span>{{ t("imageSidebar.high") }}</span>
                <span>{{ t("imageSidebar.medium") }}</span>
                <span>{{ t("imageSidebar.low") }}</span>
                <span>{{ t("imageSidebar.auto") }}</span>
              </div>
              <input
                class="image-workbench__quality-slider"
                type="range"
                min="0"
                max="3"
                step="1"
                :value="qualityIndex"
                :aria-label="t('imageSidebar.imageQuality')"
                :aria-valuetext="selectedQualityLabel"
                @input="onQualityInput"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="image-workbench__attachments">
        <div class="image-workbench__attachments-head">
          <span>{{ t("imageSidebar.references") }}</span>
          <span class="mono">{{ workbench.inputImages.length }} / 4</span>
        </div>

        <div
          class="image-workbench__dropzone"
          :class="{
            'is-file-dragging': isWindowFileDragging,
            'is-dragging': workbench.dragActive,
          }"
          @dragenter="onDropzoneDragEnter"
          @dragover="onDragOver"
          @dragleave="onDropzoneDragLeave"
          @drop="onDrop"
        >
          <input
            ref="imageInputRef"
            class="image-workbench__file"
            type="file"
            accept="image/*"
            multiple
            @change="onPickImages"
          />
          <button
            class="image-workbench__dropzone-btn"
            type="button"
            @click="triggerPickImages"
          >
            <Upload class="btn-mini__icon" aria-hidden="true" />
            <span>{{ t("imageSidebar.addReference") }}</span>
          </button>
          <div class="image-workbench__dropzone-hint">
            {{ t("imageSidebar.referenceHint") }}
          </div>
        </div>

        <div
          v-if="workbench.inputImages.length"
          class="image-workbench__thumb-grid"
        >
          <div
            v-for="image in workbench.inputImages"
            :key="image.id"
            class="image-workbench__thumb"
          >
            <img :src="image.dataUrl" :alt="image.name" />
            <div class="image-workbench__thumb-meta">
              <span class="image-workbench__thumb-name">{{ image.name }}</span>
              <button
                class="btn-mini"
                type="button"
                @click="workbench.removeInputImage(image.id)"
              >
                <Trash2 class="btn-mini__icon" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <div
          v-if="workbench.inputImages.length"
          class="image-workbench__mask-row"
        >
          <div class="image-workbench__mask-copy">
            <div class="image-workbench__label">
              {{ t("imageSidebar.maskTitle") }}
            </div>
            <div class="dim">{{ t("imageSidebar.maskDesc") }}</div>
          </div>
          <div class="image-workbench__mask-actions">
            <input
              ref="maskInputRef"
              class="image-workbench__file"
              type="file"
              accept="image/*"
              @change="onPickMask"
            />
            <button class="btn-mini" type="button" @click="triggerPickMask">
              <Upload class="btn-mini__icon" aria-hidden="true" />
              <span>{{
                workbench.maskDataUrl
                  ? t("imageSidebar.replace")
                  : t("imageSidebar.choose")
              }}</span>
            </button>
            <button
              class="btn-mini"
              type="button"
              :disabled="!workbench.maskDataUrl"
              @click="workbench.clearMask"
            >
              <X class="btn-mini__icon" aria-hidden="true" />
              <span>{{ t("imageSidebar.clear") }}</span>
            </button>
          </div>
        </div>

        <div
          v-if="workbench.inputImages.length && workbench.maskDataUrl"
          class="image-workbench__mask-preview"
        >
          <img
            :src="workbench.maskDataUrl"
            :alt="t('imageSidebar.maskPreviewAlt')"
          />
        </div>
      </div>

      <div v-if="workbench.errorText" class="image-workbench__error mono">
        {{ workbench.errorText }}
      </div>

      <button
        class="image-settings-sidebar__generate"
        type="button"
        :disabled="!workbench.canGenerate"
        @click="workbench.generate"
      >
        <Wand2 class="btn-mini__icon" aria-hidden="true" />
        <span>{{ t("imageSidebar.generate") }}</span>
      </button>

      <section
        v-if="selectedHistoryItem"
        class="image-settings-sidebar__section"
      >
        <div class="image-settings-sidebar__section-head">
          <span>{{ t("imageSidebar.currentRecord") }}</span>
          <button
            class="btn-mini btn-mini--danger"
            type="button"
            @click="deleteHistoryItem(selectedHistoryItem.id)"
          >
            <Trash2 class="btn-mini__icon" aria-hidden="true" />
            <span>{{ t("imageWorkbench.delete") }}</span>
          </button>
        </div>
        <div class="image-settings-sidebar__detail">
          <div class="image-settings-sidebar__detail-row">
            <span>{{ t("imageSidebar.model") }}</span>
            <span class="mono">{{ selectedHistoryItem.model }}</span>
          </div>
          <div class="image-settings-sidebar__detail-row">
            <span>{{ t("imageSidebar.params") }}</span>
            <span class="mono">{{
              formatHistoryParams(selectedHistoryItem)
            }}</span>
          </div>
          <div class="image-settings-sidebar__detail-row">
            <span>{{ t("imageSidebar.time") }}</span>
            <span class="mono">{{
              formatDateTime(selectedHistoryItem.createdAt)
            }}</span>
          </div>
          <div class="image-settings-sidebar__prompt-block">
            <div class="image-workbench__label">
              {{ t("imageSidebar.prompt") }}
            </div>
            <p class="app-scrollbar">{{ selectedHistoryItem.prompt }}</p>
          </div>
          <div
            v-if="selectedHistoryItem.revisedPrompt"
            class="image-settings-sidebar__prompt-block"
          >
            <div class="image-workbench__label">
              {{ t("imageSidebar.revisedPrompt") }}
            </div>
            <p class="app-scrollbar">{{ selectedHistoryItem.revisedPrompt }}</p>
          </div>
        </div>
      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Settings2, Trash2, Upload, Wand2, X } from "lucide-vue-next";
import { openImagegenSettings } from "../runtimeBridge";
import { useImageWorkbenchStore } from "../store";

const { t, locale } = useI18n();
const workbench = useImageWorkbenchStore();
const imageInputRef = ref<HTMLInputElement | null>(null);
const maskInputRef = ref<HTMLInputElement | null>(null);
const isWindowFileDragging = ref(false);
const windowFileDragDepth = ref(0);
const dropzoneDragDepth = ref(0);
type SidebarHistoryItem = (typeof workbench.historyItems)[number];

const selectedHistoryItem = computed(() => workbench.selectedHistoryItem);
const qualityLevels = [
  { value: "auto", labelKey: "imageSidebar.auto" },
  { value: "low", labelKey: "imageSidebar.low" },
  { value: "medium", labelKey: "imageSidebar.medium" },
  { value: "high", labelKey: "imageSidebar.high" },
] as const;
const qualityIndex = computed(() => {
  const index = qualityLevels.findIndex(
    (item) => item.value === workbench.quality,
  );
  return index >= 0 ? index : 0;
});
const selectedQualityLabel = computed(() =>
  t(qualityLevels[qualityIndex.value]?.labelKey ?? "imageSidebar.auto"),
);

function openApiSettings() {
  openImagegenSettings();
}

function triggerPickImages() {
  imageInputRef.value?.click();
}

function triggerPickMask() {
  maskInputRef.value?.click();
}

async function onPickImages(event: Event) {
  const target = event.target as HTMLInputElement | null;
  const files = target?.files;
  if (!files || files.length === 0) return;
  await workbench.appendFiles(files);
  if (target) target.value = "";
}

async function onPickMask(event: Event) {
  const target = event.target as HTMLInputElement | null;
  const file = target?.files?.[0];
  if (!file) return;
  await workbench.setMaskFromFile(file);
  if (target) target.value = "";
}

async function onDrop(event: DragEvent) {
  event.preventDefault();
  resetFileDragState();
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return;
  await workbench.appendFiles(files);
}

function onDropzoneDragEnter(event: DragEvent) {
  if (!hasFileDragData(event)) return;
  event.preventDefault();
  dropzoneDragDepth.value += 1;
  workbench.dragActive = true;
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function onDropzoneDragLeave(event: DragEvent) {
  if (!hasFileDragData(event)) return;
  dropzoneDragDepth.value = Math.max(0, dropzoneDragDepth.value - 1);
  if (dropzoneDragDepth.value === 0) workbench.stopDrag();
}

function onDragOver(event: DragEvent) {
  if (!hasFileDragData(event)) return;
  workbench.dragActive = true;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function onQualityInput(event: Event) {
  const target = event.target as HTMLInputElement | null;
  const index = Math.max(
    0,
    Math.min(qualityLevels.length - 1, Math.round(Number(target?.value ?? 0))),
  );
  workbench.quality = qualityLevels[index]?.value ?? "auto";
}

function formatDateTime(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(String(locale.value), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatHistoryParams(item: SidebarHistoryItem): string {
  const modeText =
    item.mode === "edit"
      ? t("imageWorkbench.editMode")
      : t("imageWorkbench.textMode");
  return [modeText, item.quality].filter(Boolean).join(" / ") || "auto";
}

async function deleteHistoryItem(id: string) {
  await workbench.deleteHistoryItem(id);
}

function hasFileDragData(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function resetFileDragState() {
  windowFileDragDepth.value = 0;
  dropzoneDragDepth.value = 0;
  isWindowFileDragging.value = false;
  workbench.stopDrag();
}

function onWindowDragEnter(event: DragEvent) {
  if (!hasFileDragData(event)) return;
  windowFileDragDepth.value += 1;
  isWindowFileDragging.value = true;
}

function onWindowDragOver(event: DragEvent) {
  if (!hasFileDragData(event)) return;
  isWindowFileDragging.value = true;
}

function onWindowDragLeave(event: DragEvent) {
  if (!hasFileDragData(event)) return;
  windowFileDragDepth.value = Math.max(0, windowFileDragDepth.value - 1);
  if (windowFileDragDepth.value === 0) isWindowFileDragging.value = false;
}

onMounted(() => {
  window.addEventListener("dragenter", onWindowDragEnter);
  window.addEventListener("dragover", onWindowDragOver);
  window.addEventListener("dragleave", onWindowDragLeave);
  window.addEventListener("drop", resetFileDragState);
  window.addEventListener("dragend", resetFileDragState);
});

onBeforeUnmount(() => {
  window.removeEventListener("dragenter", onWindowDragEnter);
  window.removeEventListener("dragover", onWindowDragOver);
  window.removeEventListener("dragleave", onWindowDragLeave);
  window.removeEventListener("drop", resetFileDragState);
  window.removeEventListener("dragend", resetFileDragState);
  resetFileDragState();
});
</script>

<style scoped>
.image-settings-sidebar {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background:
    radial-gradient(
      circle at 50% 0%,
      color-mix(in srgb, var(--accent) 8%, transparent),
      transparent 36%
    ),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--surface-1) 90%, transparent),
      transparent 45%
    ),
    color-mix(in srgb, var(--bg) 92%, var(--surface-1) 8%);
}

.image-settings-sidebar__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 14px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
}

.image-settings-sidebar__eyebrow {
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1;
  text-transform: uppercase;
}

.image-settings-sidebar__title {
  margin: 5px 0 0;
  color: var(--text);
  font-size: 14px;
  font-weight: 750;
  line-height: 1.2;
}

.image-settings-sidebar__scroll {
  min-height: 0;
  flex: 1 1 auto;
  overflow: auto;
  padding: 12px 12px 16px;
}

.image-settings-sidebar__generate {
  display: inline-flex;
  width: 100%;
  height: 38px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 12px;
  border: 1px solid color-mix(in srgb, var(--accent) 58%, var(--border) 42%);
  border-radius: 8px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--accent) 84%, var(--theme-seed-neutral-paper) 8%),
    color-mix(in srgb, var(--accent) 70%, var(--theme-seed-canvas-deep) 12%)
  );
  color: var(--theme-seed-accent-contrast);
  font-size: 12px;
  font-weight: 800;
  box-shadow: 0 12px 24px color-mix(in srgb, var(--accent) 18%, transparent);
  transition:
    opacity 150ms ease,
    transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
}

.image-settings-sidebar__generate:hover:not(:disabled) {
  transform: translateY(-1px);
}

.image-settings-sidebar__generate:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.image-settings-sidebar__section {
  display: grid;
  gap: 10px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
}

.image-settings-sidebar__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 750;
}

.image-settings-sidebar__detail {
  display: grid;
  gap: 8px;
  border: 1px solid color-mix(in srgb, var(--border) 66%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--ui-code-bg) 84%, transparent);
  padding: 9px;
}

.image-settings-sidebar__detail-row {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  color: var(--text-muted);
  font-size: 11px;
}

.image-settings-sidebar__detail-row .mono {
  min-width: 0;
  color: var(--text);
  overflow-wrap: anywhere;
}

.image-settings-sidebar__prompt-block {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.image-settings-sidebar__prompt-block p {
  margin: 0;
  max-height: 150px;
  overflow: auto;
  border: 1px solid color-mix(in srgb, var(--border) 68%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--ui-code-bg) 88%, transparent);
  color: var(--text);
  font-size: 11px;
  line-height: 1.45;
  overflow-wrap: anywhere;
  padding: 8px;
}

.btn-mini--danger {
  color: var(--fg-danger);
}

.image-workbench__control-grid,
.image-workbench__attachments {
  display: grid;
  gap: 10px;
}

.image-workbench__prompt-quality {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 78px;
  gap: 10px;
  align-items: stretch;
}

.image-workbench__field {
  display: grid;
  gap: 5px;
}

.image-workbench__label,
.image-workbench__attachments-head {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.image-workbench__textarea {
  min-height: 128px;
  height: 100%;
  resize: vertical;
}

.image-workbench__quality-panel {
  min-width: 0;
  height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 6px;
  border: 1px solid color-mix(in srgb, var(--border) 68%, transparent);
  border-radius: 8px;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--accent) 8%, transparent),
      transparent 48%
    ),
    color-mix(in srgb, var(--ui-code-bg) 90%, transparent);
  padding: 7px;
}

.image-workbench__quality-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 750;
}

.image-workbench__quality-head .mono {
  color: var(--text);
}

.image-workbench__quality-body {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 24px;
  gap: 7px;
  align-items: stretch;
}

.image-workbench__quality-labels {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  padding: 4px 0;
  text-align: right;
}

.image-workbench__quality-slider {
  width: 24px;
  min-height: 0;
  height: 100%;
  margin: 0;
  accent-color: var(--accent);
  appearance: slider-vertical;
  cursor: ns-resize;
  writing-mode: vertical-lr;
  direction: rtl;
  opacity: 0.95;
}

.image-workbench__quality-slider:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 72%, transparent);
  outline-offset: 2px;
  border-radius: 999px;
}

.image-workbench__segmented,
.image-workbench__inline,
.image-workbench__attachments-head,
.image-workbench__mask-row,
.image-workbench__mask-actions,
.image-workbench__thumb-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.image-workbench__attachments-head,
.image-workbench__mask-row,
.image-workbench__thumb-meta {
  justify-content: space-between;
}

.image-workbench__segmented {
  padding: 3px;
  border: 1px solid var(--ui-code-border);
  border-radius: 8px;
  background: var(--ui-code-bg);
}

.image-workbench__segment {
  flex: 1 1 0;
  height: 26px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.image-workbench__segment.is-active {
  border-color: color-mix(in srgb, var(--accent) 34%, transparent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--text);
}

.image-workbench__inline .context-input {
  min-width: 0;
}

.image-workbench__attachments {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
}

.image-workbench__dropzone {
  position: relative;
  display: grid;
  place-items: center;
  gap: 6px;
  min-height: 92px;
  overflow: hidden;
  border: 1px dashed color-mix(in srgb, var(--border) 82%, var(--accent) 18%);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-1) 70%, transparent);
  padding: 10px;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.image-workbench__dropzone.is-file-dragging {
  border-color: color-mix(in srgb, var(--accent) 56%, var(--border));
  background: color-mix(in srgb, var(--accent) 5%, var(--surface-1));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 8%, transparent);
}

.image-workbench__dropzone.is-dragging {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, var(--surface-1));
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent),
    0 10px 22px color-mix(in srgb, var(--accent) 12%, transparent);
  transform: translateY(-1px);
}

.image-workbench__dropzone-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.image-workbench__dropzone-hint {
  color: var(--text-muted);
  font-size: 11px;
}

.image-workbench__file {
  display: none;
}

.image-workbench__thumb-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.image-workbench__thumb,
.image-workbench__mask-preview {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--ui-code-border);
  border-radius: 8px;
  background: var(--ui-code-bg);
}

.image-workbench__thumb img,
.image-workbench__mask-preview img {
  display: block;
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
}

.image-workbench__thumb-meta {
  padding: 6px;
}

.image-workbench__thumb-name {
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-workbench__mask-copy {
  min-width: 0;
}

.image-workbench__error {
  margin-top: 10px;
  border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--danger) 8%, transparent);
  color: var(--text);
  font-size: 11px;
  padding: 8px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* Restore the previous lighter sidebar treatment. */
.image-settings-sidebar {
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--surface-1) 94%, transparent),
      transparent 42%
    ),
    color-mix(in srgb, var(--bg) 94%, var(--surface-1) 6%);
}

.image-settings-sidebar__header {
  padding: 12px 12px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
}

.image-settings-sidebar__scroll {
  padding: 10px 10px 14px;
}

.image-settings-sidebar__generate {
  height: 34px;
  border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--border) 58%);
  background: color-mix(in srgb, var(--accent) 14%, var(--surface-1) 86%);
  color: var(--text);
  font-weight: 700;
  box-shadow: none;
}

.image-settings-sidebar__generate:hover:not(:disabled) {
  transform: none;
}

.image-settings-sidebar__detail {
  border: 0;
  background: transparent;
  padding: 0;
}

.image-workbench__quality-panel {
  border: 1px solid color-mix(in srgb, var(--ui-code-border) 82%, transparent);
  background: color-mix(in srgb, var(--ui-code-bg) 86%, transparent);
}
</style>
