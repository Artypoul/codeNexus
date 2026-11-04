import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useMessageQueueStore } from "./messageQueue.store";
import { normalizeLocalMessageOutbox } from "@codenexus/shared/localMessageOutbox";
import { saveLocalMessageOutboxThread } from "../domain/localMessageOutbox";
import type { UserTurnInput } from "../domain/types";

vi.mock("../domain/localMessageOutbox", () => ({
  clearSavedLocalMessageOutboxThread: vi.fn(),
  saveLocalMessageOutboxThread: vi.fn(),
}));

beforeEach(() => setActivePinia(createPinia()));

describe("queued structured input", () => {
  it("preserves skills and mentions through enqueue, persistence and hydration", () => {
    const store = useMessageQueueStore();
    const inputs: UserTurnInput[] = [
      { type: "skill", name: "review", path: "C:/skills/review/SKILL.md" },
      { type: "mention", name: "file.ts", path: "C:/repo/file.ts" },
    ];
    store.enqueue({ threadId: "thread", text: "$review", inputs });
    expect(store.queueByThread.get("thread")![0].inputs).toEqual(inputs);
    expect(saveLocalMessageOutboxThread).toHaveBeenLastCalledWith("thread", [expect.objectContaining({ inputs })]);
    const snapshot = {
      version: 1 as const,
      updatedAt: 0,
      threads: { thread: store.queueByThread.get("thread")!.map((item) => ({ ...item, status: "queued" as const })) },
    };
    store.hydrateFromLocalMessageOutbox(normalizeLocalMessageOutbox(JSON.parse(JSON.stringify(snapshot))));
    expect(store.peekNextQueued("thread")!.inputs).toEqual(inputs);
    expect(store.peekNextQueued("thread")!.inputs[0]).not.toBe(inputs[0]);
  });
});
