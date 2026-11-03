import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();

vi.mock("../../api/codexDesktopClient", () => ({
  codexDesktop: {
    codexServer: {
      rpc: (...args: unknown[]) => rpcMock(...args),
    },
  },
}));

import { createConfigRuntime } from "./configRuntime";

describe("configRuntime", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ result: {} });
  });

  it("hot-reloads user config after batch writes", async () => {
    const runtime = createConfigRuntime({
      requireActiveWorkspaceServerId: () => "server-1",
      getWorkspacePath: () => "D:/workspace",
    });

    await runtime.requestConfigBatchWrite([{ keyPath: "features.apply_patch_streaming_events", value: true }]);

    expect(rpcMock).toHaveBeenCalledWith({
      serverId: "server-1",
      method: "config/batchWrite",
      params: {
        edits: [
          {
            keyPath: "features.apply_patch_streaming_events",
            value: true,
            mergeStrategy: "replace",
          },
        ],
        filePath: null,
        reloadUserConfig: true,
      },
    });
  });
});
