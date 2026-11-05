<template>
  <div
    class="composer"
    :class="{ 'composer--inline': variant === 'inline' }"
    @pointerdown.capture="onComposerRootPointerDownCapture"
    @focusin.capture="emit('interact')"
  >
    <div class="composer-input-area">
      <div
        :ref="composerPanelRef"
        class="composer-shell"
        :class="{
          'is-agent': composeMode === 'default',
          'is-plan': composeMode === 'plan',
          'is-workspace-file-drag-over': isWorkspaceFileDragOver,
          'is-focused': isInputFocused,
        }"
        @pointerdown="onComposerShellPointerDown"
        @dragenter="onComposerDragEnter"
        @dragover="onComposerDragOver"
        @dragleave="onComposerDragLeave"
        @drop="onComposerDrop"
      >
        <ApprovalDock v-if="variant !== 'inline'" />
        <UserInputDock v-if="variant !== 'inline' && hasPendingComposerUserInput" />
        <div v-if="isWorkspaceFileDragOver" class="composer-file-drop-overlay" aria-hidden="true">
          {{ t("composer.dropFiles") }}
        </div>
        <div
          :ref="bindComposerInputRef"
          :id="inputId || 'input'"
          class="composer-input-editor app-scrollbar"
          contenteditable="true"
          role="textbox"
          aria-multiline="true"
          spellcheck="false"
          :data-placeholder="inputPlaceholder || t('composer.inputPlaceholder')"
          @keydown="onComposerKeydown"
          @paste="onComposerPaste"
          @input="onComposerInput"
          @focus="isInputFocused = true"
          @blur="isInputFocused = false"
          @mousedown="onComposerInputMouseDown"
        ></div>

        <input
          v-if="variant !== 'inline'"
          :ref="composerImageInputRef"
          class="composer-image-input-native"
          type="file"
          accept="image/*"
          multiple
          @change="onComposerImageInputChange"
        />

        <div v-if="composeAttachments.length > 0" class="composer-attachments">
          <div v-for="attachment in composeAttachments" :key="attachment.id" class="composer-attachment">
            <button
              class="composer-attachment-preview"
              type="button"
              :aria-label="t('composer.previewImage', { name: attachment.name })"
              @click="onPreviewAttachment(attachment.id)"
            >
              <img
                class="composer-attachment-image"
                :src="attachment.previewUrl"
                :alt="attachment.name"
                loading="lazy"
              />
            </button>
            <button
              class="composer-attachment-remove"
              type="button"
              :aria-label="t('composer.removeImage')"
              @click.stop.prevent="onRemoveAttachment(attachment.id)"
            >
              ×
            </button>
          </div>
        </div>

        <div class="composer-toolbar">
          <div class="composer-toolbar-main">
            <div v-if="historyRewriteActive && variant !== 'inline'" class="composer-rewrite-chip mono">
              <span>{{ historyRewriteLabel }}</span>
              <button class="btn-mini composer-rewrite-cancel" type="button" @click="emit('cancel-rewrite')">
                {{ t("common.cancel") }}
              </button>
            </div>

            <div class="composer-mode-group" role="group" :aria-label="t('composer.collaborationMode')">
              <div class="composer-mode-thumb"></div>
              <button
                class="btn-mini composer-mode-button"
                type="button"
                :class="['is-agent', composeMode === 'default' ? 'is-active' : '']"
                @click="emit('set-compose-mode', 'default')"
              >
                <Bot class="composer-mode-icon" aria-hidden="true" /><span>{{ t("composer.execute") }}</span>
              </button>
              <button
                class="btn-mini composer-mode-button"
                type="button"
                :class="['is-plan', composeMode === 'plan' ? 'is-active' : '']"
                @click="emit('set-compose-mode', 'plan')"
              >
                <ListTodo class="composer-mode-icon" aria-hidden="true" /><span>{{ t("composer.plan") }}</span>
              </button>
            </div>

            <ComposerModelReasoningPicker
              :model="model"
              :reasoningEffort="reasoningEffort"
              :modelOptions="modelOptions"
              :preservePointerFocus="variant === 'inline'"
              :interactionOwnerId="interactionOwnerId"
              @update:model="emit('update:model', $event)"
              @update:reasoningEffort="emit('update:reasoningEffort', $event)"
            />
            <ComposerSandboxPicker
              :modelValue="sandboxMode"
              :tooltipText="sandboxRiskText"
              :options="sandboxModeOptions"
              :preservePointerFocus="variant === 'inline'"
              :interactionOwnerId="interactionOwnerId"
              @update:modelValue="emit('update:sandboxMode', $event)"
            />
            <span
              v-if="variant !== 'inline' && serviceTierLabel"
              class="composer-service-tier mono"
              :class="{ 'is-fast': serviceTierLabel === t('composer.fast') }"
              >{{ serviceTierLabel }}</span
            >
          </div>

          <div class="composer-toolbar-actions">
            <button
              v-if="variant !== 'inline'"
              id="btn-insert-skill"
              class="btn-mini composer-icon-button"
              type="button"
              :aria-label="t('composer.insertSkill')"
              :aria-expanded="isSkillPickerOpen ? 'true' : 'false'"
              @click.stop="toggleSkillPicker"
            >
              <Blocks class="composer-icon-button-icon" />
            </button>

            <button
              v-if="variant !== 'inline'"
              id="btn-add-image"
              class="btn-mini composer-icon-button"
              type="button"
              :aria-label="t('composer.addImage')"
              @click="emit('pick-images')"
            >
              <ImagePlus class="composer-icon-button-icon" />
            </button>

            <div v-if="variant !== 'inline'" class="composer-context">
              <WaterBallProgress
                class="composer-context-ball"
                :percent="contextUsagePercent"
                :level="contextUsageLevel"
                :size="28"
                :aria-label="contextUsageTooltip"
              />
              <div class="composer-context-copy">
                <div class="composer-context-tokens mono">
                  {{ contextUsageTokensText }}
                </div>
              </div>
            </div>

            <button
              id="btn-send-stop"
              class="composer-send-button"
              :class="{ 'is-running': isTurnRunning, 'is-disabled': sendDisabled && !isTurnRunning }"
              type="button"
              :disabled="sendDisabled && !isTurnRunning"
              :aria-label="sendTitle"
              @click="emit('send')"
            >
              <SendHorizontal class="composer-send-icon" />
              <span class="composer-send-label">{{ t("composer.send") }}</span>
            </button>
            <button
              v-if="isTurnRunning"
              class="composer-send-button composer-stop-button is-running"
              type="button"
              :disabled="interruptDisabled"
              :aria-label="interruptTitle"
              @click="emit('interrupt-turn')"
            >
              <Square class="composer-send-icon" />
            </button>
          </div>
        </div>

        <div
          v-if="isSkillPickerOpen"
          ref="skillPickerRef"
          class="composer-skill-picker app-scrollbar"
          @pointerdown.stop
          @keydown.esc.stop.prevent="closeSkillPicker"
        >
          <div class="composer-skill-picker-title mono">{{ t("composer.skillPickerTitle") }}</div>
          <button
            v-for="skill in selectableSkills"
            :key="getSkillKey(skill)"
            class="composer-skill-option"
            type="button"
            :disabled="!skill.path"
            :title="skill.path || skill.name"
            @click.stop="insertSkillMention(skill)"
          >
            <SkillIcon :skill="skill" :size="22" />
            <span class="composer-skill-option-main">
              <span class="composer-skill-option-name">{{ skill.displayName || skill.name }}</span>
              <span v-if="skill.shortDescription || skill.description" class="composer-skill-option-desc">
                {{ skill.shortDescription || skill.description }}
              </span>
            </span>
          </button>
          <div v-if="selectableSkills.length === 0" class="composer-skill-empty mono dim">
            {{ skillsLoadState === "loading" ? t("composer.skillPickerLoading") : t("composer.skillPickerEmpty") }}
          </div>
        </div>

        <div v-if="statusText" class="composer-status-line">
          <WaveText class="composer-status-text mono dim" :text="statusText" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Blocks, Bot, ImagePlus, ListTodo, SendHorizontal, Square } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import type { ModelPickerOption } from "@codenexus/shared/modelCatalog";
import type {
  CollaborationModeKind,
  ComposeImageAttachment,
  ComposeWorkspaceFileMention,
  SkillState,
} from "../../../domain/types";
import {
  COMPOSE_FILE_TOKEN_CHAR,
  countComposeFileTokensBeforeOffset,
  createComposeFileMention,
  createComposeSkillMention,
  findComposeFileTokenOffsetByMentionIndex,
} from "../../../domain/composeFileMentions";
import { basenameFromPath } from "../../../domain/workspaceFiles";
import { isAbsoluteFsPath, normalizeAbsoluteFsPath } from "../../../domain/workspacePath";
import { readLocalImageDataUrl } from "../../../features/media/localImageCache";
import { hasWorkspaceFileDragData, readWorkspaceFileDragData } from "../../../domain/workspaceFileDrag";
import { useRuntimeStore, type SandboxMode } from "../../../stores/runtime.store";
import { useUserInputStore } from "../../../stores/userInput.store";
import WaterBallProgress from "../../ui/WaterBallProgress.vue";
import WaveText from "../../ui/WaveText.vue";
import SkillIcon from "../../ui/SkillIcon.vue";
import { resolveVscodeEntryIcon } from "../workspace/vscodeFileIcons";
import ComposerModelReasoningPicker from "./ComposerModelReasoningPicker.vue";
import ComposerSandboxPicker from "./ComposerSandboxPicker.vue";

const UserInputDock = defineAsyncComponent(() => import("../../userInput/UserInputDock.vue"));
const ApprovalDock = defineAsyncComponent(() => import("../../approval/ApprovalDock.vue"));

type SelectOption = {
  value: string;
  label: string;
};

type ElementRefBinder<T extends Element> = (el: T | null) => void;

type ComposeDraftState = {
  composeInput: string;
  composeFileMentions: ComposeWorkspaceFileMention[];
};

type CaretRangeDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

const props = defineProps<{
  composeInput: string;
  composeAttachments: ComposeImageAttachment[];
  composeFileMentions: ComposeWorkspaceFileMention[];
  skills?: readonly SkillState[];
  skillsLoadState?: "idle" | "loading" | "ready" | "error";
  historyRewriteActive: boolean;
  historyRewriteSource: "history" | "queue";
  statusText?: string;
  composeMode: CollaborationModeKind;
  model: string;
  reasoningEffort: string;
  sandboxMode: SandboxMode;
  modelOptions: readonly ModelPickerOption[];
  sandboxModeOptions: readonly SelectOption[];
  sandboxRiskText: string;
  serviceTierLabel?: string;
  serviceTierTooltip?: string;
  contextUsageTooltip: string;
  contextUsagePercent: number;
  contextUsageLevel: string;
  contextUsageTokensText: string;
  isTurnRunning: boolean;
  sendDisabled: boolean;
  sendTitle: string;
  interruptDisabled: boolean;
  interruptTitle: string;
  composerPanelRef: ElementRefBinder<HTMLDivElement>;
  composerInputRef: ElementRefBinder<HTMLDivElement>;
  composerImageInputRef: ElementRefBinder<HTMLInputElement>;
  inputId?: string;
  inputPlaceholder?: string;
  variant?: "dock" | "inline";
  interactionOwnerId?: string;
}>();

const emit = defineEmits<{
  (event: "update:composeInput", value: string): void;
  (event: "update:composeFileMentions", value: ComposeWorkspaceFileMention[]): void;
  (event: "request-skills"): void;
  (event: "update:model", value: string): void;
  (event: "update:reasoningEffort", value: string): void;
  (event: "update:sandboxMode", value: SandboxMode): void;
  (event: "set-compose-mode", mode: CollaborationModeKind): void;
  (event: "composer-keydown", eventValue: KeyboardEvent): void;
  (event: "composer-paste", eventValue: ClipboardEvent): void;
  (event: "composer-image-change", eventValue: Event): void;
  (event: "preview-attachment", attachmentId: string): void;
  (event: "remove-attachment", attachmentId: string): void;
  (event: "cancel-rewrite"): void;
  (event: "pick-images"): void;
  (event: "send"): void;
  (event: "interrupt-turn"): void;
  (event: "interact"): void;
}>();

const { t } = useI18n();
const internalComposerInputRef = ref<HTMLDivElement | null>(null);
const runtimeStore = useRuntimeStore();
const userInputStore = useUserInputStore();
const isInputFocused = ref(false);
const workspaceFileDragDepth = ref(0);
const isWorkspaceFileDragOver = ref(false);
const isSkillPickerOpen = ref(false);
const skillPickerRef = ref<HTMLElement | null>(null);
const skillInsertOffset = ref<number | null>(null);
const selectedMentionId = ref("");
const pendingSelectionOffset = ref<number | null>(null);
const pendingFocusAfterSync = ref(false);

type ComposerScrollSnapshot = {
  top: number;
  bottomOffset: number;
  overflow: boolean;
};

function bindComposerInputRef(el: HTMLDivElement | null) {
  internalComposerInputRef.value = el;
  props.composerInputRef(el);
  if (el) {
    nextTick(() => {
      if (internalComposerInputRef.value === el) syncDomFromProps();
    });
  }
}

const hasPendingComposerUserInput = computed(() => {
  const threadId = String(runtimeStore.currentThreadId ?? "").trim();
  return Boolean(threadId && userInputStore.queueSizeForThread(threadId) > 0);
});

const historyRewriteLabel = computed(() =>
  props.historyRewriteSource === "queue" ? t("composer.editQueuedMessage") : t("composer.rewriteHistoryMessage")
);

const mentionSignature = computed(() => {
  return props.composeFileMentions
    .map(
      (mention) =>
        `${mention.id}\u0001${mention.kind ?? ""}\u0001${mention.path}\u0001${mention.name ?? ""}\u0001${mention.displayName ?? ""}\u0001${mention.iconUrl ?? ""}`
    )
    .join("\u0002");
});

const selectableSkills = computed(() =>
  (props.skills ?? []).filter((skill) => skill.enabled && Boolean(String(skill.path ?? "").trim()))
);

function getComposeDraftFromProps(): ComposeDraftState {
  return {
    composeInput: String(props.composeInput ?? ""),
    composeFileMentions: props.composeFileMentions.map((mention) => ({ ...mention })),
  };
}

function isMentionTokenElement(node: Node | null): node is HTMLElement {
  return node instanceof HTMLElement && node.dataset.composeMentionId != null;
}

function isMentionTokenSpacerElement(node: Node | null): node is HTMLElement {
  return node instanceof HTMLElement && node.dataset.composeMentionSpacer === "true";
}

function isSameMention(left: ComposeWorkspaceFileMention, right: ComposeWorkspaceFileMention): boolean {
  return (
    left.id === right.id &&
    left.path === right.path &&
    left.kind === right.kind &&
    left.name === right.name &&
    left.displayName === right.displayName &&
    left.iconUrl === right.iconUrl
  );
}

function isSameComposeDraft(left: ComposeDraftState, right: ComposeDraftState): boolean {
  if (left.composeInput !== right.composeInput) return false;
  if (left.composeFileMentions.length !== right.composeFileMentions.length) return false;
  for (let index = 0; index < left.composeFileMentions.length; index += 1) {
    if (!isSameMention(left.composeFileMentions[index], right.composeFileMentions[index])) return false;
  }
  return true;
}

function buildMentionTokenElement(mention: ComposeWorkspaceFileMention): HTMLSpanElement {
  const root = document.createElement("span");
  const kind =
    mention.kind === "skill" || mention.kind === "mention"
      ? mention.kind
      : mention.kind === "directory"
        ? "directory"
        : "file";
  root.className = ["composer-inline-file-token", `composer-inline-file-token--${kind}`].filter(Boolean).join(" ");
  root.contentEditable = "false";
  root.dataset.composeMentionId = mention.id;
  root.dataset.composeMentionPath = mention.path;
  root.dataset.composeMentionKind = kind;
  if (mention.name) root.dataset.composeMentionName = mention.name;
  if (mention.displayName) root.dataset.composeMentionDisplayName = mention.displayName;
  if (mention.iconUrl) root.dataset.composeMentionIconUrl = mention.iconUrl;

  const icon =
    kind === "skill"
      ? buildSkillTokenIcon(mention.iconUrl)
      : buildMentionTokenIcon(mention.path, kind === "directory" ? "directory" : "file");
  const label = document.createElement("span");
  label.className = "composer-inline-file-token__label";
  label.textContent =
    kind === "skill"
      ? mention.displayName || mention.name || basenameFromPath(mention.path) || mention.path
      : (kind === "mention" ? mention.name : "") || basenameFromPath(mention.path) || mention.path;

  root.append(icon, label);
  return root;
}

function buildSkillTokenIcon(iconUrlValue: string | undefined): HTMLSpanElement {
  const icon = document.createElement("span");
  icon.className = "composer-inline-file-token__icon";
  icon.setAttribute("aria-hidden", "true");
  const iconUrl = String(iconUrlValue ?? "").trim();
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML =
    '<rect width="7" height="7" x="14" y="3" rx="1"></rect><path d="M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3"></path>';
  icon.append(svg);
  if (iconUrl) {
    const image = document.createElement("img");
    image.className = "composer-inline-file-token__icon-img";
    image.alt = "";
    image.onload = () => icon.replaceChildren(image);
    image.onerror = () => icon.replaceChildren(svg);
    if (isAbsoluteFsPath(iconUrl)) {
      void readLocalImageDataUrl(normalizeAbsoluteFsPath(iconUrl))
        .then((dataUrl) => {
          image.src = dataUrl;
        })
        .catch(() => {});
    } else {
      image.src = iconUrl;
    }
  }
  return icon;
}

function buildMentionTokenSpacerElement(): HTMLSpanElement {
  const spacer = document.createElement("span");
  spacer.className = "composer-inline-file-token-spacer";
  spacer.contentEditable = "false";
  spacer.dataset.composeMentionSpacer = "true";
  spacer.setAttribute("aria-hidden", "true");
  return spacer;
}

function buildMentionTokenIcon(path: string, kind: "file" | "directory"): HTMLSpanElement {
  const icon = document.createElement("span");
  icon.className = "composer-inline-file-token__icon";
  icon.setAttribute("aria-hidden", "true");

  const vscodeIcon = resolveVscodeEntryIcon(path, { isDirectory: kind === "directory" });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${vscodeIcon.width ?? 16} ${vscodeIcon.height ?? 16}`);
  svg.setAttribute("width", "1em");
  svg.setAttribute("height", "1em");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = vscodeIcon.body;

  icon.append(svg);
  return icon;
}

function renderComposeDraftToDom(root: HTMLDivElement, draft: ComposeDraftState) {
  root.replaceChildren();

  let mentionIndex = 0;
  let textBuffer = "";

  const flushTextBuffer = () => {
    if (!textBuffer) return;
    root.append(document.createTextNode(textBuffer));
    textBuffer = "";
  };

  for (const char of draft.composeInput) {
    if (char !== COMPOSE_FILE_TOKEN_CHAR) {
      textBuffer += char;
      continue;
    }
    flushTextBuffer();
    const mention = draft.composeFileMentions[mentionIndex] ?? null;
    mentionIndex += 1;
    if (!mention) continue;
    root.append(buildMentionTokenElement(mention));
    root.append(buildMentionTokenSpacerElement());
  }

  flushTextBuffer();

  for (; mentionIndex < draft.composeFileMentions.length; mentionIndex += 1) {
    const mention = draft.composeFileMentions[mentionIndex];
    if (!mention) continue;
    root.append(buildMentionTokenElement(mention));
    root.append(buildMentionTokenSpacerElement());
  }
}

function readComposeDraftFromDom(root: HTMLDivElement): ComposeDraftState {
  const composeInputParts: string[] = [];
  const composeFileMentions: ComposeWorkspaceFileMention[] = [];

  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      composeInputParts.push(child.textContent ?? "");
      continue;
    }
    if (child.nodeName === "BR") {
      composeInputParts.push("\n");
      continue;
    }
    if (isMentionTokenSpacerElement(child)) {
      continue;
    }
    if (!isMentionTokenElement(child)) {
      composeInputParts.push(child.textContent ?? "");
      continue;
    }
    const mention = createComposeFileMention(child.dataset.composeMentionPath ?? "", {
      id: child.dataset.composeMentionId ?? "",
      idPrefix: "compose-file",
      kind:
        child.dataset.composeMentionKind === "skill"
          ? "skill"
          : child.dataset.composeMentionKind === "directory"
            ? "directory"
            : child.dataset.composeMentionKind === "mention"
              ? "mention"
              : "file",
      name: child.dataset.composeMentionName ?? "",
      displayName: child.dataset.composeMentionDisplayName ?? "",
      iconUrl: child.dataset.composeMentionIconUrl ?? "",
    });
    if (!mention) continue;
    composeInputParts.push(COMPOSE_FILE_TOKEN_CHAR);
    composeFileMentions.push(mention);
  }

  const composeInput = composeInputParts.join("").replace(/\r\n?/g, "\n");
  if (
    composeFileMentions.length === 0 &&
    composeInput === "\n" &&
    root.childNodes.length === 1 &&
    root.firstChild?.nodeName === "BR"
  ) {
    return {
      composeInput: "",
      composeFileMentions,
    };
  }

  return {
    composeInput,
    composeFileMentions,
  };
}

function getLogicalLengthOfNode(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  if (node.nodeName === "BR") return 1;
  if (isMentionTokenSpacerElement(node)) return 0;
  if (isMentionTokenElement(node)) return 1;
  let total = 0;
  for (const child of Array.from(node.childNodes)) {
    total += getLogicalLengthOfNode(child);
  }
  return total;
}

function getLogicalOffsetFromDomPoint(root: HTMLDivElement, container: Node, offset: number): number {
  const range = document.createRange();
  range.setStart(root, 0);
  try {
    range.setEnd(container, offset);
  } catch {
    return String(props.composeInput ?? "").length;
  }
  const fragment = range.cloneContents();
  return Array.from(fragment.childNodes).reduce((total, child) => total + getLogicalLengthOfNode(child), 0);
}

function getCurrentSelectionOffset(root: HTMLDivElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return String(props.composeInput ?? "").length;
  const range = selection.getRangeAt(0);
  return getLogicalOffsetFromDomPoint(root, range.startContainer, range.startOffset);
}

function resolveDomPointForOffset(root: HTMLDivElement, offsetValue: number): { container: Node; offset: number } {
  const offset = Math.max(0, Math.min(String(props.composeInput ?? "").length, Math.round(offsetValue)));
  let remaining = offset;
  const children = Array.from(root.childNodes);

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const childLength = getLogicalLengthOfNode(child);
    if (remaining > childLength) {
      remaining -= childLength;
      continue;
    }
    if (child.nodeType === Node.TEXT_NODE) {
      return { container: child, offset: Math.min(remaining, child.textContent?.length ?? 0) };
    }
    if (isMentionTokenElement(child) || child.nodeName === "BR") {
      if (remaining <= 0) return { container: root, offset: index };
      if (isMentionTokenElement(child) && isMentionTokenSpacerElement(children[index + 1] ?? null)) {
        return { container: root, offset: index + 2 };
      }
      return { container: root, offset: index + 1 };
    }
    return { container: child, offset: Math.min(remaining, child.childNodes.length) };
  }

  return { container: root, offset: root.childNodes.length };
}

function focusComposerAtLogicalOffset(offset: number) {
  const root = internalComposerInputRef.value;
  if (!root) return;
  root.focus({ preventScroll: true });
  const selection = window.getSelection();
  if (!selection) return;
  const point = resolveDomPointForOffset(root, offset);
  const range = document.createRange();
  range.setStart(point.container, point.offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function applySelectedMentionState() {
  const root = internalComposerInputRef.value;
  if (!root) return;
  const activeMentionId = String(selectedMentionId.value ?? "").trim();
  for (const token of root.querySelectorAll<HTMLElement>("[data-compose-mention-id]")) {
    token.classList.toggle("is-selected", token.dataset.composeMentionId === activeMentionId);
  }
}

function captureComposerScrollSnapshot(root: HTMLDivElement): ComposerScrollSnapshot {
  const maxScrollTop = Math.max(0, root.scrollHeight - root.clientHeight);
  return {
    top: root.scrollTop,
    bottomOffset: Math.max(0, maxScrollTop - root.scrollTop),
    overflow: maxScrollTop > 0,
  };
}

function restoreComposerScrollSnapshot(root: HTMLDivElement, snapshot: ComposerScrollSnapshot) {
  const maxScrollTop = Math.max(0, root.scrollHeight - root.clientHeight);
  if (maxScrollTop <= 0) {
    root.scrollTop = 0;
    return;
  }
  if (!snapshot.overflow) {
    root.scrollTop = Math.max(0, Math.min(maxScrollTop, snapshot.top));
    return;
  }
  const nextTop = maxScrollTop - snapshot.bottomOffset;
  root.scrollTop = Math.max(0, Math.min(maxScrollTop, nextTop));
}

function syncDomFromProps() {
  const root = internalComposerInputRef.value;
  if (!root) return;

  const draftFromProps = getComposeDraftFromProps();
  const draftFromDom = readComposeDraftFromDom(root);
  const hasPhantomEmptyBreak =
    draftFromProps.composeInput === "" &&
    draftFromProps.composeFileMentions.length === 0 &&
    root.childNodes.length === 1 &&
    root.firstChild?.nodeName === "BR";
  if (isSameComposeDraft(draftFromProps, draftFromDom) && !hasPhantomEmptyBreak) {
    pendingSelectionOffset.value = null;
    pendingFocusAfterSync.value = false;
    if (
      selectedMentionId.value &&
      !draftFromProps.composeFileMentions.some((mention) => mention.id === selectedMentionId.value)
    ) {
      selectedMentionId.value = "";
    }
    applySelectedMentionState();
    return;
  }

  const shouldFocus = pendingFocusAfterSync.value || document.activeElement === root;
  const nextOffset = shouldFocus
    ? Math.max(
        0,
        Math.min(draftFromProps.composeInput.length, pendingSelectionOffset.value ?? draftFromProps.composeInput.length)
      )
    : null;
  const scrollSnapshot = captureComposerScrollSnapshot(root);

  renderComposeDraftToDom(root, draftFromProps);
  applySelectedMentionState();

  pendingSelectionOffset.value = null;
  pendingFocusAfterSync.value = false;

  restoreComposerScrollSnapshot(root, scrollSnapshot);
  if (nextOffset != null) focusComposerAtLogicalOffset(nextOffset);
}

function emitComposeDraft(
  nextDraft: ComposeDraftState,
  options?: { focusOffset?: number | null; focus?: boolean; selectedMentionId?: string }
) {
  pendingSelectionOffset.value = options?.focusOffset ?? null;
  pendingFocusAfterSync.value = Boolean(options?.focus || options?.focusOffset != null);
  selectedMentionId.value = String(options?.selectedMentionId ?? "").trim();
  emit("update:composeInput", nextDraft.composeInput);
  emit("update:composeFileMentions", nextDraft.composeFileMentions);
}

function syncComposeDraftFromDom() {
  const root = internalComposerInputRef.value;
  if (!root) return;
  const nextDraft = readComposeDraftFromDom(root);
  const prevDraft = getComposeDraftFromProps();
  if (isSameComposeDraft(prevDraft, nextDraft)) {
    applySelectedMentionState();
    return;
  }
  emitComposeDraft(nextDraft, {
    focusOffset: getCurrentSelectionOffset(root),
    focus: document.activeElement === root,
  });
}

function insertTextAtSelection(textValue: string) {
  const root = internalComposerInputRef.value;
  if (!root) return;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    focusComposerAtLogicalOffset(String(props.composeInput ?? "").length);
  }
  const nextSelection = window.getSelection();
  const range = nextSelection?.rangeCount ? nextSelection.getRangeAt(0) : null;
  if (!range) return;
  range.deleteContents();
  const textNode = document.createTextNode(String(textValue ?? "").replace(/\r\n?/g, "\n"));
  range.insertNode(textNode);
  range.setStart(textNode, textNode.textContent?.length ?? 0);
  range.collapse(true);
  nextSelection?.removeAllRanges();
  nextSelection?.addRange(range);
}

function removeMentionAtIndex(mentionIndexValue: number) {
  if (!Number.isFinite(mentionIndexValue) || mentionIndexValue < 0) return;
  const mentionIndex = Math.round(mentionIndexValue);
  const mentionOffset = findComposeFileTokenOffsetByMentionIndex(props.composeInput, mentionIndex);
  if (mentionOffset < 0) return;
  const nextMentions = props.composeFileMentions.filter((_, index) => index !== mentionIndex);
  const nextInput = `${props.composeInput.slice(0, mentionOffset)}${props.composeInput.slice(mentionOffset + 1)}`;
  emitComposeDraft(
    {
      composeInput: nextInput,
      composeFileMentions: nextMentions,
    },
    {
      focus: true,
      focusOffset: mentionOffset,
    }
  );
}

function getMentionIndexById(mentionIdValue: string): number {
  const mentionId = String(mentionIdValue ?? "").trim();
  if (!mentionId) return -1;
  return props.composeFileMentions.findIndex((mention) => mention.id === mentionId);
}

function insertDroppedFiles(
  paths: Array<{ path: string; kind?: ComposeWorkspaceFileMention["kind"] }>,
  offsetValue: number
) {
  const offset = Math.max(0, Math.min(String(props.composeInput ?? "").length, Math.round(offsetValue)));
  const insertedMentions = paths
    .map((item) => createComposeFileMention(item.path, { kind: item.kind }))
    .filter((item): item is ComposeWorkspaceFileMention => Boolean(item));
  if (insertedMentions.length === 0) return;

  const mentionInsertIndex = countComposeFileTokensBeforeOffset(props.composeInput, offset);
  const nextInput = `${props.composeInput.slice(0, offset)}${COMPOSE_FILE_TOKEN_CHAR.repeat(insertedMentions.length)}${props.composeInput.slice(offset)}`;
  const nextMentions = [
    ...props.composeFileMentions.slice(0, mentionInsertIndex),
    ...insertedMentions,
    ...props.composeFileMentions.slice(mentionInsertIndex),
  ];

  emitComposeDraft(
    {
      composeInput: nextInput,
      composeFileMentions: nextMentions,
    },
    {
      focus: true,
      focusOffset: offset + insertedMentions.length,
    }
  );
}

function getSkillKey(skill: SkillState): string {
  return String(skill.path ?? "").trim() || String(skill.name ?? "").trim();
}

function closeSkillPicker() {
  isSkillPickerOpen.value = false;
  skillInsertOffset.value = null;
}

function toggleSkillPicker() {
  if (isSkillPickerOpen.value) {
    closeSkillPicker();
    return;
  }
  const root = internalComposerInputRef.value;
  skillInsertOffset.value = root ? getCurrentSelectionOffset(root) : String(props.composeInput ?? "").length;
  isSkillPickerOpen.value = true;
  emit("request-skills");
}

function insertSkillMention(skill: SkillState) {
  const mention = createComposeSkillMention(skill);
  if (!mention) return;
  const root = internalComposerInputRef.value;
  const offset = Math.max(
    0,
    Math.min(
      String(props.composeInput ?? "").length,
      skillInsertOffset.value ?? (root ? getCurrentSelectionOffset(root) : String(props.composeInput ?? "").length)
    )
  );
  const mentionInsertIndex = countComposeFileTokensBeforeOffset(props.composeInput, offset);
  const nextInput = `${props.composeInput.slice(0, offset)}${COMPOSE_FILE_TOKEN_CHAR}${props.composeInput.slice(offset)}`;
  const nextMentions = [
    ...props.composeFileMentions.slice(0, mentionInsertIndex),
    mention,
    ...props.composeFileMentions.slice(mentionInsertIndex),
  ];
  emitComposeDraft(
    {
      composeInput: nextInput,
      composeFileMentions: nextMentions,
    },
    {
      focus: true,
      focusOffset: offset + 1,
      selectedMentionId: mention.id,
    }
  );
  skillInsertOffset.value = null;
  closeSkillPicker();
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!isSkillPickerOpen.value) return;
  const target = event.target instanceof Node ? event.target : null;
  if (!target) return;
  if (skillPickerRef.value?.contains(target)) return;
  if (target instanceof Element && target.closest("#btn-insert-skill")) return;
  closeSkillPicker();
}

watch(isSkillPickerOpen, (open) => {
  if (typeof document === "undefined") return;
  if (open) document.addEventListener("pointerdown", onDocumentPointerDown, true);
  else document.removeEventListener("pointerdown", onDocumentPointerDown, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown, true);
});

function getCaretOffsetFromPoint(clientX: number, clientY: number): number {
  const root = internalComposerInputRef.value;
  if (!root) return String(props.composeInput ?? "").length;
  const doc = document as CaretRangeDocument;
  const caretPosition = doc.caretPositionFromPoint?.(clientX, clientY) ?? null;
  if (caretPosition?.offsetNode) {
    return getLogicalOffsetFromDomPoint(root, caretPosition.offsetNode, caretPosition.offset);
  }
  const range = doc.caretRangeFromPoint?.(clientX, clientY) ?? null;
  if (range) {
    return getLogicalOffsetFromDomPoint(root, range.startContainer, range.startOffset);
  }
  return getCurrentSelectionOffset(root);
}

function resetWorkspaceFileDragState() {
  workspaceFileDragDepth.value = 0;
  isWorkspaceFileDragOver.value = false;
}

function onComposerKeydown(event: KeyboardEvent) {
  const root = internalComposerInputRef.value;
  const selection = window.getSelection();
  const isCollapsed = Boolean(selection?.rangeCount && selection.getRangeAt(0).collapsed);

  if (isSkillPickerOpen.value && event.key === "Escape") {
    event.preventDefault();
    closeSkillPicker();
    return;
  }

  if (selectedMentionId.value && (event.key === "Backspace" || event.key === "Delete")) {
    event.preventDefault();
    const mentionIndex = getMentionIndexById(selectedMentionId.value);
    selectedMentionId.value = "";
    if (mentionIndex >= 0) removeMentionAtIndex(mentionIndex);
    return;
  }

  if (selectedMentionId.value && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    event.preventDefault();
    const mentionIndex = getMentionIndexById(selectedMentionId.value);
    if (mentionIndex < 0) {
      selectedMentionId.value = "";
      return;
    }
    const mentionOffset = findComposeFileTokenOffsetByMentionIndex(props.composeInput, mentionIndex);
    selectedMentionId.value = "";
    if (mentionOffset >= 0) {
      const nextOffset = event.key === "ArrowLeft" ? mentionOffset : mentionOffset + 1;
      focusComposerAtLogicalOffset(nextOffset);
    }
    return;
  }

  if (root && isCollapsed && (event.key === "Backspace" || event.key === "Delete")) {
    const caretOffset = getCurrentSelectionOffset(root);
    const tokenOffset = event.key === "Backspace" ? caretOffset - 1 : caretOffset;
    if (tokenOffset >= 0 && props.composeInput[tokenOffset] === COMPOSE_FILE_TOKEN_CHAR) {
      event.preventDefault();
      const mentionIndex = countComposeFileTokensBeforeOffset(props.composeInput, tokenOffset);
      removeMentionAtIndex(mentionIndex);
      return;
    }
  }

  if (event.key === "Enter" && event.shiftKey && !event.isComposing) {
    event.preventDefault();
    selectedMentionId.value = "";
    insertTextAtSelection("\n");
    syncComposeDraftFromDom();
    return;
  }

  if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) {
    selectedMentionId.value = "";
  }

  emit("composer-keydown", event);
}

function onComposerPaste(event: ClipboardEvent) {
  emit("composer-paste", event);
  if (event.defaultPrevented) return;

  const text = String(event.clipboardData?.getData("text/plain") ?? "");
  if (!text) return;

  event.preventDefault();
  selectedMentionId.value = "";
  insertTextAtSelection(text);
  syncComposeDraftFromDom();
}

function onComposerInput() {
  selectedMentionId.value = "";
  syncComposeDraftFromDom();
}

function onComposerInputMouseDown(event: MouseEvent) {
  const target =
    event.target instanceof Element ? event.target.closest<HTMLElement>("[data-compose-mention-id]") : null;
  if (!target) {
    if (selectedMentionId.value) {
      selectedMentionId.value = "";
      applySelectedMentionState();
    }
    return;
  }

  event.preventDefault();
  const mentionId = String(target.dataset.composeMentionId ?? "").trim();
  const mentionIndex = getMentionIndexById(mentionId);
  if (mentionIndex < 0) return;
  const mentionOffset = findComposeFileTokenOffsetByMentionIndex(props.composeInput, mentionIndex);
  selectedMentionId.value = mentionId;
  applySelectedMentionState();
  if (mentionOffset >= 0) focusComposerAtLogicalOffset(mentionOffset + 1);
}

function onComposerRootPointerDownCapture(event: PointerEvent) {
  emit("interact");
  if (props.variant !== "inline" || event.button !== 0) return;
  const input = internalComposerInputRef.value;
  const target = event.target instanceof Element ? event.target : null;
  if (!input || !target || input.contains(target)) return;
  if (!target.closest(".composer-toolbar")) return;
  event.preventDefault();
  isInputFocused.value = true;
}

function onComposerShellPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  const input = internalComposerInputRef.value;
  if (!input) return;

  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const interactiveSelector = [
    "button",
    "input",
    "select",
    "option",
    "a",
    '[role="combobox"]',
    '[role="button"]',
    '[role="menuitem"]',
    '[contenteditable="true"]',
  ].join(",");

  if (target.closest(interactiveSelector)) return;

  event.preventDefault();
  selectedMentionId.value = "";
  applySelectedMentionState();
  focusComposerAtLogicalOffset(String(props.composeInput ?? "").length);
}

function onComposerImageInputChange(event: Event) {
  emit("composer-image-change", event);
}

function onComposerDragEnter(event: DragEvent) {
  if (!hasWorkspaceFileDragData(event.dataTransfer)) return;
  event.preventDefault();
  workspaceFileDragDepth.value += 1;
  isWorkspaceFileDragOver.value = true;
}

function onComposerDragOver(event: DragEvent) {
  if (!hasWorkspaceFileDragData(event.dataTransfer)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  isWorkspaceFileDragOver.value = true;
}

function onComposerDragLeave(event: DragEvent) {
  if (!hasWorkspaceFileDragData(event.dataTransfer)) return;
  const currentTarget = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  if (currentTarget && event.relatedTarget instanceof Node && currentTarget.contains(event.relatedTarget)) return;
  workspaceFileDragDepth.value = Math.max(0, workspaceFileDragDepth.value - 1);
  if (workspaceFileDragDepth.value === 0) isWorkspaceFileDragOver.value = false;
}

function onComposerDrop(event: DragEvent) {
  if (!hasWorkspaceFileDragData(event.dataTransfer)) return;
  event.preventDefault();
  const files = readWorkspaceFileDragData(event.dataTransfer);
  resetWorkspaceFileDragState();
  if (files.length === 0) return;
  selectedMentionId.value = "";
  insertDroppedFiles(files, getCaretOffsetFromPoint(event.clientX, event.clientY));
}

function onPreviewAttachment(attachmentId: string) {
  emit("preview-attachment", attachmentId);
}

function onRemoveAttachment(attachmentId: string) {
  emit("remove-attachment", attachmentId);
}

watch(
  () => [props.composeInput, mentionSignature.value] as const,
  () => {
    syncDomFromProps();
  },
  { immediate: true, flush: "post" }
);

watch(selectedMentionId, () => {
  nextTick(() => applySelectedMentionState());
});
</script>
