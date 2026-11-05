import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref, type EffectScope } from "vue";
import { useChatRenderModel } from "./useChatRenderModel";
import type { TimelineEventItem } from "../../../domain/types";

const { runtime, build } = vi.hoisted(() => ({ runtime: { timelineKey: "A", currentThreadId: "A" }, build: vi.fn() }));
vi.mock("../../../stores/runtime.store", () => ({ useRuntimeStore: () => runtime }));
vi.mock("../../../stores/thread.store", () => ({
  useThreadStore: () => ({
    completedTurnsByThread: new Map(),
    activeTurnIdByThread: new Map(),
    turnStartedAtByThread: new Map(),
    runningThreadIds: new Set(),
  }),
}));
vi.mock("../../../features/timeline/renderModel/buildTimelineNodes", () => ({ buildTimelineRenderNodes: build }));
vi.mock("../../../i18n", async () => ({ i18n: { global: { locale: (await import("vue")).ref("zh-CN") } } }));
vi.mock("../../../i18n/translate", () => ({ translate: (key: string) => key }));
let scope: EffectScope;
afterEach(() => {
  scope?.stop();
  build.mockReset();
});
function setup() {
  runtime.timelineKey = "A";
  runtime.currentThreadId = "A";
  const key = ref("A");
  const revision = ref(0);
  const events = new Map(
    ["A", "B", "C", "D", "E"].map((id) => [
      id,
      [
        {
          id,
          turnId: `turn-${id}`,
          method: "item/agentMessage/delta",
          paramsText: id,
          params: { item: { phase: "final_answer" } },
          createdAt: 1,
          level: "info",
        } as TimelineEventItem,
      ],
    ])
  );
  build.mockImplementation(({ events }: { events: TimelineEventItem[] }) =>
    events.map((event) => ({ id: event.id, kind: "event", event }))
  );
  scope = effectScope();
  const model = scope.run(() =>
    useChatRenderModel(
      () => events.get(key.value)!,
      () => revision.value,
      () => `D:/${key.value}`,
      () => new Map()
    )
  )!;
  const select = (id: string) => {
    runtime.timelineKey = id;
    runtime.currentThreadId = id;
    key.value = id;
    return model.chatRenderedRows.value;
  };
  return { model, select, events, revision };
}

describe("chat row caches across workspaces", () => {
  it("reuses prior A rows while still applying streamed changes that arrived while away", () => {
    const { select, events, revision } = setup();
    const firstA = select("A")[0];
    select("B");
    expect(select("A")[0]).toBe(firstA);
    expect(build).toHaveBeenCalledTimes(2);
    select("B");
    events.set("A", [{ ...events.get("A")![0], paramsText: "new A text" }]);
    revision.value += 1;
    const changed = select("A")[0];
    expect(changed.kind).toBe("assistant");
    if (changed.kind === "assistant") expect(changed.event.paramsText).toBe("new A text");
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("evicts older render models when more than four contexts are visited", () => {
    const { select } = setup();
    for (const id of ["A", "B", "C", "D", "E", "A"]) select(id);
    expect(build).toHaveBeenCalledTimes(6);
  });

  it("treats agent messages without a phase as answer rows instead of process rows", () => {
    const { select, events, revision } = setup();
    const base = events.get("A")![0];
    events.set("A", [
      { ...base, id: "no-phase", paramsText: "final answer", params: { item: { type: "agentMessage" } } },
    ]);
    revision.value += 1;

    const rows = select("A");
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("assistant");
  });

  it("keeps explicit commentary messages inside the process group", () => {
    const { select, events, revision } = setup();
    const base = events.get("A")![0];
    events.set("A", [
      {
        ...base,
        id: "commentary",
        paramsText: "working",
        params: { item: { type: "agentMessage", phase: "commentary" } },
      },
    ]);
    revision.value += 1;

    const rows = select("A");
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("auxActivityGroup");
  });

  it("keeps a streamed answer outside the process group when completion adds final_answer", () => {
    const { select, events, revision } = setup();
    const base = events.get("A")![0];
    const streaming = {
      ...base,
      id: "streamed-answer",
      paramsText: "partial answer",
      params: { item: { type: "agentMessage" } },
    };
    events.set("A", [streaming]);
    revision.value += 1;

    const before = select("A");
    expect(before.map((row) => row.kind)).toEqual(["assistant"]);

    events.set("A", [
      {
        ...streaming,
        paramsText: "partial answer complete",
        params: { item: { type: "agentMessage", phase: "final_answer" } },
      },
    ]);
    revision.value += 1;

    const after = select("A");
    expect(after.map((row) => row.kind)).toEqual(["assistant"]);
    expect(after[0].id).toBe(before[0].id);
  });
});
