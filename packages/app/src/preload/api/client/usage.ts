import { type IpcRenderer } from "electron";
import { IPC_USAGE_CHANNELS } from "../channels";
import { type CodexDesktopApi } from "../types";

export function createUsageApi(ipcRenderer: IpcRenderer): CodexDesktopApi["usage"] {
  return {
    getTokenStats: (args) => ipcRenderer.invoke(IPC_USAGE_CHANNELS.usageTokenStats, args),
  } satisfies CodexDesktopApi["usage"];
}
