import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HistoryStore } from "./historyStore";

const tempDirs: string[] = [];

async function createHistoryFixture() {
  const dir = await mkdtemp(join(tmpdir(), "codenexus-history-"));
  tempDirs.push(dir);
  const cachePath = join(dir, "history-cache.json");
  const sessionsRoot = join(dir, "sessions");
  await mkdir(sessionsRoot, { recursive: true });
  const writeSession = async (id = "thread-1") => {
    await writeFile(
      join(sessionsRoot, `${id}.jsonl`),
      `${JSON.stringify({
        type: "session_meta",
        timestamp: "2026-11-07T04:00:00.000Z",
        payload: { id, cwd: "C:\\repo" },
      })}\n`,
      "utf8"
    );
  };
  return { cachePath, sessionsRoot, writeSession, store: new HistoryStore(cachePath, sessionsRoot) };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("HistoryStore project metadata cache", () => {
  it("retains metadata received before the thread is discovered on disk", async () => {
    const { store, cachePath, writeSession } = await createHistoryFixture();

    const beforeHistory = await store.mergeThreadMetadata([
      { id: "thread-1", projectId: "project-1", sectionId: "section-1", sectionName: "In progress" },
    ]);
    expect(beforeHistory).toEqual([]);
    await writeSession();

    const history = await store.refreshDisk();

    expect(history[0]).toMatchObject({
      id: "thread-1",
      projectId: "project-1",
      sectionId: "section-1",
      sectionName: "In progress",
    });
    const cached = JSON.parse(await readFile(cachePath, "utf8"));
    expect(cached.items[0].projectId).toBe("project-1");
  });

  it("restores early metadata after restarting before disk discovery", async () => {
    const { store, cachePath, sessionsRoot, writeSession } = await createHistoryFixture();
    await store.mergeThreadMetadata([{ id: "thread-1", projectId: "project-1" }]);
    await store.refreshDisk();
    await writeSession();

    const restarted = new HistoryStore(cachePath, sessionsRoot);
    const history = await restarted.refreshDisk();

    expect(history[0]).toMatchObject({ id: "thread-1", projectId: "project-1" });
  });

  it("merges early updates without treating unknown grouping fields as clearing", async () => {
    const { store, cachePath, sessionsRoot, writeSession } = await createHistoryFixture();
    await store.mergeThreadMetadata([
      { id: "thread-1", projectId: "project-1", sectionId: "section-1", sectionName: "In progress" },
    ]);
    await store.mergeThreadMetadata([{ id: "thread-1", projectId: "project-2" }]);
    await store.mergeThreadMetadata([{ id: "thread-1", projectId: undefined, sectionId: null, sectionName: null }]);
    await writeSession();

    const history = await new HistoryStore(cachePath, sessionsRoot).refreshDisk();

    expect(history[0]).toMatchObject({
      projectId: "project-2",
      sectionId: null,
      sectionName: null,
    });
  });

  it("preserves explicit clearing before discovery and does not resurrect consumed metadata", async () => {
    const { store, cachePath, sessionsRoot, writeSession } = await createHistoryFixture();
    await store.mergeThreadMetadata([{ id: "thread-1", projectId: "project-1" }]);
    await store.mergeThreadMetadata([{ id: "thread-1", projectId: null }]);
    await writeSession();
    expect((await store.refreshDisk())[0]?.projectId).toBeNull();

    await store.mergeThreadMetadata([{ id: "thread-1", projectId: "project-2" }]);
    const history = await new HistoryStore(cachePath, sessionsRoot).refreshDisk();

    expect(history[0]?.projectId).toBe("project-2");
  });

  it("waits for a shared cold cache load before applying concurrent metadata updates", async () => {
    const { store, cachePath, sessionsRoot } = await createHistoryFixture();
    await writeFile(
      cachePath,
      JSON.stringify({
        version: 3,
        items: [
          {
            id: "thread-1",
            title: "Thread 1",
            updatedAt: 1_700_000_000_000,
            sessionPath: join(sessionsRoot, "thread-1.jsonl"),
          },
        ],
      }),
      "utf8"
    );

    await Promise.all([
      store.mergeThreadMetadata([{ id: "thread-1", projectId: "project-1" }]),
      store.mergeThreadMetadata([{ id: "thread-1", sectionId: "section-1", sectionName: "In progress" }]),
    ]);

    const history = await store.mergeThreadMetadata([]);
    expect(history[0]).toMatchObject({
      projectId: "project-1",
      sectionId: "section-1",
      sectionName: "In progress",
    });
    const restarted = await new HistoryStore(cachePath, sessionsRoot).mergeThreadMetadata([]);
    expect(restarted[0]).toMatchObject({
      projectId: "project-1",
      sectionId: "section-1",
      sectionName: "In progress",
    });
  });

  it("upgrades v2 cache and preserves unknown, assigned, and explicitly cleared project metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codenexus-history-"));
    tempDirs.push(dir);
    const cachePath = join(dir, "history-cache.json");
    const sessionsRoot = join(dir, "sessions");
    await mkdir(sessionsRoot, { recursive: true });
    await writeFile(
      cachePath,
      JSON.stringify({
        version: 2,
        items: [
          {
            id: "thread-1",
            title: "Thread 1",
            cwd: "C:\\repo",
            updatedAt: 1_700_000_000_000,
            sessionPath: join(sessionsRoot, "thread-1.jsonl"),
          },
        ],
      }),
      "utf8"
    );

    const store = new HistoryStore(cachePath, sessionsRoot);
    const unknown = await store.mergeThreadMetadata([{ id: "thread-1", agentNickname: "Agent" }]);
    expect(unknown[0]?.projectId).toBeUndefined();

    const assigned = await store.mergeThreadMetadata([
      { id: "thread-1", projectId: "project-1", sectionId: "section-1", sectionName: "In progress" },
    ]);
    expect(assigned[0]).toMatchObject({
      projectId: "project-1",
      sectionId: "section-1",
      sectionName: "In progress",
    });

    const cleared = await store.mergeThreadMetadata([
      { id: "thread-1", projectId: null, sectionId: null, sectionName: null },
    ]);
    expect(cleared[0]).toMatchObject({ projectId: null, sectionId: null, sectionName: null });

    const persisted = JSON.parse(await readFile(cachePath, "utf8"));
    expect(persisted.version).toBe(3);
    expect(persisted.items[0]).toMatchObject({
      id: "thread-1",
      projectId: null,
      sectionId: null,
      sectionName: null,
    });
  });
});
