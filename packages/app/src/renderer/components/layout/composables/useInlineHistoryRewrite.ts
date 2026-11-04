import { ref, watch } from "vue";
import {
  buildComposeDraftFromStructuredText,
  buildComposeDraftFromUserTurnInputs,
  userTurnInputsFromMessageContent,
} from "../../../domain/composeFileMentions";
import { getRuntimeOrchestrator } from "../../../domain/runtimeOrchestrator";
import type {
  CollaborationModeKind,
  ComposeImageAttachment,
  ComposeWorkspaceFileMention,
  TimelineEventItem,
} from "../../../domain/types";
import { useRuntimeStore } from "../../../stores/runtime.store";
import type { ChatInlineRewriteDraft, ChatUserMessageSnapshot } from "../types/chat.types";

type UseInlineHistoryRewriteOptions = {
  closeSeq?: () => number | undefined;
  getUserMessageSnapshot: (event: TimelineEventItem) => ChatUserMessageSnapshot;
};

function cloneInlineAttachments(items: ComposeImageAttachment[]): ComposeImageAttachment[] {
  return items.map((item) => ({
    ...item,
    input: { ...item.input },
  }));
}

function cloneInlineMentions(items: ComposeWorkspaceFileMention[]): ComposeWorkspaceFileMention[] {
  return items.map((item) => ({ ...item }));
}

function buildInlineRewriteAttachments(
  event: TimelineEventItem,
  snapshot: ChatUserMessageSnapshot
): ComposeImageAttachment[] {
  const attachments: ComposeImageAttachment[] = [];
  snapshot.images.forEach((url, index) => {
    const source = String(url ?? "").trim();
    if (!source) return;
    attachments.push({
      id: `${event.id}:inline-image:${index}`,
      name: `image-${index + 1}`,
      size: 0,
      mimeType: "image/*",
      previewUrl: source,
      revokePreviewUrlOnDispose: false,
      input: { type: "image", url: source },
    });
  });
  snapshot.localImages.forEach((path, index) => {
    const source = String(path ?? "").trim();
    if (!source) return;
    const name =
      source
        .split(/[\\/]+/)
        .filter(Boolean)
        .pop() || `local-image-${index + 1}`;
    attachments.push({
      id: `${event.id}:inline-local-image:${index}`,
      name,
      size: 0,
      mimeType: "image/*",
      previewUrl: source,
      revokePreviewUrlOnDispose: false,
      input: { type: "localImage", path: source },
    });
  });
  return attachments;
}

export function useInlineHistoryRewrite(options: UseInlineHistoryRewriteOptions) {
  const runtime = getRuntimeOrchestrator();
  const runtimeStore = useRuntimeStore();
  const inlineRewriteDraft = ref<ChatInlineRewriteDraft | null>(null);

  function closeInlineRewrite() {
    inlineRewriteDraft.value = null;
  }

  function updateInlineRewriteDraft(patch: Partial<ChatInlineRewriteDraft>) {
    const current = inlineRewriteDraft.value;
    if (!current) return;
    inlineRewriteDraft.value = {
      ...current,
      ...patch,
      composeAttachments: patch.composeAttachments
        ? cloneInlineAttachments(patch.composeAttachments)
        : current.composeAttachments,
      composeFileMentions: patch.composeFileMentions
        ? cloneInlineMentions(patch.composeFileMentions)
        : current.composeFileMentions,
    };
  }

  function openInlineRewrite(event: TimelineEventItem) {
    if (window.getSelection?.()?.toString().trim()) return;
    const anchorEventId = String(event?.id ?? "").trim();
    const anchorTurnId = String(event?.turnId ?? "").trim();
    if (!anchorEventId || !anchorTurnId) return;
    if (inlineRewriteDraft.value?.anchorEventId === anchorEventId) {
      closeInlineRewrite();
      return;
    }
    const snapshot = options.getUserMessageSnapshot(event);
    const contentInputs = userTurnInputsFromMessageContent(snapshot.content);
    const draft =
      contentInputs.length > 0
        ? buildComposeDraftFromUserTurnInputs(contentInputs)
        : buildComposeDraftFromStructuredText(snapshot.text, snapshot.textElements, {
            inferAbsolutePaths: true,
            idPrefix: "inline-history-file",
          });
    inlineRewriteDraft.value = {
      anchorEventId,
      anchorTurnId,
      composeInput: draft.composeInput || snapshot.text || String(event?.paramsText ?? ""),
      composeFileMentions: draft.composeFileMentions,
      composeAttachments: buildInlineRewriteAttachments(event, snapshot),
      model: runtimeStore.model,
      reasoningEffort: runtimeStore.reasoningEffort,
      sandboxMode: runtimeStore.sandboxMode,
      composeMode: runtimeStore.composeMode as CollaborationModeKind,
      sending: false,
    };
  }

  async function sendInlineRewriteDraft() {
    const draft = inlineRewriteDraft.value;
    if (!draft || draft.sending) return;
    inlineRewriteDraft.value = { ...draft, sending: true };
    const ok = await runtime.sendHistoryRewriteDraft({
      anchorTurnId: draft.anchorTurnId,
      composeInput: draft.composeInput,
      composeAttachments: cloneInlineAttachments(draft.composeAttachments),
      composeFileMentions: cloneInlineMentions(draft.composeFileMentions),
      model: draft.model,
      reasoningEffort: draft.reasoningEffort,
      sandboxMode: draft.sandboxMode,
      composeMode: draft.composeMode === "plan" ? "plan" : "default",
    });
    if (ok) {
      closeInlineRewrite();
      return;
    }
    const current = inlineRewriteDraft.value;
    if (current?.anchorEventId === draft.anchorEventId) inlineRewriteDraft.value = { ...current, sending: false };
  }

  if (options.closeSeq) {
    watch(options.closeSeq, (next, prev) => {
      if (next === prev) return;
      closeInlineRewrite();
    });
  }

  return {
    inlineRewriteDraft,
    openInlineRewrite,
    updateInlineRewriteDraft,
    closeInlineRewrite,
    sendInlineRewriteDraft,
  };
}
