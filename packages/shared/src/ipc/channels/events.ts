// 事件广播域 IPC channels。
//
// 这里的频道主要用于 main process 主动推送状态变化到 renderer，不是 request/response 调用入口。
export const IPC_EVENT_CHANNELS = {
  // Codex server 产生的流式事件、请求事件和运行时通知统一从这里广播。
  codexEvent: "codex:event",

  // 历史列表或线程元数据发生变化后，用于通知 renderer 刷新本地视图。
  historyUpdated: "history:updated",
} as const;
