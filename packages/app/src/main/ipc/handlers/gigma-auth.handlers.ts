import { ipcMain } from "electron";
import { IPC_CODEX_CHANNELS } from "@codenexus/shared/ipc/channels";
import { GigmaAuthClient } from "../../services/GigmaAuthClient";
import { GigmaAuthProcessSupervisor } from "../../services/GigmaAuthProcessSupervisor";

export function registerGigmaAuthHandlers(auth: GigmaAuthClient, process?: GigmaAuthProcessSupervisor): void {
  ipcMain.handle(IPC_CODEX_CHANNELS.gigmaAuthStatus, () => auth.status());
  ipcMain.handle(IPC_CODEX_CHANNELS.gigmaAuthStartLogin, async () => {
    await process?.ensure();
    return auth.startLogin();
  });
  ipcMain.handle(IPC_CODEX_CHANNELS.gigmaAuthPollLogin, () => auth.pollLogin());
  ipcMain.handle(IPC_CODEX_CHANNELS.gigmaAuthCancelLogin, (_event, flowId: string) => auth.cancelLogin(flowId));
  ipcMain.handle(IPC_CODEX_CHANNELS.gigmaAuthLogout, () => auth.logout());
}
