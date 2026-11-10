import { app, ipcMain } from "electron";
import { existsSync } from "node:fs";
import { IPC_CODEX_CHANNELS } from "@codenexus/shared/ipc/channels";
import type {
  CodexIncomingMessage,
  CodexNotifyArgs,
  CodexRpcArgs,
  CodexServerRespondArgs,
} from "@codenexus/shared/codex-protocol";
import { detectCodexNative, detectNodeNative, detectNpmNative, checkCodexLoginStatus } from "../../systemChecks";
import type { GigmaAppServerService } from "../../services/GigmaAppServerService";
import type { LocalSettingsService } from "../../services/LocalSettingsService";
import { resolveBundledCodexAppServerPath } from "../../codexNativeDiscovery";

export function registerCodexHandlers(deps: {
  serverManager: GigmaAppServerService;
  localSettingsService: LocalSettingsService;
  sendEvent: (payload: { serverId: string; msg: CodexIncomingMessage }) => void;
}) {
  const { serverManager, sendEvent, localSettingsService } = deps;

  ipcMain.handle(IPC_CODEX_CHANNELS.codexEnsureInstalled, async () => {
    const settings = await localSettingsService.read();
    const native = detectCodexNative(settings.settings.codex.executablePath ?? undefined);
    return { native };
  });

  ipcMain.handle(IPC_CODEX_CHANNELS.codexDiagnostics, async () => {
    const settings = await localSettingsService.read();
    const native = detectCodexNative(settings.settings.codex.executablePath ?? undefined);
    return {
      codex: native,
      gigmaAuth: await serverManager.authStatus(),
      node: detectNodeNative(),
      npm: detectNpmNative(),
      resolvedPath: native.resolvedPath ?? null,
      login: native.resolvedPath
        ? checkCodexLoginStatus(native.resolvedPath)
        : { status: "unknown", details: "Codex CLI executable was not found." },
    };
  });

  ipcMain.handle(
    IPC_CODEX_CHANNELS.codexServerStart,
    async (_evt, args: { cwd?: string; experimentalApi?: boolean; codexPath?: string }) => {
      const settings = await localSettingsService.read();
      const serverPath = resolveBundledCodexAppServerPath({
        appIsPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        env: process.env,
        devRuntimeDir: "D:\\Development\\CodeNexus\\native-runtime",
        exists: existsSync,
      });
      if (app.isPackaged && !serverPath) {
        throw new Error("Bundled Codex app-server is missing from the packaged application.");
      }
      return await serverManager.start({
        cwd: args?.cwd,
        experimentalApi: Boolean(args?.experimentalApi),
        codexPath: args?.codexPath ?? settings.settings.codex.executablePath ?? undefined,
        serverPath,
        onMessage: (payload) => {
          sendEvent(payload);
        },
      });
    }
  );

  ipcMain.handle(IPC_CODEX_CHANNELS.codexServerStop, async (_evt, args: { serverId: string }) => {
    return serverManager.stop(args.serverId);
  });

  ipcMain.handle(IPC_CODEX_CHANNELS.codexRpc, async (_evt, args: CodexRpcArgs) => {
    const result = await serverManager.request(args);
    return { result };
  });

  ipcMain.handle(IPC_CODEX_CHANNELS.codexNotify, async (_evt, args: CodexNotifyArgs) => {
    return serverManager.notify(args);
  });

  ipcMain.handle(IPC_CODEX_CHANNELS.codexRespond, async (_evt, args: CodexServerRespondArgs) => {
    return serverManager.respond(args);
  });
}
