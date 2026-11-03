# packages/app/src/renderer/stores

## 目录用途

Pinia 状态管理目录。

## 当前结构

| 分类         | 相关 store                                                            |
| ------------ | --------------------------------------------------------------------- |
| 壳层与偏好   | `appShell`、`viewPrefs`、`theme`、`typography`                        |
| 运行时       | `runtime`、`messageQueue`、`approval`、`config`、`configRequirements` |
| 会话与时间线 | `thread`、`timeline`、`debugTimeline`                                 |
| 扩展能力     | `skills`、`skillsUi`、`mcp`、`mcpResource`                            |
| 工作区       | `workspaceFiles`                                                      |
| 其他业务     | `modelCatalog`、`notificationSound`、`update`、`userInput`            |

## 维护边界

- ✅ store 负责状态与轻量派生
- ❌ 重编排优先放 `domain/`、`features/`、`processes/`
