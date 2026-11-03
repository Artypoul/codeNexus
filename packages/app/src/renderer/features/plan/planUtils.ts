// 计划摘要工具：处理 plan 的状态枚举、文本合并与展示友好化格式化。
export type PlanStepStatus = "pending" | "inProgress" | "completed";

export function normalizePlanStepStatus(value: unknown): PlanStepStatus {
  if (value === "completed") return "completed";
  if (value === "inProgress") return "inProgress";
  return "pending";
}
