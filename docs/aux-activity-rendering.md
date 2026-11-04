# 中间过程卡片渲染

## 组内虚拟列表

`ChatAuxActivityViewport.vue` 为每个展开的过程组提供独立滚动区域。记录不超过 40 条时使用普通布局，超过后仅挂载视口及上下缓冲区内的记录。完整记录仍保存在数据层，滚动时按需挂载历史内容。

行高先复用 `getChatRowPresentation` 的估算，再由共享的 `ResizeObserver` 测量实际高度。测量工作通过 `requestAnimationFrame` 合并；滚动定位使用二分查找。容器宽度变化时清空旧行高，并重新测量已挂载的行。

底部跟随复用 `useFollowBottomScroller`：打开时定位最新记录，向上浏览时停止跟随，回到底部后恢复。可见区域前方的行高变化时，根据首个可见行及其相对偏移恢复滚动位置。虚拟列表关闭浏览器自带的滚动锚定，避免重复补偿。

`activityItemState.ts` 在过程组作用域内保存展开状态，供日志、文件 Diff、动态工具、原始思考和图片详情使用。记录滚出视口后卸载组件，再滚回时恢复状态；切换过程组时清空这些状态。状态缓存不保留组件实例或 DOM。

## 重内容按需挂载

- `Collapsible` 的高度动画模式新增可选 `lazy` 属性，默认行为保持原样。启用后，首次展开才创建内容，折叠动画结束后卸载；动画事件缺失时有定时兜底，快速重新展开会取消卸载。
- MCP 工具组和思考面板启用 `lazy`，内部原始参数、结果和原始思考继续按各自展开状态挂载。
- MCP 资源详情折叠后卸载，不再通过 `keepMounted` 保留。
- 动态工具完整结果只在详情展开后拼接；图片使用浏览器延迟加载与异步解码。
- 图片原生 `details` 的正文仅在打开时挂载。
- 文件 Diff 查看器和命令日志沿用已有的展开后挂载逻辑。

此优化限制的是挂载与渲染开销，不改变历史数据的内存保留策略。单条超长日志在展开后仍展示完整内容，后续可根据实际测量再增加分段加载。

## 验证

自动化测试覆盖千条记录的挂载数量、初始底部定位、滚出卸载与状态恢复、追加记录时的跟随策略、可变行高锚定、容器尺寸变化、虚拟化阈值切换、卸载清理，以及重内容折叠时不挂载和动画结束后的释放。

```powershell
pnpm exec vitest run packages/app/src/renderer/components/chat/ChatAuxActivityViewport.test.ts packages/app/src/renderer/components/chat/ChatAuxActivityGroup.test.ts packages/app/src/renderer/components/ui/Collapsible.test.ts packages/app/src/renderer/components/timeline/cards/HeavyActivityContent.test.ts
```
