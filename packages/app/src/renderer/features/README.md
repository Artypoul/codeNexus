# packages/app/src/renderer/features

## 目录用途

应用壳内部保留的渲染层功能模块目录。

这里主要维护 chat/timeline/approval/history 等仍属于 app 壳的能力；image generation 已拆分到独立 workspace feature 包。

## 当前结构

| 目录                 | 说明                                |
| -------------------- | ----------------------------------- |
| `approval/`          | 审批 payload 构造                   |
| `context/`           | 上下文能力扩展位                    |
| `explored/`          | 实验功能扩展位                      |
| `guardian/`          | guardian 评审摘要与诊断             |
| `history/`           | 历史回放、标题、handoff 诊断        |
| `notificationSound/` | 通知音播放器                        |
| `plan/`              | 计划步骤状态归一化                  |
| `sleep/`             | 睡眠页音频能力                      |
| `thread/`            | 线程能力扩展位                      |
| `timeline/`          | 时间线渲染、Markdown、Mermaid、搜索 |
| `translation/`       | 翻译能力扩展位                      |
| `workflow/`          | workflow 执行能力                   |

## 外部 feature 包

| 包                            | 归属能力         |
| ----------------------------- | ---------------- |
| `@codenexus/feature-imagegen` | Image generation |

## 维护边界

- ✅ 每个 app-local feature 只聚焦一个业务域
- ✅ 跨域共用逻辑优先下沉到 `domain/`、`@codenexus/shared` 或独立 feature 包
- ❌ 不把已拆包功能重新放回 app 本地 feature 目录
