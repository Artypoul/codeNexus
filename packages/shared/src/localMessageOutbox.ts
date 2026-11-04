import type { TextElement } from "@codenexus/generated/codex-app-server/v2/TextElement";

/**
 * 本地消息发件箱。
 *
 * 用于保存已经在 UI 中排队、但还没稳定进入远端线程流的用户输入，刷新后可继续恢复发送链路。
 */
export type LocalTextUserInputElement = TextElement;

export type LocalTextUserInput = {
  type: "text";
  text: string;
  text_elements?: LocalTextUserInputElement[];
};

export type LocalImageUserInput = {
  type: "image";
  url: string;
};

export type LocalImagePathUserInput = {
  type: "localImage";
  path: string;
};

export type LocalSkillUserInput = {
  type: "skill";
  name: string;
  path: string;
};

export type LocalMentionUserInput = {
  type: "mention";
  name: string;
  path: string;
};

/** 文本、远程图片、本地图片路径、skill 和 mention 统一归一成 Codex 可消费的用户输入片段。 */
export type LocalUserTurnInput =
  | LocalTextUserInput
  | LocalImageUserInput
  | LocalImagePathUserInput
  | LocalSkillUserInput
  | LocalMentionUserInput;

/** 排队消息保留 displayText 和 localEventId，便于 UI 侧对齐乐观渲染事件。 */
export type LocalOutboxQueuedMessage = {
  id: string;
  threadId: string;
  text: string;
  inputs: LocalUserTurnInput[];
  displayText?: string;
  createdAt: number;
  status: "queued";
  localEventId?: string;
};

export type LocalMessageOutbox = {
  version: 1;
  updatedAt: number;
  threads: Record<string, LocalOutboxQueuedMessage[]>;
};

export const DEFAULT_LOCAL_MESSAGE_OUTBOX: LocalMessageOutbox = {
  version: 1,
  updatedAt: 0,
  threads: {},
};

/** 单线程最多保留最近的本地排队消息，避免异常重试把持久化状态撑大。 */
export const MAX_LOCAL_OUTBOX_ITEMS_PER_THREAD = 50;

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toThreadKey(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeTextElement(
  value: unknown,
): LocalTextUserInputElement | null {
  const record = toRecord(value);
  const byteRangeRecord =
    toRecord(record?.byteRange) ?? toRecord(record?.byte_range);
  const start = Number(byteRangeRecord?.start ?? record?.start);
  const end = Number(byteRangeRecord?.end ?? record?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return null;
  return {
    byteRange: {
      start: Math.max(0, Math.round(start)),
      end: Math.max(0, Math.round(end)),
    },
    placeholder:
      record?.placeholder == null
        ? record?.label == null
          ? null
          : String(record.label)
        : String(record.placeholder),
  };
}

/** mention 类型是旧 UI 输入形态，归一化时转换成带 text_elements 的文本输入。 */
export function normalizeLocalUserTurnInput(
  value: unknown,
): LocalUserTurnInput | null {
  const record = toRecord(value);
  const type = String(record?.type ?? "").trim();
  if (type === "text") {
    const textElements = Array.isArray(record?.text_elements)
      ? record.text_elements
          .map((item) => normalizeTextElement(item))
          .filter((item): item is LocalTextUserInputElement => item != null)
      : [];
    return {
      type: "text",
      text: typeof record?.text === "string" ? record.text : "",
      ...(textElements.length > 0 ? { text_elements: textElements } : {}),
    };
  }
  if (type === "image") {
    return { type: "image", url: String(record?.url ?? "") };
  }
  if (type === "localImage") {
    return { type: "localImage", path: String(record?.path ?? "") };
  }
  if (type === "skill") {
    const name = String(record?.name ?? "").trim();
    const path = String(record?.path ?? "").trim();
    return name && path ? { type: "skill", name, path } : null;
  }
  if (type === "mention") {
    const path = String(record?.path ?? "").trim();
    const name = String(record?.name ?? "").trim();
    return name && path ? { type: "mention", name, path } : null;
  }
  return null;
}

/** 克隆输入片段时会再次清理 text_elements，避免把脏 mention 元数据继续传播。 */
export function cloneLocalUserTurnInput(
  value: LocalUserTurnInput,
): LocalUserTurnInput {
  if (value.type === "text") {
    return {
      type: "text",
      text: String(value.text ?? ""),
      ...(Array.isArray(value.text_elements)
        ? {
            text_elements: value.text_elements
              .map((item) => normalizeTextElement(item))
              .filter(
                (item): item is LocalTextUserInputElement => item != null,
              ),
          }
        : {}),
    };
  }
  if (value.type === "image") {
    return { type: "image", url: String(value.url ?? "") };
  }
  if (value.type === "localImage") {
    return { type: "localImage", path: String(value.path ?? "") };
  }
  if (value.type === "skill") {
    return {
      type: "skill",
      name: String(value.name ?? ""),
      path: String(value.path ?? ""),
    };
  }
  if (value.type === "mention") {
    return {
      type: "mention",
      name: String(value.name ?? ""),
      path: String(value.path ?? ""),
    };
  }
  const exhaustive: never = value;
  return exhaustive;
}

export function cloneLocalUserTurnInputs(
  values: LocalUserTurnInput[],
): LocalUserTurnInput[] {
  if (!Array.isArray(values) || values.length === 0) return [];
  return values.map((value) => cloneLocalUserTurnInput(value));
}

export function normalizeLocalOutboxQueuedMessage(
  value: unknown,
  threadIdValue?: string,
): LocalOutboxQueuedMessage | null {
  const record = toRecord(value);
  const id = String(record?.id ?? "").trim();
  const threadId = toThreadKey(threadIdValue ?? record?.threadId);
  if (!id || !threadId) return null;
  const items = Array.isArray(record?.inputs)
    ? record.inputs
        .map((item) => normalizeLocalUserTurnInput(item))
        .filter((item): item is LocalUserTurnInput => item != null)
    : [];
  const createdAtRaw = Number(record?.createdAt);
  return {
    id,
    threadId,
    text: typeof record?.text === "string" ? record.text : "",
    inputs: cloneLocalUserTurnInputs(items),
    ...(String(record?.displayText ?? "").trim()
      ? { displayText: String(record?.displayText ?? "").trim() }
      : {}),
    createdAt: Number.isFinite(createdAtRaw) ? createdAtRaw : Date.now(),
    status: "queued",
    ...(String(record?.localEventId ?? "").trim()
      ? { localEventId: String(record?.localEventId ?? "").trim() }
      : {}),
  };
}

/** 恢复发件箱时按创建时间排序，并只保留每个线程最近的有限条目。 */
export function normalizeLocalMessageOutbox(
  value: unknown,
): LocalMessageOutbox {
  const root = toRecord(value);
  const threadsRecord = toRecord(root?.threads);
  const threads: Record<string, LocalOutboxQueuedMessage[]> = {};
  for (const [rawThreadId, rawItems] of Object.entries(threadsRecord ?? {})) {
    const threadId = toThreadKey(rawThreadId);
    if (!threadId || !Array.isArray(rawItems)) continue;
    const items = rawItems
      .map((item) => normalizeLocalOutboxQueuedMessage(item, threadId))
      .filter((item): item is LocalOutboxQueuedMessage => item != null)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-MAX_LOCAL_OUTBOX_ITEMS_PER_THREAD);
    if (items.length > 0) threads[threadId] = items;
  }
  const updatedAt = Number(root?.updatedAt);
  return {
    version: 1,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    threads,
  };
}

/** 替换单线程发件箱；传入空列表时表示清空该线程队列。 */
export function replaceLocalMessageOutboxThread(
  current: unknown,
  threadIdValue: string,
  itemsValue: unknown,
): LocalMessageOutbox {
  const next = normalizeLocalMessageOutbox(current);
  const threadId = toThreadKey(threadIdValue);
  if (!threadId) return next;
  const items = Array.isArray(itemsValue)
    ? itemsValue
        .map((item) => normalizeLocalOutboxQueuedMessage(item, threadId))
        .filter((item): item is LocalOutboxQueuedMessage => item != null)
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(-MAX_LOCAL_OUTBOX_ITEMS_PER_THREAD)
    : [];
  const threads = { ...next.threads };
  if (items.length > 0) threads[threadId] = items;
  else delete threads[threadId];
  return {
    version: 1,
    updatedAt: Date.now(),
    threads,
  };
}

/** 删除不存在的发件箱线程不会刷新 updatedAt，保持状态写入幂等。 */
export function removeLocalMessageOutboxThread(
  current: unknown,
  threadIdValue: string,
): LocalMessageOutbox {
  const next = normalizeLocalMessageOutbox(current);
  const threadId = toThreadKey(threadIdValue);
  if (!threadId || !(threadId in next.threads)) return next;
  const threads = { ...next.threads };
  delete threads[threadId];
  return {
    version: 1,
    updatedAt: Date.now(),
    threads,
  };
}
