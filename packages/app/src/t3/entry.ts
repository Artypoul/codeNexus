import type { CodexDesktopApi } from "@codenexus/shared/ipc/contracts";
import { createLocalCodex } from "./localCodex";
import {
  list,
  projectShell,
  record,
  string,
  threadProjection,
  threadShell,
  timestamp,
  type Data,
  type Project,
  type Thread,
} from "./projections";
import { installT3Transport, type T3TransportOptions } from "./transport";

const api = (window as unknown as { codexDesktop: CodexDesktopApi }).codexDesktop;
const origin = "http://localhost:49123";
const stateKey = "codenexus:t3:workspaces:v1";
const settingsKey = "codenexus:t3:settings:v1";
const environment = {
  environmentId: "codenexus-local",
  label: "CodeNexus",
  platform: { os: "windows", arch: "x64" },
  serverVersion: "0.1.7",
  orchestrationProtocolVersion: 2,
  capabilities: { threadStop: true },
};

function installGigmaAuthGate(): void {
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", () => installGigmaAuthGate(), { once: true });
    return;
  }
  const style = document.createElement("style");
  style.textContent = `
    #codenexus-gigma-auth-gate {
      position: fixed;
      inset: 0;
      z-index: 2147483000;
      display: grid;
      place-items: center;
      padding: 32px;
      background: color-mix(in srgb, var(--background, #09090b) 92%, transparent);
      color: var(--foreground, #fafafa);
      font-family: var(--font-sans, Inter, system-ui, sans-serif);
      backdrop-filter: blur(18px);
    }
    #codenexus-gigma-auth-gate[hidden] { display: none; }
    #codenexus-gigma-auth-card {
      width: min(460px, 100%);
      border: 1px solid color-mix(in srgb, var(--foreground, #fff) 14%, transparent);
      border-radius: 20px;
      padding: 28px;
      background: color-mix(in srgb, var(--background, #09090b) 96%, var(--foreground, #fff) 4%);
      box-shadow: 0 28px 80px rgb(0 0 0 / 38%);
    }
    #codenexus-gigma-auth-card h1 { margin: 0 0 10px; font-size: 22px; letter-spacing: -0.02em; }
    #codenexus-gigma-auth-card p { margin: 0 0 20px; color: color-mix(in srgb, var(--foreground, #fff) 68%, transparent); line-height: 1.5; }
    #codenexus-gigma-auth-status { min-height: 22px; margin-bottom: 18px; font-size: 13px; color: color-mix(in srgb, var(--foreground, #fff) 60%, transparent); }
    #codenexus-gigma-auth-code { margin: 0 0 18px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 18px; letter-spacing: 0.12em; }
    #codenexus-gigma-auth-button { width: 100%; border: 0; border-radius: 12px; padding: 11px 16px; background: var(--accent, #818cf8); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
    #codenexus-gigma-auth-button:disabled { cursor: wait; opacity: 0.58; }
  `;
  document.head.append(style);

  const gate = document.createElement("div");
  gate.id = "codenexus-gigma-auth-gate";
  gate.innerHTML = `
    <section id="codenexus-gigma-auth-card" role="dialog" aria-modal="true" aria-labelledby="codenexus-gigma-auth-title">
      <h1 id="codenexus-gigma-auth-title">Connect Gigma Auth</h1>
      <p>Sign in to Gigma before starting a local Codex runtime.</p>
      <div id="codenexus-gigma-auth-status" role="status"></div>
      <div id="codenexus-gigma-auth-code"></div>
      <button id="codenexus-gigma-auth-button" type="button">Sign in with Gigma</button>
    </section>
  `;
  document.body.append(gate);

  const statusNode = gate.querySelector<HTMLElement>("#codenexus-gigma-auth-status");
  const codeNode = gate.querySelector<HTMLElement>("#codenexus-gigma-auth-code");
  const button = gate.querySelector<HTMLButtonElement>("#codenexus-gigma-auth-button");
  if (!statusNode || !codeNode || !button) return;

  let flowId = "";
  let polling = false;
  const setStatus = (value: string) => {
    statusNode.textContent = value;
  };
  const hide = () => {
    gate.remove();
    style.remove();
  };
  const poll = async () => {
    if (!flowId || polling) return;
    polling = true;
    try {
      const result = await api.gigmaAuth.pollLogin();
      if (result?.status === "authenticated") {
        hide();
        return;
      }
      if (result?.errorMessage) setStatus(result.errorMessage);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      polling = false;
      if (document.body.contains(gate)) window.setTimeout(() => void poll(), 5000);
    }
  };

  button.addEventListener("click", async () => {
    button.disabled = true;
    setStatus("Starting Gigma sign-in…");
    codeNode.textContent = "";
    try {
      const result = await api.gigmaAuth.startLogin();
      flowId = result.flowId;
      if (result.userCode) codeNode.textContent = `Code ${result.userCode}`;
      const target = result.verificationUriComplete ?? result.verificationUri;
      if (target) await api.app.openExternal({ url: target });
      setStatus("Complete the sign-in in your browser. This screen will update automatically.");
      void poll();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      button.disabled = false;
    }
  });

  void api.gigmaAuth.status().then((status) => {
    if (status.loggedIn) hide();
    else if (!status.available) setStatus("The local Gigma runtime will start when sign-in begins.");
    else setStatus("Gigma sign-in is required before starting Codex.");
  });
}

installGigmaAuthGate();

function readStorage(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

const saved = record(readStorage(stateKey));
const projects = new Map<string, Project>();
for (const entry of list(saved.projects).map(record)) {
  const id = string(entry.id);
  const title = string(entry.title);
  const workspaceRoot = string(entry.workspaceRoot);
  if (id && workspaceRoot) projects.set(id, { id, title, workspaceRoot, createdAt: timestamp(entry.createdAt) });
}
const nativeAliases = new Map<string, string>(
  Object.entries(record(saved.aliases)).filter((entry): entry is [string, string] => typeof entry[1] === "string")
);
const threads = new Map<string, Thread>();
const activeRuns = new Map<string, Data>();
const initializedProjects = new Map<string, Promise<void>>();
let sequence = 0;
let model = "";
type Send = Parameters<T3TransportOptions["request"]>[1];
const shellSubscriptions = new Map<string, Send>();
const threadSubscriptions = new Map<string, { threadId: string; send: Send }>();
const configSubscriptions = new Map<string, Send>();

const chunk = (send: Send, ...values: unknown[]) => send({ _tag: "Chunk", values });
const success = (send: Send, value: unknown) => send({ _tag: "Exit", exit: { _tag: "Success", value } });
const failure = (send: Send, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  send({ _tag: "Exit", exit: { _tag: "Failure", cause: [{ _tag: "Die", defect: message }] } });
};
const persist = () => {
  localStorage.setItem(
    stateKey,
    JSON.stringify({ projects: [...projects.values()], aliases: Object.fromEntries(nativeAliases) })
  );
};
const getProject = (id: unknown) => {
  const project = projects.get(string(id));
  if (!project) throw new Error("Choose a workspace in CodeNexus first.");
  return project;
};
const getThread = (id: unknown) => {
  const thread = threads.get(string(id));
  if (!thread) throw new Error("This chat is unavailable in the current workspace.");
  return thread;
};
const shellSnapshot = () => ({
  schemaVersion: 2,
  snapshotSequence: sequence,
  projects: [...projects.values()].map(projectShell),
  threads: [...threads.values()].map(threadShell),
  archivedThreads: [],
});
const publish = (thread?: Thread) => {
  sequence += 1;
  for (const send of shellSubscriptions.values()) chunk(send, { kind: "snapshot", snapshot: shellSnapshot() });
  if (!thread) return;
  for (const subscription of threadSubscriptions.values()) {
    if (subscription.threadId === thread.id) {
      chunk(subscription.send, { kind: "snapshot", snapshotSequence: sequence, projection: threadProjection(thread) });
    }
  }
};

const codex = createLocalCodex(api, ({ serverId, cwd, msg }) => {
  if (msg.kind === "local" && msg.method === "codex/exit") {
    for (const [nativeId, run] of activeRuns) {
      const thread = threads.get(nativeAliases.get(nativeId) ?? nativeId);
      if (!thread || projects.get(thread.projectId)?.workspaceRoot !== cwd) continue;
      run.status = "failed";
      run.completedAt = timestamp();
      activeRuns.delete(nativeId);
      publish(thread);
    }
    return;
  }
  if (msg.kind === "request") {
    void api.codexServer
      .respond({
        serverId,
        id: msg.id,
        method: msg.method,
        error: {
          code: -32601,
          message: "This request needs an approval action that the T3 adapter does not support yet.",
        },
      })
      .catch((error: unknown) => console.error("CodeNexus approval response", error));
    return;
  }
  if (msg.kind !== "notification") return;
  const params = record(msg.params);
  const nativeId = string(params.threadId);
  const thread = threads.get(nativeAliases.get(nativeId) ?? nativeId);
  const run = activeRuns.get(nativeId);
  if (!thread || !run) return;
  const turn = record(params.turn);
  const turnId = string(params.turnId ?? turn.id);
  if (turnId && !string(run.nativeTurnId)) run.nativeTurnId = turnId;
  if (turnId && run.nativeTurnId !== turnId) return;
  const items = list(run.items).map(record);
  if (msg.method === "item/agentMessage/delta") {
    const itemId = string(params.itemId);
    if (!itemId) return;
    const item = items.find((entry) => entry.id === itemId) ?? { id: itemId, type: "agentMessage", text: "" };
    item.text = string(item.text) + string(params.delta);
    if (!items.includes(item)) items.push(item);
    run.items = items;
  } else if (msg.method === "item/completed" && record(params.item).type === "agentMessage") {
    const item = { ...record(params.item), completed: true };
    run.items = [...items.filter((entry) => entry.id !== record(item).id), item];
  } else if (msg.method === "turn/completed") {
    run.status = turn.status ?? "completed";
    run.completedAt = timestamp();
    activeRuns.delete(nativeId);
  } else {
    return;
  }
  thread.updatedAt = timestamp();
  publish(thread);
});

const loadProject = (project: Project) => {
  const pending = initializedProjects.get(project.id);
  if (pending) return pending;
  const loading = codex.listThreads(project.workspaceRoot).then((entries) => {
    for (const entry of entries.map(record)) {
      const nativeId = string(entry.id);
      if (!nativeId) continue;
      const id = nativeAliases.get(nativeId) ?? nativeId;
      if (threads.has(id)) continue;
      threads.set(id, {
        id,
        nativeId,
        projectId: project.id,
        title: string(entry.name) || string(entry.preview) || "New thread",
        model: string(entry.model) || model || "default",
        createdAt: timestamp(entry.createdAt),
        updatedAt: timestamp(entry.updatedAt),
        turns: [],
        loaded: false,
      });
    }
  });
  initializedProjects.set(project.id, loading);
  void loading.catch(() => initializedProjects.delete(project.id));
  return loading;
};

const readThread = async (id: unknown) => {
  const thread = getThread(id);
  if (!thread.loaded) {
    const nativeThread = record(await codex.readThread(getProject(thread.projectId).workspaceRoot, thread.nativeId));
    thread.turns = list(nativeThread.turns).map(record);
    thread.loaded = true;
  }
  return thread;
};

async function configuration() {
  const cwd = projects.values().next().value?.workspaceRoot ?? "C:\\";
  const [models, account] = await Promise.allSettled([codex.listModels(cwd), codex.account(cwd)]);
  const catalog = (models.status === "fulfilled" ? models.value : []).map(record);
  const installed = models.status === "fulfilled";
  const accountData = account.status === "fulfilled" ? record(record(account.value).account) : {};
  const authenticated = Boolean(accountData.type);
  model = string(catalog.find((item) => item.isDefault === true)?.model) || string(catalog[0]?.model) || model;
  return {
    environment,
    cwd,
    auth: {
      policy: "desktop-managed-local",
      bootstrapMethods: ["desktop-bootstrap"],
      sessionMethods: ["browser-session-cookie"],
      sessionCookieName: "t3_session",
    },
    keybindingsConfigPath: cwd,
    keybindings: [],
    issues: [],
    availableEditors: [],
    providers: [
      {
        instanceId: "codex",
        driver: "codex",
        displayName: "Codex",
        enabled: true,
        installed,
        version: null,
        status: installed && authenticated ? "ready" : "warning",
        auth: { status: authenticated ? "authenticated" : "unauthenticated" },
        checkedAt: timestamp(),
        models: catalog.flatMap((item) => {
          const slug = string(item.model) || string(item.id);
          return slug ? [{ slug, name: string(item.displayName) || slug, isCustom: false, capabilities: null }] : [];
        }),
      },
    ],
    observability: {
      logsDirectoryPath: cwd,
      localTracingEnabled: false,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
    settings: {},
    shellResumeCompletionMarker: true,
    threadResumeCompletionMarker: true,
  };
}

async function dispatch(command: Data) {
  switch (command.type) {
    case "thread.create": {
      const project = getProject(command.projectId);
      const id = string(command.threadId);
      if (!id || threads.has(id)) throw new Error("Chat identifier is invalid or already in use.");
      const selection = string(record(command.modelSelection).model) || model;
      const result = await codex.createThread(project.workspaceRoot, selection || undefined);
      const at = timestamp();
      nativeAliases.set(result.id, id);
      const thread: Thread = {
        id,
        nativeId: result.id,
        projectId: project.id,
        title: string(command.title) || "New thread",
        model: selection || "default",
        createdAt: at,
        updatedAt: at,
        turns: [],
        loaded: true,
      };
      threads.set(id, thread);
      persist();
      publish(thread);
      break;
    }
    case "message.dispatch": {
      if (list(command.attachments).length) throw new Error("The local adapter currently accepts text messages.");
      const thread = await readThread(command.threadId);
      const project = getProject(thread.projectId);
      const text = string(command.text).trim();
      if (!text) throw new Error("Enter a message first.");
      if (activeRuns.has(thread.nativeId)) throw new Error("A reply is already running for this chat.");
      const at = timestamp();
      const run: Data = {
        id: crypto.randomUUID(),
        status: "inProgress",
        startedAt: at,
        items: [
          {
            id: string(command.messageId) || crypto.randomUUID(),
            type: "userMessage",
            content: [{ type: "text", text }],
          },
        ],
      };
      activeRuns.set(thread.nativeId, run);
      thread.turns.push(run);
      thread.updatedAt = at;
      publish(thread);
      try {
        const result = await codex.send(
          project.workspaceRoot,
          thread.nativeId,
          text,
          string(record(command.modelSelection).model) || thread.model
        );
        run.nativeTurnId = result.id;
      } catch (error) {
        run.status = "failed";
        activeRuns.delete(thread.nativeId);
        publish(thread);
        throw error;
      }
      break;
    }
    case "thread.stop": {
      const thread = getThread(command.threadId);
      const turnId = string(activeRuns.get(thread.nativeId)?.nativeTurnId);
      if (!turnId) throw new Error("There is no active response to stop.");
      await codex.interrupt(getProject(thread.projectId).workspaceRoot, thread.nativeId, turnId);
      break;
    }
    default:
      throw new Error(`Unsupported local chat action: ${string(command.type)}`);
  }
  return { sequence };
}

const request: T3TransportOptions["request"] = ({ id, tag, payload }, send) => {
  const params = record(payload);
  void (async () => {
    switch (tag) {
      case "subscribeServerConfig":
        configSubscriptions.set(id, send);
        chunk(send, { version: 1, type: "snapshot", config: await configuration() });
        return;
      case "subscribeServerLifecycle":
        chunk(
          send,
          { version: 1, sequence: 1, type: "welcome", payload: { environment, cwd: "C:\\", projectName: "CodeNexus" } },
          { version: 1, sequence: 2, type: "ready", payload: { environment, at: timestamp() } }
        );
        return;
      case "subscribeDeviceState":
        chunk(send, {
          hostStatus: "disabled",
          hostStatuses: {},
          devices: [],
          sessions: [],
          hosts: [],
          onboardingCompleted: false,
          agentAccessEnabled: false,
          hubBasePath: "",
          revision: 0,
        });
        return;
      case "preview.reportProfiles":
      case "server.reportClientActivity":
        return success(send, null);
      case "subscribePreviewEvents":
      case "subscribeProjectClones":
      case "subscribeDiscoveredLocalServers":
        return;
      case "scheduledTasks.subscribe":
        chunk(send, { tasks: [] });
        return;
      case "server.refreshProviders":
        return success(send, { providers: (await configuration()).providers });
      case "server.discoverSourceControl":
        return success(send, { versionControlSystems: [], sourceControlProviders: [] });
      case "subscribeTerminalMetadata":
        chunk(send, { type: "snapshot", terminals: [] });
        return;
      case "orchestration.subscribeShell":
        shellSubscriptions.set(id, send);
        await Promise.allSettled([...projects.values()].map(loadProject));
        chunk(send, { kind: "snapshot", snapshot: shellSnapshot() }, { kind: "synchronized" });
        return;
      case "orchestration.subscribeThread": {
        const thread = await readThread(params.threadId);
        threadSubscriptions.set(id, { threadId: thread.id, send });
        chunk(
          send,
          { kind: "snapshot", snapshotSequence: sequence, projection: threadProjection(thread) },
          { kind: "synchronized" }
        );
        return;
      }
      case "orchestration.getThreadProjection":
        return success(send, threadProjection(await readThread(params.threadId)));
      case "orchestration.getArchivedShellSnapshot":
        return success(send, { schemaVersion: 1, snapshotSequence: sequence, projects: [], threads: [] });
      case "orchestration.dispatchCommand":
        return success(send, await dispatch(params));
      case "orchestration.launchThread": {
        const strategy = record(params.workspaceStrategy);
        if (strategy.type !== "root" || strategy.branch)
          throw new Error("Choose the project folder as the local chat environment.");
        const threadId = string(params.threadId) || crypto.randomUUID();
        const resumed = params.reuseExistingThread === true;
        if (!resumed) await dispatch({ ...params, type: "thread.create", threadId });
        if (params.initialMessage) {
          await dispatch({
            ...record(params.initialMessage),
            type: "message.dispatch",
            threadId,
            modelSelection: params.modelSelection,
          });
        }
        return success(send, { threadId, projection: threadProjection(await readThread(threadId)), resumed, sequence });
      }
      case "projects.mutate": {
        if (params.type !== "project.create") throw new Error("Only adding an existing folder is supported.");
        const workspaceRoot = string(params.workspaceRoot);
        const metadata = await api.app.getFileMetadata({ path: workspaceRoot });
        if (!metadata.ok || !metadata.metadata.isDirectory) throw new Error("Choose an existing workspace folder.");
        const project = {
          id: string(params.projectId),
          title: string(params.title) || workspaceRoot,
          workspaceRoot,
          createdAt: timestamp(),
        };
        if (!project.id) throw new Error("Workspace identifier is required.");
        projects.set(project.id, project);
        persist();
        publish();
        await loadProject(project);
        publish();
        for (const sendConfig of configSubscriptions.values()) {
          chunk(sendConfig, { version: 1, type: "snapshot", config: await configuration() });
        }
        return success(send, projectShell(project));
      }
      default:
        throw new Error(`Unsupported local T3 method: ${tag}`);
    }
  })().catch((error: unknown) => failure(send, error));
};

const unsubscribe = () => () => {};
let fullscreen = false;
api.window.onState((state) => {
  fullscreen = state.isFullScreen;
});
const desktopBridge = {
  getAppBranding: () => ({ baseName: "CodeNexus", displayName: "CodeNexus", stageLabel: "Beta" }),
  getClientPlatform: () => "win32",
  getSystemLocale: () => navigator.language,
  getPreferredSystemLanguages: () => navigator.languages,
  getRelayTelemetryEnabled: () => false,
  getLocalEnvironmentBootstraps: () => [
    {
      id: "primary",
      label: "CodeNexus",
      runningDistro: null,
      httpBaseUrl: origin,
      wsBaseUrl: origin.replace("http", "ws"),
    },
  ],
  getLocalEnvironmentEnabled: () => true,
  getLocalEnvironmentBearerToken: async () => "codenexus-local-ipc",
  getClientSettings: async () => readStorage(settingsKey),
  setClientSettings: async (value: unknown) => localStorage.setItem(settingsKey, JSON.stringify(value)),
  getConnectionCatalog: async () => null,
  setConnectionCatalog: async () => false,
  pickFolder: () => codex.selectWorkspace(),
  getWindowFullscreenState: () => fullscreen,
  onWindowFullscreenStateChange: (listener: (value: boolean) => void) =>
    api.window.onState((state) => listener(state.isFullScreen)),
  getWindowZoomFactor: () => 1,
  openExternal: async (url: string) => (await api.app.openExternal({ url })).ok,
  onMenuAction: unsubscribe,
  onQuitShortcut: unsubscribe,
  onTrackpadScrollBegin: unsubscribe,
  onTrackpadScrollEnd: unsubscribe,
  onNotificationBadgeClear: unsubscribe,
  onSshPasswordPrompt: unsubscribe,
  onUpdateState: unsubscribe,
  setTheme: async () => {},
  setNotificationBadge: async () => {},
  getUpdateState: async () => ({
    enabled: false,
    status: "disabled",
    channel: "latest",
    currentVersion: "1.0.4",
    hostArch: "x64",
    appArch: "x64",
    runningUnderArm64Translation: false,
    availableVersion: null,
    downloadedVersion: null,
    releaseNotes: [],
    omittedReleaseCount: 0,
    downloadPercent: null,
    checkedAt: null,
    message: null,
    errorContext: null,
    canRetry: false,
  }),
  cliCommand: { getState: async () => ({ supported: false, installedPath: null, onPath: false, launcherPath: null }) },
};
Object.defineProperty(window, "desktopBridge", { value: Object.freeze(desktopBridge) });
installT3Transport({
  environment,
  async readShell() {
    await Promise.allSettled([...projects.values()].map(loadProject));
    return shellSnapshot();
  },
  request,
  interrupt(id) {
    shellSubscriptions.delete(id);
    threadSubscriptions.delete(id);
    configSubscriptions.delete(id);
  },
  onError(error) {
    console.error("CodeNexus T3 transport", error);
  },
});
window.addEventListener("beforeunload", () => codex.dispose(), { once: true });
