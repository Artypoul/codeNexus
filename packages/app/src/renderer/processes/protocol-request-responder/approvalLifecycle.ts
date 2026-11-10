type ApprovalMethod =
  | "item/fileChange/requestApproval"
  | "item/commandExecution/requestApproval"
  | "item/permissions/requestApproval";

type ApprovalResponseArgs = {
  serverId: string;
  id: string | number;
  method: ApprovalMethod;
  result?: unknown;
  error?: { code: number; message: string };
};

type ApprovalLifecycleDeps = {
  respond: (args: ApprovalResponseArgs) => Promise<unknown> | unknown;
  remove: (serverId: string, requestId: string | number) => void;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
};

type ApprovalLifecycleController = {
  schedule: (args: { serverId: string; requestId: string | number; method: ApprovalMethod }) => void;
  clear: (serverId: string, requestId: string | number, removePrompt?: boolean) => void;
  clearServer: (serverId: string) => void;
  dispose: () => void;
};

type ApprovalTimerRecord = {
  timer: ReturnType<typeof setTimeout>;
  requestId: string | number;
  method: ApprovalMethod;
};

const APPROVAL_TIMEOUT_MS = 5 * 60_000;

function requestKey(serverId: string, requestId: string | number): string {
  return `${String(serverId ?? "").trim()}:${String(requestId ?? "").trim()}`;
}

function buildTimeoutResponse(args: {
  serverId: string;
  requestId: string | number;
  method: ApprovalMethod;
}): ApprovalResponseArgs {
  if (args.method === "item/permissions/requestApproval") {
    return {
      serverId: args.serverId,
      id: args.requestId,
      method: args.method,
      error: { code: 4001, message: "permissions request timed out" },
    };
  }
  return {
    serverId: args.serverId,
    id: args.requestId,
    method: args.method,
    result: { decision: "decline" },
  };
}

export function createApprovalLifecycleController(deps: ApprovalLifecycleDeps): ApprovalLifecycleController {
  const scheduleTimer = deps.setTimeout ?? setTimeout;
  const cancelTimer = deps.clearTimeout ?? clearTimeout;
  const timers = new Map<string, ApprovalTimerRecord>();

  const clear = (serverId: string, requestId: string | number, removePrompt = false) => {
    const key = requestKey(serverId, requestId);
    const record = timers.get(key);
    if (!record) return;
    cancelTimer(record.timer);
    timers.delete(key);
    if (removePrompt) deps.remove(serverId, record.requestId);
  };

  const schedule = (args: { serverId: string; requestId: string | number; method: ApprovalMethod }) => {
    const serverId = String(args.serverId ?? "").trim();
    if (!serverId) return;
    const key = requestKey(serverId, args.requestId);
    if (timers.has(key)) return;
    const timer = scheduleTimer(() => {
      timers.delete(key);
      const response = buildTimeoutResponse({ ...args, serverId });
      Promise.resolve(deps.respond(response))
        .catch(() => undefined)
        .finally(() => deps.remove(serverId, args.requestId));
    }, APPROVAL_TIMEOUT_MS);
    timers.set(key, { timer, requestId: args.requestId, method: args.method });
  };

  const clearServer = (serverId: string) => {
    const normalizedServerId = String(serverId ?? "").trim();
    if (!normalizedServerId) return;
    for (const key of timers.keys()) {
      if (!key.startsWith(`${normalizedServerId}:`)) continue;
      const record = timers.get(key);
      if (record) {
        cancelTimer(record.timer);
        void Promise.resolve(
          deps.respond(
            buildTimeoutResponse({
              serverId: normalizedServerId,
              requestId: record.requestId,
              method: record.method,
            })
          )
        ).catch(() => undefined);
        deps.remove(normalizedServerId, record.requestId);
      }
      timers.delete(key);
    }
  };

  const dispose = () => {
    for (const record of timers.values()) cancelTimer(record.timer);
    timers.clear();
  };

  return { schedule, clear, clearServer, dispose };
}

export type { ApprovalLifecycleController, ApprovalMethod, ApprovalResponseArgs };
