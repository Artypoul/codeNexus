import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHistoryRewriteRuntime } from "./historyRewriteRuntime";
import type { TimelineEventItem } from "../types";

const { confirmModal } = vi.hoisted(() => ({
  confirmModal: vi.fn(),
}));

vi.mock("../../ui/modal", () => ({ confirmModal }));
vi.mock("../../api/codexDesktopClient", () => ({
  codexDesktop: {
    workspace: {
      dryRunApplyReverseDiff: vi.fn(async () => ({ ok: true })),
      applyReverseDiff: vi.fn(async () => ({ ok: true, files: [] })),
    },
  },
}));

function userEvent(id: string, turnId: string): TimelineEventItem {
  return {
    id,
    method: "user",
    paramsText: "message",
    turnId,
    localKind: "user",
  } as TimelineEventItem;
}

function createRuntime(events: TimelineEventItem[], completedTurnIds: string[] = ["turn-1"]) {
  const threadId = "thread-1";
  const timelineStore = {
    eventsForThread: vi.fn(() => events),
    removeTurnEvents: vi.fn(),
  };
  const completedTurns = completedTurnIds.map((turnId, index) => ({
    turnId,
    diffText: "",
    completedAt: index + 1,
  }));
  const threadStore = {
    runningThreadIds: new Set<string>(),
    activeTurnIdByThread: new Map<string, string>(),
    completedTurnsByThread: new Map([[threadId, completedTurns]]),
    removeTurnsFromState: vi.fn(),
  };
  const runtimeStore = {
    historyRewriteActive: true,
    historyRewriteSource: "history" as const,
    historyRewriteAnchorTurnId: "turn-1",
    historyRewriteAnchorEventId: "user-1",
    workspacePath: "C:\\workspace",
  };
  const translate = (key: string) => key;
  const showToast = vi.fn();

  const runtime = createHistoryRewriteRuntime({
    runtimeStore: runtimeStore as never,
    threadStore: threadStore as never,
    timelineStore: timelineStore as never,
    normalizeWorkspacePath: (value) => value,
    getWorkspaceForThread: () => "C:\\workspace",
    getServerIdForThread: () => "server-1",
    ensureThreadResumed: vi.fn(async () => true),
    requestThreadRollback: vi.fn(async () => true),
    requestTurnInterrupt: vi.fn(async () => true),
    pushEvent: vi.fn(),
    translate,
    showToast,
  });

  return { runtime, timelineStore, threadStore, showToast };
}

describe("history rewrite confirmation", () => {
  beforeEach(() => {
    confirmModal.mockReset();
  });

  it("does not prompt when only lifecycle events follow the anchor", async () => {
    const { runtime, timelineStore } = createRuntime([
      userEvent("user-1", "turn-1"),
      { id: "started", method: "turn/started", paramsText: "", turnId: "turn-1", hidden: true } as TimelineEventItem,
      {
        id: "completed",
        method: "turn/completed",
        paramsText: "",
        turnId: "turn-1",
        hidden: true,
      } as TimelineEventItem,
    ]);

    await expect(
      runtime.rollbackHistoryRewriteBeforeSend("thread-1", { anchorTurnId: "turn-1", force: true })
    ).resolves.toBe(true);
    expect(confirmModal).not.toHaveBeenCalled();
    expect(timelineStore.removeTurnEvents).toHaveBeenCalledWith("thread-1", ["turn-1"]);
  });

  it("does not prompt when editing the latest completed turn", async () => {
    const { runtime, timelineStore } = createRuntime([
      userEvent("user-1", "turn-1"),
      {
        id: "assistant-1",
        method: "item/agentMessage/delta",
        paramsText: "answer",
        turnId: "turn-1",
      } as TimelineEventItem,
    ]);

    await expect(
      runtime.rollbackHistoryRewriteBeforeSend("thread-1", { anchorTurnId: "turn-1", force: true })
    ).resolves.toBe(true);
    expect(confirmModal).not.toHaveBeenCalled();
    expect(timelineStore.removeTurnEvents).toHaveBeenCalledWith("thread-1", ["turn-1"]);
  });

  it("prompts when an additional completed turn follows the anchor", async () => {
    confirmModal.mockResolvedValue(false);
    const { runtime } = createRuntime(
      [
        userEvent("user-1", "turn-1"),
        {
          id: "assistant-1",
          method: "item/agentMessage/delta",
          paramsText: "answer",
          turnId: "turn-1",
        } as TimelineEventItem,
        userEvent("user-2", "turn-2"),
        {
          id: "assistant-2",
          method: "item/agentMessage/delta",
          paramsText: "follow-up answer",
          turnId: "turn-2",
        } as TimelineEventItem,
      ],
      ["turn-1", "turn-2"]
    );

    await expect(
      runtime.rollbackHistoryRewriteBeforeSend("thread-1", { anchorTurnId: "turn-1", force: true })
    ).resolves.toBe(false);
    expect(confirmModal).toHaveBeenCalledOnce();
  });
});
