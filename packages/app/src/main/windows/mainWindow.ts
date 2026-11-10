import { app, BrowserWindow, shell } from "electron";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { normalizeSafeExternalUrl } from "../utils/externalUrl";
import { logger } from "../utils/logger";
import { IPC_APP_CHANNELS } from "@codenexus/shared/ipc/channels";
import type { AppWindowState } from "@codenexus/shared/ipc/contracts";
import { resolveUiFontSizeZoomFactor, type UserLocalSettings } from "@codenexus/shared/localSettings";
import { installWindowsMenu } from "./windowsMenu";
import { T3_URL } from "../t3/t3Protocol";

export type MainWindowOptions = {
  isDev: boolean;
  devServerUrl?: string;
  initialLocalSettingsSnapshot: { path: string; exists: boolean; settings: UserLocalSettings };
};

function resolveWindowIconPath(): string | undefined {
  if (process.platform !== "win32") return undefined;

  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "icon.ico")]
    : [resolve(app.getAppPath(), "build", "icon.ico"), resolve(app.getAppPath(), "CodeNexus.png")];

  return candidates.find((candidate) => existsSync(candidate));
}

export async function createMainWindow(opts: MainWindowOptions): Promise<BrowserWindow> {
  // Windows 使用自定义标题栏（渲染层自绘 + IPC 控制窗口），不使用原生 caption buttons。
  const useT3Client = !opts.isDev && existsSync(join(app.getAppPath(), "dist/t3-client/index.html"));
  const useCustomTitlebar = process.platform === "win32" && !useT3Client;

  const initialLocalSettingsArg = `--codex-local-settings=${Buffer.from(JSON.stringify(opts.initialLocalSettingsSnapshot), "utf8").toString("base64url")}`;
  const windowIcon = resolveWindowIconPath();
  const shouldOpenDevTools = opts.isDev && process.env.CODENEXUS_OPEN_DEVTOOLS !== "0";

  type DevToolsMode = "right" | "bottom" | "undocked" | "detach";
  const envMode = (process.env.CODENEXUS_DEVTOOLS_MODE || "").trim();
  const devToolsMode: DevToolsMode = (["right", "bottom", "undocked", "detach"] as const).includes(
    envMode as DevToolsMode
  )
    ? (envMode as DevToolsMode)
    : "right";

  const win = new BrowserWindow({
    width: 1200,
    minWidth: 950,
    height: 780,
    autoHideMenuBar: true,
    backgroundColor: "#181818",
    frame: !useCustomTitlebar,
    ...(useT3Client && process.platform === "win32"
      ? { titleBarStyle: "hidden" as const, titleBarOverlay: { color: "#181818", symbolColor: "#ffffff", height: 40 } }
      : {}),
    icon: windowIcon,
    webPreferences: {
      // 预加载脚本负责暴露受控 API，渲染进程不直接访问 Node。
      preload: resolve(app.getAppPath(), "dist/preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Windows 最小化后 Chromium 默认会节流/暂停后台页面的动画与定时器。
      // 本应用会持续接收流式输出，若后台刷新被暂停，恢复窗口时会集中渲染积压内容并短暂卡死。
      backgroundThrottling: false,
      additionalArguments: [initialLocalSettingsArg],
    },
  });

  try {
    const zoomFactor = resolveUiFontSizeZoomFactor(opts.initialLocalSettingsSnapshot.settings.ui.fontSizePreset);
    if (Number.isFinite(zoomFactor) && zoomFactor > 0) {
      win.webContents.setZoomFactor(zoomFactor);
    }
  } catch (error) {
    logger.warn("window", "failed to set initial zoom factor", error);
  }

  // 禁止渲染进程自行打开新窗口；外链统一交给系统浏览器。
  win.webContents.setWindowOpenHandler(({ url }) => {
    const safeUrl = normalizeSafeExternalUrl(url);
    if (safeUrl) void shell.openExternal(safeUrl);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    const current = win.webContents.getURL();
    if (url === current) return;
    event.preventDefault();
    const safeUrl = normalizeSafeExternalUrl(url);
    if (safeUrl) void shell.openExternal(safeUrl);
  });

  // 即使系统切换了 autoHideMenuBar，也强制隐藏菜单栏。
  try {
    win.setMenuBarVisibility(false);
    win.removeMenu();
  } catch (error) {
    logger.warn("window", "failed to hide menu bar", error);
  }

  if (process.platform === "win32") installWindowsMenu(win);

  const toWindowState = (): AppWindowState => ({
    isMaximized: win.isMaximized(),
    isMinimized: win.isMinimized(),
    isFullScreen: win.isFullScreen(),
    isFocused: win.isFocused(),
    isVisible: win.isVisible(),
  });

  const pushWindowState = () => {
    try {
      win.webContents.send(IPC_APP_CHANNELS.appWindowState, toWindowState());
    } catch (error) {
      logger.warn("window", "failed to push window state", error);
    }
  };

  // 首屏加载完成后同步一次状态；并在窗口状态变化时持续推送。
  win.webContents.on("did-finish-load", pushWindowState);
  win.on("maximize", pushWindowState);
  win.on("unmaximize", pushWindowState);
  win.on("minimize", pushWindowState);
  win.on("restore", pushWindowState);
  win.on("focus", pushWindowState);
  win.on("blur", pushWindowState);
  win.on("enter-full-screen", pushWindowState);
  win.on("leave-full-screen", pushWindowState);

  if (opts.isDev && opts.devServerUrl) {
    // 开发态加载 Vite dev server，方便热更新与调试。
    await win.loadURL(opts.devServerUrl);
  } else if (useT3Client) {
    await win.loadURL(T3_URL);
  } else {
    // 生产态加载本地构建产物。
    await win.loadFile(join(app.getAppPath(), "dist/renderer/index.html"));
  }

  const openDevToolsOnce = (reason: string) => {
    if (!shouldOpenDevTools) return;
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    if (win.webContents.isDevToolsOpened()) return;
    try {
      win.webContents.openDevTools({ mode: devToolsMode });
    } catch (error) {
      console.warn(`[main] DevTools open failed (${reason})`, error);
    }
  };

  // Vite dev server 首次加载时，DevTools 可能需要在页面 ready 后再打开才可见。
  win.webContents.once("did-finish-load", () => {
    setTimeout(() => openDevToolsOnce("did-finish-load"), 50);
  });
  setTimeout(() => openDevToolsOnce("post-load-timeout"), 1500);

  return win;
}
