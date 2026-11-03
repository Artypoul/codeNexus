import { type IpcRenderer } from "electron";
import { type CodexDesktopApi } from "./types";
import { createAppApi } from "./client/app";
import { createCacheApi } from "./client/cache";
import { createCodexServerApi } from "./client/codexServer";
import { createHistoryApi } from "./client/history";
import { createLocalStateApi } from "./client/localState";
import { createWindowApi } from "./client/window";
import { createWorkspaceApi } from "./client/workspace";

// 统一组装渲染层可见的桌面能力，隐藏底层 IPC 细节。
export function createCodexDesktopApi(
  ipcRenderer: IpcRenderer,
  initialLocalSettingsSnapshot: CodexDesktopApi["localState"]["initialSettingsSnapshot"]
): CodexDesktopApi {
  return {
    // 应用基础能力：文件、图片、通知、剪贴板与系统输入。
    app: createAppApi(ipcRenderer),
    // 窗口控制：最小化、最大化、关闭与状态监听。
    window: createWindowApi(ipcRenderer),
    // 本地设置：注入首屏快照并读取/修改用户配置。
    localState: createLocalStateApi(ipcRenderer, initialLocalSettingsSnapshot),
    // 缓存管理：查看和清理各类缓存。
    cache: createCacheApi(ipcRenderer),
    // Codex 服务：启动进程、请求/通知与事件订阅。
    codexServer: createCodexServerApi(ipcRenderer),
    // 工作区能力：选择目录与应用反向 diff。
    workspace: createWorkspaceApi(ipcRenderer),
    // 历史能力：列表、回放、任务和工件。
    history: createHistoryApi(ipcRenderer),
  };
}
