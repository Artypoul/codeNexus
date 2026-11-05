import type { Project } from "@codenexus/generated/codex-app-server/v2/Project";
import type { ThreadSection } from "@codenexus/generated/codex-app-server/v2/ThreadSection";

export type GroupableThread = {
  id: string;
  title: string;
  updatedAt: number;
  cwd?: string;
  projectId?: string | null;
  sectionId?: string | null;
  sectionName?: string | null;
};

export type ThreadRowModel<T extends GroupableThread> = {
  item: T;
  depth: number;
};

export type ThreadSectionGroup<T extends GroupableThread> = {
  key: string;
  title: string;
  updatedAt: number;
  rows: ThreadRowModel<T>[];
};

export type ThreadHistoryGroup<T extends GroupableThread> = {
  key: string;
  title: string;
  kind: "project" | "unassigned" | "workspace";
  cwdFull: string;
  updatedAt: number;
  rows: ThreadRowModel<T>[];
  sections: ThreadSectionGroup<T>[];
};

export type ThreadHistoryGrouping<T extends GroupableThread> = {
  primaryGroups: ThreadHistoryGroup<T>[];
  otherWorkspaceGroups: ThreadHistoryGroup<T>[];
};

export type BuildThreadHistoryGroupsArgs<T extends GroupableThread> = {
  mode: "project" | "workspace";
  items: T[];
  projects: Array<Pick<Project, "id" | "name" | "position">>;
  sections: Array<Pick<ThreadSection, "id" | "name">>;
  currentWorkspace: string;
  labels: {
    unassigned: string;
    noWorkspace: string;
  };
};

const titleCollator =
  typeof Intl !== "undefined" && typeof Intl.Collator === "function"
    ? new Intl.Collator(["zh-Hans-u-co-pinyin", "zh-CN-u-co-pinyin", "zh-CN", "en"], {
        usage: "sort",
        sensitivity: "base",
        numeric: true,
        ignorePunctuation: true,
      })
    : null;

function compareTitle(a: string, b: string): number {
  return titleCollator
    ? titleCollator.compare(String(a ?? "").trim(), String(b ?? "").trim())
    : String(a ?? "")
        .trim()
        .localeCompare(String(b ?? "").trim(), "zh-CN", { sensitivity: "base", numeric: true });
}

function normalizeFsPath(value: unknown): string {
  let path = String(value ?? "")
    .trim()
    .replace(/\//g, "\\");
  while (path.endsWith("\\") && path.length > 3) path = path.slice(0, -1);
  return path.toLowerCase();
}

function basenameFromPath(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .replace(/\//g, "\\")
    .replace(/\\+$/, "");
  if (!normalized) return "";
  const parts = normalized.split("\\").filter(Boolean);
  return parts.length > 0 ? String(parts[parts.length - 1] ?? "").trim() : normalized;
}

function sortThreads<T extends GroupableThread>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    a.updatedAt !== b.updatedAt ? b.updatedAt - a.updatedAt : compareTitle(a.title, b.title)
  );
}

function maxUpdatedAt<T extends GroupableThread>(items: T[]): number {
  return items.reduce((latest, item) => Math.max(latest, Number(item.updatedAt ?? 0)), 0);
}

function toRows<T extends GroupableThread>(items: T[]): ThreadRowModel<T>[] {
  return sortThreads(items).map((item) => ({ item, depth: 0 }));
}

function buildSections<T extends GroupableThread>(
  items: T[],
  sections: Array<Pick<ThreadSection, "id" | "name">>
): { rows: ThreadRowModel<T>[]; sections: ThreadSectionGroup<T>[] } {
  const unsectioned: T[] = [];
  const bySectionId = new Map<string, T[]>();
  for (const item of items) {
    const sectionId = String(item.sectionId ?? "").trim();
    if (!sectionId) {
      unsectioned.push(item);
      continue;
    }
    const bucket = bySectionId.get(sectionId);
    if (bucket) bucket.push(item);
    else bySectionId.set(sectionId, [item]);
  }

  const sectionTitleById = new Map<string, string>();
  const sectionOrder = new Map<string, number>();
  sections.forEach((section, index) => {
    sectionTitleById.set(section.id, section.name);
    sectionOrder.set(section.id, index);
  });

  const groups: ThreadSectionGroup<T>[] = [];
  for (const [sectionId, sectionItems] of bySectionId.entries()) {
    const fallbackName = sectionItems.find((item) => String(item.sectionName ?? "").trim())?.sectionName ?? "";
    groups.push({
      key: `section:${sectionId}`,
      title: sectionTitleById.get(sectionId) || String(fallbackName).trim() || sectionId,
      updatedAt: maxUpdatedAt(sectionItems),
      rows: toRows(sectionItems),
    });
  }
  groups.sort((a, b) => {
    const aIndex = sectionOrder.get(a.key.slice("section:".length));
    const bIndex = sectionOrder.get(b.key.slice("section:".length));
    if (aIndex != null && bIndex != null && aIndex !== bIndex) return aIndex - bIndex;
    if (aIndex != null && bIndex == null) return -1;
    if (aIndex == null && bIndex != null) return 1;
    return compareTitle(a.title, b.title);
  });

  return {
    rows: toRows(unsectioned),
    sections: groups,
  };
}

function buildWorkspaceGroups<T extends GroupableThread>(
  items: T[],
  labels: BuildThreadHistoryGroupsArgs<T>["labels"]
): ThreadHistoryGroup<T>[] {
  const byWorkspace = new Map<string, { cwd: string; items: T[] }>();
  for (const item of items) {
    const cwd = String(item.cwd ?? "").trim();
    const key = normalizeFsPath(cwd) || "__no_workspace__";
    const bucket = byWorkspace.get(key);
    if (bucket) bucket.items.push(item);
    else byWorkspace.set(key, { cwd, items: [item] });
  }

  const groups = [...byWorkspace.entries()].map(([key, bucket]) => ({
    key: `workspace:${key}`,
    title: bucket.cwd ? basenameFromPath(bucket.cwd) : labels.noWorkspace,
    kind: "workspace" as const,
    cwdFull: bucket.cwd,
    updatedAt: maxUpdatedAt(bucket.items),
    rows: toRows(bucket.items),
    sections: [],
  }));
  groups.sort((a, b) => {
    if (a.key.endsWith("__no_workspace__") && !b.key.endsWith("__no_workspace__")) return 1;
    if (b.key.endsWith("__no_workspace__") && !a.key.endsWith("__no_workspace__")) return -1;
    const byTitle = compareTitle(a.title, b.title);
    return byTitle !== 0 ? byTitle : compareTitle(a.cwdFull || a.key, b.cwdFull || b.key);
  });
  return groups;
}

export function buildThreadHistoryGroups<T extends GroupableThread>(
  args: BuildThreadHistoryGroupsArgs<T>
): ThreadHistoryGrouping<T> {
  if (args.mode === "workspace") {
    return {
      primaryGroups: buildWorkspaceGroups(args.items, args.labels),
      otherWorkspaceGroups: [],
    };
  }

  const projectById = new Map(
    args.projects
      .slice()
      .sort((a, b) => a.position - b.position || compareTitle(a.name, b.name))
      .map((project) => [project.id, project] as const)
  );
  const currentWorkspace = normalizeFsPath(args.currentWorkspace);
  const byProject = new Map<string, T[]>();
  const unassigned: T[] = [];
  const otherWorkspaceItems: T[] = [];

  for (const item of args.items) {
    const projectId = String(item.projectId ?? "").trim();
    if (projectId && projectById.has(projectId)) {
      const bucket = byProject.get(projectId);
      if (bucket) bucket.push(item);
      else byProject.set(projectId, [item]);
      continue;
    }
    if (currentWorkspace && normalizeFsPath(item.cwd) === currentWorkspace) {
      unassigned.push(item);
      continue;
    }
    otherWorkspaceItems.push(item);
  }

  const primaryGroups: ThreadHistoryGroup<T>[] = [];
  for (const project of projectById.values()) {
    const projectItems = byProject.get(project.id) ?? [];
    const sectioned = buildSections(projectItems, args.sections);
    primaryGroups.push({
      key: `project:${project.id}`,
      title: project.name,
      kind: "project",
      cwdFull: "",
      updatedAt: maxUpdatedAt(projectItems),
      rows: sectioned.rows,
      sections: sectioned.sections,
    });
  }

  if (unassigned.length > 0) {
    const sectioned = buildSections(unassigned, args.sections);
    primaryGroups.push({
      key: `unassigned:${currentWorkspace || "__no_workspace__"}`,
      title: args.labels.unassigned,
      kind: "unassigned",
      cwdFull: String(args.currentWorkspace ?? "").trim(),
      updatedAt: maxUpdatedAt(unassigned),
      rows: sectioned.rows,
      sections: sectioned.sections,
    });
  }

  const otherWorkspaceGroups = buildWorkspaceGroups(otherWorkspaceItems, args.labels).map((group) => ({
    ...group,
    key: `other:${group.key.slice("workspace:".length)}`,
  }));
  return { primaryGroups, otherWorkspaceGroups };
}
