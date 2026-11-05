<template>
  <section class="image-workbench" :aria-label="t('imageWorkbench.aria')">
    <div
      v-if="workbench.historyLoading && !selectedHistoryItem"
      class="image-workbench__empty"
    >
      <Loader2
        class="image-workbench__empty-icon is-spinning"
        aria-hidden="true"
      />
      <div>{{ t("imageWorkbench.loadingHistory") }}</div>
    </div>

    <div
      v-else-if="selectedHistoryItem && selectedImage"
      class="image-workbench__viewer"
    >
      <header class="image-workbench__viewer-head">
        <div class="image-workbench__viewer-copy">
          <div class="image-workbench__viewer-kicker mono">
            {{ formatDateTime(selectedHistoryItem.createdAt) }}
          </div>
          <h2>{{ selectedHistoryItem.prompt }}</h2>
        </div>
        <div class="image-workbench__viewer-actions">
          <span class="image-workbench__zoom mono"
            >{{ Math.round(getImageZoom(selectedImage.path) * 100) }}%</span
          >
          <button
            class="image-workbench__tool"
            type="button"
            :aria-label="t('imageWorkbench.zoomOut')"
            @click="zoomImage(selectedImage.path, 1 / ZOOM_STEP)"
          >
            <ZoomOut aria-hidden="true" />
          </button>
          <button
            class="image-workbench__tool"
            type="button"
            :aria-label="t('imageWorkbench.zoomIn')"
            @click="zoomImage(selectedImage.path, ZOOM_STEP)"
          >
            <ZoomIn aria-hidden="true" />
          </button>
          <button
            class="image-workbench__tool"
            type="button"
            :aria-label="t('common.reset')"
            @click="resetImageZoom(selectedImage.path)"
          >
            <RotateCcw aria-hidden="true" />
          </button>
          <button
            class="image-workbench__tool"
            type="button"
            :aria-label="t('imageWorkbench.copyImage')"
            @click="copyImageToClipboard(selectedImage)"
          >
            <Copy aria-hidden="true" />
          </button>
          <button
            class="image-workbench__tool"
            type="button"
            :aria-label="t('imageWorkbench.downloadImage')"
            @click="downloadImage(selectedImage)"
          >
            <Download aria-hidden="true" />
          </button>
          <button
            class="image-workbench__tool is-danger"
            type="button"
            :aria-label="t('imageWorkbench.delete')"
            @click="workbench.deleteHistoryItem(selectedHistoryItem.id)"
          >
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        class="image-workbench__viewport"
        :class="{ 'is-dragging': isImageDragging(selectedImage.path) }"
        @pointerdown="onImagePointerDown(selectedImage.path, $event)"
        @wheel="onImageWheel(selectedImage.path, $event)"
      >
        <Loader2
          v-if="imageDataUrlLoading[selectedImage.path]"
          class="image-workbench__image-state is-spinning"
          aria-hidden="true"
        />
        <img
          v-else-if="imageDataUrlByPath[selectedImage.path]"
          :src="imageDataUrlByPath[selectedImage.path]"
          :alt="selectedImage.path"
          :style="{ transform: getImageTransform(selectedImage.path) }"
          draggable="false"
        />
        <div v-else class="image-workbench__image-missing">
          {{ t("imageWorkbench.imageUnavailable") }}
        </div>
      </div>

      <div
        v-if="selectedHistoryItem.images.length > 1"
        class="image-workbench__filmstrip app-scrollbar"
      >
        <button
          v-for="(image, index) in selectedHistoryItem.images"
          :key="image.path"
          class="image-workbench__filmstrip-item"
          :class="{ 'is-active': index === selectedImageIndex }"
          type="button"
          @click="selectedImageIndex = index"
        >
          <img
            v-if="imageDataUrlByPath[image.path]"
            :src="imageDataUrlByPath[image.path]"
            :alt="image.path"
          />
          <ImageIcon v-else aria-hidden="true" />
        </button>
      </div>
    </div>

    <div v-else class="image-workbench__empty">
      <ImageIcon class="image-workbench__empty-icon" aria-hidden="true" />
      <div>
        {{
          workbench.historyItems.length > 0
            ? t("imageWorkbench.selectFromWorkspace")
            : t("imageWorkbench.emptyHistory")
        }}
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeMount, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  Copy,
  Download,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-vue-next";
import {
  getImagegenDesktopApi,
  readImagegenLocalImageDataUrl,
  showImagegenToast as showToast,
} from "../runtimeBridge";
import { useImageWorkbenchStore } from "../store";

const { t, locale } = useI18n();
const workbench = useImageWorkbenchStore();

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 6;
const ZOOM_STEP = 1.18;

type WorkbenchImage = NonNullable<
  typeof workbench.selectedHistoryItem
>["images"][number];
type ImagePanState = { panX: number; panY: number };
type ImageDragState = {
  path: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPanX: number;
  startPanY: number;
};

const selectedImageIndex = ref(0);
const imageZoomByPath = ref<Record<string, number>>({});
const imagePanByPath = ref<Record<string, ImagePanState>>({});
const imageDataUrlByPath = ref<Record<string, string>>({});
const imageDataUrlLoading = ref<Record<string, boolean>>({});
const imageDragState = ref<ImageDragState | null>(null);

const selectedHistoryItem = computed(() => workbench.selectedHistoryItem);
const selectedImage = computed(
  () =>
    selectedHistoryItem.value?.images[selectedImageIndex.value] ??
    selectedHistoryItem.value?.images[0] ??
    null,
);
const selectedImagePathsText = computed(
  () =>
    selectedHistoryItem.value?.images.map((image) => image.path).join("\n") ??
    "",
);

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function sanitizeDownloadName(value: string): string {
  const name = String(value ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ");
  return name || "image";
}

function extensionFromImage(image: WorkbenchImage): string {
  const mimeExt = image.mimeType
    .match(/^image\/([a-z0-9.+-]+)$/i)?.[1]
    ?.toLowerCase();
  if (mimeExt) {
    if (mimeExt === "jpeg") return "jpg";
    if (mimeExt === "svg+xml") return "svg";
    return mimeExt;
  }
  return image.path.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() || "png";
}

function getImageZoom(path: string): number {
  return imageZoomByPath.value[path] ?? 1;
}

function getImagePan(path: string): ImagePanState {
  return imagePanByPath.value[path] ?? { panX: 0, panY: 0 };
}

function getImageTransform(path: string): string {
  const pan = getImagePan(path);
  return `translate3d(${pan.panX}px, ${pan.panY}px, 0) scale(${getImageZoom(path)})`;
}

function setImageZoom(path: string, zoom: number) {
  imageZoomByPath.value = {
    ...imageZoomByPath.value,
    [path]: clampNumber(zoom, MIN_ZOOM, MAX_ZOOM),
  };
}

function setImagePan(path: string, pan: ImagePanState) {
  imagePanByPath.value = {
    ...imagePanByPath.value,
    [path]: { panX: Math.round(pan.panX), panY: Math.round(pan.panY) },
  };
}

function zoomImage(path: string, factor: number) {
  setImageZoom(path, getImageZoom(path) * factor);
}

function resetImageZoom(path: string) {
  setImageZoom(path, 1);
  setImagePan(path, { panX: 0, panY: 0 });
}

function onImageWheel(path: string, event: WheelEvent) {
  event.preventDefault();
  zoomImage(path, event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
}

function isImageDragging(path: string): boolean {
  return imageDragState.value?.path === path;
}

function teardownImageDragListeners() {
  window.removeEventListener("pointermove", onImagePointerMove);
  window.removeEventListener("pointerup", onImagePointerUp);
  window.removeEventListener("pointercancel", onImagePointerUp);
}

function onImagePointerDown(path: string, event: PointerEvent) {
  if (event.button !== 0 || !imageDataUrlByPath.value[path]) return;
  const pan = getImagePan(path);
  imageDragState.value = {
    path,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startPanX: pan.panX,
    startPanY: pan.panY,
  };
  try {
    (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(
      event.pointerId,
    );
  } catch {}
  window.addEventListener("pointermove", onImagePointerMove);
  window.addEventListener("pointerup", onImagePointerUp);
  window.addEventListener("pointercancel", onImagePointerUp);
  event.preventDefault();
}

function onImagePointerMove(event: PointerEvent) {
  const state = imageDragState.value;
  if (!state || event.pointerId !== state.pointerId) return;
  setImagePan(state.path, {
    panX: state.startPanX + event.clientX - state.startClientX,
    panY: state.startPanY + event.clientY - state.startClientY,
  });
}

function onImagePointerUp(event: PointerEvent) {
  const state = imageDragState.value;
  if (state && event.pointerId !== state.pointerId) return;
  imageDragState.value = null;
  teardownImageDragListeners();
}

function formatDateTime(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("imageWorkbench.unknownTime");
  return date.toLocaleString(String(locale.value), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function downloadImage(image: WorkbenchImage) {
  if (typeof document === "undefined") return;
  const src = String(imageDataUrlByPath.value[image.path] ?? "").trim();
  if (!src) return;
  const link = document.createElement("a");
  link.href = src;
  link.download = `${sanitizeDownloadName(image.path || "generated-image")}.${extensionFromImage(image)}`;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function copyImageToClipboard(image: WorkbenchImage) {
  const path = String(image.path ?? "").trim();
  if (!path) return;
  try {
    await getImagegenDesktopApi().app.writeClipboardImageFromPath({ path });
    showToast({
      kind: "success",
      title: t("imageWorkbench.copySuccessTitle"),
      message: t("imageWorkbench.copySuccessMessage"),
    });
  } catch (error: any) {
    showToast({
      kind: "error",
      title: t("imageWorkbench.copyFailedTitle"),
      message: String(error?.message ?? error ?? ""),
    });
  }
}

function pruneRecordByPaths<T>(
  record: Record<string, T>,
  allowedPaths: Set<string>,
): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [path, value] of Object.entries(record)) {
    if (allowedPaths.has(path)) next[path] = value;
  }
  return next;
}

async function ensureImageDataUrl(path: string) {
  const normalized = String(path ?? "").trim();
  if (
    !normalized ||
    imageDataUrlByPath.value[normalized] ||
    imageDataUrlLoading.value[normalized]
  )
    return;
  imageDataUrlLoading.value = {
    ...imageDataUrlLoading.value,
    [normalized]: true,
  };
  try {
    const dataUrl = await readImagegenLocalImageDataUrl(normalized);
    imageDataUrlByPath.value = {
      ...imageDataUrlByPath.value,
      [normalized]: dataUrl,
    };
  } catch (error: any) {
    console.warn("[ImageWorkbench] read image failed", {
      path: normalized,
      message: String(error?.message ?? error ?? "unknown error"),
    });
    imageDataUrlByPath.value = {
      ...imageDataUrlByPath.value,
      [normalized]: "",
    };
  } finally {
    imageDataUrlLoading.value = {
      ...imageDataUrlLoading.value,
      [normalized]: false,
    };
  }
}

function firstReadyHistoryId(): string {
  return (
    workbench.historyItems.find(
      (item) => !item.workbenchStatus && item.images.length > 0,
    )?.id ??
    workbench.historyItems.find(
      (item) => item.workbenchStatus === "ready" && item.images.length > 0,
    )?.id ??
    ""
  );
}

function ensureSelectedHistory() {
  if (selectedHistoryItem.value) return;
  const id = firstReadyHistoryId();
  if (id) workbench.selectHistoryItem(id);
}

onBeforeMount(() => {
  void (async () => {
    await workbench.syncSettingsFromCache();
    workbench.notifyMissingConfigurationOnce();
    await workbench.loadHistory();
  })();
});

watch(
  () =>
    [
      workbench.selectedHistoryId,
      workbench.historyItems.map((item) => item.id).join("\n"),
    ] as const,
  () => ensureSelectedHistory(),
  { immediate: true },
);

watch(
  () => selectedHistoryItem.value?.id ?? "",
  () => {
    selectedImageIndex.value = 0;
    imageZoomByPath.value = {};
    imagePanByPath.value = {};
    imageDragState.value = null;
    teardownImageDragListeners();
  },
);

watch(
  selectedImagePathsText,
  (pathsText) => {
    const paths = pathsText.split("\n").filter(Boolean);
    const allowedPaths = new Set(paths);
    imageDataUrlByPath.value = pruneRecordByPaths(
      imageDataUrlByPath.value,
      allowedPaths,
    );
    imageDataUrlLoading.value = pruneRecordByPaths(
      imageDataUrlLoading.value,
      allowedPaths,
    );
    imageZoomByPath.value = pruneRecordByPaths(
      imageZoomByPath.value,
      allowedPaths,
    );
    imagePanByPath.value = pruneRecordByPaths(
      imagePanByPath.value,
      allowedPaths,
    );
    for (const path of paths) void ensureImageDataUrl(path);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  workbench.stopDrag();
  imageDragState.value = null;
  teardownImageDragListeners();
});
</script>

<style scoped>
.image-workbench {
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
  display: grid;
  overflow: hidden;
  padding: 0 14px 18px;
  background: transparent;
}

.image-workbench__viewer {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 10px;
}

.image-workbench__viewer-head {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 14px;
  padding: 2px 0 0;
}

.image-workbench__viewer-copy {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.image-workbench__viewer-kicker {
  color: var(--text-muted);
  font-size: 11px;
}

.image-workbench__viewer-copy h2 {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 15px;
  font-weight: 780;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-workbench__viewer-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.image-workbench__zoom {
  min-width: 42px;
  color: var(--text-muted);
  font-size: 11px;
  text-align: right;
}

.image-workbench__tool {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  display: inline-grid;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg) 72%, transparent);
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    color 120ms ease;
}

.image-workbench__tool:hover {
  border-color: color-mix(in srgb, var(--accent) 52%, var(--border));
  background: color-mix(in srgb, var(--accent) 10%, var(--bg));
  color: var(--text);
}

.image-workbench__tool.is-danger {
  color: var(--fg-danger);
}

.image-workbench__tool svg {
  width: 14px;
  height: 14px;
}

.image-workbench__viewport {
  min-width: 0;
  min-height: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--ui-code-border) 86%, transparent);
  border-radius: 8px;
  background:
    linear-gradient(
      45deg,
      color-mix(in srgb, var(--bg) 86%, var(--theme-seed-canvas-deep) 14%) 25%,
      transparent 25%
    ),
    linear-gradient(
      -45deg,
      color-mix(in srgb, var(--bg) 86%, var(--theme-seed-canvas-deep) 14%) 25%,
      transparent 25%
    ),
    linear-gradient(
      45deg,
      transparent 75%,
      color-mix(in srgb, var(--bg) 86%, var(--theme-seed-canvas-deep) 14%) 75%
    ),
    linear-gradient(
      -45deg,
      transparent 75%,
      color-mix(in srgb, var(--bg) 86%, var(--theme-seed-canvas-deep) 14%) 75%
    ),
    color-mix(in srgb, var(--bg) 72%, var(--theme-seed-canvas-deep) 28%);
  background-position:
    0 0,
    0 8px,
    8px -8px,
    -8px 0;
  background-size: 16px 16px;
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.image-workbench__viewport.is-dragging {
  cursor: grabbing;
}

.image-workbench__viewport img {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  transform-origin: center center;
  transition: transform 120ms ease;
  user-select: none;
  will-change: transform;
  pointer-events: none;
}

.image-workbench__viewport.is-dragging img {
  transition: none;
}

.image-workbench__filmstrip {
  min-width: 0;
  display: flex;
  gap: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 2px;
}

.image-workbench__filmstrip-item {
  width: 62px;
  height: 62px;
  flex: 0 0 62px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
  border-radius: 7px;
  background: color-mix(in srgb, var(--ui-code-bg) 90%, transparent);
  color: var(--text-muted);
}

.image-workbench__filmstrip-item.is-active {
  border-color: color-mix(in srgb, var(--accent) 62%, var(--border));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent);
}

.image-workbench__filmstrip-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.image-workbench__empty {
  display: grid;
  place-items: center;
  gap: 10px;
  min-height: 0;
  border: 1px dashed color-mix(in srgb, var(--border) 82%, transparent);
  border-radius: 8px;
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--accent) 7%, transparent),
      transparent 48%
    ),
    color-mix(in srgb, var(--surface-1) 72%, transparent);
  color: var(--text-muted);
  padding: 24px;
  text-align: center;
}

.image-workbench__empty-icon,
.image-workbench__image-state {
  width: 26px;
  height: 26px;
  color: var(--accent);
}

.image-workbench__image-missing {
  color: var(--text-muted);
  font-size: 12px;
}

.is-spinning {
  animation: image-workbench-spin 1s linear infinite;
}

@keyframes image-workbench-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 980px) {
  .image-workbench {
    padding: 0 12px 14px;
  }

  .image-workbench__viewer-head {
    grid-template-columns: minmax(0, 1fr);
  }

  .image-workbench__viewer-actions {
    justify-content: flex-start;
    overflow-x: auto;
  }
}
</style>
