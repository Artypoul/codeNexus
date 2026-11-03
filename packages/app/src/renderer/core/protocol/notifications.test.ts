import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeNotification } from "./notifications";

describe("normalizeNotification", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ignores deprecated fileChange outputDelta notifications", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(
      normalizeNotification({
        method: "item/fileChange/outputDelta",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-1",
          delta: "*** Begin Patch\n",
        },
      })
    ).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("normalizes fileChange patchUpdated notifications", () => {
    const notification = normalizeNotification(
      {
        method: "item/fileChange/patchUpdated",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-1",
          changes: [{ path: "README.md", kind: { type: "update" }, diff: "@@ -1 +1 @@" }],
        },
      },
      "server-1"
    );

    expect(notification).toMatchObject({
      method: "item/fileChange/patchUpdated",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      serverId: "server-1",
    });
  });
});
