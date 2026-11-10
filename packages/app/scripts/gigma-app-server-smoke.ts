import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { CodexServerManager } from "../src/main/services/CodexServerManager";
import { GigmaAppServerService } from "../src/main/services/GigmaAppServerService";

const workspace = resolve(
  process.env.GIGMA_SMOKE_WORKSPACE ?? "D:\\Development\\CodeNexus\\build-cache\\gigma-smoke-workspace"
);
const serverPath = String(
  process.env.CODEX_APP_SERVER_BIN ?? "D:\\Development\\CodeNexus\\native-runtime\\codex-app-server.exe"
).trim();

async function main(): Promise<void> {
  await mkdir(workspace, { recursive: true });
  const auth = {
    status: async () => ({
      provider: "gigma-account" as const,
      configured: true,
      loggedIn: true,
      available: true,
    }),
  };
  const service = new GigmaAppServerService(new CodexServerManager(), auth as never);
  const started = await service.start({
    cwd: workspace,
    serverPath,
    experimentalApi: true,
    onMessage: () => undefined,
  });
  try {
    const thread = await service.request({
      serverId: started.serverId,
      method: "thread/start",
      params: { cwd: workspace, approvalPolicy: "never", sandbox: "read-only", ephemeral: true },
    });
    const threadId = String(thread.thread?.id ?? "");
    if (!threadId) throw new Error("Gigma AppServer smoke did not create a thread.");
    process.stdout.write(`${JSON.stringify({ ok: true, serverId: started.serverId, threadId, workspace })}\n`);
  } finally {
    service.stopAll();
  }
}

void main();
