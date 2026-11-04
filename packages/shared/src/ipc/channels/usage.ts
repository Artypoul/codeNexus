// Token 用量统计域 IPC channels。
//
// 统计完全基于本机 Codex 会话日志，renderer 只提交日期区间并接收聚合结果。
export const IPC_USAGE_CHANNELS = {
  usageTokenStats: "usage:tokenStats",
} as const;
