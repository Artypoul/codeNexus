// turn 级行缓存：把「事件数组 → ChatRow[]」的增量同步逻辑独立出来。
// useChatRenderModel 负责提供 turn 归属、签名与节点构建，
// 这里只处理「哪些事件变了、哪些 turn 需要重建、哪些行只需要换事件引用」。
import type { TimelineEventItem } from "../../../domain/types";
import type { ChatRow } from "../types/chat.types";

export type TurnRowsCacheEntry = {
  signature: string;
  rows: ChatRow[];
};

export type TurnRowsCacheState = {
  initialized: boolean;
  /** 线程 / 工作区 / 工具定义等外部上下文，变化时整体失效。 */
  contextKey: string;
  /** 上一次同步时各事件对象的位置快照，与事件数组等长且顺序一致。 */
  snapshot: TimelineEventItem[];
  /** event.id -> turnKey，用于识别事件在 turn 之间的迁移。 */
  turnKeyByEventId: Map<string, string>;
  /** turnKey -> 事件桶；跨帧复用，避免每帧重新分组。 */
  buckets: Map<string, TimelineEventItem[]>;
  /** turn 首次出现的顺序。 */
  order: string[];
  /** 每个事件位置所属的 turnKey。 */
  keyByIndex: string[];
  /** 每个事件在其 turn 桶内的下标。 */
  indexInTurn: number[];
  turnEntries: Map<string, TurnRowsCacheEntry>;
  rows: ChatRow[];
};

export function createTurnRowsCacheState(): TurnRowsCacheState {
  return {
    initialized: false,
    contextKey: "",
    snapshot: [],
    turnKeyByEventId: new Map(),
    buckets: new Map(),
    order: [],
    keyByIndex: [],
    indexInTurn: [],
    turnEntries: new Map(),
    rows: [],
  };
}

export type SyncTurnRowsOptions = {
  events: TimelineEventItem[];
  contextKey: string;
  computeTurnKey: (event: TimelineEventItem) => string;
  computeSignature: (turnKey: string, events: TimelineEventItem[]) => string;
  buildTurnRows: (turnKey: string, events: TimelineEventItem[]) => ChatRow[];
};

type TranscriptRow = Extract<ChatRow, { kind: "assistant" | "assistantCommentary" }>;

const isTranscriptRow = (row: ChatRow): row is TranscriptRow =>
  row.kind === "assistant" || row.kind === "assistantCommentary";

const hasSamePrefix = (snapshot: TimelineEventItem[], events: TimelineEventItem[]): boolean => {
  for (let index = 0; index < snapshot.length; index += 1) {
    if (snapshot[index] !== events[index]) return false;
  }
  return true;
};

/**
 * 同步事件数组与行缓存，返回与 events 对应的 ChatRow 列表。
 * 无变化时直接返回上一轮数组引用，避免下游 computed 连锁重算。
 */
export function syncTurnRows(state: TurnRowsCacheState, options: SyncTurnRowsOptions): ChatRow[] {
  const { events, contextKey, computeTurnKey, computeSignature, buildTurnRows } = options;

  const sameContext = state.initialized && state.contextKey === contextKey;
  // 上下文（线程 / 工作区 / 工具定义）变化时整体失效，不依赖调用方把上下文写进签名。
  if (!sameContext) state.turnEntries.clear();
  // 结构一致性：上下文与事件数量都未变，才能用「按位置比对对象引用」判断增量。
  const sameLength = sameContext && state.snapshot.length === events.length;

  const dirtyIndexes: number[] = [];
  if (sameLength) {
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (state.snapshot[index] === event) continue;
      // 快照就地更新，避免每帧复制整个事件数组。
      state.snapshot[index] = event;
      dirtyIndexes.push(index);
    }
    if (dirtyIndexes.length === 0) return state.rows;
  }

  const dirtyTurnKeys = new Set<string>();

  const rebuildGroups = () => {
    state.buckets.clear();
    state.order.length = 0;
    state.keyByIndex.length = 0;
    state.indexInTurn.length = 0;
    state.turnKeyByEventId.clear();
    dirtyTurnKeys.clear();
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      const turnKey = computeTurnKey(event);
      let bucket = state.buckets.get(turnKey);
      if (!bucket) {
        bucket = [];
        state.buckets.set(turnKey, bucket);
        state.order.push(turnKey);
      }
      state.keyByIndex[index] = turnKey;
      state.indexInTurn[index] = bucket.length;
      bucket.push(event);
      state.turnKeyByEventId.set(event.id, turnKey);
      dirtyTurnKeys.add(turnKey);
    }
  };

  let rebuilt = false;
  if (sameLength) {
    // 位置不变时，只要 turn 归属没变，就可以原地替换桶内的事件引用。
    let structureChanged = false;
    for (const index of dirtyIndexes) {
      if (computeTurnKey(events[index]) !== state.keyByIndex[index]) {
        structureChanged = true;
        break;
      }
    }
    if (!structureChanged) {
      for (const index of dirtyIndexes) {
        const turnKey = state.keyByIndex[index];
        const bucket = state.buckets.get(turnKey);
        if (!bucket) {
          structureChanged = true;
          break;
        }
        bucket[state.indexInTurn[index]] = events[index];
        state.turnKeyByEventId.set(events[index].id, turnKey);
        dirtyTurnKeys.add(turnKey);
      }
    }
    if (structureChanged) {
      rebuildGroups();
      rebuilt = true;
    }
  } else if (sameContext && events.length > state.snapshot.length && hasSamePrefix(state.snapshot, events)) {
    // 尾部追加（流式新增事件的主要形态）：只把新事件推进对应桶，不重新分组。
    for (let index = state.snapshot.length; index < events.length; index += 1) {
      const event = events[index];
      const turnKey = computeTurnKey(event);
      let bucket = state.buckets.get(turnKey);
      if (!bucket) {
        bucket = [];
        state.buckets.set(turnKey, bucket);
        state.order.push(turnKey);
      }
      state.keyByIndex[index] = turnKey;
      state.indexInTurn[index] = bucket.length;
      bucket.push(event);
      state.turnKeyByEventId.set(event.id, turnKey);
      dirtyTurnKeys.add(turnKey);
    }
  } else {
    rebuildGroups();
    rebuilt = true;
  }

  // 流式文本变化不会改变 turn 结构签名，但缓存行里持有的仍是旧事件对象。
  // 结构重建时（历史回放等）事件对象可能整体换新，需要按 id 全量校对一次。
  let lookupEvent: ((id: string) => TimelineEventItem | undefined) | null = null;
  if (rebuilt) {
    const eventsById = new Map<string, TimelineEventItem>();
    for (const event of events) eventsById.set(event.id, event);
    lookupEvent = (id) => eventsById.get(id);
  } else if (dirtyIndexes.length > 0) {
    const dirtyEventById = new Map<string, TimelineEventItem>();
    for (const index of dirtyIndexes) dirtyEventById.set(events[index].id, events[index]);
    lookupEvent = (id) => dirtyEventById.get(id);
  }

  const patchCachedRows = (turnRows: ChatRow[]): ChatRow[] => {
    if (!lookupEvent) return turnRows;
    let patched: ChatRow[] | null = null;
    for (let index = 0; index < turnRows.length; index += 1) {
      const row = turnRows[index];
      if (!isTranscriptRow(row)) continue;
      const nextEvent = lookupEvent(row.event.id);
      if (!nextEvent || nextEvent === row.event) continue;
      if (!patched) patched = turnRows.slice();
      patched[index] = { ...row, event: nextEvent };
    }
    return patched ?? turnRows;
  };

  const rows: ChatRow[] = [];
  const activeTurnKeys = new Set<string>();
  for (const turnKey of state.order) {
    activeTurnKeys.add(turnKey);
    const bucket = state.buckets.get(turnKey) ?? [];
    const cached = state.turnEntries.get(turnKey);

    // 该 turn 没有任何事件变化，直接复用上一轮的行。
    if (!rebuilt && cached && !dirtyTurnKeys.has(turnKey)) {
      for (const row of cached.rows) rows.push(row);
      continue;
    }

    const signature = computeSignature(turnKey, bucket);
    if (cached && cached.signature === signature) {
      const cachedRows = dirtyTurnKeys.has(turnKey) ? patchCachedRows(cached.rows) : cached.rows;
      if (cachedRows !== cached.rows) state.turnEntries.set(turnKey, { signature, rows: cachedRows });
      for (const row of cachedRows) rows.push(row);
      continue;
    }

    const turnRows = buildTurnRows(turnKey, bucket);
    state.turnEntries.set(turnKey, { signature, rows: turnRows });
    for (const row of turnRows) rows.push(row);
  }

  for (const turnKey of state.turnEntries.keys()) {
    if (!activeTurnKeys.has(turnKey)) state.turnEntries.delete(turnKey);
  }

  if (!sameLength) state.snapshot = events.slice();
  state.contextKey = contextKey;
  state.rows = rows;
  state.initialized = true;
  return rows;
}
