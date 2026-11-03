import { describe, expect, it } from "vitest";
import type { ChatAuxActivityGroupRow, ChatAuxiliaryRow } from "../types/chat.types";
import { canReuseAuxGroup, type AuxGroupCacheEntry, type AuxGroupFlags } from "./auxGroupCache";

const makeAuxRow = (id: string): ChatAuxiliaryRow =>
  ({ id, turnKey: "turn:t1", kind: "activity", text: id, createdAt: 1 }) as ChatAuxiliaryRow;

const makeEntry = (members: ChatAuxiliaryRow[], flags: AuxGroupFlags): AuxGroupCacheEntry => ({
  ...flags,
  row: {
    id: `aux:${flags.groupIndex}:${members[0]?.id ?? "empty"}`,
    turnKey: members[0]?.turnKey ?? "",
    kind: "auxActivityGroup",
    items: [...members],
    summaryItems: [],
    summaryText: "",
    status: "completed",
    defaultCollapsed: flags.defaultCollapsed,
    startedAtMs: flags.startedAtMs,
    answerStartedAtMs: flags.answerStartedAtMs,
    elapsedLive: flags.elapsedLive,
  } satisfies ChatAuxActivityGroupRow,
});

const baseFlags = (): AuxGroupFlags => ({
  groupIndex: 0,
  locale: "zh-CN",
  defaultCollapsed: true,
  startedAtMs: 100,
  answerStartedAtMs: null,
  elapsedLive: false,
});

describe("canReuseAuxGroup", () => {
  it("成员与标记都没变时复用", () => {
    const members = [makeAuxRow("a"), makeAuxRow("b")];
    const flags = baseFlags();
    expect(canReuseAuxGroup(makeEntry(members, flags), flags, members)).toBe(true);
  });

  it("成员对象换了就重建", () => {
    const flags = baseFlags();
    const entry = makeEntry([makeAuxRow("a"), makeAuxRow("b")], flags);
    expect(canReuseAuxGroup(entry, flags, [entry.row.items[0], makeAuxRow("b")])).toBe(false);
  });

  it("成员数量变化就重建", () => {
    const flags = baseFlags();
    const entry = makeEntry([makeAuxRow("a")], flags);
    expect(canReuseAuxGroup(entry, flags, [makeAuxRow("a"), makeAuxRow("b")])).toBe(false);
  });

  it.each([
    ["groupIndex", { groupIndex: 1 }],
    ["locale", { locale: "en-US" }],
    ["defaultCollapsed", { defaultCollapsed: false }],
    ["startedAtMs", { startedAtMs: 200 }],
    ["answerStartedAtMs", { answerStartedAtMs: 300 }],
    ["elapsedLive", { elapsedLive: true }],
  ] as const)("标记 %s 变化就重建", (_label, patch) => {
    const members = [makeAuxRow("a")];
    const flags = baseFlags();
    const entry = makeEntry(members, flags);
    expect(canReuseAuxGroup(entry, { ...flags, ...patch }, members)).toBe(false);
  });

  it("没有缓存条目时返回 false", () => {
    expect(canReuseAuxGroup(undefined, baseFlags(), [makeAuxRow("a")])).toBe(false);
  });
});
