import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, Notification, shell } from "electron";
import { execFile } from "node:child_process";
import { appendFile, lstat, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { IPC_APP_CHANNELS } from "@codenexus/shared/ipc/channels";
import { resolveUiFontSizeZoomFactor, type UserLocalSettingsPatch } from "@codenexus/shared/localSettings";
import { normalizeSafeExternalUrl } from "../../utils/externalUrl";
import type { AppTextEncoding } from "@codenexus/shared/ipc/contracts";
import type { LocalSettingsService } from "../../services/LocalSettingsService";
import type { CodexSkillRootsService } from "../../services/CodexSkillRootsService";
import type { CodexConfigSwitcherService } from "../../services/CodexConfigSwitcherService";
import type { UpdateService } from "../../services/UpdateService";
import type { CodexConfigSwitcherImportArgs, CodexConfigSwitcherState } from "@codenexus/shared/codexConfigSwitcher";
import {
  detectLineEnding,
  detectTextEncoding,
  encodeUtf8Text,
  isPathWithinDir,
  resolveLocalFilePath,
  safeJsonStringify,
  stripUtf8Bom,
  toLocalDateYmd,
  truncateText,
} from "./app-handler-utils";

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function readImageFileAsDataUrl(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();
  const directMime = IMAGE_MIME_BY_EXT[ext];
  if (directMime) {
    const buffer = await readFile(filePath);
    return `data:${directMime};base64,${buffer.toString("base64")}`;
  }
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) throw new Error("app:readImageFileDataUrl failed to load image");
  return image.toDataURL();
}

function focusMainWindow(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  try {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  } catch {}
}

const ALLOWED_NOTIFICATION_SOUND_EXTS = new Set<string>([".mp3", ".wav", ".ogg", ".m4a"]);
const activeSystemNotifications = new Set<Notification>();

function toAudioMime(ext: string): string {
  const e = String(ext ?? "")
    .trim()
    .toLowerCase();
  if (e === ".mp3") return "audio/mpeg";
  if (e === ".wav") return "audio/wav";
  if (e === ".ogg") return "audio/ogg";
  if (e === ".m4a") return "audio/mp4";
  return "application/octet-stream";
}

async function firstExistingDir(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      const s = await stat(candidate);
      if (s.isDirectory()) return candidate;
    } catch {}
  }
  return null;
}

function bundledMusicDirCandidates(): string[] {
  const out: string[] = [];
  try {
    const p = String(process.resourcesPath ?? "").trim();
    if (p) out.push(join(p, "music"));
  } catch {}
  try {
    out.push(join(app.getAppPath(), "music"));
  } catch {}
  return out;
}

function isSafeSoundId(id: unknown): id is string {
  const text = String(id ?? "").trim();
  if (!text) return false;
  if (text.includes("/") || text.includes("\\")) return false;
  if (text.includes("..")) return false;
  const ext = extname(text).toLowerCase();
  return ALLOWED_NOTIFICATION_SOUND_EXTS.has(ext);
}

function resolveSoundPathOrThrow(musicDir: string, id: string): string {
  const safeDir = resolve(musicDir);
  const filePath = resolve(join(safeDir, id));
  const rel = relative(safeDir, filePath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("app:notificationSound invalid path");
  if (!filePath.toLowerCase().startsWith((safeDir + sep).toLowerCase())) {
    throw new Error("app:notificationSound invalid path scope");
  }
  return filePath;
}

async function listNotificationSoundItems(musicDir: string) {
  const entries = await readdir(musicDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => ALLOWED_NOTIFICATION_SOUND_EXTS.has(extname(name).toLowerCase()))
    .map((name) => ({
      id: name,
      label: basename(name, extname(name)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
}

export function registerAppHandlers(deps: {
  getMainWindow: () => BrowserWindow | null;
  localSettingsService: LocalSettingsService;
  codexSkillRootsService: CodexSkillRootsService;
  codexConfigSwitcherService: CodexConfigSwitcherService;
  updateService: UpdateService;
}) {
  const { localSettingsService, codexSkillRootsService, codexConfigSwitcherService, updateService } = deps;
  const getWindowOrNull = (): BrowserWindow | null => {
    const win = deps.getMainWindow();
    if (!win || win.isDestroyed()) return null;
    return win;
  };

  ipcMain.handle(IPC_APP_CHANNELS.appSelectWorkspace, async () => {
    const mainWindow = deps.getMainWindow();
    if (!mainWindow) return null;

    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled) return null;
    return res.filePaths[0] ?? null;
  });

  ipcMain.handle(IPC_APP_CHANNELS.appOpenExternal, async (_evt, args: { url: string }) => {
    const url = normalizeSafeExternalUrl(args?.url ?? "");
    if (!url) throw new Error("app:openExternal blocked unsupported url protocol");
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle(IPC_APP_CHANNELS.appReadTextFile, async (_evt, args: { path: string }) => {
    const filePath = resolveLocalFilePath(args?.path ?? "");
    if (!filePath) throw new Error("app:readTextFile requires path");
    try {
      const raw = await readFile(filePath);
      const encoding = detectTextEncoding(raw);
      const content = stripUtf8Bom(raw).toString("utf8");
      return { ok: true, content, encoding, lineEnding: detectLineEnding(content) };
    } catch (error: any) {
      if (String(error?.code ?? "") === "ENOENT" && isPathWithinDir(filePath, app.getPath("userData"))) {
        return { ok: true, content: "", encoding: "UTF-8" as const, lineEnding: null };
      }
      throw error;
    }
  });

  ipcMain.handle(
    IPC_APP_CHANNELS.appWriteTextFile,
    async (_evt, args: { path: string; content: string; encoding?: AppTextEncoding }) => {
      const filePath = resolveLocalFilePath(args?.path ?? "");
      if (!filePath) throw new Error("app:writeTextFile requires path");
      const content = String(args?.content ?? "");
      const encoding = args?.encoding === "UTF-8 BOM" ? "UTF-8 BOM" : "UTF-8";
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, encodeUtf8Text(content, encoding));
      return { ok: true };
    }
  );

  ipcMain.handle(IPC_APP_CHANNELS.appDeleteFile, async (_evt, args: { path: string }) => {
    const filePath = resolveLocalFilePath(args?.path ?? "");
    if (!filePath) throw new Error("app:deleteFile requires path");
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("app:deleteFile path is not a file");
    await unlink(filePath);
    return { ok: true as const };
  });

  ipcMain.handle(IPC_APP_CHANNELS.appReadDirectory, async (_evt, args: { path: string }) => {
    const dirPath = resolveLocalFilePath(args?.path ?? "");
    if (!dirPath) throw new Error("app:readDirectory requires path");
    const info = await stat(dirPath);
    if (!info.isDirectory()) throw new Error("app:readDirectory path is not a directory");
    const entries = await readdir(dirPath, { withFileTypes: true });
    return {
      ok: true as const,
      entries: entries
        .map((entry) => ({
          fileName: entry.name,
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile(),
        }))
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.fileName.localeCompare(b.fileName, "zh-CN");
        }),
    };
  });

  ipcMain.handle(IPC_APP_CHANNELS.appGetFileMetadata, async (_evt, args: { path: string }) => {
    const filePath = resolveLocalFilePath(args?.path ?? "");
    if (!filePath) throw new Error("app:getFileMetadata requires path");
    const info = await stat(filePath);
    return {
      ok: true as const,
      metadata: {
        isDirectory: info.isDirectory(),
        isFile: info.isFile(),
        createdAtMs: Number.isFinite(info.birthtimeMs) ? Math.round(info.birthtimeMs) : 0,
        modifiedAtMs: Number.isFinite(info.mtimeMs) ? Math.round(info.mtimeMs) : 0,
      },
    };
  });

  ipcMain.handle(IPC_APP_CHANNELS.appLocalSettingsRead, async () => {
    const { exists, settings } = await localSettingsService.read();
    return { path: localSettingsService.path, exists, settings };
  });

  ipcMain.handle(IPC_APP_CHANNELS.appLocalSettingsPatch, async (_evt, args: { patch: UserLocalSettingsPatch }) => {
    const settings = await localSettingsService.patch(args?.patch ?? {});
    const win = getWindowOrNull();
    if (win) {
      try {
        win.webContents.setZoomFactor(resolveUiFontSizeZoomFactor(settings.ui.fontSizePreset));
      } catch {}
    }
    return { path: localSettingsService.path, exists: true as const, settings };
  });

  ipcMain.handle(IPC_APP_CHANNELS.appCodexSkillRootsRead, async () => {
    const { exists, state } = await codexSkillRootsService.read();
    return { path: codexSkillRootsService.path, exists, state };
  });

  ipcMain.handle(
    IPC_APP_CHANNELS.appCodexSkillRootsSetForWorkspace,
    async (_evt, args: { workspacePath: string; roots: string[] }) => {
      const state = await codexSkillRootsService.setRootsForWorkspace(args?.workspacePath ?? "", args?.roots ?? []);
      return { path: codexSkillRootsService.path, exists: true as const, state };
    }
  );

  ipcMain.handle(IPC_APP_CHANNELS.appCodexConfigSwitcherRead, async () => {
    return await codexConfigSwitcherService.read();
  });

  ipcMain.handle(
    IPC_APP_CHANNELS.appCodexConfigSwitcherSave,
    async (_evt, args: { state: CodexConfigSwitcherState }) => {
      return await codexConfigSwitcherService.save(args?.state ?? null);
    }
  );

  ipcMain.handle(IPC_APP_CHANNELS.appCodexConfigSwitcherActivateProfile, async (_evt, args: { profileId: string }) => {
    return await codexConfigSwitcherService.activateProfile(args?.profileId ?? "");
  });

  ipcMain.handle(
    IPC_APP_CHANNELS.appCodexConfigSwitcherImportCurrent,
    async (_evt, args: CodexConfigSwitcherImportArgs) => {
      return await codexConfigSwitcherService.importCurrentConfig(args ?? {});
    }
  );

  ipcMain.handle(IPC_APP_CHANNELS.appCodexConfigSwitcherRestoreBackup, async (_evt, args: { backupId: string }) => {
    return await codexConfigSwitcherService.restoreBackup(args?.backupId ?? "");
  });

  ipcMain.handle(IPC_APP_CHANNELS.appListNotificationSounds, async () => {
    const musicDir = await firstExistingDir(bundledMusicDirCandidates());
    if (!musicDir) return { items: [] };
    return { items: await listNotificationSoundItems(musicDir) };
  });

  ipcMain.handle(IPC_APP_CHANNELS.appReadNotificationSoundDataUrl, async (_evt, args: { id: string }) => {
    const id = String(args?.id ?? "").trim();
    if (!isSafeSoundId(id)) throw new Error("app:notificationSound invalid id");
    const musicDir = await firstExistingDir(bundledMusicDirCandidates());
    if (!musicDir) throw new Error("app:notificationSound dir not found");
    const items = await listNotificationSoundItems(musicDir);
    if (!items.some((item) => item.id === id)) throw new Error("app:notificationSound not listed");
    const filePath = resolveSoundPathOrThrow(musicDir, id);
    const fileInfo = await lstat(filePath);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
      throw new Error("app:notificationSound not a regular file");
    }
    const buf = await readFile(filePath);
    const ext = extname(id).toLowerCase();
    const mime = toAudioMime(ext);
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    return { ok: true, dataUrl };
  });

  ipcMain.handle(
    IPC_APP_CHANNELS.appSystemNotificationShow,
    async (_evt, args: { title?: string; body?: string; silent?: boolean }) => {
      if (!Notification.isSupported()) return { ok: false as const, reason: "unsupported" as const };
      try {
        const notification = new Notification({
          title: String(args?.title ?? "").trim() || app.getName() || "CodeNexus",
          body: String(args?.body ?? "").trim(),
          silent: Boolean(args?.silent),
        });
        // Electron 的通知对象如果过早被 GC，Windows 上可能出现点击无响应。
        // 保留到 close/click 后再释放，保证用户能从通知回到主窗口。
        activeSystemNotifications.add(notification);
        const release = () => activeSystemNotifications.delete(notification);
        notification.once("close", release);
        notification.once("click", () => {
          focusMainWindow(getWindowOrNull());
          release();
        });
        notification.show();
        return { ok: true as const };
      } catch (error: any) {
        return { ok: false as const, reason: "failed" as const, message: String(error?.message ?? error) };
      }
    }
  );

  ipcMain.handle(IPC_APP_CHANNELS.appSystemPowerShutdownNow, async () => {
    if (process.platform !== "win32") return { ok: false as const, reason: "unsupported" as const };
    return await new Promise<{ ok: true } | { ok: false; reason: "failed"; message: string }>((resolve) => {
      execFile("shutdown.exe", ["/s", "/t", "0"], { windowsHide: true }, (error) => {
        if (!error) {
          resolve({ ok: true as const });
          return;
        }
        resolve({ ok: false as const, reason: "failed" as const, message: String(error.message ?? error) });
      });
    });
  });

  ipcMain.handle(IPC_APP_CHANNELS.appUpdateGetState, async () => {
    return updateService.getState();
  });

  ipcMain.handle(IPC_APP_CHANNELS.appUpdateCheck, async () => {
    return await updateService.checkForUpdates();
  });

  ipcMain.handle(IPC_APP_CHANNELS.appUpdateDownload, async () => {
    return await updateService.downloadUpdate();
  });

  ipcMain.handle(IPC_APP_CHANNELS.appUpdateInstall, async () => {
    updateService.quitAndInstall();
    return { ok: true as const };
  });

  ipcMain.handle(IPC_APP_CHANNELS.appFileChangeLogAppend, async (_evt, args: { record: unknown }) => {
    const logDir = join(homedir(), ".codex", "logs");
    const logPath = join(logDir, `file-change-${toLocalDateYmd()}.txt`);

    const record = args?.record ?? null;
    const normalized = {
      ...(record && typeof record === "object" && !Array.isArray(record) ? (record as any) : { record }),
      paramsText: truncateText((record as any)?.paramsText, 200_000),
      delta: truncateText((record as any)?.delta, 400_000),
      chunk: truncateText((record as any)?.chunk, 400_000),
    };

    const line = `${safeJsonStringify(normalized)}\n`;
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, line, "utf8");
    return { ok: true, path: logPath };
  });

  ipcMain.handle(IPC_APP_CHANNELS.appReadClipboardImageDataUrl, async () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) return { ok: true, dataUrl: null };
    return { ok: true, dataUrl: image.toDataURL() };
  });

  ipcMain.handle(IPC_APP_CHANNELS.appWriteClipboardImageFromPath, async (_evt, args: { path: string }) => {
    const filePath = resolveLocalFilePath(args?.path ?? "");
    if (!filePath) throw new Error("app:writeClipboardImageFromPath requires path");
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) throw new Error("app:writeClipboardImageFromPath failed to load image");
    clipboard.writeImage(image);
    return { ok: true as const };
  });

  ipcMain.handle(IPC_APP_CHANNELS.appReadImageFileDataUrl, async (_evt, args: { path: string }) => {
    const filePath = resolveLocalFilePath(args?.path ?? "");
    if (!filePath) throw new Error("app:readImageFileDataUrl requires path");
    return { ok: true, dataUrl: await readImageFileAsDataUrl(filePath) };
  });
}
