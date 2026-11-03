import { type IpcRenderer } from "electron";
import { IPC_APP_CHANNELS } from "../channels";
import { type CodexDesktopApi } from "../types";

export function createAppApi(ipcRenderer: IpcRenderer): CodexDesktopApi["app"] {
  return {
    // 打开外部链接：交给系统浏览器处理。
    openExternal: (args) => ipcRenderer.invoke(IPC_APP_CHANNELS.appOpenExternal, args),
    // 读取文本文件：由主进程统一访问磁盘。
    readTextFile: (args) => ipcRenderer.invoke(IPC_APP_CHANNELS.appReadTextFile, args),
    // 写入文本文件：用于工作区编辑与本地持久化。
    writeTextFile: (args) => ipcRenderer.invoke(IPC_APP_CHANNELS.appWriteTextFile, args),
    // 删除本地文件：用于工作区文件面板的显式删除操作。
    deleteFile: (args) => ipcRenderer.invoke(IPC_APP_CHANNELS.appDeleteFile, args),
    // 读取目录：用于文件面板和工作区浏览。
    readDirectory: (args) => ipcRenderer.invoke(IPC_APP_CHANNELS.appReadDirectory, args),
    // 获取文件元信息：用于判断类型、大小和修改时间。
    getFileMetadata: (args) => ipcRenderer.invoke(IPC_APP_CHANNELS.appGetFileMetadata, args),
    // 列出通知音：用于设置页选择提示音。
    listNotificationSounds: () => ipcRenderer.invoke(IPC_APP_CHANNELS.appListNotificationSounds),
    // 读取通知音数据：供音频预览和播放使用。
    readNotificationSoundDataUrl: (args) => ipcRenderer.invoke(IPC_APP_CHANNELS.appReadNotificationSoundDataUrl, args),
    // 显示系统通知：用于任务完成、更新提醒等场景。
    showSystemNotification: (args) => ipcRenderer.invoke(IPC_APP_CHANNELS.appSystemNotificationShow, args),
    // 执行系统关机：仅由主进程白名单命令处理。
    shutdownSystemNow: () => ipcRenderer.invoke(IPC_APP_CHANNELS.appSystemPowerShutdownNow),
    getUpdateState: () => ipcRenderer.invoke(IPC_APP_CHANNELS.appUpdateGetState),
    checkForUpdates: () => ipcRenderer.invoke(IPC_APP_CHANNELS.appUpdateCheck),
    downloadUpdate: () => ipcRenderer.invoke(IPC_APP_CHANNELS.appUpdateDownload),
    installUpdate: () => ipcRenderer.invoke(IPC_APP_CHANNELS.appUpdateInstall),
    onUpdateState: (cb) => {
      const listener = (_evt: unknown, payload: any) => cb(payload);
      ipcRenderer.on(IPC_APP_CHANNELS.appUpdateState, listener);
      return () => ipcRenderer.off(IPC_APP_CHANNELS.appUpdateState, listener);
    },
    // 追加文件变更日志：给时间线和调试页留痕。
    appendFileChangeLog: (args) => ipcRenderer.invoke(IPC_APP_CHANNELS.appFileChangeLogAppend, args),
    // 读取剪贴板图片：把当前剪贴板内容转成可预览数据。
    readClipboardImageDataUrl: () => ipcRenderer.invoke(IPC_APP_CHANNELS.appReadClipboardImageDataUrl),
    // 写入剪贴板图片：用于一键复制生成结果。
    writeClipboardImageFromPath: (args) => ipcRenderer.invoke(IPC_APP_CHANNELS.appWriteClipboardImageFromPath, args),
    // 读取图片文件：用于附件预览和图片工具。
    readImageFileDataUrl: (args) => ipcRenderer.invoke(IPC_APP_CHANNELS.appReadImageFileDataUrl, args),
    // 生成图片：调用主进程的图片生成能力。
    generateImage: (args) => ipcRenderer.invoke(IPC_APP_CHANNELS.appImageGenerationGenerate, args),
    // 图片生成历史：跨重启保存的批次记录。
    listImageGenerationHistory: () => ipcRenderer.invoke(IPC_APP_CHANNELS.appImageGenerationHistoryList),
    // 删除图片生成历史：同步清理安全范围内的生成文件。
    deleteImageGenerationHistory: (args) => ipcRenderer.invoke(IPC_APP_CHANNELS.appImageGenerationHistoryDelete, args),
    listImageGenerationTasks: () => ipcRenderer.invoke(IPC_APP_CHANNELS.appImageGenerationTaskList),
    submitImageGenerationTask: (args) => ipcRenderer.invoke(IPC_APP_CHANNELS.appImageGenerationTaskSubmit, args),
    cancelImageGenerationTask: (args) => ipcRenderer.invoke(IPC_APP_CHANNELS.appImageGenerationTaskCancel, args),
    deleteImageGenerationTask: (args) => ipcRenderer.invoke(IPC_APP_CHANNELS.appImageGenerationTaskDelete, args),
    retryImageGenerationTask: (args) => ipcRenderer.invoke(IPC_APP_CHANNELS.appImageGenerationTaskRetry, args),
    // 读取 skill roots：获取当前启用的技能根目录。
    readCodexSkillRoots: () => ipcRenderer.invoke(IPC_APP_CHANNELS.appCodexSkillRootsRead),
    // 为当前工作区设置 skill roots：联动工作区与技能配置。
    setCodexSkillRootsForWorkspace: (args) =>
      ipcRenderer.invoke(IPC_APP_CHANNELS.appCodexSkillRootsSetForWorkspace, args),
    readCodexConfigSwitcher: () => ipcRenderer.invoke(IPC_APP_CHANNELS.appCodexConfigSwitcherRead),
    saveCodexConfigSwitcher: (args) => ipcRenderer.invoke(IPC_APP_CHANNELS.appCodexConfigSwitcherSave, args),
    activateCodexConfigSwitcherProfile: (args) =>
      ipcRenderer.invoke(IPC_APP_CHANNELS.appCodexConfigSwitcherActivateProfile, args),
    importCurrentCodexConfigSwitcher: (args) =>
      ipcRenderer.invoke(IPC_APP_CHANNELS.appCodexConfigSwitcherImportCurrent, args),
    restoreCodexConfigSwitcherBackup: (args) =>
      ipcRenderer.invoke(IPC_APP_CHANNELS.appCodexConfigSwitcherRestoreBackup, args),
  } satisfies CodexDesktopApi["app"];
}
