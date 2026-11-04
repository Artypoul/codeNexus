import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useRuntimeStore } from "./runtime.store";

vi.mock("../domain/localDraftState", () => ({
  clearSavedLocalDraftThreadState: vi.fn(),
  saveLocalDraftThreadState: vi.fn(),
  saveLocalDraftThreadStates: vi.fn(),
}));

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("thread-scoped scroll requests", () => {
  it("ignores scroll requests from a background thread", () => {
    const store = useRuntimeStore();
    store.currentThreadId = "thread-b";
    store.requestScrollTimelineToBottom("thread-a");
    expect(store.timelineScrollToBottomSeq).toBe(0);
    store.requestScrollTimelineToBottom("thread-b");
    expect(store.timelineScrollToBottomSeq).toBe(1);
  });

  it("defaults explicit requests to the current timeline, including the app timeline", () => {
    const store = useRuntimeStore();
    store.requestScrollTimelineToBottom();
    expect(store.timelineScrollToBottomSeq).toBe(1);
    store.currentThreadId = "thread-a";
    store.requestScrollTimelineToBottom();
    expect(store.timelineScrollToBottomSeq).toBe(2);
  });
});
