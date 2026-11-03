import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useWorkspaceFilesStore } from "./workspaceFiles.store";
import type { WorkspaceDirectoryReadResult } from "../domain/types";

const { readDirectory, readGit, getMetadata, readText, runtime } = vi.hoisted(() => ({
  readDirectory: vi.fn(),
  readGit: vi.fn(),
  getMetadata: vi.fn(),
  readText: vi.fn(),
  runtime: { workspacePath: "D:/A" },
}));
vi.mock("../api/codexDesktopClient", () => ({ codexDesktop: { workspace: { readGitStatus: readGit } } }));
vi.mock("../domain/runtimeOrchestrator", () => ({
  getRuntimeOrchestrator: () => ({
    readWorkspaceDirectory: readDirectory,
    getWorkspaceMetadata: getMetadata,
    readWorkspaceTextFile: readText,
  }),
}));
vi.mock("./runtime.store", () => ({ useRuntimeStore: () => runtime }));
vi.mock("./timeline.store", () => ({ useTimelineStore: vi.fn() }));
vi.mock("../ui/toast", () => ({ showToast: vi.fn() }));
vi.mock("../i18n/translate", () => ({ translate: (key: string) => key }));
const directory = (path: string, fileName = "file.ts"): WorkspaceDirectoryReadResult => ({
  path,
  source: "local",
  entries: [{ path: `${path}/${fileName}`, fileName, isDirectory: false, isFile: true, source: "local" }],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  runtime.workspacePath = "D:/A";
  readDirectory.mockReset().mockImplementation(async (path: string) => directory(path));
  readGit.mockReset().mockResolvedValue({ ok: true, entries: [] });
  getMetadata.mockReset();
  readText.mockReset();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("workspace file switching", () => {
  it("restores directory position and expanded folders on A → B → A without new reads", async () => {
    const store = useWorkspaceFilesStore();
    await store.ensureReady();
    await store.openDirectory("D:/A/src");
    const calls = readDirectory.mock.calls.length;
    runtime.workspacePath = "D:/B";
    await store.ensureReady();
    runtime.workspacePath = "D:/A";
    await store.ensureReady();
    expect(store.directoryPath).toBe("D:/A/src");
    expect(store.expandedDirectoryPaths).toContain("D:/A/src");
    expect(readDirectory).toHaveBeenCalledTimes(calls + 1);
    expect(store.entries[0].path).toBe("D:/A/src/file.ts");
    vi.setSystemTime(1_016_000);
    await store.ensureReady();
    expect(readDirectory).toHaveBeenCalledTimes(calls + 3);
  });

  it("deduplicates directory reads and blocks A results after switching to B", async () => {
    const pending = deferred<WorkspaceDirectoryReadResult>();
    readDirectory.mockReturnValueOnce(pending.promise);
    const store = useWorkspaceFilesStore();
    store.syncWorkspace();
    const a = store.openDirectory("D:/A");
    const duplicate = store.ensureDirectoryLoaded("D:/A");
    expect(readDirectory).toHaveBeenCalledTimes(1);
    runtime.workspacePath = "D:/B";
    await store.ensureReady();
    pending.resolve(directory("D:/A", "late.ts"));
    await Promise.all([a, duplicate]);
    expect(store.directoryPath).toBe("D:/B");
    expect(store.entries[0].path).toBe("D:/B/file.ts");
    expect(store.treeEntriesByPath["d:/a"]).toBeUndefined();
    expect(store.directoryLoading).toBe(false);
  });

  it("rejects old A results even after switching back to A", async () => {
    const pending = deferred<WorkspaceDirectoryReadResult>();
    readDirectory.mockReturnValueOnce(pending.promise);
    const store = useWorkspaceFilesStore();
    const oldA = store.ensureReady();
    runtime.workspacePath = "D:/B";
    await store.ensureReady();
    runtime.workspacePath = "D:/A";
    await store.ensureReady();
    pending.resolve(directory("D:/A", "old.ts"));
    await oldA;
    expect(store.entries[0].fileName).toBe("file.ts");
  });

  it("ignores late Git status and invalidates requests when the tree cache is cleared", async () => {
    const git = deferred<{ ok: boolean; entries: { path: string; code: string }[] }>();
    const store = useWorkspaceFilesStore();
    store.syncWorkspace();
    readGit.mockReturnValueOnce(git.promise);
    const oldGit = store.refreshGitStatus();
    const secondGit = store.refreshGitStatus();
    expect(readGit).toHaveBeenCalledTimes(1);
    runtime.workspacePath = "D:/B";
    store.syncWorkspace();
    git.resolve({ ok: true, entries: [{ path: "D:/A/old.ts", code: "M" }] });
    await Promise.all([oldGit, secondGit]);
    expect(store.gitStatusByPath).toEqual({});
    const dir = deferred<WorkspaceDirectoryReadResult>();
    readDirectory.mockReturnValueOnce(dir.promise);
    const pending = store.ensureDirectoryLoaded("D:/B");
    store.clearTreeCache();
    dir.resolve(directory("D:/B"));
    await pending;
    expect(store.treeEntriesByPath).toEqual({});
    expect(store.directoryLoading).toBe(false);
  });

  it("bounds inactive workspaces and honors explicit force refresh", async () => {
    const store = useWorkspaceFilesStore();
    for (const workspace of ["A", "B", "C", "D", "E"]) {
      runtime.workspacePath = `D:/${workspace}`;
      await store.ensureReady();
    }
    runtime.workspacePath = "D:/A";
    await store.ensureReady();
    expect(readDirectory).toHaveBeenCalledTimes(6);
    await store.ensureReady(true);
    expect(readDirectory).toHaveBeenCalledTimes(7);
    expect(store.getTreeCacheStats().items).toBe(4);
  });

  it("does not let old file metadata overwrite a newly opened file after A → B → A", async () => {
    const oldMetadata = deferred<{ path: string; isFile: boolean; isDirectory: boolean }>();
    const metadata = { path: "D:/A/file.ts", isFile: true, isDirectory: false };
    getMetadata.mockReturnValueOnce(oldMetadata.promise).mockResolvedValue(metadata);
    readText.mockResolvedValue({
      path: metadata.path,
      source: "local",
      content: "new content",
      encoding: "UTF-8",
      lineEnding: "LF",
    });
    const store = useWorkspaceFilesStore();
    await store.ensureReady();
    const oldFile = store.openFile(metadata.path);
    for (let step = 0; step < 10; step += 1) await Promise.resolve();
    expect(getMetadata).toHaveBeenCalledTimes(1);
    runtime.workspacePath = "D:/B";
    await store.ensureReady();
    runtime.workspacePath = "D:/A";
    await store.ensureReady();
    expect(await store.openFile(metadata.path)).toBe(true);
    oldMetadata.resolve({ ...metadata, isFile: false });
    expect(await oldFile).toBe(false);
    expect(store.activeTab?.originalContent).toBe("new content");
    expect(store.activeTab?.errorText).toBe("");
  });

  it("revalidates stale expanded siblings when restoring a workspace snapshot", async () => {
    const store = useWorkspaceFilesStore();
    await store.ensureReady();
    await store.toggleDirectoryExpanded("D:/A/tests");
    await store.openDirectory("D:/A/src");
    runtime.workspacePath = "D:/B";
    await store.ensureReady();
    vi.setSystemTime(1_016_000);
    runtime.workspacePath = "D:/A";
    await store.ensureReady();
    expect(store.directoryPath).toBe("D:/A/src");
    expect(readDirectory.mock.calls.filter(([path]) => path === "D:/A/tests")).toHaveLength(2);
  });
});
