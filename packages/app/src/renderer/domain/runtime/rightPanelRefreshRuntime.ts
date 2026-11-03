export type RightPanelRefreshRuntimeDeps = {
  getWorkspacePath: () => string;
  normalizeWorkspacePath: (value: string) => string;
  getServerIdForWorkspace: (workspacePath: string) => string;
  hasSkillsSnapshot: (workspacePath: string) => boolean;
  hasMcpSnapshot: (workspacePath: string) => boolean;
  ensureGlobalConfigLoadedOnce: () => Promise<void>;
  ensureModelCatalog: () => Promise<unknown>;
  refreshSkills: (forceReload?: boolean) => Promise<void>;
  refreshMcp: () => Promise<void>;
};

export type RightPanelRefreshRuntime = {
  refreshRightPanels: (opts?: { forceSkills?: boolean; forceMcp?: boolean }) => Promise<void>;
};

export function createRightPanelRefreshRuntime(deps: RightPanelRefreshRuntimeDeps): RightPanelRefreshRuntime {
  const refreshRightPanels: RightPanelRefreshRuntime["refreshRightPanels"] = async (opts) => {
    const workspace = deps.normalizeWorkspacePath(deps.getWorkspacePath());
    if (!workspace || !deps.getServerIdForWorkspace(workspace)) return;
    const shouldRefreshSkills = Boolean(opts?.forceSkills) || !deps.hasSkillsSnapshot(workspace);
    const shouldRefreshMcp = Boolean(opts?.forceMcp) || !deps.hasMcpSnapshot(workspace);
    const tasks: Promise<unknown>[] = [deps.ensureGlobalConfigLoadedOnce(), deps.ensureModelCatalog()];
    if (shouldRefreshSkills) tasks.push(deps.refreshSkills(false));
    if (shouldRefreshMcp) tasks.push(deps.refreshMcp());
    await Promise.allSettled(tasks);
  };

  return { refreshRightPanels };
}
