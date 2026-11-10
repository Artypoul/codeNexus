// Codex 服务域 IPC channels。
//
// 这一组只描述桌面应用和 Codex app server 管理器之间的 IPC 边界；
// 具体 JSON-RPC 方法、通知和请求响应结构由 codex-protocol 继续约束。
export const IPC_CODEX_CHANNELS = {
  gigmaAuthStatus: "gigma:authStatus",
  gigmaAuthStartLogin: "gigma:authStartLogin",
  gigmaAuthPollLogin: "gigma:authPollLogin",
  gigmaAuthCancelLogin: "gigma:authCancelLogin",
  gigmaAuthLogout: "gigma:authLogout",
  // 环境探测：用于启动前确认 Codex/native 依赖是否可用。
  codexEnsureInstalled: "codex:ensureInstalled",
  codexDiagnostics: "codex:diagnostics",

  // Server 生命周期：main process 负责按工作区启动、复用和停止 Codex server。
  codexServerStart: "codex:serverStart",
  codexServerStop: "codex:serverStop",

  // 协议转发：renderer 通过这些频道和已启动的 Codex server 通信。
  codexRpc: "codex:rpc",
  codexNotify: "codex:notify",
  codexRespond: "codex:respond",
} as const;
