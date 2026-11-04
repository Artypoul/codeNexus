import type { TimelineEventItem, TimelineUserMessageParams } from "../../../domain/types";
import { buildStructuredTextSegments } from "../../../domain/composeFileMentions";
import { splitEnvironmentContextSegments } from "../../../domain/taggedMessageBlocks";
import { basenameFromPath } from "../../../domain/workspaceFiles";
import { translate } from "../../../i18n/translate";
import { useWorkspaceFilesStore } from "../../../stores/workspaceFiles.store";
import { resolveVscodeEntryIcon } from "../workspace/vscodeFileIcons";
import type {
  ChatUserMessageSnapshot,
  ChatUserMessagePart,
  LazyImageSourceKind,
  ChatImageEntry,
  ThumbLoadErrorPayload,
  ImageToolItemWithImages,
  ImageToolImageEntry,
} from "../types/chat.types";

export function useChatMessageParts(hiddenImageIds: () => Set<string>, onLayoutChange?: () => void) {
  const workspaceFilesStore = useWorkspaceFilesStore();

  const toRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const toStringArray = (value: unknown, opts?: { keepEmpty?: boolean }): string[] =>
    Array.isArray(value)
      ? value.map((item) => String(item ?? "")).filter((item) => (opts?.keepEmpty ? true : !!item.trim()))
      : [];

  const asTimelineUserMessageParams = (event: TimelineEventItem): TimelineUserMessageParams | null => {
    if (event.method !== "user") return null;
    const params = toRecord(event.params);
    if (params?.role !== "user") return null;
    return params as TimelineUserMessageParams;
  };

  const getUserMessageSnapshot = (event: TimelineEventItem): ChatUserMessageSnapshot => {
    const params = asTimelineUserMessageParams(event);
    if (!params) {
      return {
        text: "",
        textElements: undefined,
        images: [],
        localImages: [],
        content: [],
      };
    }
    const text = String(params.text ?? "").replace(/\r\n?/g, "\n");
    const content = Array.isArray(params.content) ? params.content : [];
    const hasContentText = content.some((item) => {
      const type = toRecord(item)?.type;
      return type === "text" || type === "input_text";
    });
    return {
      text,
      textElements: params.text_elements,
      images: toStringArray(params.images, { keepEmpty: true }),
      localImages: toStringArray(params.local_images),
      content:
        text && content.length > 0 && !hasContentText
          ? [{ type: "text", text, text_elements: params.text_elements }, ...content]
          : content,
    };
  };

  const userMessageParts = (event: TimelineEventItem): ChatUserMessagePart[] => {
    const snapshot = getUserMessageSnapshot(event);
    const parts: ChatUserMessagePart[] = [];

    const pushStructuredTextParts = (text: string, textElements: unknown, keyPrefix: string) => {
      for (const segment of buildStructuredTextSegments(text, textElements, {
        inferAbsolutePaths: true,
      })) {
        if (segment.type === "text") {
          for (const taggedSegment of splitEnvironmentContextSegments(segment.text)) {
            if (taggedSegment.type === "text") {
              if (taggedSegment.text) {
                parts.push({
                  key: `${event.id}:${keyPrefix}:text:${parts.length}`,
                  type: "text",
                  text: taggedSegment.text,
                });
              }
            } else {
              parts.push({
                key: `${event.id}:${keyPrefix}:environment:${parts.length}`,
                type: "environmentContext",
                context: taggedSegment.context,
              });
            }
          }
          continue;
        }
        const label = String(segment.placeholder ?? "").trim() || basenameFromPath(segment.path) || segment.path;
        parts.push({
          key: `${event.id}:${keyPrefix}:file:${parts.length}:${segment.path}`,
          type: "file",
          path: segment.path,
          label,
          title: segment.path,
          icon: resolveVscodeEntryIcon(segment.path, { isDirectory: segment.kind === "directory" }),
        });
      }
    };

    if (snapshot.content.length > 0) {
      for (const rawItem of snapshot.content) {
        const item = toRecord(rawItem);
        const type = String(item?.type ?? "").trim();
        if (type === "text" || type === "input_text") {
          pushStructuredTextParts(String(item?.text ?? ""), item?.text_elements, "content");
          continue;
        }
        if (type === "skill" || type === "input_skill") {
          const name = String(item?.name ?? "").trim();
          const path = String(item?.path ?? "").trim();
          if (!name && !path) continue;
          parts.push({
            key: `${event.id}:content:skill:${parts.length}:${path || name}`,
            type: "skill",
            name,
            path,
            label: name || basenameFromPath(path) || path,
          });
          continue;
        }
        if (type === "mention") {
          const path = String(item?.path ?? "").trim();
          if (!path) continue;
          parts.push({
            key: `${event.id}:content:mention:${parts.length}:${path}`,
            type: "file",
            path,
            label: String(item?.name ?? "").trim() || basenameFromPath(path) || path,
            title: path,
            icon: resolveVscodeEntryIcon(path, { isDirectory: false }),
          });
        }
      }
      if (parts.length > 0) return parts;
    }

    pushStructuredTextParts(snapshot.text, snapshot.textElements, "text");
    if (parts.length > 0) return parts;
    const fallbackText = String(event?.paramsText ?? "");
    return fallbackText
      ? splitEnvironmentContextSegments(fallbackText).map((segment, segmentIndex) =>
          segment.type === "text"
            ? { key: `${event.id}:fallback:${segmentIndex}`, type: "text", text: segment.text }
            : {
                key: `${event.id}:fallback-environment:${segmentIndex}`,
                type: "environmentContext",
                context: segment.context,
              }
        )
      : [];
  };

  const inferLazyImageSourceKind = (value: string): LazyImageSourceKind => {
    const text = String(value ?? "").trim();
    if (!text) return "remoteUrl";
    if (text.startsWith("data:image/")) return "dataUrl";
    if (/^https?:\/\//i.test(text)) return "remoteUrl";
    return "localPath";
  };

  const userMessageImageCount = (event: TimelineEventItem): number => {
    const snapshot = getUserMessageSnapshot(event);
    return snapshot.images.length + snapshot.localImages.length;
  };

  const userMessageImageEntries = (event: TimelineEventItem): ChatImageEntry[] => {
    const snapshot = getUserMessageSnapshot(event);
    const entries: ChatImageEntry[] = [];
    snapshot.images.forEach((source, i) => {
      const kind = inferLazyImageSourceKind(source);
      entries.push({
        id: `${event.id}:img:${i + 1}:${source.length}`,
        sourceKind: kind === "localPath" ? "remoteUrl" : kind,
        source,
        title: translate("lazyImage.imageWithIndex", { index: i + 1 }),
      });
    });
    snapshot.localImages.forEach((source, i) => {
      const name = basenameFromPath(source) || source;
      entries.push({ id: `${event.id}:local:${i + 1}:${name}`, sourceKind: "localPath", source, title: name });
    });
    return entries;
  };

  const visibleUserMessageImageEntries = (event: TimelineEventItem): ChatImageEntry[] => {
    const entries = userMessageImageEntries(event);
    return entries.filter((e) => e?.id && !hiddenImageIds().has(e.id));
  };

  const visibleImageToolEntries = (item: ImageToolItemWithImages): ImageToolImageEntry[] => {
    const entries = Array.isArray(item?.images) ? item.images : [];
    return entries.filter((e) => e?.id && !hiddenImageIds().has(e.id));
  };

  const onThumbLoadError = (payload: ThumbLoadErrorPayload) => {
    const id = String(payload?.imageId ?? "").trim();
    if (id && !hiddenImageIds().has(id)) {
      hiddenImageIds().add(id);
      onLayoutChange?.();
    }
  };

  const onUserFileTokenClick = (pathValue: string) => {
    const path = String(pathValue ?? "").trim();
    if (path) void workspaceFilesStore.openFile(path);
  };

  return {
    userMessageParts,
    userMessageImageCount,
    visibleUserMessageImageEntries,
    visibleImageToolEntries,
    onThumbLoadError,
    onUserFileTokenClick,
    getUserMessageSnapshot,
  };
}
