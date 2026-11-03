import { IPC_APP_CHANNELS } from "./channels/app";
import { IPC_CACHE_CHANNELS } from "./channels/cache";
import { IPC_CODEX_CHANNELS } from "./channels/codex";
import { IPC_EVENT_CHANNELS } from "./channels/events";
import { IPC_HISTORY_CHANNELS } from "./channels/history";
import { IPC_WORKSPACE_CHANNELS } from "./channels/workspace";

/*
 * IPC Channel 常量聚合层
 * ─────────────────────────────────────────────────────────────
 * 作用域：Main / Preload / Renderer 三层共享
 * 单一事实来源：按业务域拆分的 channel 常量集合
 * 模块关系：channels/* 各子模块定义具体 channel，本文件聚合并导出
 */

// 按域拆分的 IPC channel 常量：Main/Preload/Renderer 共享的单一事实来源。
export {
  IPC_APP_CHANNELS,
  IPC_CODEX_CHANNELS,
  IPC_WORKSPACE_CHANNELS,
  IPC_HISTORY_CHANNELS,
  IPC_CACHE_CHANNELS,
  IPC_EVENT_CHANNELS,
};
