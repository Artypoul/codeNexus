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

/*
 * IpcChannel 联合类型
 * ─────────────────────────────────────────────────────────────
 * 作用域：全局 IPC 消息路由
 * 数据结构：所有 domain channel 值的联合
 * 用途：类型守卫、消息分发、事件监听时的类型约束
 */
type ValueOf<T> = T[keyof T];

export type IpcChannel =
  | ValueOf<typeof IPC_APP_CHANNELS>
  | ValueOf<typeof IPC_CODEX_CHANNELS>
  | ValueOf<typeof IPC_WORKSPACE_CHANNELS>
  | ValueOf<typeof IPC_HISTORY_CHANNELS>
  | ValueOf<typeof IPC_CACHE_CHANNELS>
  | ValueOf<typeof IPC_EVENT_CHANNELS>;

