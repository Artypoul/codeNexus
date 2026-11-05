# packages/app/src/renderer/components/ui

## 目录用途

跨页面复用的基础 UI 组件目录。

## 当前内容

| 文件                       | 说明                    |
| -------------------------- | ----------------------- |
| `AgentMarkdownContent.vue` | Agent Markdown 渲染容器 |
| `Collapsible.vue`          | 折叠面板                |
| `DetailDisclosure.vue`     | 详情展开                |
| `LazyImageThumb.vue`       | 图片缩略图懒加载        |
| `LoadingDots.vue`          | 加载文字                |
| `SelectDropdown.vue`       | 下拉选择                |
| `WaterBallProgress.vue`    | 水球进度条              |
| `WaveText.vue`             | 执行状态文字            |

## 维护边界

- ✅ 保持低业务耦合
- ✅ 通用交互优先参数化而不是复制组件
