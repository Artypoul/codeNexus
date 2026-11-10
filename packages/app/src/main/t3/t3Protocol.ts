import { protocol } from "electron";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const scheme = "codenexus-t3";
export const T3_URL = `${scheme}://app/`;

// Electron requires scheme privileges before app readiness.
export function registerT3Scheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
  ]);
}

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".glb": "model/gltf-binary",
};
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

export function installT3Protocol(assetDirectory: string): void {
  const root = resolve(assetDirectory);
  protocol.handle(scheme, async (request) => {
    const url = new URL(request.url);
    if (url.host !== "app" || url.username || url.password || (request.method !== "GET" && request.method !== "HEAD")) {
      return new Response(null, { status: 404 });
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response(null, { status: 400 });
    }
    if (pathname.includes("\0") || pathname.includes("\\")) return new Response(null, { status: 400 });
    let file = resolve(root, `.${pathname}`);
    if (file !== root && !file.startsWith(root + sep)) return new Response(null, { status: 404 });
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      if (extname(file) && !request.headers.get("accept")?.includes("text/html")) {
        return new Response(null, { status: 404 });
      }
      file = resolve(root, "index.html");
    }
    const contents = await readFile(file).catch(() => null);
    if (!contents) return new Response(null, { status: 404 });
    return new Response(request.method === "HEAD" ? null : new Uint8Array(contents), {
      headers: {
        "content-type": mimeTypes[extname(file).toLowerCase()] ?? "application/octet-stream",
        "Content-Security-Policy": csp,
      },
    });
  });
}
