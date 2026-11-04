<template>
  <span
    class="skill-icon inline-flex flex-none items-center justify-center overflow-hidden rounded-[4px]"
    :style="{ width: `${size}px`, height: `${size}px`, color: brandColor || undefined }"
  >
    <img v-if="resolvedSrc" class="skill-icon__image" :src="resolvedSrc" alt="" @error="onImageError" />
    <Blocks v-else class="skill-icon__fallback" aria-hidden="true" />
  </span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Blocks } from "lucide-vue-next";
import type { SkillState } from "../../domain/types";
import { isAbsoluteFsPath, normalizeAbsoluteFsPath } from "../../domain/workspacePath";
import { readLocalImageDataUrl } from "../../features/media/localImageCache";

const props = withDefaults(
  defineProps<{
    skill?: SkillState | null;
    src?: string;
    size?: number;
  }>(),
  {
    skill: null,
    src: "",
    size: 28,
  }
);

const localDataUrl = ref("");
const failed = ref(false);
let loadSeq = 0;

const brandColor = computed(() => String(props.skill?.brandColor ?? "").trim());
const rawSrc = computed(() => {
  const explicit = String(props.src ?? "").trim();
  if (explicit) return explicit;
  const skill = props.skill;
  return String(skill?.iconSmallUrl || skill?.iconSmall || skill?.iconLargeUrl || skill?.iconLarge || "").trim();
});
const sourceKind = computed<"remote" | "local">(() => {
  const source = rawSrc.value;
  if (!source) return "local";
  if (source.startsWith("data:") || /^https?:\/\//i.test(source)) return "remote";
  return isAbsoluteFsPath(source) ? "local" : "remote";
});
const resolvedSrc = computed(() => {
  if (failed.value) return "";
  return sourceKind.value === "local" ? localDataUrl.value : rawSrc.value;
});

async function loadLocalIcon() {
  const seq = loadSeq + 1;
  loadSeq = seq;
  localDataUrl.value = "";
  failed.value = false;
  if (!rawSrc.value || sourceKind.value !== "local") return;
  const path = isAbsoluteFsPath(rawSrc.value) ? normalizeAbsoluteFsPath(rawSrc.value) : rawSrc.value;
  try {
    const dataUrl = await readLocalImageDataUrl(path);
    if (loadSeq === seq) localDataUrl.value = dataUrl;
  } catch {
    if (loadSeq === seq) failed.value = true;
  }
}

function onImageError() {
  failed.value = true;
}

watch(rawSrc, () => void loadLocalIcon(), { immediate: true });

onBeforeUnmount(() => {
  loadSeq += 1;
});
</script>

<style scoped>
.skill-icon__image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.skill-icon__fallback {
  width: 62%;
  height: 62%;
}
</style>
