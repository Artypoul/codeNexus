// P6 基准：数据层（事件 → ChatRow[]）与下游（ChatRow[] → 分组行）的单帧耗时。
// 运行：node scripts/bench-chat-render-model.mjs [--events 3000] [--turns 200] [--iterations 1000]
import { canReuseAuxGroup } from "../src/renderer/components/layout/composables/auxGroupCache.ts";
import { createTurnRowsCacheState, syncTurnRows } from "../src/renderer/components/layout/composables/turnRowsCache.ts";

const DIRECT_STREAMING_METHODS = new Set(["item/agentMessage/delta"]);

const readArg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const eventCount = readArg("events", 3000);
const turnCount = readArg("turns", 200);
const iterations = readArg("iterations", 1000);
const perTurn = Math.max(1, Math.floor(eventCount / turnCount));

const percentile = (sorted, ratio) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];

const measure = (name, run) => {
  const samples = [];
  for (let round = 0; round < 3; round += 1) {
    for (let step = 0; step < iterations; step += 1) {
      const start = process.hrtime.bigint();
      run(step);
      samples.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
  }
  samples.sort((a, b) => a - b);
  const total = samples.reduce((sum, value) => sum + value, 0);
  console.log(
    `${name.padEnd(12)} p50=${percentile(samples, 0.5).toFixed(3)}ms ` +
      `p95=${percentile(samples, 0.95).toFixed(3)}ms ` +
      `avg=${(total / samples.length).toFixed(3)}ms samples=${samples.length}`
  );
  return percentile(samples, 0.95);
};

// ---------------------------------------------------------------------------
// 第一段：事件数组 → ChatRow[]（turnRowsCache）
// ---------------------------------------------------------------------------
const makeEvent = (id, turnId, paramsText, method) => ({
  id,
  method,
  paramsText,
  params: { item: { type: "agent_message", id, status: "running" } },
  createdAt: 0,
  turnId,
  level: "info",
});

const events = [];
for (let index = 0; index < eventCount; index += 1) {
  const turnId = `turn-${Math.floor(index / perTurn)}`;
  const method = index % 3 === 0 ? "item/completed" : "item/agentMessage/delta";
  events.push(makeEvent(`e${index}`, turnId, "x".repeat(400), method));
}

const computeTurnKey = (event) => `turn:${String(event.turnId ?? "").trim() || event.id}`;

const computeEventSignature = (event) => {
  const parts = [event.id, event.method, event.turnId ?? "", event.level ?? "", event.hidden ? "1" : "0"];
  if (!DIRECT_STREAMING_METHODS.has(event.method)) {
    parts.push(String(event.paramsText.length), JSON.stringify(event.params ?? null));
  }
  return parts.join(":");
};

// 旧实现：每帧全量签名，无事件级缓存。
const buildAllRows = (list) =>
  list.map((event) => ({ id: `a:${event.id}`, turnKey: computeTurnKey(event), kind: "assistant", event }));

const groupEvents = (list) => {
  const groups = new Map();
  const order = [];
  for (const event of list) {
    const key = computeTurnKey(event);
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
      order.push(key);
    }
    bucket.push(event);
  }
  return { groups, order };
};

const createBaseline = () => {
  let cache = null;
  return (list) => {
    const { groups, order } = groupEvents(list);
    const signature = order
      .map((key) => `${key}\n${groups.get(key).map(computeEventSignature).join("\n")}`)
      .join("\n\n");
    if (cache?.signature === signature) return cache.rows;
    const rows = [];
    for (const key of order) rows.push(...buildAllRows(groups.get(key)));
    cache = { signature, rows };
    return rows;
  };
};

// 新实现：事件签名按对象身份缓存，只重建受影响的 turn。
const signatureByEvent = new WeakMap();
const cachedEventSignature = (event) => {
  const hit = signatureByEvent.get(event);
  if (hit != null) return hit;
  const signature = computeEventSignature(event);
  signatureByEvent.set(event, signature);
  return signature;
};

const cacheState = createTurnRowsCacheState();
const runIncremental = (list) =>
  syncTurnRows(cacheState, {
    events: list,
    contextKey: "bench",
    computeTurnKey,
    computeSignature: (turnKey, turnEvents) => `${turnKey}\u0000${turnEvents.map(cachedEventSignature).join("\n")}`,
    buildTurnRows: (turnKey, turnEvents) => buildAllRows(turnEvents),
  });

const mutateLastEvent = () => {
  const index = events.length - 1;
  const current = events[index];
  events[index] = { ...current, paramsText: `${current.paramsText}${"y".repeat(20)}` };
};

console.log(`[timeline] events=${events.length} turns=${turnCount} iterations=${iterations} perTurn=${perTurn}`);
const baselineTurnRows = createBaseline();
const baselineP95 = measure("baseline", () => {
  mutateLastEvent();
  baselineTurnRows(events);
});
const incrementalP95 = measure("incremental", () => {
  mutateLastEvent();
  runIncremental(events);
});
console.log(`数据层 p95 下降 ${(100 - (incrementalP95 / baselineP95) * 100).toFixed(1)}%`);

// ---------------------------------------------------------------------------
// 第二段：ChatRow[] → 分组行（rowsWithTokenUsageSummaries + chatRows）
// 说明：复刻 useChatRenderModel 的分组循环；translate 用查表模拟，不计入 vue-i18n 开销。
// ---------------------------------------------------------------------------
const chatRowList = [];
for (let turn = 0; turn < turnCount; turn += 1) {
  const turnKey = `turn:${turn}`;
  chatRowList.push({
    id: `a:${turn}`,
    turnKey,
    kind: "assistant",
    event: { id: `e${turn}`, method: "item/agentMessage/delta", createdAt: turn },
  });
  for (let index = 0; index < perTurn - 1; index += 1) {
    chatRowList.push({
      id: `x:${turn}:${index}`,
      turnKey,
      kind: index % 3 === 0 ? "reasoningBlock" : index % 3 === 1 ? "commandAction" : "fileChange",
      item: { createdAt: turn },
    });
  }
}

const KIND_LABEL_KEYS = {
  reasoningBlock: "timeline.auxReasoning",
  commandAction: "timeline.auxCommand",
  fileChange: "timeline.auxFiles",
};
const translateStub = (key) => `t(${key})`;
const isAuxiliaryRow = (row) => row.kind !== "assistant";
const buildGroupSim = (items, groupIndex, flags) => {
  const counts = new Map();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const summaryItems = [];
  for (const [kind, count] of counts) {
    summaryItems.push({ key: kind, label: translateStub(KIND_LABEL_KEYS[kind] ?? kind), count });
  }
  const summaryText = summaryItems.map((item) => `${item.label} ${item.count}`).join(" · ");
  return {
    id: `aux:${groupIndex}:${items[0]?.id ?? "empty"}`,
    turnKey: items[0]?.turnKey ?? "",
    kind: "auxActivityGroup",
    items: [...items],
    summaryItems,
    summaryText,
    status: "completed",
    ...flags,
  };
};

const groupFlags = (groupIndex) => ({
  groupIndex,
  locale: "zh-CN",
  defaultCollapsed: true,
  startedAtMs: 0,
  answerStartedAtMs: null,
  elapsedLive: false,
});

const assembleBaseline = (rows) => {
  const out = [];
  let pending = [];
  let groupIndex = 0;
  const flush = () => {
    if (pending.length === 0) return;
    out.push(buildGroupSim(pending, groupIndex, groupFlags(groupIndex)));
    groupIndex += 1;
    pending = [];
  };
  for (const row of rows) {
    if (isAuxiliaryRow(row)) {
      pending.push(row);
      continue;
    }
    flush();
    out.push(row);
  }
  flush();
  return out;
};

const groupCache = [];
const assembleCached = (rows) => {
  const out = [];
  let pending = [];
  let groupIndex = 0;
  let cursor = 0;
  const flush = () => {
    if (pending.length === 0) return;
    const flags = groupFlags(groupIndex);
    const cached = groupCache[cursor];
    if (cached && canReuseAuxGroup(cached, flags, pending)) {
      out.push(cached.row);
    } else {
      const row = buildGroupSim(pending, groupIndex, flags);
      groupCache[cursor] = { row, ...flags };
      out.push(row);
    }
    cursor += 1;
    groupIndex += 1;
    pending = [];
  };
  for (const row of rows) {
    if (isAuxiliaryRow(row)) {
      pending.push(row);
      continue;
    }
    flush();
    out.push(row);
  }
  flush();
  groupCache.length = cursor;
  return out;
};

const assertSameOutput = () => {
  const expected = JSON.stringify(assembleBaseline(chatRowList));
  const actual = JSON.stringify(assembleCached(chatRowList));
  if (expected !== actual) throw new Error("group cache output diverged from full rebuild");
};
assertSameOutput();

const assistantRowIndex = chatRowList.length - perTurn;
const mutateAssistantRow = () => {
  const current = chatRowList[assistantRowIndex];
  chatRowList[assistantRowIndex] = { ...current, event: { ...current.event, createdAt: current.event.createdAt + 1 } };
};

console.log(`[downstream] rows=${chatRowList.length} groups≈${turnCount}`);
const baselineGroupsP95 = measure("baseline", () => {
  mutateAssistantRow();
  assembleBaseline(chatRowList);
});
const cachedGroupsP95 = measure("cached", () => {
  mutateAssistantRow();
  assembleCached(chatRowList);
});
console.log(`下游组装 p95 下降 ${(100 - (cachedGroupsP95 / baselineGroupsP95) * 100).toFixed(1)}%`);
