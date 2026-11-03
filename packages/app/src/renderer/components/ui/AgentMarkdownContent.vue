<template>
  <div
    ref="rootRef"
    v-bind="$attrs"
    @click="onRootClick"
    @keydown="onRootKeydown"
    @pointerdown="onRootPointerDown"
    @pointermove="onRootPointerMove"
    @pointerup="onRootPointerUp"
    @pointercancel="onRootPointerUp"
    @wheel="onRootWheel"
  ></div>

  <Teleport to="body">
    <Transition name="composer-lightbox">
      <div
        v-if="lightboxSvgHtml"
        class="composer-lightbox-overlay"
        role="dialog"
        aria-modal="true"
        :aria-label="t('agentMarkdown.mermaidPreview')"
      >
        <div class="composer-lightbox-backdrop"></div>
        <div class="composer-lightbox-stage agent-mermaid-lightbox-stage" @click.self="closeMermaidLightbox">
          <div ref="lightboxPanelRef" class="agent-mermaid-lightbox-panel" tabindex="-1">
            <div class="agent-mermaid-lightbox-toolbar">
              <span class="agent-mermaid-lightbox-status">{{
                t("agentMarkdown.mermaidPreviewWithZoom", { percent: Math.round(lightboxUserZoom * 100) })
              }}</span>
              <button
                type="button"
                class="agent-mermaid-lightbox-copy"
                :class="{ 'is-success': lightboxCopyState === 'success', 'is-error': lightboxCopyState === 'error' }"
                :disabled="lightboxCopyBusy || !lightboxSource"
                @click="onMermaidLightboxCopyClick"
              >
                {{ copyButtonText(lightboxCopyState, t("agentMarkdown.copySource")) }}
              </button>
            </div>
            <div
              ref="lightboxRenderRef"
              class="agent-mermaid-lightbox-render app-scrollbar"
              :class="{ 'is-dragging': lightboxIsDragging }"
              @pointerdown="onMermaidLightboxPointerDown"
              @pointermove="onMermaidLightboxPointerMove"
              @pointerup="onMermaidLightboxPointerUp"
              @pointercancel="onMermaidLightboxPointerUp"
              @lostpointercapture="onMermaidLightboxPointerUp"
              @wheel="onMermaidLightboxWheel"
            >
              <div
                ref="lightboxContentRef"
                class="agent-mermaid-lightbox-content"
                :style="mermaidLightboxContentStyle"
                v-html="lightboxSvgHtml"
              ></div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  normalizeMermaidError,
  readMermaidTone,
  renderMermaidDiagram,
  type MermaidTone,
} from "../../features/timeline/mermaidRenderer";
import { subscribeMermaidTone } from "../../features/timeline/mermaidToneSubscription";
import {
  highlightCodeTokens,
  normalizeCodeLanguage,
  type SyntaxHighlightToken,
} from "../../features/timeline/renderModel/codeSyntaxHighlight";
import {
  isPathLikeStrict,
  parsePathToken,
  summarizeParsedPath,
  tokenizePathLikeText,
} from "../../domain/pathHighlight";
import { showToast } from "../../ui/toast";

defineOptions({
  inheritAttrs: false,
});

const props = defineProps<{
  html: string;
}>();

const { t } = useI18n();
const rootRef = ref<HTMLElement | null>(null);
const lightboxPanelRef = ref<HTMLElement | null>(null);
const lightboxRenderRef = ref<HTMLElement | null>(null);
const lightboxContentRef = ref<HTMLElement | null>(null);
const lightboxSvgHtml = ref("");
const lightboxSource = ref("");
const lightboxCopyState = ref<CopyButtonState>("idle");
const lightboxCopyBusy = ref(false);
const tone = ref<MermaidTone>(readMermaidTone());

const MERMAID_RENDER_DEBOUNCE_MS = 160;
const MERMAID_LAYOUT_DEBOUNCE_MS = 32;
const MERMAID_MAX_HEIGHT_PX = 420;
const MERMAID_LIGHTBOX_BUTTON_THRESHOLD = 0.85;
const MERMAID_VIEWPORT_MARGIN_PX = 260;
const MERMAID_LIGHTBOX_ZOOM_MIN = 0.25;
const MERMAID_LIGHTBOX_ZOOM_MAX = 4;
const MERMAID_LIGHTBOX_ZOOM_SENSITIVITY = 0.0015;
const MERMAID_INLINE_ZOOM_MIN = 0.25;
const MERMAID_INLINE_ZOOM_MAX = 4;
const MERMAID_INLINE_ZOOM_SENSITIVITY = 0.0015;
const MERMAID_WHEEL_LINE_HEIGHT_PX = 16;
const CODE_COPY_FEEDBACK_RESET_MS = 1600;
// 语法高亮/路径高亮会遍历整棵 DOM，流式期间按稳定间隔节流执行。
const ENHANCE_THROTTLE_MS = 220;
type CopyButtonState = "idle" | "success" | "error";

let unsubscribeTone: (() => void) | null = null;
let viewportObserver: IntersectionObserver | null = null;
let rootResizeObserver: ResizeObserver | null = null;
let renderTimer: ReturnType<typeof setTimeout> | null = null;
let layoutTimer: ReturnType<typeof setTimeout> | null = null;
let enhanceTimer: ReturnType<typeof setTimeout> | null = null;
let htmlSyncDeferred = false;
let lightboxLayoutTimer: ReturnType<typeof setTimeout> | null = null;
let lightboxCopyResetTimer: ReturnType<typeof setTimeout> | null = null;
let renderTaskSeq = 0;
let codeHighlightTaskSeq = 0;
let lightboxTaskSeq = 0;
const lightboxUserZoom = ref(1);
const lightboxPanX = ref(0);
const lightboxPanY = ref(0);
const lightboxIsDragging = ref(false);
const componentUid = String(getCurrentInstance()?.uid ?? `fallback-${Math.random().toString(36).slice(2)}`);
const mermaidLightboxContentStyle = computed(() => ({
  transform: `translate3d(${lightboxPanX.value}px, ${lightboxPanY.value}px, 0) scale(${lightboxUserZoom.value})`,
}));
let frozenMermaidBlocks = new Map<string, HTMLElement>();
let mermaidFailureByKey = new Map<string, string>();
let mermaidSourceByKey = new Map<string, string>();
let codeCopyResetTimerByButton = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>();
const isInViewport = ref(true);

let lightboxDragPointerId: number | null = null;
let lightboxDragStartClientX = 0;
let lightboxDragStartClientY = 0;
let lightboxDragStartPanX = 0;
let lightboxDragStartPanY = 0;
let mermaidDragViewport: HTMLElement | null = null;
let mermaidDragPointerId: number | null = null;
let mermaidDragStartClientX = 0;
let mermaidDragStartClientY = 0;
let mermaidDragStartScrollLeft = 0;
let mermaidDragStartScrollTop = 0;

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeWheelDeltaPx(event: WheelEvent, pageHeight: number) {
  if (event.deltaMode === 1) return event.deltaY * MERMAID_WHEEL_LINE_HEIGHT_PX;
  if (event.deltaMode === 2) return event.deltaY * Math.max(220, pageHeight);
  return event.deltaY;
}

function readMermaidBlockUserZoom(block: HTMLElement) {
  const zoom = Number(block.dataset.agentMermaidZoom ?? "");
  return clampNumber(Number.isFinite(zoom) && zoom > 0 ? zoom : 1, MERMAID_INLINE_ZOOM_MIN, MERMAID_INLINE_ZOOM_MAX);
}

function writeMermaidBlockUserZoom(block: HTMLElement, zoom: number) {
  block.dataset.agentMermaidZoom = String(clampNumber(zoom, MERMAID_INLINE_ZOOM_MIN, MERMAID_INLINE_ZOOM_MAX));
}

function clearRenderTimer() {
  if (renderTimer == null) return;
  clearTimeout(renderTimer);
  renderTimer = null;
}

function clearLayoutTimer() {
  if (layoutTimer == null) return;
  clearTimeout(layoutTimer);
  layoutTimer = null;
}

function clearLightboxLayoutTimer() {
  if (lightboxLayoutTimer == null) return;
  clearTimeout(lightboxLayoutTimer);
  lightboxLayoutTimer = null;
}

function clearLightboxCopyResetTimer() {
  if (lightboxCopyResetTimer == null) return;
  clearTimeout(lightboxCopyResetTimer);
  lightboxCopyResetTimer = null;
}

function clearCodeCopyResetTimer(button: HTMLButtonElement) {
  const timer = codeCopyResetTimerByButton.get(button);
  if (timer == null) return;
  clearTimeout(timer);
  codeCopyResetTimerByButton.delete(button);
}

function clearAllCodeCopyResetTimers() {
  codeCopyResetTimerByButton.forEach((timer) => clearTimeout(timer));
  codeCopyResetTimerByButton.clear();
}

function clearMermaidDragState() {
  if (mermaidDragViewport instanceof HTMLElement) {
    mermaidDragViewport.classList.remove("is-dragging");
    if (mermaidDragPointerId != null && mermaidDragViewport.hasPointerCapture(mermaidDragPointerId)) {
      try {
        mermaidDragViewport.releasePointerCapture(mermaidDragPointerId);
      } catch {}
    }
  }
  mermaidDragViewport = null;
  mermaidDragPointerId = null;
}

function readCodeLanguageRaw(codeElement: HTMLElement) {
  const languageClass = [...codeElement.classList].find(
    (className) => className.startsWith("language-") && className.length > 9
  );
  const fromClass = languageClass ? languageClass.slice("language-".length).trim() : "";
  const fromData = String(codeElement.getAttribute("data-language") ?? "").trim();
  return String(fromData || fromClass).trim();
}

function readCodeLanguageLabel(codeElement: HTMLElement) {
  const raw = readCodeLanguageRaw(codeElement).toUpperCase();
  if (!raw) return "CODE";
  if (/^[A-Z0-9+#._-]{1,28}$/.test(raw)) return raw;
  return "CODE";
}

function readCopyIdleLabel(button: HTMLButtonElement) {
  const raw = String(button.dataset.agentCopyIdleLabel ?? "").trim();
  return raw || t("agentMarkdown.copyCode");
}

function copyButtonText(state: CopyButtonState, idleLabel: string) {
  if (state === "success") return t("clipboard.copied");
  if (state === "error") return t("clipboard.copyFailed");
  return idleLabel;
}

function setCopyButtonState(button: HTMLButtonElement, state: CopyButtonState) {
  button.dataset.agentCodeCopyState = state;
  button.classList.toggle("is-success", state === "success");
  button.classList.toggle("is-error", state === "error");
  button.textContent = copyButtonText(state, readCopyIdleLabel(button));
}

function scheduleCodeCopyButtonReset(button: HTMLButtonElement) {
  clearCodeCopyResetTimer(button);
  const timer = setTimeout(() => {
    codeCopyResetTimerByButton.delete(button);
    if (!button.isConnected) return;
    setCopyButtonState(button, "idle");
  }, CODE_COPY_FEEDBACK_RESET_MS);
  codeCopyResetTimerByButton.set(button, timer);
}

function scheduleLightboxCopyReset() {
  clearLightboxCopyResetTimer();
  lightboxCopyResetTimer = setTimeout(() => {
    lightboxCopyResetTimer = null;
    lightboxCopyState.value = "idle";
  }, CODE_COPY_FEEDBACK_RESET_MS);
}

async function copyTextToClipboard(text: string) {
  const source = String(text ?? "");
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(source);
    return;
  }
  if (typeof document === "undefined") {
    throw new Error(t("clipboard.unavailable"));
  }
  const textarea = document.createElement("textarea");
  textarea.value = source;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  const host = document.body ?? document.documentElement;
  host.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const ok = document.execCommand("copy");
    if (!ok) throw new Error(t("clipboard.copyFailed"));
  } finally {
    textarea.remove();
  }
}

function enhanceCodeCopyButtons(host: HTMLElement) {
  const codeBlocks = [...host.querySelectorAll<HTMLElement>("pre > code")];
  for (const codeElement of codeBlocks) {
    const preElement = codeElement.closest("pre");
    if (!(preElement instanceof HTMLElement)) continue;
    preElement.classList.add("app-scrollbar");
    const existed = preElement.querySelector("[data-agent-code-role='toolbar']");
    if (existed) continue;

    const toolbar = document.createElement("div");
    toolbar.className = "agent-code-toolbar";
    toolbar.dataset.agentCodeRole = "toolbar";

    const language = document.createElement("span");
    language.className = "agent-code-language";
    language.textContent = readCodeLanguageLabel(codeElement);

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "agent-code-copy";
    copyButton.dataset.agentCodeAction = "copy";
    copyButton.setAttribute("aria-label", t("agentMarkdown.copyCode"));
    copyButton.dataset.agentCopyIdleLabel = t("agentMarkdown.copyCode");
    setCopyButtonState(copyButton, "idle");

    toolbar.append(language, copyButton);
    preElement.append(toolbar);
  }
}

function toCssPropertyName(property: string) {
  return property.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function appendSyntaxHighlightToken(parent: HTMLElement, token: SyntaxHighlightToken) {
  if (Object.keys(token.style).length === 0) {
    parent.append(document.createTextNode(token.content));
    return;
  }
  const span = document.createElement("span");
  span.textContent = token.content;
  for (const [property, value] of Object.entries(token.style)) {
    span.style.setProperty(toCssPropertyName(property), value);
  }
  parent.append(span);
}

function replaceCodeElementWithHighlightedTokens(codeElement: HTMLElement, lines: SyntaxHighlightToken[][]) {
  const fragment = document.createDocumentFragment();
  for (const [lineIndex, line] of lines.entries()) {
    if (lineIndex > 0) fragment.append(document.createTextNode("\n"));
    for (const token of line) {
      const spanHost = document.createElement("span");
      appendSyntaxHighlightToken(spanHost, token);
      fragment.append(...Array.from(spanHost.childNodes));
    }
  }
  codeElement.replaceChildren(fragment);
  codeElement.dataset.agentSyntaxHighlighted = "true";
}

async function enhanceSyntaxHighlightedCodeBlocks(host: HTMLElement, seq: number) {
  const codeBlocks = [...host.querySelectorAll<HTMLElement>("pre > code")];
  for (const codeElement of codeBlocks) {
    if (seq !== codeHighlightTaskSeq) return;
    if (codeElement.classList.contains("language-mermaid")) continue;
    if (codeElement.dataset.agentSyntaxHighlighted === "true") continue;

    const language = readCodeLanguageRaw(codeElement);
    if (normalizeCodeLanguage(language) === "text") continue;

    const source = String(codeElement.textContent ?? "");
    if (!source) continue;

    const lines = await highlightCodeTokens({ code: source, language, tone: tone.value });
    if (seq !== codeHighlightTaskSeq) return;
    if (!codeElement.isConnected) continue;
    if (lines.length === 0) continue;

    replaceCodeElementWithHighlightedTokens(codeElement, lines);
  }
}

function scheduleEnhanceSyntaxHighlightedCodeBlocks(host: HTMLElement) {
  codeHighlightTaskSeq += 1;
  const seq = codeHighlightTaskSeq;
  void enhanceSyntaxHighlightedCodeBlocks(host, seq);
}

function hasInlinePathForbiddenAncestor(node: Node): boolean {
  let current = node.parentElement;
  while (current) {
    const tag = current.tagName;
    if (tag === "CODE" || tag === "PRE" || tag === "A" || tag === "SVG") return true;
    if (current.classList.contains("agent-mermaid-block")) return true;
    current = current.parentElement;
  }
  return false;
}

function readHasSelection(): boolean {
  try {
    const sel = window.getSelection?.();
    if (!sel) return false;
    const text = sel.toString();
    return Boolean(text && text.trim());
  } catch {
    return false;
  }
}

type PathCandidateFromTextNode = {
  node: Text;
  tokens: ReturnType<typeof tokenizePathLikeText>;
  pathValues: string[];
};

function enhanceInlinePathHighlights(host: HTMLElement) {
  if (typeof document === "undefined") return;
  if (typeof NodeFilter === "undefined") return;

  const parsedByFull = new Map<string, ReturnType<typeof parsePathToken>>();
  const basenameCount = new Map<string, number>();

  const noteBasename = (full: string) => {
    const parsed = parsePathToken(full);
    if (!parsed) return;
    parsedByFull.set(full, parsed);
    const key = parsed.basename.toLowerCase();
    basenameCount.set(key, (basenameCount.get(key) ?? 0) + 1);
  };

  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const textCandidates: PathCandidateFromTextNode[] = [];
  while (true) {
    const node = walker.nextNode();
    if (!node) break;
    if (!(node instanceof Text)) continue;
    const value = String(node.nodeValue ?? "");
    if (!value) continue;
    if (!value.includes("/") && !value.includes("\\")) continue;
    if (hasInlinePathForbiddenAncestor(node)) continue;
    const tokens = tokenizePathLikeText(value);
    const pathValues = tokens.filter((t) => t.kind === "path").map((t) => t.value);
    if (pathValues.length === 0) continue;
    for (const full of pathValues) noteBasename(full);
    textCandidates.push({ node, tokens, pathValues });
  }

  const inlineCodeCandidates = [
    ...host.querySelectorAll<HTMLElement>("code:not(pre code):not(.agent-inline-path)"),
  ].filter((node) => !node.closest(".agent-mermaid-block"));
  for (const code of inlineCodeCandidates) {
    const raw = String(code.textContent ?? "").trim();
    if (!raw) continue;
    if (!isPathLikeStrict(raw)) continue;
    noteBasename(raw);
  }

  const segmentCountFor = (full: string): number => {
    const parsed = parsedByFull.get(full);
    if (!parsed) return 1;
    const key = parsed.basename.toLowerCase();
    const collisions = basenameCount.get(key) ?? 0;
    if (collisions <= 1) return 1;
    if (parsed.segments.length >= 3) return 2;
    return 1;
  };

  for (const code of inlineCodeCandidates) {
    const raw = String(code.textContent ?? "").trim();
    if (!raw) continue;
    if (!isPathLikeStrict(raw)) continue;
    const parsed = parsedByFull.get(raw);
    if (!parsed) continue;
    const segments = segmentCountFor(raw);
    const display = summarizeParsedPath(parsed, segments);
    code.classList.add("agent-inline-path");
    code.dataset.agentPathFull = parsed.full;
    code.setAttribute("role", "button");
    code.setAttribute("tabindex", "0");
    code.textContent = display;
  }

  for (const candidate of textCandidates) {
    const fragment = document.createDocumentFragment();
    for (const token of candidate.tokens) {
      if (!token.value) continue;
      if (token.kind === "path") {
        const parsed = parsedByFull.get(token.value);
        if (!parsed) {
          fragment.append(document.createTextNode(token.value));
          continue;
        }
        const segments = segmentCountFor(token.value);
        const display = summarizeParsedPath(parsed, segments);
        const code = document.createElement("code");
        code.className = "agent-inline-path";
        code.dataset.agentPathFull = parsed.full;
        code.setAttribute("role", "button");
        code.setAttribute("tabindex", "0");
        code.textContent = display;
        fragment.append(code);
        continue;
      }
      fragment.append(document.createTextNode(token.value));
    }
    const parent = candidate.node.parentNode;
    if (!parent) continue;
    parent.replaceChild(fragment, candidate.node);
  }
}

async function onCodeCopyAction(button: HTMLButtonElement) {
  const preElement = button.closest("pre");
  const codeElement = preElement?.querySelector<HTMLElement>("code");
  const source = String(codeElement?.textContent ?? "");
  if (!source) {
    setCopyButtonState(button, "error");
    scheduleCodeCopyButtonReset(button);
    return;
  }

  button.disabled = true;
  try {
    await copyTextToClipboard(source);
    setCopyButtonState(button, "success");
  } catch {
    setCopyButtonState(button, "error");
  } finally {
    button.disabled = false;
    scheduleCodeCopyButtonReset(button);
  }
}

async function onMermaidBlockCopyAction(button: HTMLButtonElement) {
  const block = button.closest<HTMLElement>(".agent-mermaid-block");
  const blockKey = String(block?.dataset.agentMermaidKey ?? "").trim();
  const source = blockKey ? String(mermaidSourceByKey.get(blockKey) ?? "") : "";
  if (!source) {
    setCopyButtonState(button, "error");
    scheduleCodeCopyButtonReset(button);
    return;
  }

  button.disabled = true;
  try {
    await copyTextToClipboard(source);
    setCopyButtonState(button, "success");
  } catch {
    setCopyButtonState(button, "error");
  } finally {
    button.disabled = false;
    scheduleCodeCopyButtonReset(button);
  }
}

async function onMermaidLightboxCopyClick() {
  if (lightboxCopyBusy.value) return;
  const source = String(lightboxSource.value ?? "").trim();
  if (!source) {
    lightboxCopyState.value = "error";
    scheduleLightboxCopyReset();
    return;
  }

  lightboxCopyBusy.value = true;
  try {
    await copyTextToClipboard(source);
    lightboxCopyState.value = "success";
  } catch {
    lightboxCopyState.value = "error";
  } finally {
    lightboxCopyBusy.value = false;
    scheduleLightboxCopyReset();
  }
}

function fnv1a32Hex(text: string) {
  // Simple, fast, synchronous hash for stable keys (avoid embedding the full source in DOM).
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function createMermaidBlockKey(source: string, occurrence: number) {
  const hash = fnv1a32Hex(source);
  return `m:${occurrence}:${source.length}:${hash}`;
}

function readIsInViewport(element: HTMLElement) {
  if (typeof window === "undefined") return true;
  const rect = element.getBoundingClientRect();
  const viewHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const margin = MERMAID_VIEWPORT_MARGIN_PX;
  return rect.bottom >= -margin && rect.top <= viewHeight + margin;
}

function clearFrozenMermaidBlocks() {
  frozenMermaidBlocks.clear();
}

function clearMermaidFailures() {
  mermaidFailureByKey.clear();
}

function syncRenderedHtml() {
  const host = rootRef.value;
  if (!host) return;
  clearMermaidDragState();
  clearAllCodeCopyResetTimers();

  // Keep diagram SVG blocks stable while the parent HTML updates (streaming output).
  const template = document.createElement("div");
  template.innerHTML = props.html;

  const nextFrozenMermaidBlocks = new Map<string, HTMLElement>();
  const nextMermaidFailures = new Map<string, string>();
  const nextMermaidSources = new Map<string, string>();
  const sourceOccurrences = new Map<string, number>();
  const mermaidCodeBlocks = [...template.querySelectorAll<HTMLElement>("pre > code.language-mermaid")];

  for (const codeElement of mermaidCodeBlocks) {
    const preElement = codeElement.closest("pre");
    if (!(preElement instanceof HTMLElement)) continue;

    const source = String(codeElement.textContent ?? "").trim();
    if (!source) continue;

    const occurrence = (sourceOccurrences.get(source) ?? 0) + 1;
    sourceOccurrences.set(source, occurrence);

    const blockKey = createMermaidBlockKey(source, occurrence);
    nextMermaidSources.set(blockKey, source);
    const frozenBlock = frozenMermaidBlocks.get(blockKey);
    if (frozenBlock) {
      nextFrozenMermaidBlocks.set(blockKey, frozenBlock);
      preElement.replaceWith(frozenBlock);
      continue;
    }

    preElement.dataset.agentMermaidKey = blockKey;

    const failure = mermaidFailureByKey.get(blockKey);
    if (failure) {
      nextMermaidFailures.set(blockKey, failure);
      preElement.insertAdjacentElement("beforebegin", createMermaidErrorElement(failure));
    }
  }

  host.replaceChildren(...Array.from(template.childNodes));
  frozenMermaidBlocks = nextFrozenMermaidBlocks;
  mermaidFailureByKey = nextMermaidFailures;
  mermaidSourceByKey = nextMermaidSources;
  enhanceCodeCopyButtons(host);
  htmlSyncDeferred = false;
  scheduleDeferredEnhancements();
}

// 只对可见内容做高亮增强：离屏消息在进入视口时再补一次。
function runDeferredEnhancements() {
  const host = rootRef.value;
  if (!host || !isInViewport.value) return;
  scheduleEnhanceSyntaxHighlightedCodeBlocks(host);
  enhanceInlinePathHighlights(host);
}

function clearEnhanceTimer() {
  if (enhanceTimer == null) return;
  clearTimeout(enhanceTimer);
  enhanceTimer = null;
}

function scheduleDeferredEnhancements() {
  if (typeof window === "undefined") return;
  // 已有待执行任务时不再重置计时器，否则持续流式输出会一直饿死高亮。
  if (enhanceTimer != null) return;
  enhanceTimer = window.setTimeout(() => {
    enhanceTimer = null;
    runDeferredEnhancements();
  }, ENHANCE_THROTTLE_MS);
}

function createMermaidErrorElement(detail: string) {
  const element = document.createElement("div");
  element.className = "agent-mermaid-error";
  const normalized = String(detail ?? "").trim();
  element.textContent = normalized
    ? t("agentMarkdown.mermaidRenderFailedWithDetail", { detail: normalized })
    : t("agentMarkdown.mermaidRenderFailedFallback");
  return element;
}

function createMermaidRenderElement(svg: string, blockKey?: string) {
  const block = document.createElement("div");
  block.className = "agent-mermaid-block";
  block.dataset.agentMermaidZoom = "1";
  if (blockKey) block.dataset.agentMermaidKey = blockKey;

  const toolbar = document.createElement("div");
  toolbar.className = "agent-mermaid-toolbar";

  const status = document.createElement("span");
  status.className = "agent-mermaid-status";
  status.dataset.agentMermaidRole = "status";
  status.textContent = t("agentMarkdown.mermaidDiagram");

  const actions = document.createElement("div");
  actions.className = "agent-mermaid-actions";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "agent-mermaid-copy";
  copyButton.dataset.agentMermaidAction = "copy";
  copyButton.dataset.agentCopyIdleLabel = t("agentMarkdown.copySource");
  copyButton.setAttribute("aria-label", t("agentMarkdown.copyMermaidSource"));
  setCopyButtonState(copyButton, "idle");

  const expandButton = document.createElement("button");
  expandButton.type = "button";
  expandButton.className = "agent-mermaid-expand";
  expandButton.dataset.agentMermaidAction = "lightbox";
  expandButton.hidden = true;
  expandButton.textContent = t("agentMarkdown.zoomInView");

  actions.append(copyButton, expandButton);
  toolbar.append(status, actions);

  const viewport = document.createElement("div");
  viewport.className = "agent-mermaid-viewport app-scrollbar";

  const body = document.createElement("div");
  body.className = "agent-mermaid-render";
  body.innerHTML = svg;

  viewport.append(body);
  block.append(toolbar, viewport);
  return block;
}

function readSvgDimensions(svg: SVGSVGElement) {
  const cachedWidth = Number(svg.dataset.agentMermaidWidth ?? "");
  const cachedHeight = Number(svg.dataset.agentMermaidHeight ?? "");
  if (cachedWidth > 0 && cachedHeight > 0) {
    return { width: cachedWidth, height: cachedHeight };
  }

  let width = 0;
  let height = 0;

  const viewBox = String(svg.getAttribute("viewBox") ?? "").trim();
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map((value) => Number(value));
    if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3])) {
      width = parts[2];
      height = parts[3];
    }
  }

  if (!(width > 0 && height > 0)) {
    const parsedWidth = Number.parseFloat(String(svg.getAttribute("width") ?? ""));
    const parsedHeight = Number.parseFloat(String(svg.getAttribute("height") ?? ""));
    if (Number.isFinite(parsedWidth) && Number.isFinite(parsedHeight) && parsedWidth > 0 && parsedHeight > 0) {
      width = parsedWidth;
      height = parsedHeight;
    }
  }

  if (!(width > 0 && height > 0)) return null;

  svg.dataset.agentMermaidWidth = String(width);
  svg.dataset.agentMermaidHeight = String(height);
  return { width, height };
}

function applySvgDimensions(svg: SVGSVGElement, width: number, height: number) {
  const nextWidth = `${Math.max(1, Math.round(width * 100) / 100)}px`;
  const nextHeight = `${Math.max(1, Math.round(height * 100) / 100)}px`;
  svg.style.width = nextWidth;
  svg.style.height = nextHeight;
  svg.style.maxWidth = "none";
  svg.style.maxHeight = "none";
  svg.setAttribute("width", nextWidth);
  svg.setAttribute("height", nextHeight);
}

function layoutMermaidBlock(block: HTMLElement) {
  const viewport = block.querySelector<HTMLElement>(".agent-mermaid-viewport");
  const render = block.querySelector<HTMLElement>(".agent-mermaid-render");
  const svg = render?.querySelector<SVGSVGElement>("svg");
  if (!(viewport instanceof HTMLElement) || !(render instanceof HTMLElement) || !(svg instanceof SVGSVGElement)) return;

  const dimensions = readSvgDimensions(svg);
  if (!dimensions) return;

  const availableWidth = Math.max(180, viewport.clientWidth - 8);
  const availableHeight = MERMAID_MAX_HEIGHT_PX;
  const fitScale = Math.min(availableWidth / dimensions.width, availableHeight / dimensions.height, 1);
  const userZoom = readMermaidBlockUserZoom(block);
  const effectiveScale = fitScale * userZoom;
  const targetWidth = dimensions.width * effectiveScale;
  const targetHeight = dimensions.height * effectiveScale;

  applySvgDimensions(svg, targetWidth, targetHeight);
  render.style.width = `${targetWidth}px`;
  render.style.height = `${targetHeight}px`;

  const status = block.querySelector<HTMLElement>("[data-agent-mermaid-role='status']");
  if (status) {
    const fitText =
      fitScale < 0.999
        ? t("agentMarkdown.fitPercent", { percent: Math.round(fitScale * 100) })
        : t("agentMarkdown.originalSize");
    status.textContent =
      userZoom === 1 ? fitText : t("agentMarkdown.fitAndZoom", { fit: fitText, percent: Math.round(userZoom * 100) });
  }

  const expandButton = block.querySelector<HTMLButtonElement>("[data-agent-mermaid-action='lightbox']");
  if (expandButton) {
    const shouldShow = fitScale < MERMAID_LIGHTBOX_BUTTON_THRESHOLD;
    expandButton.hidden = !shouldShow;
  }
}

function layoutMermaidBlocks(host: HTMLElement) {
  host.querySelectorAll<HTMLElement>(".agent-mermaid-block").forEach((block) => {
    layoutMermaidBlock(block);
  });
}

function scheduleLayoutMermaidBlocks() {
  const host = rootRef.value;
  if (!host) return;
  if (!isInViewport.value) return;
  clearLayoutTimer();
  layoutTimer = setTimeout(() => {
    layoutTimer = null;
    layoutMermaidBlocks(host);
  }, MERMAID_LAYOUT_DEBOUNCE_MS);
}

function layoutMermaidLightbox() {
  const panel = lightboxPanelRef.value;
  const render = lightboxRenderRef.value;
  const content = lightboxContentRef.value;
  const svg = content?.querySelector<SVGSVGElement>("svg");
  if (!(panel instanceof HTMLElement) || !(render instanceof HTMLElement) || !(svg instanceof SVGSVGElement)) return;

  const dimensions = readSvgDimensions(svg);
  if (!dimensions) return;

  const availableWidth = Math.max(240, panel.clientWidth - 32);
  const availableHeight = Math.max(220, panel.clientHeight - 32);
  const fitScale = Math.min(availableWidth / dimensions.width, availableHeight / dimensions.height, 1);

  applySvgDimensions(svg, dimensions.width * fitScale, dimensions.height * fitScale);
}

function scheduleMermaidLightboxLayout() {
  if (!lightboxSvgHtml.value) return;
  clearLightboxLayoutTimer();
  lightboxLayoutTimer = setTimeout(() => {
    lightboxLayoutTimer = null;
    void nextTick(() => layoutMermaidLightbox());
  }, MERMAID_LAYOUT_DEBOUNCE_MS);
}

function closeMermaidLightbox() {
  lightboxTaskSeq += 1;
  lightboxIsDragging.value = false;
  lightboxDragPointerId = null;
  lightboxPanX.value = 0;
  lightboxPanY.value = 0;
  clearLightboxCopyResetTimer();
  lightboxCopyBusy.value = false;
  lightboxCopyState.value = "idle";
  lightboxSource.value = "";
  lightboxSvgHtml.value = "";
}

async function openMermaidLightbox(source: string) {
  const nextSeq = lightboxTaskSeq + 1;
  lightboxTaskSeq = nextSeq;
  lightboxUserZoom.value = 1;
  lightboxPanX.value = 0;
  lightboxPanY.value = 0;
  clearLightboxCopyResetTimer();
  lightboxCopyBusy.value = false;
  lightboxCopyState.value = "idle";
  lightboxSource.value = source;
  // Ensure the overlay is visible immediately, but avoid duplicating SVG ids by re-rendering from source.
  lightboxSvgHtml.value = `<div class="mono dim">${t("agentMarkdown.mermaidRendering")}</div>`;
  await nextTick();
  if (nextSeq !== lightboxTaskSeq) return;
  lightboxPanelRef.value?.focus();
  scheduleMermaidLightboxLayout();

  try {
    const svg = await renderMermaidDiagram({
      id: `agent-mermaid-lightbox-${componentUid}-${nextSeq}-${Date.now()}`,
      source,
      tone: tone.value,
    });
    if (nextSeq !== lightboxTaskSeq) return;
    lightboxSvgHtml.value = svg;
    void nextTick(() => layoutMermaidLightbox());
  } catch (error) {
    if (nextSeq !== lightboxTaskSeq) return;
    const detail = normalizeMermaidError(error);
    lightboxSvgHtml.value = createMermaidErrorElement(detail).outerHTML;
  }
}

function onMermaidLightboxWheel(event: WheelEvent) {
  if (!lightboxSvgHtml.value) return;

  const render = lightboxRenderRef.value;
  if (!(render instanceof HTMLElement)) return;
  const content = lightboxContentRef.value;
  if (!(content instanceof HTMLElement)) return;

  const previousZoom = clampNumber(lightboxUserZoom.value, MERMAID_LIGHTBOX_ZOOM_MIN, MERMAID_LIGHTBOX_ZOOM_MAX);
  const deltaPx = normalizeWheelDeltaPx(event, render.clientHeight);
  if (!Number.isFinite(deltaPx) || deltaPx === 0) return;

  event.preventDefault();
  event.stopPropagation();

  const factor = Math.exp(-deltaPx * MERMAID_LIGHTBOX_ZOOM_SENSITIVITY);
  if (!Number.isFinite(factor) || factor <= 0) return;
  const nextZoom = clampNumber(previousZoom * factor, MERMAID_LIGHTBOX_ZOOM_MIN, MERMAID_LIGHTBOX_ZOOM_MAX);
  if (Math.abs(nextZoom - previousZoom) < 0.0001) return;

  const renderRect = render.getBoundingClientRect();
  const pointerX = event.clientX - (renderRect.left + renderRect.width / 2);
  const pointerY = event.clientY - (renderRect.top + renderRect.height / 2);
  const zoomRatio = nextZoom / previousZoom;

  lightboxPanX.value = pointerX - (pointerX - lightboxPanX.value) * zoomRatio;
  lightboxPanY.value = pointerY - (pointerY - lightboxPanY.value) * zoomRatio;
  lightboxUserZoom.value = nextZoom;
}

function onMermaidLightboxPointerDown(event: PointerEvent) {
  if (!lightboxSvgHtml.value) return;
  if (event.button !== 0) return;

  const render = lightboxRenderRef.value;
  if (!(render instanceof HTMLElement)) return;

  event.preventDefault();

  lightboxIsDragging.value = true;
  lightboxDragPointerId = event.pointerId;
  lightboxDragStartClientX = event.clientX;
  lightboxDragStartClientY = event.clientY;
  lightboxDragStartPanX = lightboxPanX.value;
  lightboxDragStartPanY = lightboxPanY.value;

  try {
    if (!render.hasPointerCapture(event.pointerId)) render.setPointerCapture(event.pointerId);
  } catch {}
}

function onMermaidLightboxPointerMove(event: PointerEvent) {
  if (!lightboxIsDragging.value) return;
  if (lightboxDragPointerId != null && event.pointerId !== lightboxDragPointerId) return;

  const render = lightboxRenderRef.value;
  if (!(render instanceof HTMLElement)) return;

  event.preventDefault();

  const dx = event.clientX - lightboxDragStartClientX;
  const dy = event.clientY - lightboxDragStartClientY;
  lightboxPanX.value = lightboxDragStartPanX + dx;
  lightboxPanY.value = lightboxDragStartPanY + dy;
}

function onMermaidLightboxPointerUp(event: PointerEvent) {
  if (!lightboxIsDragging.value) return;
  if (lightboxDragPointerId != null && event.pointerId !== lightboxDragPointerId) return;

  const render = lightboxRenderRef.value;
  if (render instanceof HTMLElement) {
    if (lightboxDragPointerId != null && render.hasPointerCapture(lightboxDragPointerId)) {
      try {
        render.releasePointerCapture(lightboxDragPointerId);
      } catch {}
    }
  }

  event.preventDefault();

  lightboxIsDragging.value = false;
  lightboxDragPointerId = null;
}

function findMermaidViewportFromTarget(target: EventTarget | null) {
  return target instanceof HTMLElement ? target.closest<HTMLElement>(".agent-mermaid-viewport") : null;
}

function onRootWheel(event: WheelEvent) {
  const viewport = findMermaidViewportFromTarget(event.target);
  if (!(viewport instanceof HTMLElement)) return;

  const block = viewport.closest<HTMLElement>(".agent-mermaid-block");
  const render = viewport.querySelector<HTMLElement>(".agent-mermaid-render");
  const svg = render?.querySelector<SVGSVGElement>("svg");
  if (!(block instanceof HTMLElement) || !(render instanceof HTMLElement) || !(svg instanceof SVGSVGElement)) return;

  const previousZoom = readMermaidBlockUserZoom(block);
  const deltaPx = normalizeWheelDeltaPx(event, viewport.clientHeight);
  if (!Number.isFinite(deltaPx) || deltaPx === 0) return;

  const factor = Math.exp(-deltaPx * MERMAID_INLINE_ZOOM_SENSITIVITY);
  if (!Number.isFinite(factor) || factor <= 0) return;
  const nextZoom = clampNumber(previousZoom * factor, MERMAID_INLINE_ZOOM_MIN, MERMAID_INLINE_ZOOM_MAX);
  if (Math.abs(nextZoom - previousZoom) < 0.0001) return;

  event.preventDefault();
  event.stopPropagation();

  const viewportRect = viewport.getBoundingClientRect();
  const svgRect = svg.getBoundingClientRect();
  const pointerViewportX = event.clientX - viewportRect.left;
  const pointerViewportY = event.clientY - viewportRect.top;
  const pointerLocalX = event.clientX - svgRect.left;
  const pointerLocalY = event.clientY - svgRect.top;
  const zoomRatio = nextZoom / previousZoom;

  writeMermaidBlockUserZoom(block, nextZoom);
  layoutMermaidBlock(block);

  const nextSvgRect = svg.getBoundingClientRect();
  const svgOriginX = nextSvgRect.left - viewportRect.left + viewport.scrollLeft;
  const svgOriginY = nextSvgRect.top - viewportRect.top + viewport.scrollTop;
  const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  const nextScrollLeft = svgOriginX + pointerLocalX * zoomRatio - pointerViewportX;
  const nextScrollTop = svgOriginY + pointerLocalY * zoomRatio - pointerViewportY;

  viewport.scrollLeft = clampNumber(nextScrollLeft, 0, maxScrollLeft);
  viewport.scrollTop = clampNumber(nextScrollTop, 0, maxScrollTop);
}

function onRootPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  if (event.isPrimary === false) return;

  const viewport = findMermaidViewportFromTarget(event.target);
  if (!(viewport instanceof HTMLElement)) return;

  event.preventDefault();
  event.stopPropagation();

  mermaidDragViewport = viewport;
  mermaidDragPointerId = event.pointerId;
  mermaidDragStartClientX = event.clientX;
  mermaidDragStartClientY = event.clientY;
  mermaidDragStartScrollLeft = viewport.scrollLeft;
  mermaidDragStartScrollTop = viewport.scrollTop;
  viewport.classList.add("is-dragging");

  try {
    if (!viewport.hasPointerCapture(event.pointerId)) viewport.setPointerCapture(event.pointerId);
  } catch {}
}

function onRootPointerMove(event: PointerEvent) {
  const viewport = mermaidDragViewport;
  if (!(viewport instanceof HTMLElement)) return;
  if (mermaidDragPointerId != null && event.pointerId !== mermaidDragPointerId) return;

  event.preventDefault();
  event.stopPropagation();

  const dx = event.clientX - mermaidDragStartClientX;
  const dy = event.clientY - mermaidDragStartClientY;
  viewport.scrollLeft = mermaidDragStartScrollLeft - dx;
  viewport.scrollTop = mermaidDragStartScrollTop - dy;
}

function onRootPointerUp(event: PointerEvent) {
  const viewport = mermaidDragViewport;
  if (!(viewport instanceof HTMLElement)) return;
  if (mermaidDragPointerId != null && event.pointerId !== mermaidDragPointerId) return;

  if (mermaidDragPointerId != null && viewport.hasPointerCapture(mermaidDragPointerId)) {
    try {
      viewport.releasePointerCapture(mermaidDragPointerId);
    } catch {}
  }

  event.preventDefault();
  event.stopPropagation();

  viewport.classList.remove("is-dragging");
  mermaidDragViewport = null;
  mermaidDragPointerId = null;
}

function onRootClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const pathToken = target.closest<HTMLElement>("code.agent-inline-path");
  if (pathToken) {
    if (readHasSelection()) return;
    const full = String(pathToken.dataset.agentPathFull ?? "").trim();
    if (!full) return;
    event.preventDefault();
    event.stopPropagation();
    void copyTextToClipboard(full)
      .then(() => {
        showToast({
          kind: "success",
          title: t("clipboard.copied"),
          message: t("clipboard.pathCopied", { path: String(pathToken.textContent ?? "").trim() }),
        });
      })
      .catch((error) => {
        showToast({
          kind: "error",
          title: t("clipboard.copyFailed"),
          message: String((error as any)?.message ?? error ?? ""),
        });
      });
    return;
  }

  const mermaidCopyButton = target.closest("[data-agent-mermaid-action='copy']");
  if (mermaidCopyButton instanceof HTMLButtonElement) {
    event.preventDefault();
    event.stopPropagation();
    void onMermaidBlockCopyAction(mermaidCopyButton);
    return;
  }

  const copyButton = target.closest("[data-agent-code-action='copy']");
  if (copyButton instanceof HTMLButtonElement) {
    event.preventDefault();
    event.stopPropagation();
    void onCodeCopyAction(copyButton);
    return;
  }

  const actionButton = target.closest<HTMLElement>("[data-agent-mermaid-action='lightbox']");
  if (!actionButton) return;

  event.preventDefault();
  event.stopPropagation();

  const block = actionButton.closest<HTMLElement>(".agent-mermaid-block");
  if (!(block instanceof HTMLElement)) return;
  const blockKey = String(block.dataset.agentMermaidKey ?? "").trim();
  const source = blockKey ? mermaidSourceByKey.get(blockKey) : null;
  if (!source) return;
  void openMermaidLightbox(source);
}

function onRootKeydown(event: KeyboardEvent) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  const pathToken = target.closest<HTMLElement>("code.agent-inline-path");
  if (!pathToken) return;
  if (readHasSelection()) return;
  const full = String(pathToken.dataset.agentPathFull ?? "").trim();
  if (!full) return;
  event.preventDefault();
  event.stopPropagation();
  void copyTextToClipboard(full)
    .then(() => {
      showToast({
        kind: "success",
        title: t("clipboard.copied"),
        message: t("clipboard.pathCopied", { path: String(pathToken.textContent ?? "").trim() }),
      });
    })
    .catch((error) => {
      showToast({
        kind: "error",
        title: t("clipboard.copyFailed"),
        message: String((error as any)?.message ?? error ?? ""),
      });
    });
}

function onWindowResize() {
  scheduleLayoutMermaidBlocks();
  scheduleMermaidLightboxLayout();
}

function onMermaidLightboxWindowKeydown(event: KeyboardEvent) {
  if (!lightboxSvgHtml.value) return;
  if (event.key !== "Escape") return;
  event.preventDefault();
  closeMermaidLightbox();
}

async function enhanceMermaidBlocks(seq: number) {
  const host = rootRef.value;
  if (!host || seq !== renderTaskSeq) return;
  if (!isInViewport.value) return;

  const mermaidCodeBlocks = [...host.querySelectorAll<HTMLElement>("pre > code.language-mermaid")];
  if (mermaidCodeBlocks.length === 0) return;

  for (const [index, codeElement] of mermaidCodeBlocks.entries()) {
    if (seq !== renderTaskSeq) return;
    const preElement = codeElement.closest("pre");
    if (!(preElement instanceof HTMLElement)) continue;

    const source = String(codeElement.textContent ?? "").trim();
    if (!source) continue;

    const blockKey = String(preElement.dataset.agentMermaidKey ?? "").trim();
    if (blockKey && mermaidFailureByKey.has(blockKey)) continue;
    const renderId = `agent-mermaid-${componentUid}-${seq}-${index}`;

    try {
      const svg = await renderMermaidDiagram({
        id: renderId,
        source,
        tone: tone.value,
      });
      if (seq !== renderTaskSeq) return;

      if (blockKey) mermaidSourceByKey.set(blockKey, source);
      const renderElement = createMermaidRenderElement(svg, blockKey || undefined);
      if (blockKey) {
        frozenMermaidBlocks.set(blockKey, renderElement);
        mermaidFailureByKey.delete(blockKey);
      }
      preElement.replaceWith(renderElement);
      layoutMermaidBlock(renderElement);
    } catch (error) {
      if (seq !== renderTaskSeq) return;
      const detail = normalizeMermaidError(error);
      if (blockKey) mermaidFailureByKey.set(blockKey, detail);
      const errorElement = createMermaidErrorElement(detail);
      preElement.insertAdjacentElement("beforebegin", errorElement);
    }
  }
}

function scheduleEnhanceMermaidBlocks() {
  renderTaskSeq += 1;
  if (!isInViewport.value) return;
  if (renderTimer != null) return;
  // Throttle (not debounce) so Mermaid can render while the assistant message is still streaming.
  renderTimer = setTimeout(() => {
    renderTimer = null;
    void enhanceMermaidBlocks(renderTaskSeq);
  }, MERMAID_RENDER_DEBOUNCE_MS);
}

onMounted(() => {
  tone.value = readMermaidTone();
  window.addEventListener("resize", onWindowResize, true);
  syncRenderedHtml();
  if (rootRef.value) isInViewport.value = readIsInViewport(rootRef.value);
  scheduleLayoutMermaidBlocks();
  scheduleEnhanceMermaidBlocks();

  if (typeof ResizeObserver !== "undefined" && rootRef.value) {
    rootResizeObserver = new ResizeObserver(() => {
      scheduleLayoutMermaidBlocks();
    });
    rootResizeObserver.observe(rootRef.value);
  }

  unsubscribeTone = subscribeMermaidTone((nextTone) => {
    if (nextTone === tone.value) return;
    tone.value = nextTone;
  });

  if (typeof IntersectionObserver === "undefined" || !rootRef.value) return;

  viewportObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      const next = Boolean(entry?.isIntersecting);
      if (next === isInViewport.value) return;
      isInViewport.value = next;
      if (!next) return;
      if (htmlSyncDeferred) {
        htmlSyncDeferred = false;
        syncRenderedHtml();
      }
      scheduleLayoutMermaidBlocks();
      scheduleEnhanceMermaidBlocks();
      scheduleDeferredEnhancements();
    },
    { root: null, rootMargin: `${MERMAID_VIEWPORT_MARGIN_PX}px 0px ${MERMAID_VIEWPORT_MARGIN_PX}px 0px` }
  );
  viewportObserver.observe(rootRef.value);
});

watch(
  () => props.html,
  () => {
    closeMermaidLightbox();
    // 离屏消息先跳过 DOM 重建，等进入视口时一次性同步，避免长对话里无谓的重排。
    if (!isInViewport.value) {
      htmlSyncDeferred = true;
      return;
    }
    syncRenderedHtml();
    scheduleLayoutMermaidBlocks();
    scheduleEnhanceMermaidBlocks();
  },
  { immediate: true }
);

watch(
  () => tone.value,
  () => {
    closeMermaidLightbox();
    clearFrozenMermaidBlocks();
    clearMermaidFailures();
    if (!isInViewport.value) {
      htmlSyncDeferred = true;
      return;
    }
    syncRenderedHtml();
    scheduleLayoutMermaidBlocks();
    scheduleEnhanceMermaidBlocks();
  }
);

watch(lightboxSvgHtml, (value) => {
  if (value) {
    scheduleMermaidLightboxLayout();
    window.addEventListener("keydown", onMermaidLightboxWindowKeydown, true);
    return;
  }
  window.removeEventListener("keydown", onMermaidLightboxWindowKeydown, true);
});

onBeforeUnmount(() => {
  renderTaskSeq += 1;
  codeHighlightTaskSeq += 1;
  lightboxTaskSeq += 1;
  clearMermaidDragState();
  clearLightboxCopyResetTimer();
  clearAllCodeCopyResetTimers();
  clearFrozenMermaidBlocks();
  clearMermaidFailures();
  mermaidSourceByKey.clear();
  clearRenderTimer();
  clearLayoutTimer();
  clearEnhanceTimer();
  clearLightboxLayoutTimer();
  window.removeEventListener("resize", onWindowResize, true);
  window.removeEventListener("keydown", onMermaidLightboxWindowKeydown, true);
  rootResizeObserver?.disconnect();
  rootResizeObserver = null;
  unsubscribeTone?.();
  unsubscribeTone = null;
  viewportObserver?.disconnect();
  viewportObserver = null;
});
</script>
