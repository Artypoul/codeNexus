// App 域 IPC channels。
//
// 这一组覆盖 renderer 需要借助 main process 完成的桌面能力：文件系统、系统通知、更新、窗口控制，
// 以及挂载在 app 命名空间下的 feature 能力。key 供 preload/API 层映射，value 是真正传给 Electron IPC 的频道名。
export const IPC_APP_CHANNELS = {
  // 工作区选择与外部资源打开：涉及系统对话框或 OS shell，必须留在 main process 侧处理。
  appSelectWorkspace: "app:selectWorkspace",
  appOpenExternal: "app:openExternal",

  // 文件系统读写：renderer 不直接访问本地路径，统一通过 preload 白名单和 main handler 转发。
  appReadTextFile: "app:readTextFile",
  appWriteTextFile: "app:writeTextFile",
  appDeleteFile: "app:deleteFile",
  appReadDirectory: "app:readDirectory",
  appGetFileMetadata: "app:getFileMetadata",

  // 本地用户设置：UI 配置、偏好项等长期状态从这里进入持久化服务。
  appLocalSettingsRead: "app:localSettings:read",
  appLocalSettingsPatch: "app:localSettings:patch",

  // Codex 供应商与认证配置：包含 profile 管理、API key 读写和连通性测试。
  appCodexProfilesRead: "app:codexProfiles:read",
  appCodexProfilesUpsert: "app:codexProfiles:upsert",
  appCodexProfilesDelete: "app:codexProfiles:delete",
  appCodexProfilesSetActive: "app:codexProfiles:setActive",
  appCodexAuthReadApiKey: "app:codexAuth:readApiKey",
  appCodexAuthWriteApiKey: "app:codexAuth:writeApiKey",
  appCodexProviderTest: "app:codexProvider:test",
  appDeepSeekProxyPrepare: "app:deepSeekProxy:prepare",

  // Codex 工作区附加配置：技能根目录和配置切换器都和当前机器上的文件状态有关。
  appCodexSkillRootsRead: "app:codexSkillRoots:read",
  appCodexSkillRootsSetForWorkspace: "app:codexSkillRoots:setForWorkspace",
  appCodexConfigSwitcherRead: "app:codexConfigSwitcher:read",
  appCodexConfigSwitcherSave: "app:codexConfigSwitcher:save",
  appCodexConfigSwitcherActivateProfile: "app:codexConfigSwitcher:activateProfile",
  appCodexConfigSwitcherImportCurrent: "app:codexConfigSwitcher:importCurrent",
  appCodexConfigSwitcherRestoreBackup: "app:codexConfigSwitcher:restoreBackup",

  // 系统通知、声音和电源操作：属于 OS 级能力，renderer 只提交意图和参数。
  appListNotificationSounds: "app:notificationSound:list",
  appReadNotificationSoundDataUrl: "app:notificationSound:readDataUrl",
  appSystemNotificationShow: "app:systemNotification:show",
  appSystemPowerShutdownNow: "app:systemPower:shutdownNow",

  // 应用更新流程：查询状态、触发检查、下载、安装，以及更新状态广播频道。
  appUpdateGetState: "app:update:getState",
  appUpdateCheck: "app:update:check",
  appUpdateDownload: "app:update:download",
  appUpdateInstall: "app:update:install",
  appUpdateState: "app:update:state",

  // 操作记录与剪贴板/图片桥接：用于跨层传递本地文件、图片 data URL 和变更审计记录。
  appFileChangeLogAppend: "app:fileChangeLog:append",
  appReadClipboardImageDataUrl: "app:readClipboardImageDataUrl",
  appWriteClipboardImageFromPath: "app:writeClipboardImageFromPath",
  appReadImageFileDataUrl: "app:readImageFileDataUrl",

  // 图片生成 feature 频道：频道归 app 命名空间，具体参数契约由 feature-imagegen 扩展到 preload API。
  appImageGenerationGenerate: "app:imageGeneration:generate",
  appImageGenerationHistoryList: "app:imageGeneration:historyList",
  appImageGenerationHistoryDelete: "app:imageGeneration:historyDelete",
  appImageGenerationTaskList: "app:imageGeneration:taskList",
  appImageGenerationTaskSubmit: "app:imageGeneration:taskSubmit",
  appImageGenerationTaskCancel: "app:imageGeneration:taskCancel",
  appImageGenerationTaskDelete: "app:imageGeneration:taskDelete",
  appImageGenerationTaskRetry: "app:imageGeneration:taskRetry",

  // 窗口控制：服务自定义标题栏；状态类频道用于 renderer 订阅窗口变化。
  appWindowGetState: "app:window:getState",
  appWindowMinimize: "app:window:minimize",
  appWindowToggleMaximize: "app:window:toggleMaximize",
  appWindowClose: "app:window:close",
  appWindowState: "app:window:state",
  appWindowClosingState: "app:window:closingState",
} as const;
