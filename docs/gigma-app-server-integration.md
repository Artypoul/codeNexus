# Gigma AppServer integration

CodeNexus now has an auth-aware local supervisor named `GigmaAppServerService`.
It owns the existing per-workspace Codex child processes through
`CodexServerManager`, while `GigmaAuthClient` talks only to the local Gigma CLI
API. Raw Gigma credentials remain owned by the Gigma CLI and its encrypted
credential storage.

The local contract is the Gigma CLI API used by `gigma-cli`.

- `GET /api/v1/oauth/status?provider=gigma-account`
- `POST /api/v1/oauth/login` with `{ "provider": "gigma-account" }`
- `GET /api/v1/oauth/login?provider=gigma-account`
- `POST /api/v1/oauth/logout` with `{ "provider": "gigma-account" }`

The default local origin is `http://127.0.0.1:58627`, matching the current
Gigma CLI `kap-server` default. Override it with
`GIGMA_KAP_SERVER_URL`. Set `GIGMA_KAP_SERVER_TOKEN_FILE` to the daemon's
`server.token` file, or set `KIMI_CODE_HOME` and CodeNexus will use its
`server.token`. CodeNexus accepts only loopback HTTP origins. When the
daemon is not already running, set `GIGMA_KAP_SERVER_COMMAND`, optional
`GIGMA_KAP_SERVER_ARGS_JSON` and optional `GIGMA_KAP_SERVER_WORKDIR`; the
supervisor starts and stops that local process with CodeNexus. The
renderer receives status and bounded login metadata through the preload API. It
never receives access tokens, refresh tokens, PKCE verifier values, or callback
proofs.

Before starting a Codex app-server child, the supervisor requires the local
Gigma CLI status to be available and `logged_in=true`. An unavailable or signed
out Gigma service fails closed, so a Codex child is not started without the
selected auth boundary.

Windows packaging stages the Gigma CLI native runtime built from
`D:\GitHub\gigma-cli` into `resources\\gigma-runtime\\gigma.exe`. When no local
KAP daemon is already listening, CodeNexus starts that executable hidden with
`web --no-open --debug-endpoints`, waits for the loopback API, and stops the
entire child tree during application shutdown. Override the binary with
`GIGMA_KAP_SERVER_COMMAND`, its arguments with `GIGMA_KAP_SERVER_ARGS_JSON`, or
the development runtime directory with `CODENEXUS_NATIVE_RUNTIME_DIR`.

The process seam can be smoke-tested against the bundled binary without opening
the desktop window:

```powershell
$env:CODEX_APP_SERVER_BIN = 'D:\Development\CodeNexus\T3-Gigma2\win-unpacked\resources\codex-runtime\codex-app-server.exe'
pnpm --filter @codenexus/app exec tsx scripts/gigma-app-server-smoke.ts
```

For a live Gigma daemon from `gigma-cli`, use its current `kap-server` default
port and keep the account home explicit:

```powershell
$env:KIMI_CODE_HOME = 'D:\Development\gigma-auth-live'
$env:GIGMA_KAP_SERVER_URL = 'http://127.0.0.1:58627'
pnpm --filter @codenexus/app exec tsx scripts/gigma-auth-status-smoke.ts
```

The local Windows package is produced with `pnpm dist:local`. It stages the
Codex app-server and Gigma CLI runtime under `D:\Development\CodeNexus` before
electron-builder packages them into separate resource directories.

This slice integrates the existing Gigma CLI auth service with the local Codex
binary and gives CodeNexus explicit ownership of the configured local auth
process lifecycle. It does not claim that the remote Authorization Code policy is enabled
in `api.auth.gigma.ru`. That policy remains a separate server-side rollout.
