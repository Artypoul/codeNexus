import type { Project } from "@codenexus/generated/codex-app-server/v2/Project";
import type { ProjectRoot } from "@codenexus/generated/codex-app-server/v2/ProjectRoot";

export function normalizeProjectPath(value: unknown): string {
  let path = String(value ?? "")
    .trim()
    .replace(/\//g, "\\");
  if (path.startsWith("\\\\?\\UNC\\")) path = `\\\\${path.slice(8)}`;
  else if (path.startsWith("\\\\?\\")) path = path.slice(4);
  while (path.endsWith("\\") && path.length > 3) path = path.slice(0, -1);
  return path.toLowerCase();
}

function projectRootPath(root: Pick<ProjectRoot, "path"> | string): string {
  return normalizeProjectPath(typeof root === "string" ? root : root?.path);
}

export function findProjectForWorkspace<T extends Pick<Project, "id" | "name" | "roots" | "position">>(
  projects: T[],
  workspacePathValue: string
): T | null {
  const workspace = normalizeProjectPath(workspacePathValue);
  if (!workspace) return null;

  let best: { project: T; rootLength: number } | null = null;
  for (const project of projects) {
    for (const root of project.roots ?? []) {
      const rootPath = projectRootPath(root);
      if (!rootPath) continue;
      const prefix = rootPath.endsWith("\\") ? rootPath : `${rootPath}\\`;
      if (workspace !== rootPath && !workspace.startsWith(prefix)) continue;
      if (!best || rootPath.length > best.rootLength) {
        best = { project, rootLength: rootPath.length };
      }
    }
  }
  return best?.project ?? null;
}

export function projectNameFromWorkspace(workspacePathValue: string): string {
  const normalized = String(workspacePathValue ?? "")
    .trim()
    .replace(/\//g, "\\")
    .replace(/\\+$/, "");
  const parts = normalized.split("\\").filter(Boolean);
  return parts.length > 0 ? String(parts[parts.length - 1]) : "Workspace";
}

export function projectAutoCreateKey(workspacePathValue: string): string {
  const workspace = normalizeProjectPath(workspacePathValue);
  let hash = 2166136261;
  for (let index = 0; index < workspace.length; index += 1) {
    hash ^= workspace.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `codenexus-auto-project-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
