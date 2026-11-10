import { ipcRenderer } from "electron";
import { IPC_CODEX_CHANNELS } from "../channels";
import type { CodexDesktopApi } from "../types";

export function createGigmaAuthApi(ipc: typeof ipcRenderer): CodexDesktopApi["gigmaAuth"] {
  return {
    status: () => ipc.invoke(IPC_CODEX_CHANNELS.gigmaAuthStatus),
    startLogin: () => ipc.invoke(IPC_CODEX_CHANNELS.gigmaAuthStartLogin),
    pollLogin: () => ipc.invoke(IPC_CODEX_CHANNELS.gigmaAuthPollLogin),
    cancelLogin: (flowId) => ipc.invoke(IPC_CODEX_CHANNELS.gigmaAuthCancelLogin, flowId),
    logout: () => ipc.invoke(IPC_CODEX_CHANNELS.gigmaAuthLogout),
  };
}
