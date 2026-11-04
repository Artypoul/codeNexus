import { describe, expect, it, vi } from "vitest";
import { notifyTurnCompleted, shouldSendSystemNotification } from "./systemNotification";

describe("shouldSendSystemNotification", () => {
  it("应用在前台且可见时不发送系统通知", () => {
    expect(shouldSendSystemNotification({ focused: true, hidden: false, minimized: false })).toBe(false);
  });

  it("窗口失焦、隐藏或最小化时发送系统通知", () => {
    expect(shouldSendSystemNotification({ focused: false, hidden: false, minimized: false })).toBe(true);
    expect(shouldSendSystemNotification({ focused: true, hidden: true, minimized: false })).toBe(true);
    expect(shouldSendSystemNotification({ focused: true, hidden: false, minimized: true })).toBe(true);
  });
});

describe("notifyTurnCompleted", () => {
  it("后台完成任务时展示包含线程标题的系统通知", async () => {
    const showSystemNotification = vi.fn(async () => ({ ok: true as const }));

    await notifyTurnCompleted({
      app: { showSystemNotification },
      focused: false,
      hidden: false,
      minimized: false,
      threadTitle: "整理发布说明",
    });

    expect(showSystemNotification).toHaveBeenCalledWith({
      title: "任务完成",
      body: "整理发布说明 已完成一次回复。",
      silent: true,
    });
  });

  it("应用在前台时不打扰用户", async () => {
    const showSystemNotification = vi.fn(async () => ({ ok: true as const }));

    await notifyTurnCompleted({
      app: { showSystemNotification },
      focused: true,
      hidden: false,
      minimized: false,
      threadTitle: "整理发布说明",
    });

    expect(showSystemNotification).not.toHaveBeenCalled();
  });
});
