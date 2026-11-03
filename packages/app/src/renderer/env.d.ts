/// <reference types="vite/client" />

// 渲染进程全局类型补充：声明 window.codexDesktop。
import type { CodexDesktopApi } from "../preload/api/types";

export {};

declare global {
  interface Window {
    codexDesktop: CodexDesktopApi;
  }
}
