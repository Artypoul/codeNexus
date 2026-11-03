<template>
  <section class="settings-card" :aria-label="t('settingsSound.aria')">
    <header class="settings-card-head">
      <div class="settings-card-title">{{ t("settingsSound.title") }}</div>
      <div class="row" style="gap: 8px; align-items: center">
        <button
          id="btn-settings-sound-preview"
          class="btn-mini"
          type="button"
          :disabled="notificationSoundControlsDisabled"
          @click="onPreview"
        >
          {{ t("settingsSound.preview") }}
        </button>
      </div>
    </header>

    <div class="settings-card-body">
      <div class="settings-grid">
        <label class="settings-row">
          <span class="context-label dim">{{ t("settingsSound.sound") }}</span>
          <SelectDropdown
            id="sel-settings-notification-sound"
            class="context-input mono w-full"
            :modelValue="notificationSoundStore.selectedId"
            :disabled="notificationSoundControlsDisabled"
            :options="notificationSoundDropdownOptions"
            :minPopoverWidth="260"
            @update:modelValue="onSoundChange"
          />
        </label>

        <div v-if="notificationSoundStatusText" class="dim text-[12px] leading-[1.25]">
          {{ notificationSoundStatusText }}
        </div>

        <label class="settings-row">
          <span class="context-label dim">{{ t("settingsSound.volume") }}</span>
          <div class="settings-volume">
            <input
              id="rng-settings-notification-sound-volume"
              class="settings-volume-slider"
              type="range"
              min="0"
              max="100"
              step="1"
              :value="notificationSoundStore.volumePercent"
              @input="onVolumeInput"
              @change="onVolumeChange"
            />
            <span class="mono dim settings-volume-value">{{ notificationSoundStore.volumePercent }}%</span>
          </div>
        </label>

        <div class="dim text-[12px] leading-[1.25]">{{ t("settingsSound.description") }}</div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import SelectDropdown from "../../ui/SelectDropdown.vue";
import { useNotificationSoundStore } from "../../../stores/notificationSound.store";
import { playNotificationSoundOnce } from "../../../features/notificationSound/player";

const { t } = useI18n();
const notificationSoundStore = useNotificationSoundStore();

onMounted(() => {
  void notificationSoundStore.refreshAvailable();
});

const notificationSoundDropdownOptions = computed(() => {
  return notificationSoundStore.available.map((item) => ({ value: item.id, label: item.label }));
});

const notificationSoundControlsDisabled = computed(() => {
  if (notificationSoundStore.loadState === "loading") return true;
  return notificationSoundStore.available.length === 0;
});

const notificationSoundStatusText = computed(() => {
  if (notificationSoundStore.loadState === "idle") return "";
  if (notificationSoundStore.loadState === "loading") return t("settingsSound.loading");
  if (notificationSoundStore.loadState === "error") {
    return notificationSoundStore.errorText
      ? t("settingsSound.loadFailedWithMessage", { message: notificationSoundStore.errorText })
      : t("settingsSound.loadFailed");
  }
  if (notificationSoundStore.available.length === 0) return t("settingsSound.noBuiltInSounds");
  return "";
});

const onSoundChange = (nextRaw: string) => {
  const next = String(nextRaw ?? "").trim();
  if (!next) return;
  notificationSoundStore.setSelectedId(next, { save: true });
};

const onPreview = async () => {
  const id = String(notificationSoundStore.selectedId ?? "").trim();
  if (!id) return;
  await playNotificationSoundOnce({ soundId: id, force: true, volumePercent: notificationSoundStore.volumePercent });
};

const onVolumeInput = (event: Event) => {
  const el = event.target as HTMLInputElement | null;
  if (!el) return;
  notificationSoundStore.setVolumePercent(Number(el.value), { save: false });
};

const onVolumeChange = (event: Event) => {
  const el = event.target as HTMLInputElement | null;
  if (!el) return;
  notificationSoundStore.setVolumePercent(Number(el.value), { save: true });
};
</script>
