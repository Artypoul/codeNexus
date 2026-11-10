import { URL } from "node:url";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GigmaAuthLoginPoll, GigmaAuthLoginStart, GigmaAuthStatus } from "@codenexus/shared/ipc/contracts";

const PROVIDER = "gigma-account" as const;
const DEFAULT_ORIGIN = "http://127.0.0.1:58627";
const REQUEST_TIMEOUT_MS = 10_000;

export function resolveGigmaTokenFile(tokenFile?: string, kimiHome?: string): string {
  const explicit = String(tokenFile ?? "").trim();
  if (explicit) return explicit;
  const home = String(kimiHome ?? process.env.KIMI_CODE_HOME ?? "").trim() || join(homedir(), ".kimi-code");
  return join(home, "server.token");
}

type WireEnvelope<T> = { code?: unknown; data?: T; msg?: unknown };
type WireStatus = {
  provider?: unknown;
  configured?: unknown;
  logged_in?: unknown;
  login_method?: unknown;
};
type WireLogin = {
  flow_id?: unknown;
  status?: unknown;
  authorization_url?: unknown;
  verification_uri?: unknown;
  verification_uri_complete?: unknown;
  user_code?: unknown;
  expires_in?: unknown;
  interval?: unknown;
  expires_at?: unknown;
  resolved_at?: unknown;
  error_message?: unknown;
};

function requireLoopbackOrigin(value: string | undefined): string {
  const origin = String(value ?? DEFAULT_ORIGIN).trim();
  const url = new URL(origin);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "http:" || !loopback || url.username || url.password || url.pathname !== "/") {
    throw new Error("Gigma CLI server must use a loopback HTTP origin.");
  }
  return url.origin;
}

function text(value: unknown): string | undefined {
  const output = typeof value === "string" ? value.trim() : "";
  return output || undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function mapLogin(value: WireLogin): GigmaAuthLoginStart & { resolvedAt?: string; errorMessage?: string } {
  const status = value.status === "authenticated" ? "authenticated" : "pending";
  return {
    flowId: text(value.flow_id) ?? "",
    status,
    authorizationUrl: text(value.authorization_url),
    verificationUri: text(value.verification_uri),
    verificationUriComplete: text(value.verification_uri_complete),
    userCode: text(value.user_code),
    expiresIn: finiteNumber(value.expires_in),
    interval: finiteNumber(value.interval),
    expiresAt: text(value.expires_at),
    resolvedAt: text(value.resolved_at),
    errorMessage: text(value.error_message),
  };
}

export class GigmaAuthClient {
  private readonly origin: string;
  private readonly tokenFile: string | undefined;

  constructor(origin = process.env.GIGMA_KAP_SERVER_URL, tokenFile = process.env.GIGMA_KAP_SERVER_TOKEN_FILE) {
    this.origin = requireLoopbackOrigin(origin);
    this.tokenFile = resolveGigmaTokenFile(tokenFile);
  }

  async status(): Promise<GigmaAuthStatus> {
    try {
      const value = await this.request<WireStatus>("GET", "/api/v1/oauth/status?provider=gigma-account");
      return {
        provider: PROVIDER,
        configured: value.configured === true,
        loggedIn: value.logged_in === true,
        loginMethod: value.login_method === "desktop_callback" ? "desktop_callback" : undefined,
        available: true,
      };
    } catch (error) {
      return {
        provider: PROVIDER,
        configured: false,
        loggedIn: false,
        available: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async startLogin(): Promise<GigmaAuthLoginStart> {
    return mapLogin(await this.request<WireLogin>("POST", "/api/v1/oauth/login", { provider: PROVIDER }));
  }

  async pollLogin(): Promise<GigmaAuthLoginPoll | null> {
    const value = await this.request<WireLogin | null>("GET", "/api/v1/oauth/login?provider=gigma-account");
    return value ? mapLogin(value) : null;
  }

  async logout(): Promise<{ loggedOut: boolean }> {
    const value = await this.request<{ logged_out?: unknown }>("POST", "/api/v1/oauth/logout", { provider: PROVIDER });
    return { loggedOut: value.logged_out === true };
  }

  async cancelLogin(flowId: string): Promise<{ cancelled: boolean; status: string }> {
    const id = flowId.trim();
    if (!id) throw new Error("Gigma login flow id is required.");
    const value = await this.request<{ cancelled?: unknown; status?: unknown }>(
      "DELETE",
      `/api/v1/oauth/login?provider=gigma-account&flow_id=${encodeURIComponent(id)}`
    );
    return { cancelled: value.cancelled === true, status: text(value.status) ?? "unknown" };
  }

  private async request<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    const token = await this.readToken();
    const response = await fetch(`${this.origin}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const envelope = (await response.json().catch(() => null)) as WireEnvelope<T> | null;
    if (!response.ok || envelope?.code !== 0) {
      const message = text(envelope?.msg) ?? `${method} ${path} returned HTTP ${response.status}`;
      throw new Error(`Gigma CLI auth request failed: ${message}`);
    }
    return envelope.data as T;
  }

  private async readToken(): Promise<string | undefined> {
    if (!this.tokenFile) return undefined;
    try {
      const token = (await readFile(this.tokenFile, "utf8")).trim();
      return token || undefined;
    } catch {
      return undefined;
    }
  }
}
