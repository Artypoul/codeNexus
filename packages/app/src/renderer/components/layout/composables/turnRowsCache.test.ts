import { describe, expect, it } from "vitest";
import type { TimelineEventItem } from "../../../domain/types";
import type { ChatRow } from "../types/chat.types";
import { createTurnRowsCacheState, syncTurnRows, type SyncTurnRowsOptions } from "./turnRowsCache";

const DIRECT_STREAMING_METHODS = new Set(["item/agentMessage/delta"]);

const computeTurnKey = (event: TimelineEventItem) => `turn:${String(event.turnId ?? "").trim() || event.id}`;

// 与实现保持同一语义：流式事件的结构签名不包含文本内容。
const computeSignature = (turnKey: string, events: TimelineEventItem[]) =>
  `${turnKey}|${events
    .map((event) => {
      const textPart = DIRECT_STREAMING_METHODS.has(event.method) ? "" : event.paramsText.length;
      return `${event.id}:${event.method}:${event.turnId ?? ""}:${textPart}`;
    })
    .join(";")}`;

const buildTurnRows = (turnKey: string, events: TimelineEventItem[]): ChatRow[] =>
  events.map((event) => ({ id: `a:${event.id}`, turnKey, kind: "assistant", event }) as ChatRow);

const makeOptions = (events: TimelineEventItem[], contextKey = "ctx"): SyncTurnRowsOptions => ({
  events,
  contextKey,
  computeTurnKey,
  computeSignature,
  buildTurnRows,
});

// 朴素实现：每轮都从零分组并重建，作为增量结果的对照。
const rebuildAll = (events: TimelineEventItem[]): ChatRow[] => {
  const groups = new Map<string, TimelineEventItem[]>();
  const order: string[] = [];
  for (const event of events) {
    const key = computeTurnKey(event);
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
      order.push(key);
    }
    bucket.push(event);
  }
  const rows: ChatRow[] = [];
  for (const key of order) rows.push(...buildTurnRows(key, groups.get(key) ?? []));
  return rows;
};

const makeEvent = (
  id: string,
  turnId: string,
  paramsText = "",
  method = "item/agentMessage/delta"
): TimelineEventItem => ({
  id,
  method,
  paramsText,
  createdAt: 0,
  turnId,
  level: "info",
});

// 用「行 id + turn + 事件文本」做投影，事件引用过期会直接体现为文本不一致。
const project = (rows: ChatRow[]) =>
  rows.map((row) =>
    row.kind === "assistant" || row.kind === "assistantCommentary"
      ? `${row.id}|${row.turnKey}|${row.event.paramsText}`
      : `${row.id}|${row.turnKey}`
  );

const expectMatchesFullRebuild = (rows: ChatRow[], events: TimelineEventItem[]) => {
  expect(project(rows)).toEqual(project(rebuildAll(events)));
};

describe("syncTurnRows", () => {
  it("首轮构建与全量重建一致", () => {
    const state = createTurnRowsCacheState();
    const events = [makeEvent("e1", "t1", "a"), makeEvent("e2", "t1", "b"), makeEvent("e3", "t2", "c")];
    const rows = syncTurnRows(state, makeOptions(events));
    expectMatchesFullRebuild(rows, events);
  });

  it("没有任何变化时返回同一个数组引用", () => {
    const state = createTurnRowsCacheState();
    const events = [makeEvent("e1", "t1", "a")];
    const first = syncTurnRows(state, makeOptions(events));
    const second = syncTurnRows(state, makeOptions(events));
    expect(second).toBe(first);
  });

  it("流式文本变化只替换对应行，其它行保持引用", () => {
    const state = createTurnRowsCacheState();
    const events = [makeEvent("e1", "t1", "a"), makeEvent("e2", "t1", "b"), makeEvent("e3", "t2", "c")];
    const first = syncTurnRows(state, makeOptions(events));

    events[1] = makeEvent("e2", "t1", "b+delta");
    const second = syncTurnRows(state, makeOptions(events));

    expectMatchesFullRebuild(second, events);
    expect(second).not.toBe(first);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
    expect(second[2]).toBe(first[2]);
    expect((second[1] as { event: TimelineEventItem }).event.paramsText).toBe("b+delta");
  });

  it("结构变化时重建对应 turn，其余 turn 复用", () => {
    const state = createTurnRowsCacheState();
    const events = [makeEvent("e1", "t1", "a"), makeEvent("e2", "t2", "b")];
    const first = syncTurnRows(state, makeOptions(events));

    events.push(makeEvent("e3", "t2", "c"));
    const second = syncTurnRows(state, makeOptions(events));

    expectMatchesFullRebuild(second, events);
    expect(second[0]).toBe(first[0]);
  });

  it("事件换 turn 时旧 turn 不会残留旧引用", () => {
    const state = createTurnRowsCacheState();
    const events = [makeEvent("e1", "t1", "a"), makeEvent("e2", "t1", "b"), makeEvent("e3", "t2", "c")];
    const first = syncTurnRows(state, makeOptions(events));

    events[1] = makeEvent("e2", "t2", "b");
    const second = syncTurnRows(state, makeOptions(events));

    expectMatchesFullRebuild(second, events);
    const secondIds = new Set(second.map((row) => row.id));
    expect(secondIds.has("a:e2")).toBe(true);
    expect(second.length).toBe(first.length);
    expect(second.filter((row) => row.turnKey === "turn:t1").length).toBe(1);
  });

  it("上下文变化时全部重建", () => {
    const state = createTurnRowsCacheState();
    const events = [makeEvent("e1", "t1", "a")];
    const first = syncTurnRows(state, makeOptions(events, "ctx-a"));
    const second = syncTurnRows(state, makeOptions(events, "ctx-b"));
    expectMatchesFullRebuild(second, events);
    expect(second[0]).not.toBe(first[0]);
  });

  it("事件对象整体换新时，签名相同的 turn 也会刷新行内引用", () => {
    const state = createTurnRowsCacheState();
    const events = [makeEvent("e1", "t1", "a"), makeEvent("e2", "t2", "b")];
    const first = syncTurnRows(state, makeOptions(events));

    // 模拟历史回放：对象全部重建，同时长度变化，走结构重建 + 按 id 校对引用。
    const replayed = [
      { ...events[0], paramsText: "a!" },
      { ...events[1], paramsText: "b!" },
      makeEvent("e3", "t2", "c"),
    ];
    const second = syncTurnRows(state, makeOptions(replayed));

    expectMatchesFullRebuild(second, replayed);
    expect(second[0]).not.toBe(first[0]);
    expect((second[0] as { event: TimelineEventItem }).event.paramsText).toBe("a!");

    // 下一轮只改文本时，缓存里必须已经是新引用。
    replayed[0] = { ...replayed[0], paramsText: "a!!" };
    const third = syncTurnRows(state, makeOptions(replayed));
    expectMatchesFullRebuild(third, replayed);
    expect((third[0] as { event: TimelineEventItem }).event.paramsText).toBe("a!!");
  });

  it("尾部追加只影响对应 turn，其余行保持引用", () => {
    const state = createTurnRowsCacheState();
    const events = [makeEvent("e1", "t1", "a"), makeEvent("e2", "t2", "b")];
    const first = syncTurnRows(state, makeOptions(events));

    events.push(makeEvent("e3", "t2", "c"), makeEvent("e4", "t3", "d"));
    const second = syncTurnRows(state, makeOptions(events));

    expectMatchesFullRebuild(second, events);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
    expect(second[3].turnKey).toBe("turn:t3");
  });

  it("随机变更序列与全量重建逐步一致", () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    const state = createTurnRowsCacheState();
    const events: TimelineEventItem[] = [];
    let nextId = 0;
    for (let index = 0; index < 30; index += 1) {
      events.push(makeEvent(`e${nextId++}`, `t${index % 5}`, `text-${index}`));
    }

    for (let step = 0; step < 200; step += 1) {
      const action = random();
      if (action < 0.45 || events.length === 0) {
        events.push(makeEvent(`e${nextId++}`, `t${Math.floor(random() * 5)}`, `text-${step}`));
      } else if (action < 0.75) {
        const index = Math.floor(random() * events.length);
        const current = events[index];
        events[index] = { ...current, paramsText: `${current.paramsText}+${step}` };
      } else if (action < 0.85) {
        const index = Math.floor(random() * events.length);
        const current = events[index];
        events[index] = makeEvent(current.id, `t${Math.floor(random() * 5)}`, current.paramsText, current.method);
      } else if (action < 0.95) {
        events.splice(Math.floor(random() * events.length), 1);
      } else {
        events.reverse();
      }

      const rows = syncTurnRows(state, makeOptions(events));
      expectMatchesFullRebuild(rows, events);
    }
  });
});
