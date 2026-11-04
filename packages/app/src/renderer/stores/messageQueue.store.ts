import { defineStore } from "pinia";
import type { UserTurnInput } from "../domain/types";
import { cloneComposeTextElements } from "../domain/composeFileMentions";
import type { LocalMessageOutbox } from "@codenexus/shared/localMessageOutbox";
import { cloneLocalUserTurnInputs } from "@codenexus/shared/localMessageOutbox";
import { clearSavedLocalMessageOutboxThread, saveLocalMessageOutboxThread } from "../domain/localMessageOutbox";

export type QueuedMessageStatus = "queued" | "sending" | "failed";

export type QueuedMessage = {
  id: string;
  threadId: string;
  text: string;
  inputs: UserTurnInput[];
  displayText?: string;
  createdAt: number;
  status: QueuedMessageStatus;
  localEventId?: string;
};

function ensureThreadId(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || "__app__";
}

function cloneUserTurnInput(value: UserTurnInput): UserTurnInput {
  if (value.type === "text") {
    return {
      type: "text",
      text: String(value.text ?? ""),
      ...(Array.isArray(value.text_elements) ? { text_elements: cloneComposeTextElements(value.text_elements) } : {}),
    };
  }
  if (value.type === "image") {
    return { type: "image", url: String(value.url ?? "") };
  }
  if (value.type === "skill" || value.type === "mention") {
    return { type: value.type, name: String(value.name ?? ""), path: String(value.path ?? "") };
  }
  return { type: "localImage", path: String(value.path ?? "") };
}

function cloneUserTurnInputs(values: UserTurnInput[]): UserTurnInput[] {
  if (!Array.isArray(values) || values.length === 0) return [];
  return values.map((value) => cloneUserTurnInput(value));
}

export const useMessageQueueStore = defineStore("messageQueue", {
  state: () => ({
    queueByThread: new Map<string, QueuedMessage[]>(),
  }),
  getters: {
    queuedCount(state): (threadId: string) => number {
      return (threadId: string) => {
        const key = ensureThreadId(threadId);
        const items = state.queueByThread.get(key) ?? [];
        return items.filter((item) => item.status === "queued").length;
      };
    },
  },
  actions: {
    hydrateFromLocalMessageOutbox(snapshot: LocalMessageOutbox) {
      const next = new Map<string, QueuedMessage[]>();
      for (const [threadId, items] of Object.entries(snapshot?.threads ?? {})) {
        const key = ensureThreadId(threadId);
        const normalized = items.map((item) => ({
          id: String(item.id ?? ""),
          threadId: key,
          text: String(item.text ?? ""),
          inputs: cloneUserTurnInputs(cloneLocalUserTurnInputs(item.inputs ?? []) as UserTurnInput[]),
          ...(String(item.displayText ?? "").trim() ? { displayText: String(item.displayText ?? "").trim() } : {}),
          createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
          status: "queued" as const,
          ...(String(item.localEventId ?? "").trim() ? { localEventId: String(item.localEventId ?? "").trim() } : {}),
        }));
        if (normalized.length > 0) next.set(key, normalized);
      }
      this.queueByThread = next;
    },
    saveThreadQueueNow(threadIdValue: string) {
      const threadId = ensureThreadId(threadIdValue);
      const current = this.queueByThread.get(threadId) ?? [];
      if (current.length === 0) {
        void clearSavedLocalMessageOutboxThread(threadId);
        return;
      }

      const normalized = current
        .slice()
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((msg) => ({
          id: String(msg.id ?? ""),
          threadId,
          text: String(msg.text ?? ""),
          inputs: cloneUserTurnInputs(msg.inputs ?? []),
          ...(String(msg.displayText ?? "").trim() ? { displayText: String(msg.displayText ?? "").trim() } : {}),
          createdAt: Number.isFinite(msg.createdAt) ? msg.createdAt : Date.now(),
          status: "queued" as const,
          ...(String(msg.localEventId ?? "").trim() ? { localEventId: String(msg.localEventId ?? "").trim() } : {}),
        }))
        .filter((item) => item.id.trim().length > 0);

      void saveLocalMessageOutboxThread(threadId, normalized);
    },
    clearThreadQueue(threadIdValue: string) {
      const threadId = ensureThreadId(threadIdValue);
      this.queueByThread.delete(threadId);
      void clearSavedLocalMessageOutboxThread(threadId);
    },
    moveThreadQueue(fromThreadIdValue: string, toThreadIdValue: string) {
      const fromThreadId = ensureThreadId(fromThreadIdValue);
      const toThreadId = ensureThreadId(toThreadIdValue);
      if (!fromThreadId || !toThreadId || fromThreadId === toThreadId) return;

      const fromList = this.queueByThread.get(fromThreadId) ?? [];
      const toList = this.queueByThread.get(toThreadId) ?? [];
      if (fromList.length === 0) {
        this.queueByThread.delete(fromThreadId);
        void clearSavedLocalMessageOutboxThread(fromThreadId);
        return;
      }

      const moved = fromList.map((msg) => ({
        ...msg,
        threadId: toThreadId,
        inputs: cloneUserTurnInputs(msg.inputs ?? []),
      }));
      const merged = [...toList, ...moved].sort((a, b) => a.createdAt - b.createdAt);
      this.queueByThread.set(toThreadId, merged);
      this.queueByThread.delete(fromThreadId);
      this.saveThreadQueueNow(toThreadId);
      void clearSavedLocalMessageOutboxThread(fromThreadId);
    },
    enqueue(params: {
      threadId: string;
      text: string;
      inputs: UserTurnInput[];
      localEventId?: string;
      displayText?: string;
    }): QueuedMessage {
      const threadId = ensureThreadId(params.threadId);
      const text = String(params.text ?? "").trim();
      const inputs = cloneUserTurnInputs(params.inputs ?? []);
      const localEventId = String(params.localEventId ?? "").trim();
      const displayText = String(params.displayText ?? "").trim();
      const msg: QueuedMessage = {
        id: `qmsg:${Date.now()}:${Math.random().toString(16).slice(2)}`,
        threadId,
        text,
        inputs,
        ...(displayText ? { displayText } : {}),
        createdAt: Date.now(),
        status: "queued",
        ...(localEventId ? { localEventId } : {}),
      };
      const current = this.queueByThread.get(threadId) ?? [];
      current.push(msg);
      this.queueByThread.set(threadId, current);
      this.saveThreadQueueNow(threadId);
      return msg;
    },
    markStatus(threadIdValue: string, messageId: string, status: QueuedMessageStatus) {
      const threadId = ensureThreadId(threadIdValue);
      const current = this.queueByThread.get(threadId) ?? [];
      const idx = current.findIndex((item) => item.id === messageId);
      if (idx < 0) return;
      current[idx] = { ...current[idx], status };
      this.queueByThread.set(threadId, current);
      this.saveThreadQueueNow(threadId);
    },
    setLocalEventId(threadIdValue: string, messageId: string, localEventIdValue: string) {
      const threadId = ensureThreadId(threadIdValue);
      const localEventId = String(localEventIdValue ?? "").trim();
      if (!localEventId) return;
      const current = this.queueByThread.get(threadId) ?? [];
      const idx = current.findIndex((item) => item.id === messageId);
      if (idx < 0) return;
      current[idx] = { ...current[idx], localEventId };
      this.queueByThread.set(threadId, current);
      this.saveThreadQueueNow(threadId);
    },
    takeEditable(threadIdValue: string, messageId: string): QueuedMessage | null {
      const threadId = ensureThreadId(threadIdValue);
      const current = this.queueByThread.get(threadId) ?? [];
      const idx = current.findIndex(
        (item) => item.id === messageId && (item.status === "queued" || item.status === "failed")
      );
      if (idx < 0) return null;
      const [removed] = current.splice(idx, 1);
      this.queueByThread.set(threadId, current);
      this.saveThreadQueueNow(threadId);
      return {
        ...removed,
        inputs: cloneUserTurnInputs(removed.inputs ?? []),
      };
    },
    remove(threadIdValue: string, messageId: string) {
      const threadId = ensureThreadId(threadIdValue);
      const current = this.queueByThread.get(threadId) ?? [];
      const idx = current.findIndex((item) => item.id === messageId);
      if (idx < 0) return;
      current.splice(idx, 1);
      this.queueByThread.set(threadId, current);
      this.saveThreadQueueNow(threadId);
    },
    peekNextQueued(threadIdValue: string): QueuedMessage | null {
      const threadId = ensureThreadId(threadIdValue);
      const current = this.queueByThread.get(threadId) ?? [];
      for (const msg of current) {
        if (msg.status === "queued") return msg;
      }
      return null;
    },
  },
});
