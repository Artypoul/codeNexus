# packages/app/src/renderer/features/timeline

## 目录用途

时间线业务能力目录。

## 当前内容

| 文件 / 目录                   | 说明                                                      |
| ----------------------------- | --------------------------------------------------------- |
| `renderModel/`                | 事件到渲染节点的聚合层                                    |
| `markdownRenderer.ts`         | Markdown 安全渲染                                         |
| `markdownBlockPatcher.ts`     | 复用稳定 Markdown 块的 DOM，保留高亮、选区与 Mermaid 节点 |
| `mermaidRenderer.ts`          | Mermaid 渲染与主题适配                                    |
| `useAgentMarkdownRenderer.ts` | 事件级渲染缓存                                            |
| `webSearch.ts`                | Web 搜索结果展示辅助                                      |

## 维护边界

- ✅ 展示策略优先收敛到这里
- ❌ 组件层不重复聚合事件
