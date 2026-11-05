import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HistoryStore } from "./historyStore";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("HistoryStore project metadata cache", () => {
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
