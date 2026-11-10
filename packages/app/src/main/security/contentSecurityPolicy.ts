import { session } from "electron";

/**
 * 生产环境 CSP 策略：
 * - 禁止 eval 和外部脚本注入
 * - 允许内联样式（Vue/Tailwind 需要）和内联脚本（index.html 主题初始化）
 * - 图片允许 data: URI 和 HTTPS 源
 * - 网络请求限制为 HTTPS 和本地开发地址
 */
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "media-src 'self' data: blob:",
  "connect-src 'self' https: http://localhost:* ws://localhost:*",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

export function installContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.startsWith("codenexus-t3://app/")) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [CSP_DIRECTIVES],
      },
    });
  });
}
