export interface T3TransportOptions {
  request(request: { id: string; tag: string; payload: unknown }, send: (frame: unknown) => void): void;
  interrupt(id: string): void;
  environment: Record<string, unknown>;
  readShell(): Promise<unknown>;
  onError?: (error: unknown) => void;
}

const virtualOrigin = "http://localhost:49123";
const permissions = [
  "orchestration:read",
  "orchestration:operate",
  "settings:write",
  "providers:manage",
  "environment:maintain",
  "preview:operate",
  "diagnostics:read",
  "terminal:read",
  "terminal:operate",
  "source-control:write",
  "filesystem:read",
  "filesystem:write",
  "relay:read",
  "access:read",
  "access:write",
  "relay:write",
];
const scopes = [
  "orchestration:read",
  "orchestration:operate",
  "terminal:operate",
  "relay:read",
  "access:read",
  "access:write",
  "relay:write",
];
const auth = {
  policy: "desktop-managed-local",
  bootstrapMethods: ["desktop-bootstrap", "one-time-token"],
  sessionMethods: ["browser-session-cookie", "bearer-access-token", "dpop-access-token"],
  sessionCookieName: "t3_session",
  serverUpdateScope: "environment:maintain",
};

/** Install only for the embedded T3 renderer, before its modules execute. */
export function installT3Transport(options: T3TransportOptions): void {
  let nextSocketId = 0;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    if (url.origin === virtualOrigin) {
      let body: unknown;
      if (url.pathname === "/.well-known/t3/environment") body = options.environment;
      else if (url.pathname === "/api/auth/session") {
        body = {
          authenticated: true,
          auth,
          scopes,
          permissions,
          sessionMethod: "browser-session-cookie",
          expiresAt: "2099-01-01T00:00:00.000Z",
        };
      } else if (url.pathname === "/api/auth/websocket-ticket/rpc" || url.pathname === "/api/auth/websocket-ticket") {
        body = { ticket: "codenexus-local-ipc", expiresAt: "2099-01-01T00:00:00.000Z" };
      } else if (url.pathname === "/api/orchestration/shell") {
        body = await options.readShell();
      } else return Promise.resolve(new Response(null, { status: 404 }));
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
      );
    }
    // Application assets use the renderer's own origin; arbitrary network fetches do not.
    if (url.origin === window.location.origin && !["http:", "https:"].includes(url.protocol))
      return nativeFetch(input, init);
    return Promise.reject(new TypeError("External fetch is disabled in the embedded T3 renderer"));
  };

  class VirtualWebSocket extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;
    readonly url: string;
    readonly protocol = "";
    readonly extensions = "";
    readonly bufferedAmount = 0;
    binaryType: BinaryType = "blob";
    readyState = VirtualWebSocket.CONNECTING;
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    private readonly socketId = nextSocketId++;
    private active = new Map<string, string | number>();

    constructor(url: string | URL, _protocols?: string | string[]) {
      super();
      const target = new URL(url, window.location.href);
      if (
        target.protocol !== "ws:" ||
        target.hostname !== "localhost" ||
        target.port !== "49123" ||
        target.pathname !== "/ws" ||
        target.username ||
        target.password
      ) {
        throw new DOMException("External WebSocket is disabled", "SecurityError");
      }
      this.url = target.href;
      queueMicrotask(() => {
        if (this.readyState !== this.CONNECTING) return;
        this.readyState = this.OPEN;
        const event = new Event("open");
        this.dispatchEvent(event);
        this.onopen?.(event);
      });
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      if (this.readyState !== this.OPEN) throw new DOMException("WebSocket is not open", "InvalidStateError");
      try {
        if (typeof data !== "string") throw new TypeError("Expected JSON text frame");
        const frame = JSON.parse(data) as {
          _tag?: string;
          id?: string | number;
          requestId?: string | number;
          tag?: string;
          payload?: unknown;
        };
        if (frame._tag === "Ping") return this.emit({ _tag: "Pong" });
        if (frame._tag === "Ack") return;
        if (frame._tag === "Interrupt" && frame.requestId !== undefined) {
          const id = `${this.socketId}:${String(frame.requestId)}`;
          if (this.active.delete(id)) options.interrupt(id);
          return;
        }
        if (frame._tag !== "Request" || frame.id === undefined || typeof frame.tag !== "string")
          throw new TypeError("Invalid RPC frame");
        const originalId = frame.id;
        const id = `${this.socketId}:${String(originalId)}`;
        if (this.active.has(id)) throw new TypeError("Duplicate RPC request id");
        this.active.set(id, originalId);
        options.request({ id, tag: frame.tag, payload: frame.payload }, (response) => {
          if (!this.active.has(id) || !response || typeof response !== "object") return;
          const outgoing = { ...response, requestId: originalId } as Record<string, unknown>;
          if (outgoing._tag === "Exit") this.active.delete(id);
          this.emit(outgoing);
        });
      } catch (error) {
        options.onError?.(error);
      }
    }

    private emit(frame: unknown): void {
      queueMicrotask(() => {
        if (this.readyState !== this.OPEN) return;
        const event = new MessageEvent("message", { data: JSON.stringify(frame) });
        this.dispatchEvent(event);
        this.onmessage?.(event);
      });
    }

    close(code = 1000, reason = ""): void {
      if (this.readyState >= this.CLOSING) return;
      this.readyState = this.CLOSING;
      for (const id of this.active.keys()) options.interrupt(id);
      this.active.clear();
      queueMicrotask(() => {
        this.readyState = this.CLOSED;
        const event = new CloseEvent("close", { code, reason, wasClean: true });
        this.dispatchEvent(event);
        this.onclose?.(event);
      });
    }
  }
  window.WebSocket = VirtualWebSocket as unknown as typeof WebSocket;
}
