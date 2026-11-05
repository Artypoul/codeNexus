import { defineStore } from "pinia";
import type { Project } from "@codenexus/generated/codex-app-server/v2/Project";
import type { ThreadSection } from "@codenexus/generated/codex-app-server/v2/ThreadSection";

export type ProjectLoadStatus = "idle" | "loading" | "ready" | "error";

type ProjectSnapshot = {
  workspacePath: string;
  serverId: string;
  projects: Project[];
  sections: ThreadSection[];
  loadedAt: number;
};

function normalizeWorkspaceKey(value: unknown): string {
  let path = String(value ?? "")
    .trim()
    .replace(/\//g, "\\");
  while (path.endsWith("\\") && path.length > 3) path = path.slice(0, -1);
  return path.toLowerCase();
}

export const useProjectStore = defineStore("project", {
  state: () => ({
    workspacePath: "",
    serverId: "",
    status: "idle" as ProjectLoadStatus,
    projects: [] as Project[],
    sections: [] as ThreadSection[],
    loadedAt: 0,
    error: "",
  }),
  getters: {
    hasSnapshotForWorkspace: (state) => (workspacePathValue: string) => {
      const workspace = normalizeWorkspaceKey(workspacePathValue);
      return Boolean(
        workspace &&
        normalizeWorkspaceKey(state.workspacePath) === workspace &&
        state.loadedAt > 0 &&
        (state.status === "ready" || state.status === "loading" || state.status === "error")
      );
    },
    projectById: (state) => {
      const byId = new Map<string, Project>();
      for (const project of state.projects) byId.set(project.id, project);
      return byId;
    },
    sectionById: (state) => {
      const byId = new Map<string, ThreadSection>();
      for (const section of state.sections) byId.set(section.id, section);
      return byId;
    },
  },
  actions: {
    beginLoad(workspacePathValue: string, serverIdValue: string) {
      const workspacePath = String(workspacePathValue ?? "").trim();
      const serverId = String(serverIdValue ?? "").trim();
      if (!workspacePath || !serverId) return;
      if (normalizeWorkspaceKey(this.workspacePath) !== normalizeWorkspaceKey(workspacePath)) {
        this.projects = [];
        this.sections = [];
        this.loadedAt = 0;
      }
      this.workspacePath = workspacePath;
      this.serverId = serverId;
      this.status = "loading";
      this.error = "";
    },
    setSnapshot(snapshot: ProjectSnapshot) {
      this.workspacePath = snapshot.workspacePath;
      this.serverId = snapshot.serverId;
      this.status = "ready";
      this.projects = snapshot.projects;
      this.sections = snapshot.sections;
      this.loadedAt = snapshot.loadedAt;
      this.error = "";
    },
    setError(workspacePathValue: string, serverIdValue: string, message: string) {
      const workspacePath = String(workspacePathValue ?? "").trim();
      if (normalizeWorkspaceKey(this.workspacePath) !== normalizeWorkspaceKey(workspacePath)) {
        this.projects = [];
        this.sections = [];
        this.loadedAt = 0;
      }
      this.workspacePath = workspacePath;
      this.serverId = String(serverIdValue ?? "").trim();
      this.status = "error";
      this.error = String(message ?? "").trim();
    },
    removeProject(projectIdValue: string) {
      const projectId = String(projectIdValue ?? "").trim();
      if (!projectId) return;
      this.projects = this.projects.filter((project) => project.id !== projectId);
    },
    upsertProject(project: Project) {
      const projectId = String(project?.id ?? "").trim();
      if (!projectId) return;
      const index = this.projects.findIndex((item) => item.id === projectId);
      if (index >= 0) this.projects[index] = project;
      else this.projects.push(project);
      this.projects.sort((left, right) => left.position - right.position);
    },
    clear() {
      this.workspacePath = "";
      this.serverId = "";
      this.status = "idle";
      this.projects = [];
      this.sections = [];
      this.loadedAt = 0;
      this.error = "";
    },
  },
});
