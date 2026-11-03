# packages/shared/src

## 目录用途

`@codenexus/shared` 的源码目录，保存跨进程、跨功能包复用的轻量契约。

这里主要放三类内容：

- 可序列化的数据结构
- app-server / IPC 协议类型
- 无副作用的归一化、构建和兼容函数

## 当前内容

| 目录 / 文件                    | 说明                                      |
| ------------------------------ | ----------------------------------------- |
| `index.ts`                     | shared 包公共出口                         |
| `agent-protocol/`              | Agent 协议相关共享类型                    |
| `codex-protocol/`              | Codex app-server 协议映射与类型导出       |
| `ipc/`                         | 跨进程 IPC 频道与契约                     |
| `localSettings.ts`             | 用户本地设置 schema、默认值和 patch 合并  |
| `localDraftState.ts`           | 线程输入草稿的本地持久化结构              |
| `localMessageOutbox.ts`        | 本地排队消息和刷新恢复结构                |
| `newThreadComposeSeed.ts`      | 新线程输入区初始值选择规则                |
| `modelCatalog.ts`              | 内置模型、自定义模型和模型选择器候选规则  |
| `modelToolFeatureOverrides.ts` | thread start 阶段的模型/工具特性覆盖规则  |
| `dynamicTools.ts`              | 内置动态工具定义、注入 schema 和过滤规则  |
| `codexInstructionProfiles.ts`  | 主视图/论文模式到 Codex 指令 profile 映射 |
| `codexMcp.ts`                  | MCP 配置导入、归一化、校验和导出结构      |
| `codexSkillRoots.ts`           | workspace 到 skill 根目录的共享状态       |
| `codexConfigSwitcher.ts`       | Codex 配置切换器的 profile、备份和状态    |

## 维护边界

- ✅ 只保留跨层共享定义、纯函数和可持久化 schema
- ✅ 允许依赖 `@codenexus/generated` 这类协议类型
- ✅ 注释优先解释数据边界、迁移规则、兼容策略和运行时约束
- ❌ 不放 Electron、文件系统、浏览器 DOM、Vue/Pinia 等运行时实现
- ❌ 不放具体功能包的业务组件、状态服务或 UI 逻辑
- ❌ 不在这里读写真实配置、密钥、缓存或工作区文件
