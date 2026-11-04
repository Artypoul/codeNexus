import { ipcMain } from "electron";
import { IPC_USAGE_CHANNELS } from "@codenexus/shared/ipc/channels";
import type { TokenUsageStatsArgs } from "@codenexus/shared/ipc/contracts";
import type { UsageStatsService } from "../../services/UsageStatsService";

export function registerUsageHandlers(deps: { usageStatsService: UsageStatsService }) {
  ipcMain.handle(IPC_USAGE_CHANNELS.usageTokenStats, async (_event, args?: TokenUsageStatsArgs) => {
    return await deps.usageStatsService.getTokenStats({
      startDate: String(args?.startDate ?? ""),
      endDate: String(args?.endDate ?? ""),
    });
  });
}
