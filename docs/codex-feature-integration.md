# Codex 特性集成清单

> 最后核对：2026-11-04  
> 基准版本：Codex CLI `0.166.0`  
> 用途：当用户询问“Codex 有哪些功能”“CodeNexus 集成了哪些特性”“哪些还没做”时，先以本文件为准，再结合当前代码确认是否有新变化。

## 判定标准

| 状态        | 含义                                                                      |
| ----------- | ------------------------------------------------------------------------- |
| 已集成      | CodeNexus 有用户入口，调用了对应 RPC，并维护了基本状态或 UI               |
| 部分集成    | 有底层调用或基础展示，但缺少完整入口、状态模型、配置项或结果 UI           |
| 仅协议支持  | 生成类型、RPC 映射或通知白名单已存在，但 CodeNexus 没有实际调用或产品入口 |
| 未集成      | Codex 有用户可感知能力，CodeNexus 当前没有对应实现                        |
| 不适用/实验 | 官方内部开关、已移除功能或仍处于开发阶段的能力                            |

注意：`packages/generated` 中存在类型，不代表 CodeNexus 已集成。必须以运行时 RPC 调用、store、设置入口或 UI 为准。

## 当前已集成

| 能力域       | CodeNexus 当前实现                                                                    | 关键位置                                                                         |
| ------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 会话生命周期 | 创建、恢复、读取、列出、回退回合、压缩上下文                                          | `threadCreationRuntime.ts`、`threadResumeRuntime.ts`、`threadRollbackRuntime.ts` |
| 对话时间线   | Agent 消息、推理、计划、命令、文件变更、审批、MCP 调用、token、goal                   | `packages/app/src/renderer/features/timeline/`                                   |
| 命令执行     | 命令输出增量、终端交互、进程输出、终止命令、统一执行开关                              | `installEventPipeline.ts`、`GlobalConfigDrawer.vue`                              |
| 文件变更     | 流式 patch、Diff 卡片、Turn diff、文件变更审批                                        | `item/fileChange/patchUpdated` 处理链路                                          |
| 审批与输入   | 命令审批、文件变更审批、权限审批、Agent/Plan 用户问答、MCP elicitation、Guardian 诊断 | `packages/app/src/renderer/components/approval/`                                 |
| 模型配置     | 模型目录、推理强度、推理摘要、Fast/Flex、上下文窗口、自动压缩阈值                     | `modelCatalog.store.ts`、`GlobalConfigDrawer.vue`                                |
| 权限配置     | 审批策略、审批审阅者、沙箱模式、Windows sandbox 配置项                                | `serverInterop.ts`、`GlobalConfigDrawer.vue`                                     |
| 全局配置     | `config/read`、`configRequirements/read`、`config/batchWrite`、热加载、自动刷新       | `configRuntime.ts`、`globalConfigManagementRuntime.ts`                           |
| Goals        | 获取、设置、完成、清除线程目标；完成后的关机自动化                                    | `threadGoalRuntime.ts`、`goalShutdown.store.ts`                                  |
| Skills       | 列出、启停、追加 Skills Roots                                                         | `skillsManagementRuntime.ts`、`IntegrationsDrawer.vue`                           |
| MCP          | 状态列表、启停、JSON 导入、OAuth 登录、资源读取、工具调用卡片                         | `mcpManagementRuntime.ts`、`MCP` 时间线卡片                                      |
| 图片生成     | CodeNexus 动态工具 `codenexus.image_generate`、图片工作区、历史与任务                 | `packages/feature-imagegen/`                                                     |
| 工作区文件   | 文件树、刷新、读取、写入、删除、图片读取                                              | `workspaceFiles.store.ts`、`Main` 文件 IPC                                       |
| 本地编辑器   | 多标签、CodeMirror、保存、未保存保护                                                  | `WorkspaceEditorPane.vue`                                                        |
| 通知         | 桌面通知、通知音、问答提示、回合完成提示                                              | `features/systemNotification/`、`features/notificationSound/`                    |
| 更新         | 应用更新检查和更新设置                                                                | `SettingsUpdateTab.vue`                                                          |

## 部分集成

| 能力            | 已有部分                                         | 仍缺少                                                         |
| --------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| Token 与上下文  | 读取 `thread/tokenUsage/updated`，展示主要 token | 完整明细、缓存 token、每轮成本、额度关联                       |
| 线程历史        | 历史列表、分页读取、回放、回退                   | 完整归档、Fork、重命名、读状态、项目分组                       |
| 多 Agent        | 展示 `agentNickname`、`agentRole`、fork 来源     | Agent 树、子 Agent 状态、任务编排、切换和独立配置              |
| Memory          | 低层重置和模式切换运行时                         | `memory/status`、`thread/memory/read`、Memory 设置页、记忆浏览 |
| Guardian        | 审批诊断、风险与决策来源                         | 完整权限细节、全部时间字段、连接器上下文                       |
| Windows Sandbox | 配置中的 elevated/unelevated                     | `windowsSandbox/readiness`、`setupStart`、设置结果提示         |
| 流式文件 Diff   | 已接入 `apply_patch_streaming_events`            | 更完整的生命周期时间和历史回放一致性                           |

## 未集成

| 能力域             | 未集成内容                                                                     | 官方能力或协议入口                                                                                   |
| ------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 账号与额度         | 登录、登出、ChatGPT 账号状态、速率限制、token 用量、额度重置、Bedrock/GCP 配置 | `account/read`、`account/login/*`、`account/logout`、`account/rateLimits/read`、`account/usage/read` |
| Plugins            | 插件搜索、安装、卸载、读取、分享、市场添加/移除/升级                           | `plugin/*`、`marketplace/*`                                                                          |
| Apps / Connectors  | 应用列表、安装状态、读取应用、工具摘要、连接器授权                             | `app/list`、`app/read`、`app/installed`、`app/list/updated`                                          |
| Hooks              | Hook 列表、启停、信任、开始/完成卡片                                           | `hooks/list`、`hook/started`、`hook/completed`                                                       |
| Memory 产品层      | 记忆状态、记忆内容读取、记忆设置页                                             | `memory/status`、`thread/memory/read`                                                                |
| 浏览器与电脑操作   | 浏览器控制、CDP、扩展、电脑操作、截图与操作审批                                | `browser_use*`、`computer_use`、`in_app_browser`                                                     |
| Realtime 语音      | 实时语音会话、音频输入输出、转写、音色选择                                     | `thread/realtime/*`                                                                                  |
| 代码审查           | 独立 Review 会话、审查目标选择、审查结果                                       | `review/start`                                                                                       |
| 反馈               | 上传反馈和保存反馈                                                             | `feedback/upload`、`feedback/save`                                                                   |
| 外部配置迁移       | Claude Code / Cursor 设置和会话导入                                            | `externalAgentConfig/*`                                                                              |
| 远程控制           | 启用、禁用、状态、配对、客户端撤销                                             | `remoteControl/*`                                                                                    |
| 项目管理           | Codex 项目创建、导入、移动、删除、项目分组                                     | `project/*`、`threadSection/*`                                                                       |
| 线程附件           | 独立线程附件上传、列出、移除                                                   | `thread/attachment/*`                                                                                |
| 线程队列           | 官方队列增删改、排序、启动                                                     | `thread/queue/*`                                                                                     |
| 后台终端           | 列出、终止、清理后台终端                                                       | `thread/backgroundTerminals/*`                                                                       |
| 文件监听           | `fs/watch`、`fs/unwatch` 和 `fs/changed` 状态同步                              | `fs/*`                                                                                               |
| 自定义协作模式     | 动态读取和选择协作模式                                                         | `collaborationMode/list`，当前仅 Agent/Plan                                                          |
| 实验特性管理       | 列出和切换官方 experimental features                                           | `experimentalFeature/list`、`experimentalFeature/enablement/set`                                     |
| 模型 Provider 能力 | Provider 能力发现和权限配置档                                                  | `modelProvider/capabilities/read`、`permissionProfile/list`                                          |
| Ultrafast          | Ultrafast 模型服务层级                                                         | `ultrafast_mode`                                                                                     |

## 仅协议支持或通知白名单

下列能力已经进入生成协议或通知白名单，但 CodeNexus 还没有形成完整产品能力：

- `thread/archived`、`thread/unarchived`、`thread/closed`、`thread/name/updated`
- `hook/started`、`hook/completed`
- `account/updated`、`account/login/completed`、`account/rateLimits/updated`
- `app/list/updated`
- `externalAgentConfig/import/progress`、`externalAgentConfig/import/completed`
- `thread/realtime/*`
- `remoteControl/status/changed`
- `fs/changed`
- `deprecationNotice`、`configWarning`、`model/rerouted`
- `windows/worldWritableWarning`、`windowsSandbox/setupCompleted`

通知语义和字段消费情况详见 [protocol-notification-handling.md](./protocol-notification-handling.md)。

## 不适用或暂不优先

- 已移除功能：`apply_patch_freeform`、`sqlite`、`undo`、`worktrees`、`personality`、`remote_models` 等。
- 内部实现开关：compaction、rollout migration、连接重试、缓存、遥测等，不应作为用户功能入口。
- 开发中能力：`code_mode`、`artifact`、`agent_message_board`、`guardianv2`、`guardianv3`。
- TUI/Desktop 专属能力：终端宠物、TUI 快捷键、部分 in-app automation。除非 CodeNexus 明确要复刻，否则不列入交付缺口。

## 外部配置迁移

### 它是什么

外部配置迁移（External Agent Config Migration）用于把其他 AI 编程工具的本地设置、扩展和历史会话导入 Codex。

它不是以下两个功能：

- `migrate-rollouts`：把旧格式的 Codex 本地会话迁移为分页线程历史。
- `migrate-nfs-db`：迁移 Codex 本地数据库的 SQLite journal 模式。

Codex 0.166 支持两种来源：

| 来源        | `migrationSource` | 典型本地路径                                                         |
| ----------- | ----------------- | -------------------------------------------------------------------- |
| Claude Code | `claude-code`     | `~/.claude`、项目 `.claude/`、`CLAUDE.md`、`settings.json`           |
| Cursor      | `cursor`          | `~/.cursor`、项目 `.cursor/`、`.cursorrules`、`cli.json`、`mcp.json` |

`migrationSource` 缺失或无法识别时默认使用 Claude Code。官方 TUI 会同时检测两个来源；如果两者都检测到可迁移内容，会让用户选择来源。

### 检测范围

`externalAgentConfig/detect` 支持：

| 参数                | 作用                                               |
| ------------------- | -------------------------------------------------- |
| `includeHome`       | 是否扫描用户主目录下的全局配置                     |
| `cwds`              | 要扫描的仓库目录，用于项目级设置                   |
| `maxSessionAgeDays` | 只检测最近若干天的会话                             |
| `maxSessions`       | 限制检测到的会话数量                               |
| `migrationSource`   | 选择 `claude-code` 或 `cursor`                     |
| `source`            | 已弃用，仅为兼容保留，实际应使用 `migrationSource` |

检测结果分为：

- `items`：可迁移项目，每项包含类型、描述、作用目录和详细信息。
- `connectors`：从远程 MCP 配置或历史会话工具使用中识别到的连接器候选，包含名称和会话数量。

`cwd` 为空表示用户级迁移；非空表示仓库级迁移。

### 可迁移内容

| 类型                | 内容                                                                  |
| ------------------- | --------------------------------------------------------------------- |
| `AGENTS_MD`         | 外部 Agent 的全局或项目指令文件，转换后作为 Codex 指令来源            |
| `CONFIG`            | 外部工具的设置文件转换为 Codex `config.toml` 值                       |
| `SKILLS`            | Skills 目录和技能定义                                                 |
| `PLUGINS`           | 已启用的插件及其 Marketplace                                          |
| `MCP_SERVER_CONFIG` | MCP Servers 配置，转换为 Codex 的 `mcp_servers` 配置                  |
| `SUBAGENTS`         | 外部子 Agent 定义                                                     |
| `HOOKS`             | 生命周期 Hook                                                         |
| `COMMANDS`          | 外部自定义命令，迁移时转换为 Codex Skills                             |
| `MEMORY`            | Claude Code 项目 Memory 目录中的 Markdown 文件；Cursor 当前不支持此项 |
| `SESSIONS`          | 最近的聊天/会话历史，导入为 Codex 线程                                |

Claude Code 会合并 `settings.json` 与 `settings.local.json` 后再转换。Cursor 会读取全局和项目 CLI 配置。配置迁移使用“只补缺失值”的合并方式：Codex 已有配置不会被覆盖；MCP Server 也只有同名项不存在时才会新增。

### 执行流程

```text
externalAgentConfig/detect
        ↓
用户选择来源和迁移项
        ↓
externalAgentConfig/import
        ↓
立即返回 importId，后台异步执行
        ↓
externalAgentConfig/import/progress
        ↓
externalAgentConfig/import/completed
        ↓
写入导入历史与结果
```

`externalAgentConfig/import` 参数包括：

- `migrationItems`：用户最终选择的迁移项。
- `migrationSource`：必须与检测阶段一致。
- `source`：发起导入的产品标识，可选。
- `providerId`：用于统计归属和导入历史展示，不参与来源选择。

导入结果按类型汇总成功项和失败项。导入可以部分成功，不要求所有类型全部完成。

官方说明导入完成后：

- 迁移的配置对**新会话**生效。
- 已存在的线程不会被批量重写。
- 导入期间用户可以继续工作。
- 会话导入通过内容哈希和本地 ledger 去重，避免同一会话内容被重复导入。

### 与 CodeNexus 的关系

当前 CodeNexus 没有集成外部配置迁移：

- 没有调用 `externalAgentConfig/detect` 或 `externalAgentConfig/import`。
- 没有迁移来源选择、项目选择、迁移项勾选和结果页面。
- `externalAgentConfig/import/progress/completed` 只在通知白名单中，没有专门 store 或 UI。
- 没有读取导入历史的入口。
- 没有在导入后刷新配置、Skills、MCP、Plugins、Hooks 和线程列表的联动逻辑。

如果后续集成，最小可用流程应为：

1. 在设置页新增“迁移”入口。
2. 同时检测 `claude-code` 和 `cursor`。
3. 按类型展示迁移项、作用范围和数量，允许选择。
4. 调用 `externalAgentConfig/import`，保存返回的 `importId`。
5. 监听 progress/completed，展示每类成功和失败数量。
6. 完成后刷新全局配置、Skills、MCP 和线程历史。
7. 提供导入历史查看入口，并明确提示 Hooks、Plugins、Commands 可能执行代码，需要用户复核。

### 风险与注意事项

- 迁移会读取本地配置和历史会话，属于敏感数据操作。
- Hooks、Plugins 和 Commands 可能包含可执行逻辑，导入前必须提示并允许逐项选择。
- 配置采用补缺失合并，不代表外部配置一定完全等价；复杂字段可能需要人工检查。
- 会话迁移依赖来源格式和文件完整性，可能产生解析失败或部分成功。
- 导入结果应展示失败原因，不能只显示“导入完成”。
