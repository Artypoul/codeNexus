# P6：聊天时间线数据层性能优化方案

> 状态：阶段 1–5 已落地并通过校验（阶段 4 采用「组级复用」方案，未做行数组原地复用）
> 范围：`useChatRenderModel`、`timeline.store`、`ChatRow` 行数组的下游消费方
> 前置：P0–P5（流式 Markdown、思考块懒渲染、观察器合并、`will-change`、输入框测量、WaveText / 毛玻璃）已完成
> 实施位置：新增 `components/layout/composables/turnRowsCache.ts`，改造 `useChatRenderModel.ts`，修正 `features/history/replayParsers.ts`

## 1. 背景

P0–P5 已经把「单条消息的渲染成本」压下来了，但**每一帧仍然会重算整条时间线的数据结构**。
流式输出期间，`timeline.store` 通过 `requestAnimationFrame` 触发 flush，理想情况下每帧一次（约 60Hz），
每一帧都会驱动 `baseChatRows` 这个 computed 全量重算。事件数上千、turn 数上百时，这部分成为新的主要开销。

本文档只讨论**数据层**，即「事件数组 → `ChatRow[]`」这一段；DOM 渲染与 Markdown 渲染已在 P0–P5 处理。

## 2. 现状与热点

### 2.1 触发链路

```
流式 delta 到达
  → pendingAppendsByKey 累积
  → scheduleFlush() 用 rAF 合并（rAF 可用时另有 120ms 兜底；不可用时退回 33ms）
     packages/app/src/renderer/stores/timeline.store.ts:8, :87
  → flushPendingAppends() 合并 chunk、生成新的 event 对象、替换 renderEvents[index]
     packages/app/src/renderer/stores/timeline.store.ts:235
  → touchThreadRevision() 递增 contentRevision / structureRevision
     packages/app/src/renderer/stores/timeline.store.ts:124
  → CenterPane 的 contentTimelineEvents / timelineContentRevision 失效
     packages/app/src/renderer/components/layout/CenterPane.vue:299
  → baseChatRows computed 重算
     packages/app/src/renderer/components/layout/composables/useChatRenderModel.ts:733
  → buildRowsByTurnCache() 全量分组 + 全量签名 + 全量行扫描
     packages/app/src/renderer/components/layout/composables/useChatRenderModel.ts:647
```

关键事实：

- `renderEvents` 是**原地修改**的数组（`push` / `renderEvents[index] = event` / `splice`），
  所以 `contentTimelineEvents` 这个 computed 返回的始终是同一个数组引用，失效完全靠 revision 计数器驱动。
- `flushPendingAppends` 每次都创建**新的 event 对象**（内容变化时），这为「按对象身份做缓存」提供了前提。
- 例外（已修复）：`packages/app/src/renderer/features/history/replayParsers.ts` 原先存在 `existing.paramsText = ...`
  的原地改写，会破坏对象身份假设；现改为生成新对象后写回数组（见 §6）。

### 2.2 热点清单

| #   | 位置                                                        | 现状                                                                     | 复杂度                        | 触发频率   |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------- | ---------- | ---- |
| 1   | `useChatRenderModel.ts:647` 分组循环                        | 每帧重建 `groups` 数组与 `groupIndexByKey` Map，把事件按 turnId 重新分桶 | O(n) 分配 + Map 写入          | 每帧       |
| 2   | `useChatRenderModel.ts:664` 逐组签名                        | `group.events.map(eventStructureSignature).join("\n")`                   | O(n) 字符串分配 + O(总字符数) | 每帧       |
| 3   | `useChatRenderModel.ts:613` `eventStructureSignature`       | 每个事件拼 13 段字段并 `join(":")`                                       | O(n) 字符串                   | 每帧       |
| 4   | `useChatRenderModel.ts:673` 全局签名                        | `groups.map(...).join("\n\n")`                                           | O(总字符数)                   | 每帧       |
| 5   | `useChatRenderModel.ts:712` `updateDirectStreamingRows`     | `new Map(events.map(...))` + `rows.map(...)`                             | O(n) + O(m)                   | 每帧       |
| 6   | `useChatRenderModel.ts:637` `definitionsStructureSignature` | `[...keys].sort().join("                                                 | ")`                           | O(k log k) | 每帧 |
| 7   | 下游 computed（`rowsWithTokenUsageSummaries` 等）           | 行数组每次都是新引用，全部重算                                           | O(m)                          | 每帧       |
| 8   | `timeline.store.ts:8` 刷新节奏                              | rAF 驱动，无可见性判断，后台窗口也照常 flush                             | —                             | 持续       |

说明：第 2、3 项的字符串总量等于「全部事件签名字符数之和」，长会话下每帧会产生几百 KB 的临时字符串，
主要成本是 GC 压力而非 CPU 时间。

### 2.3 已经有效的部分（不要重复优化）

- `baseRowsCache.signature` 命中时（`useChatRenderModel.ts:674`）会跳过 `buildTimelineRenderNodes`，
  只走 `updateDirectStreamingRows`，即「按 turn 缓存渲染节点」已经生效。
- 流式事件的签名不含 `paramsText`（`useChatRenderModel.ts:630`），所以纯文本增长不会让 turn 节点重建。
- `paramsObjectSignature` 已经用 `WeakMap` 做了对象身份缓存（`useChatRenderModel.ts:72`）。

## 3. 目标

在 3000 事件 / 200 turn 的会话里，流式期间单帧数据层满足：

- 单帧「事件 → `ChatRow[]`」耗时 ≤ 1ms（当前预计 4–8ms 量级，需先测基线）；
- 单帧临时字符串分配 ≤ 2KB（当前为「全量签名长度」量级）；
- 新增/更新一条流式文本时，不触碰未受影响的 turn 与行；
- 行为零回归：`ChatRow[]` 的内容与顺序必须与当前实现完全一致（用快照测试保证）。

## 4. 方案

分五个阶段，每阶段可独立合入、独立回滚。

### 阶段一：事件签名缓存（已落地）

`eventStructureSignature` 的结果只取决于事件对象自身字段，而事件内容变化时 store 会创建新对象，
因此可以按对象身份缓存：

```ts
const eventSignatureCache = new WeakMap<TimelineEventItem, string>();

const eventStructureSignature = (event: TimelineEventItem) => {
  const cached = eventSignatureCache.get(event);
  if (cached != null) return cached;
  const signature = /* 现有实现 */;
  eventSignatureCache.set(event, signature);
  return signature;
};
```

- 未变化的事件：O(1)。
- 变化的事件：仍然只拼一次小字符串，不再每帧重拼。
- 前提：事件对象不可变，需要先修 `replayParsers.ts:384` 的原地改写。

> 实现：`useChatRenderModel.ts` 的 `eventSignatureCache`（`WeakMap`）+ `replayParsers.ts` 不可变写回。

### 阶段二：turn 分组与签名增量维护（已落地，实现简化）

把「每帧全量分组 + 全量签名」换成「按 turn 增量更新」。

```ts
type TurnBucket = {
  key: string;
  events: TimelineEventItem[];
  signature: string;
};

// 跨帧保留
const turnBuckets = new Map<string, TurnBucket>();
const turnKeyByEventId = new Map<string, string>();
const eventIndexInTurn = new Map<string, number>();
```

- 新事件：`turnKeyByEventId` 未命中 → 追加到对应 bucket，标记该 turn 为 dirty。
- 内容变化事件：turnKey 未变 → 按 `eventIndexInTurn` 原地替换，标记 dirty。
- turnId 变化（`flushPendingAppends` 已先 `removeTurnIndex` 再 `addTurnIndex`）：从旧 bucket 移除、加入新 bucket，两个 turn 都标 dirty。
- 每个 dirty turn 只重算自己的 `signature`。

整体签名改为版本号，避免每帧拼全量长字符串：

```ts
let timelineStructureVersion = 0; // 只在 turn 增删/重排时自增
const turnSignatureByKey = new Map<string, string>();
```

命中条件从「字符串相等」变为「版本号相等 + 所有 turn 签名未变」，语义等价但不需要每帧构造大字符串。

> 注意：当前 `baseRowsCache` 是单槽缓存，阶段二需要改成按线程存（`Map<threadId, Cache>`），
> 否则切换线程会让缓存互相覆盖，退化为全量重建。

> 实现差异：没有引入 `eventIndexInTurn` 之外的额外索引，也没有让 store 暴露 `flushSeq`。
> 实际做法是「位置快照 + 对象身份比对」：
>
> - 每帧用 `snapshot[i] !== events[i]` 找出脏事件（O(n) 次指针比较，无字符串分配）；
> - 分组用跨帧存活的 `buckets` / `order` / `keyByIndex` / `indexInTurn`，脏位置 turn 归属不变时原地替换桶内引用；
> - 尾部追加（流式新增事件的主要形态）走前缀比对 + 追加路径，不重新分组；
> - 只有增删、换 turn、重排等结构性变化才重建分组，并按 turn 签名决定是否复用行；
> - 上下文（线程 / 工作区 / timelineKey / 工具定义）变化时直接清空 `turnEntries` 整体失效。
>
> 这样渲染层不必依赖 store 内部结构，`flushSeq` / `dirtyEventIds`（§5）均未采用。

### 阶段三：按脏事件更新行（已落地）

`updateDirectStreamingRows` 现在是「重建全量 Map + 全量 map」，改为：

```ts
// 跨帧保留：event.id -> 行下标
const rowIndexByEventId = new Map<string, number>();
```

- `flushPendingAppends` 已经知道本轮改了哪些事件（`entries` 的 key），把它暴露成 `dirtyEventIds`（见 §5）。
- 只有脏事件且 `row.kind` 属于 `assistant` / `assistantCommentary` 时，才按下标替换行对象。
- 其余行保持原对象引用，`rows` 数组只在确实发生变化时复制一次（`slice()`）。

单帧成本从 O(n + m) 降到 O(脏事件数)。

> 实现：缓存行在「签名命中但 turn 脏」时就地打补丁（替换 `row.event`）并**写回 `turnEntries`**，
> 避免下一帧复用到旧事件引用（这是增量缓存最容易漏的一步）。
> 结构性重建时按 `event.id` 建立一次全量映射，校正历史回放等路径换新的事件对象。

### 阶段四：行数组稳定性（已落地，采用组级复用）

目前只要有任何变化就产出新的 `rows` 数组，`rowsWithTokenUsageSummaries` 等多个下游 computed 会全部重算。

两个可选做法：

1. **保守**：保持「变则新建数组」，但把下游 computed 的依赖收窄到「行版本号 + 必要字段」，
   避免它们消费整个数组引用。
2. **激进**：`rows` 数组原地复用（`splice` 替换脏位置），另设 `rowsRevision` 计数器通知下游。
   收益最大，但要求所有消费方都不依赖数组引用变化，风险较高，建议单独一轮。

> 实现选择：保留「变则新建数组」的引用语义，不动 `rows` 数组本身，把下游最贵的一段
> ——`chatRows` 里的 aux 活动组装配——改成**组级复用**：
>
> - 新增 `composables/auxGroupCache.ts` 的 `canReuseAuxGroup`，按「成员行对象 + groupIndex +
>   locale + defaultCollapsed / startedAtMs / answerStartedAtMs / elapsedLive」判断能否复用；
> - `chatRows` 每次重建时逐组比对，命中就复用上一帧的 `ChatAuxActivityGroupRow`，
>   跳过 `buildAuxActivityGroup` 的统计、翻译与数组分配；
> - 缓存按组顺序存数组，末尾截断；切线程时成员对象不同，自然全部重建。
>
> 这样既拿到了大部分收益，又避免了原地复用行数组带来的 Vue 引用比对风险。
> `rowsWithTokenUsageSummaries` 仍是 O(m) 的浅扫描（每帧约 0.05ms 量级），暂不特殊处理。

### 阶段五：刷新节奏与可见性降频（已落地）

- `flushPendingAppends` 在 `document.visibilityState !== "visible"` 时改为 200–300ms 批量刷新，
  窗口重新可见时立即补一次。
- 与 `useAgentMarkdownRenderer` 的自适应间隔对齐：UI 侧最多每 48–120ms 消费一次，
  数据层没必要每帧都算。

> 实现：新增 `stores/timelineFlushPolicy.ts` 的 `resolveStreamFlushPlan`（纯函数，可单测）：
> 可见 + 有 rAF → rAF + 120ms 兜底；可见无 rAF → 33ms；后台 → 250ms 定时器（rAF 在后台会被暂停）。
> `timeline.store` 在 `scheduleFlush` 时读取可见性，并监听 `visibilitychange`，
> 窗口恢复可见时立即执行挂起的 flush，避免后台降频漏掉最后一帧。

## 5. 接口改动（未采用）

`timeline.store` 需要新增三个只读信息，供渲染层做增量（每次 flush 前清空、flush 后填充）：

```ts
type ThreadTimelineState = {
  // 现有字段...
  lastFlushDirtyEventIds: Set<string>; // 本轮 flush 内容变化的事件
  lastFlushDirtyTurnIds: Set<string>; // 受影响 turn（新增事件或 turnId 变化）
  flushSeq: number; // 单调递增，替代「全量签名比较」
};
```

新增 getter：

```ts
threadFlushDeltaForThread(state): (threadId: string) => {
  dirtyEventIds: ReadonlySet<string>;
  dirtyTurnIds: ReadonlySet<string>;
  flushSeq: number;
}
```

约束：

- 非 flush 路径（历史加载、线程切换、批量替换、删除事件）必须把 `dirtyTurnIds` 置为「全量失效」，
  渲染层据此回退到全量重建。
- 建议在 store 里集中一个 `invalidateThreadStructure(threadId)`，所有结构性变更都走它，
  避免遗漏。

> 落地时没有改动 `timeline.store`：位置快照比对足以识别「哪些事件对象换了」，
> 而 `renderEvents` 本身就是原地修改的数组，渲染层按索引比对即可，无需 store 额外记账。
> 这样避免了 store 与渲染层之间的新耦合，也兼容现有的 rAF 合并刷新。
> 若后续阶段四/五需要更细的脏标记，再考虑补这套接口。

## 6. 风险与约束

| 风险                 | 说明                                                                                       | 应对                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| 事件对象被原地改写   | `features/history/replayParsers.ts:384` 直接改 `existing.paramsText`，会让签名缓存读到旧值 | 改为生成新对象（`{ ...existing, paramsText }`），或在该处显式失效缓存                       |
| 缓存与真实数据不同步 | 增量维护的分组/索引漏更新，表现为「消息丢失或错位」                                        | 提供 `CHAT_RENDER_MODEL_VERIFY` 调试开关：增量结果与全量重建做 deepEqual 断言，仅开发期开启 |
| 线程切换串缓存       | `baseRowsCache` / `turnRowsCacheByKey` 目前是单槽，切线程会互相覆盖                        | 阶段二改为按线程存；或至少在 `timelineKey` 变化时整体 clear                                 |
| 行数组原地复用       | 破坏 Vue 的引用比对，可能「数据变了但视图没更新」                                          | 只在阶段四采用，且必须配合 `rowsRevision` 显式依赖                                          |
| 全量失效路径遗漏     | 历史回放、上下文压缩、删除消息等路径若没标记全量失效，会残留旧行                           | 统一走 `invalidateThreadStructure`，并在测试里覆盖这些路径                                  |

## 7. 验证方案

### 7.1 单元测试（优先）

现有测试基础：`packages/**/*.test.ts`（vitest），P0 已在此框架下补过分块渲染用例。

已落地：`packages/app/src/renderer/components/layout/composables/turnRowsCache.test.ts`（9 个用例），
覆盖首轮构建、无变化引用稳定、流式文本替换、结构变化复用、事件换 turn、上下文失效、
历史回放换新对象、尾部追加，以及 200 步随机变更序列与全量重建逐步比对。
阶段四/五补充：`auxGroupCache.test.ts`（7 个用例，成员/标记变化矩阵）与
`timelineFlushPolicy.test.ts`（3 个用例，前台/后台 × rAF 可用性）。

- **等价性测试**：构造 2000 个事件（含流式增量、turnId 变化、事件删除、线程切换），
  对比「增量实现」与「全量重建」产出的 `ChatRow[]` 快照，要求完全一致。
- **增量正确性**：单条流式事件连续追加 100 次文本，断言只有该事件对应的行对象变化，
  其余行对象引用保持不变。
- **缓存失效**：修改 `mcpToolDefinitions`、切换 `workspaceRoot`、删除事件后，断言走全量重建。

### 7.2 基准脚本

已落地：`packages/app/scripts/bench-chat-render-model.mjs`，运行 `pnpm --filter @codenexus/app bench:timeline`：

- 造 3000 事件 / 200 turn；
- 循环 1000 次「向最后一个 assistant 事件追加 20 字符」；
- 输出单次 `buildRowsByTurnCache` 的 p50 / p95 耗时与 GC 次数。

用途是拿到 §3 的基线数字，并作为后续回归门槛。

实测（Node 24 / Windows，3 轮 × 1000 次，单位 ms/帧）：

| 实现 | p50 | p95 | avg |
| --- | --- | --- | --- |
| 基线（每帧全量分组 + 全量签名 + 全量行 Map） | 0.742 | 1.156 | 0.802 |
| 增量（事件签名缓存 + 增量分组 + 脏行补丁） | 0.035 | 0.124 | 0.047 |

p95 下降 **89.3%**，p50 下降约 95%。

极端形态（3000 事件全部属于同一个 turn，`--turns 1`）：增量实现 p50 0.234ms / p95 0.394ms，
相比基线下降 68%。此时剩余成本主要来自该 turn 自身的签名拼接，不会再随其它 turn 增长。

同一脚本还会跑下游分组装配（200 个 aux 组，`translate` 用查表模拟，不计 vue-i18n 开销）：

| 实现 | p50 | p95 | avg |
| --- | --- | --- | --- |
| 基线（每帧重建全部组） | 0.093 | 0.153 | 0.106 |
| 组级复用 | 0.016 | 0.035 | 0.020 |

p95 下降 **77.2%**；真实环境中 `translate()` 走 vue-i18n，复用收益会更大。

### 7.3 手工观察点

- 长会话（>1000 事件）流式输出：滚动是否掉帧、输入是否卡顿；
- 同时有多个 running 工具卡片时的时间线更新；
- 切换线程 / 历史回放后内容是否完整、顺序是否正确；
- 后台放置 10 分钟后切回：内容与耗时统计是否正常。

## 8. 验收标准

- [x] 阶段一、二、三落地后，基准脚本 p95 耗时相比基线下降 ≥ 60%（实测 89.3%）；
- [x] 单帧字符串分配由 O(全部事件) 降为 O(脏 turn)：基准场景每帧只重算 1 个 turn 的签名（15 条事件，约 1KB 量级）；
      未做 `--trace-gc` 级精确统计；
- [x] 等价性测试通过，`ChatRow[]` 快照零差异（含随机变更序列）；
- [x] `pnpm run lint` / `typecheck` / `test` / `build` 全部通过（87 个测试）；
- [x] 阶段四：aux 组装配 p95 下降 77%（模拟基准）；行组对象在无变化时保持引用稳定；
- [x] 阶段五：后台刷新降频到 250ms，恢复可见时立即补一次；
- [ ] §7.3 手工观察点无回归（需真实长会话运行验证）。

## 9. 不在本方案范围

- `buildTimelineRenderNodes` 内部的算法优化 —— 已有按 turn 缓存，暂不动；
- Markdown 渲染、Shiki 高亮、Mermaid 渲染 —— 已由 P0–P2 处理；
- 虚拟滚动的阈值与测量策略（`ChatTimelineViewport`）—— 属于渲染层，如需调整另开任务。

## 10. 落地顺序与工作量预估

| 阶段 | 内容                                    | 预估   | 风险 |
| ---- | --------------------------------------- | ------ | ---- |
| 0    | 基准脚本 + 等价性测试骨架               | 0.5 天 | 低   |
| 1    | 事件签名缓存 + `replayParsers` 不可变化 | 0.5 天 | 低   |
| 2    | turn 分组与签名增量维护                 | 1.5 天 | 中   |
| 3    | 按脏事件更新行（依赖 §5 的 store 接口） | 1 天   | 中   |
| 4    | 行数组稳定性（可选）                    | 1–2 天 | 高   |
| 5    | 刷新节奏与可见性降频（可选）            | 0.5 天 | 低   |

建议按 0 → 1 → 2 → 3 推进，每步单独提交并跑一次完整校验；4、5 视阶段三的实测收益再决定是否继续。

## 11. 落地记录

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 0 基准 + 等价性测试 | 完成 | `scripts/bench-chat-render-model.mjs`、`turnRowsCache.test.ts` |
| 1 事件签名缓存 | 完成 | `eventSignatureCache` + `replayParsers` 不可变写回 |
| 2 分组/签名增量 | 完成（简化实现） | 位置快照 + 持久化 buckets，未改 store 接口 |
| 3 脏事件更新行 | 完成 | 缓存行就地补丁并写回，结构重建时按 id 校对引用 |
| 4 行数组稳定性 | 完成（组级复用） | `auxGroupCache.ts` + `chatRows` 组缓存；未做行数组原地复用 |
| 5 可见性降频 | 完成 | `timelineFlushPolicy.ts`，后台 250ms，恢复可见立即 flush |

关键约束（后续改动请保持）：

- `TimelineEventItem` 必须保持不可变；任何字段更新都要生成新对象，否则对象身份缓存与脏检测会失效。
- 结构重建（`rebuilt`）路径必须按 `event.id` 全量校对缓存行的事件引用，历史回放会整体换新对象。
- aux 组缓存以「成员行对象身份 + locale + 展示标记」为键；新增会影响组摘要的输入（例如新的行内状态）时，
  必须同步加进 `AuxGroupFlags`，否则会复用旧摘要。

遗留观察项：§7.3 的四个手工场景仍需在真实长会话（>1000 事件）里跑一遍，
重点看流式期间滚动/输入是否顺滑、切换线程与历史回放后内容是否完整。
