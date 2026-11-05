import { describe, expect, it } from "vitest";
import { buildThreadHistoryGroups, type GroupableThread } from "./projectThreadGroups";

type TestThread = GroupableThread & { meta?: string };

function thread(overrides: Partial<TestThread> & Pick<TestThread, "id">): TestThread {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    updatedAt: overrides.updatedAt ?? 1,
    cwd: overrides.cwd,
    projectId: overrides.projectId,
    sectionId: overrides.sectionId,
    sectionName: overrides.sectionName,
  };
}

describe("buildThreadHistoryGroups", () => {
  it("builds project-first groups, keeps empty projects, and isolates other workspaces", () => {
    const result = buildThreadHistoryGroups({
      mode: "project",
      items: [
        thread({
          id: "project-1-thread",
          projectId: "project-1",
          cwd: "C:\\other",
          updatedAt: 4,
        }),
        thread({
          id: "project-2-thread",
          projectId: "project-2",
          cwd: "C:\\repo",
          updatedAt: 3,
        }),
        thread({ id: "unassigned", projectId: null, cwd: "C:\\repo", updatedAt: 2 }),
        thread({ id: "other", projectId: "foreign-project", cwd: "C:\\other", updatedAt: 1 }),
      ],
      projects: [
        { id: "project-2", name: "Beta", position: 2 },
        { id: "project-1", name: "Alpha", position: 1 },
        { id: "project-empty", name: "Empty", position: 3 },
      ],
      sections: [],
      currentWorkspace: "C:\\repo",
      labels: { unassigned: "Unassigned", noWorkspace: "No workspace" },
    });

    expect(result.primaryGroups.map((group) => group.key)).toEqual([
      "project:project-1",
      "project:project-2",
      "project:project-empty",
      "unassigned:c:\\repo",
    ]);
    expect(result.primaryGroups[0]?.rows.map((row) => row.item.id)).toEqual(["project-1-thread"]);
    expect(result.primaryGroups[2]?.rows).toEqual([]);
    expect(result.primaryGroups[3]?.rows.map((row) => row.item.id)).toEqual(["unassigned"]);
    expect(result.otherWorkspaceGroups).toHaveLength(1);
    expect(result.otherWorkspaceGroups[0]?.rows.map((row) => row.item.id)).toEqual(["other"]);
  });

  it("orders sections from the server list and keeps unsectioned threads direct", () => {
    const result = buildThreadHistoryGroups({
      mode: "project",
      items: [
        thread({ id: "plain", projectId: "p1", cwd: "C:\\repo", sectionId: null }),
        thread({ id: "later", projectId: "p1", cwd: "C:\\repo", sectionId: "s2", sectionName: "Later" }),
        thread({ id: "earlier", projectId: "p1", cwd: "C:\\repo", sectionId: "s1", sectionName: "Earlier" }),
        thread({ id: "unknown", projectId: "p1", cwd: "C:\\repo", sectionId: "s3", sectionName: "Unknown" }),
      ],
      projects: [{ id: "p1", name: "Project", position: 0 }],
      sections: [
        { id: "s2", name: "Later" },
        { id: "s1", name: "Earlier" },
        { id: "empty-section", name: "Empty section" },
      ],
      currentWorkspace: "C:\\repo",
      labels: { unassigned: "Unassigned", noWorkspace: "No workspace" },
    });

    const group = result.primaryGroups[0];
    expect(group?.rows.map((row) => row.item.id)).toEqual(["plain"]);
    expect(group?.sections.map((section) => section.title)).toEqual(["Later", "Earlier", "Unknown"]);
    expect(group?.sections.map((section) => section.rows[0]?.item.id)).toEqual(["later", "earlier", "unknown"]);
  });

  it("falls back to workspace groups without treating unknown project metadata as unassigned", () => {
    const result = buildThreadHistoryGroups({
      mode: "workspace",
      items: [
        thread({ id: "repo", cwd: "C:\\repo", projectId: undefined }),
        thread({ id: "other", cwd: "C:\\other", projectId: "p1" }),
        thread({ id: "none" }),
      ],
      projects: [],
      sections: [],
      currentWorkspace: "C:\\repo",
      labels: { unassigned: "Unassigned", noWorkspace: "No workspace" },
    });

    expect(result.primaryGroups.map((group) => group.title)).toEqual(["other", "repo", "No workspace"]);
    expect(result.primaryGroups[0]?.rows[0]?.item.id).toBe("other");
    expect(result.primaryGroups[1]?.rows[0]?.item.id).toBe("repo");
    expect(result.primaryGroups[2]?.rows[0]?.item.id).toBe("none");
    expect(result.otherWorkspaceGroups).toEqual([]);
  });
});
