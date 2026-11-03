# packages/app/src/renderer/domain

## 目录用途

渲染层领域逻辑目录，负责运行时编排、桌面互操作、本地状态与工作流仓库。

## 当前内容

| 文件 / 目录                                                                                | 说明                               |
| ------------------------------------------------------------------------------------------ | ---------------------------------- |
| `runtimeOrchestrator.ts`                                                                   | 核心运行编排                       |
| `serverInterop.ts`                                                                         | 服务端配置与协议互操作             |
| `types.ts`                                                                                 | 领域类型                           |
| `composeFileMentions.ts`                                                                   | 输入区文件 mention 处理            |
| `layoutWidthBudget.ts`                                                                     | 壳层宽度分配                       |
| `workspacePath.ts` / `workspaceFiles.ts` / `workspaceFileDrag.ts`                          | 工作区路径、文件、拖拽互操作       |
| `localSettings.ts` / `localDraftState.ts` / `localMessageOutbox.ts` / `localStateFiles.ts` | 本地状态读写                       |
| `workflow/`                                                                                | 工作流模板、运行记录与结果读取仓库 |

## 维护边界

- ✅ 领域规则集中在这里
- ❌ 组件层不重复实现同类编排
