# packages/app/src

## 目录用途

`@codenexus/app` 的应用壳源码目录，负责 Electron 主进程、preload 桥接和渲染层宿主。

功能域已经拆到 workspace 包中，`app/src` 只保留应用级入口、运行时编排、IPC 聚合和壳层 UI。

## 当前结构

| 目录        | 说明                                             |
| ----------- | ------------------------------------------------ |
| `main/`     | Electron 主进程、窗口、IPC 注册和应用级服务      |
| `preload/`  | `contextBridge` 桥接、基础 IPC 客户端和 API 聚合 |
| `renderer/` | Vue 应用壳、状态编排、协议事件流水线和壳层组件   |

## 关联 workspace 包

| 包                            | 说明                                         |
| ----------------------------- | -------------------------------------------- |
| `@codenexus/shared`           | 跨进程基础契约、IPC 通道、设置和协议辅助函数 |
| `@codenexus/generated`        | Codex app-server 生成协议类型                |
| `@codenexus/feature-imagegen` | 图片生成类型、任务/历史服务、状态和组件      |

## 维护边界

- ✅ 跨层通信统一经由 IPC 与 `window.codexDesktop`
- ✅ 应用壳只编排功能包，不把功能域实现重新塞回 `app/src`
- ✅ 协议升级优先更新 `@codenexus/generated` 与 `@codenexus/shared`
- ❌ 不在 `main/`、`preload/`、`renderer/` 之间共享隐式运行时状态

## 维护建议

- ✅ 新增能力前先确认归属：app 壳层、shared 契约，还是独立 feature 包
- ✅ 分层职责变化时同步更新对应子目录 `README.md`
