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

工作区切换使用 `runtime.navigationRevision` 标记导航版本，目录与 Git 请求另用工作区版本和缓存代数拦截过期结果。
文件树保留当前工作区及最近 3 个工作区的目录与展开状态；目录在 15 秒内复用，快照在 5 分钟后失效，后台快照合计最多保留 20,000 条目录、Git 状态与展开路径记录。
模型列表按服务缓存最近 6 份目录（合计最多 6,000 个模型），默认有效期 5 分钟；显式刷新会重新请求，清理缓存会使进行中的旧结果失效。

- ✅ store 负责状态与轻量派生
- ❌ 重编排优先放 `domain/`、`features/`、`processes/`
