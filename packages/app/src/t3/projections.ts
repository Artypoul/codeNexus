export type Data = Record<string, unknown>;

export const record = (value: unknown): Data =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Data) : {};

export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const string = (value: unknown): string => (typeof value === "string" ? value : "");

export const timestamp = (value?: unknown): string => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
  }
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return new Date().toISOString();
};

export type Project = { id: string; title: string; workspaceRoot: string; createdAt: string };
export type Thread = {
  id: string;
  nativeId: string;
  projectId: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  turns: Data[];
  loaded: boolean;
};

export const modelSelection = (model: string) => ({ instanceId: "codex", model });

export const projectShell = (project: Project) => ({
  ...project,
  updatedAt: project.createdAt,
  repositoryIdentity: null,
  defaultModelSelection: null,
  scripts: [],
  deletedAt: null,
});

const status = (value: unknown) => {
  switch (value) {
    case "inProgress":
      return "running";
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
    default:
      return "completed";
  }
};

const messageText = (item: Data) =>
  item.type === "userMessage"
    ? list(item.content)
        .map(record)
        .filter((entry) => entry.type === "text")
        .map((entry) => string(entry.text))
        .join("\n")
    : string(item.text);

const projectTurns = (thread: Thread) => {
  const runs: Data[] = [];
  const turnItems: Data[] = [];
  for (const turn of thread.turns) {
    const runId = string(turn.id);
    if (!runId) continue;
    const runStatus = status(turn.status);
    const active = runStatus === "running";
    const at = timestamp(turn.startedAt ?? thread.updatedAt);
    const turnMessages = list(turn.items)
      .map(record)
      .filter((item) => item.type === "userMessage" || item.type === "agentMessage");
    const userMessageId = string(turnMessages.find((item) => item.type === "userMessage")?.id) || null;
    runs.push({
      id: runId,
      threadId: thread.id,
      ordinal: runs.length + 1,
      providerInstanceId: "codex",
      modelSelection: modelSelection(thread.model),
      providerThreadId: null,
      userMessageId,
      rootNodeId: null,
      activeAttemptId: null,
      status: runStatus,
      requestedAt: at,
      startedAt: at,
      completedAt: active ? null : timestamp(turn.completedAt ?? thread.updatedAt),
      checkpointId: null,
      contextHandoffId: null,
    });
    for (const item of turnMessages) {
      const id = string(item.id);
      if (!id) continue;
      const assistant = item.type === "agentMessage";
      const streaming = assistant && active && item.completed !== true;
      turnItems.push({
        id,
        threadId: thread.id,
        runId,
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: turnItems.length,
        status: streaming ? "running" : "completed",
        title: null,
        startedAt: at,
        completedAt: streaming ? null : at,
        updatedAt: at,
        type: assistant ? "assistant_message" : "user_message",
        messageId: id,
        text: messageText(item),
        ...(assistant
          ? { streaming }
          : { attachments: [], inputIntent: "turn_start", createdBy: "user", creationSource: "web" }),
      });
    }
  }
  return { runs, turnItems };
};

export function threadProjection(thread: Thread) {
  const { runs, turnItems } = projectTurns(thread);
  return {
    thread: {
      id: thread.id,
      projectId: thread.projectId,
      title: thread.title,
      providerInstanceId: "codex",
      modelSelection: modelSelection(thread.model),
      runtimeMode: "approval-required",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: null,
      lineage: { rootThreadId: thread.id, parentThreadId: null, relationshipToParent: null },
      forkedFrom: null,
      createdBy: "user",
      creationSource: "web",
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      deletedAt: null,
    },
    runs,
    attempts: [],
    nodes: [],
    subagents: [],
    providerSessions: [],
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [],
    messages: [],
    plans: [],
    turnItems,
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems: turnItems.map((item, position) => ({
      position,
      visibility: "local",
      sourceThreadId: thread.id,
      sourceItemId: item.id,
      item,
    })),
    updatedAt: thread.updatedAt,
  };
}

export function threadShell(thread: Thread) {
  const { thread: summary, runs, turnItems } = threadProjection(thread);
  const latest = runs.at(-1);
  return {
    ...summary,
    latestRunId: latest?.id ?? null,
    activeRunId: latest?.status === "running" ? latest.id : null,
    status: latest?.status ?? "idle",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    itemCount: turnItems.length,
    visibleItemCount: turnItems.length,
  };
}
