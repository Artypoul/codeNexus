import { ipcMain, type BrowserWindow } from "electron";
import { IPC_APP_CHANNELS } from "@codenexus/shared/ipc/channels";
import type { AppWindowState } from "@codenexus/shared/ipc/contracts";

export function registerWindowHandlers(deps: { getMainWindow: () => BrowserWindow | null }) {
  const getWindowOrNull = (): BrowserWindow | null => {
    const win = deps.getMainWindow();
    if (!win || win.isDestroyed()) return null;
    return win;
  };

  const DEFAULT_WINDOW_STATE: AppWindowState = {
    isMaximized: false,
    isMinimized: false,
    isFullScreen: false,
    isFocused: false,
    isVisible: false,
  };

  const toWindowState = (win: BrowserWindow): AppWindowState => ({
    isMaximized: win.isMaximized(),
    isMinimized: win.isMinimized(),
    isFullScreen: win.isFullScreen(),
    isFocused: win.isFocused(),
    isVisible: win.isVisible(),
  });

  ipcMain.handle(IPC_APP_CHANNELS.appWindowGetState, async () => {
    const win = getWindowOrNull();
    return win ? toWindowState(win) : DEFAULT_WINDOW_STATE;
  });

  ipcMain.handle(IPC_APP_CHANNELS.appWindowMinimize, async () => {
    const win = getWindowOrNull();
    if (!win) return { ok: true };
    win.minimize();
    return { ok: true };
  });

  ipcMain.handle(IPC_APP_CHANNELS.appWindowToggleMaximize, async () => {
    const win = getWindowOrNull();
    if (!win) return { ok: true };
    if (win.isFullScreen()) win.setFullScreen(false);
    else if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return { ok: true };
  });

  ipcMain.on(IPC_APP_CHANNELS.appWindowClose, () => {
    const win = getWindowOrNull();
    if (!win) return;
    win.close();
  });

  ipcMain.handle(IPC_APP_CHANNELS.appWindowClose, async () => {
    const win = getWindowOrNull();
    if (!win) return { ok: true };
    win.close();
    return { ok: true };
  });
}
