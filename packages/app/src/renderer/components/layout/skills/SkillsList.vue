<template>
  <div v-if="stateText" class="skills-list skills-list--message dim">{{ stateText }}</div>
  <div v-else-if="items.length === 0" class="skills-list skills-list--message dim">{{ emptyText }}</div>
  <div v-else class="skills-list" :class="modeClass">
    <article
      v-for="skill in items"
      :key="getSkillKey(skill)"
      class="skill-details"
      :class="[
        modeClass,
        { 'is-open': isSkillOpen(skill), 'is-readonly': !skill.configurable, 'is-pending': isSkillPending(skill) },
      ]"
    >
      <div class="skill-summary" :class="modeClass">
        <label class="skill-switch">
          <input
            class="skill-switch-input"
            type="checkbox"
            :checked="skill.enabled"
            :disabled="!skill.configurable || isSkillPending(skill)"
            @click.stop
            @change="onSkillCheckboxChanged(skill, $event)"
          />
          <span class="skill-switch-track" aria-hidden="true">
            <span class="skill-switch-thumb"></span>
          </span>
        </label>

        <div class="skill-summary-main">
          <div class="skill-summary-topline">
            <div class="skill-title-wrap">
              <SkillIcon :skill="skill" :size="28" class="skill-title-icon" />
              <div class="skill-title-copy">
                <div class="name">{{ skill.name }}</div>
                <div v-if="mode === 'manager'" class="skill-badge-row">
                  <span class="skill-status-pill" :class="skill.enabled ? 'is-enabled' : 'is-disabled'">
                    {{ skill.enabled ? t("skills.enabled") : t("skills.disabled") }}
                  </span>
                  <span class="skill-meta-pill">{{
                    skill.configurable ? t("skills.configurable") : t("skills.fixed")
                  }}</span>
                </div>
              </div>
            </div>

            <button
              v-if="skill.description || skill.path"
              class="skill-summary-toggle"
              type="button"
              :aria-label="isSkillOpen(skill) ? t('skills.collapseDetails') : t('skills.expandDetails')"
              @click="toggleSkillOpen(skill)"
            >
              <ChevronDown class="skill-summary-toggle-icon" :class="{ open: isSkillOpen(skill) }" aria-hidden="true" />
            </button>
          </div>

          <div v-if="mode === 'manager'" class="skill-preview">
            {{ previewText(skill) }}
          </div>

          <div v-if="skill.path" class="skill-path">{{ skill.path }}</div>
        </div>
      </div>

      <div v-if="isSkillOpen(skill)" class="skill-body" :class="modeClass">
        <section v-if="skill.description" class="skill-info-block">
          <div class="skill-info-label mono">{{ t("skills.description") }}</div>
          <div class="skill-desc">{{ skill.description }}</div>
        </section>

        <section v-if="skill.path" class="skill-info-block">
          <div class="skill-info-label mono">{{ t("skills.path") }}</div>
          <div class="skill-path skill-path--body">{{ skill.path }}</div>
        </section>
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { ChevronDown } from "lucide-vue-next";
import type { SkillState } from "../../../domain/types";
import { useSkillsUiStore } from "../../../stores/skillsUi.store";
import SkillIcon from "../../ui/SkillIcon.vue";

const props = withDefaults(
  defineProps<{
    items: SkillState[];
    mode?: "compact" | "manager";
    pendingPath?: string;
    stateText?: string;
    emptyText?: string;
  }>(),
  {
    mode: "compact",
    pendingPath: "",
    stateText: "",
    emptyText: "",
  }
);

const emit = defineEmits<{
  (event: "toggle-skill", payload: { skill: SkillState; enabled: boolean }): void;
}>();

const skillsUiStore = useSkillsUiStore();
const { t } = useI18n();
const modeClass = computed(() => `skill-mode-${props.mode}`);

const getSkillKey = (skill: SkillState): string => {
  const key = String(skill.path ?? "").trim() || String(skill.name ?? "").trim();
  return key || "unknown-skill";
};

const isSkillOpen = (skill: SkillState): boolean => skillsUiStore.isExpanded(getSkillKey(skill));
const toggleSkillOpen = (skill: SkillState): void => skillsUiStore.toggleExpanded(getSkillKey(skill));

const isSkillPending = (skill: SkillState): boolean => props.pendingPath === String(skill.path ?? "");

const previewText = (skill: SkillState): string => {
  const description = String(skill.description ?? "").trim();
  if (description) return description;
  if (!skill.configurable) return t("skills.fixedPreview");
  return skill.enabled ? t("skills.enabledPreview") : t("skills.disabledPreview");
};

const onSkillCheckboxChanged = (skill: SkillState, event: Event) => {
  const target = event.target as HTMLInputElement | null;
  emit("toggle-skill", { skill, enabled: Boolean(target?.checked) });
};
</script>
