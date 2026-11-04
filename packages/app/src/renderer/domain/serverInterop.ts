import type { GlobalConfigDraft, McpServerState, PlanStepState, SkillState } from "./types";
import { normalizePlanStepStatus } from "../features/plan/planUtils";
import { sandboxKebabFromUi } from "../shared/sandboxPolicy";
import type { ReasoningEffort } from "@codenexus/generated/codex-app-server/ReasoningEffort";
import type { ReasoningSummary } from "@codenexus/generated/codex-app-server/ReasoningSummary";
import type { ApprovalsReviewer } from "@codenexus/generated/codex-app-server/v2/ApprovalsReviewer";
import type { AskForApproval } from "@codenexus/generated/codex-app-server/v2/AskForApproval";
import type { ConfigReadResponse } from "@codenexus/generated/codex-app-server/v2/ConfigReadResponse";
import type { ConfigRequirements } from "@codenexus/generated/codex-app-server/v2/ConfigRequirements";
import type { ConfigRequirementsReadResponse } from "@codenexus/generated/codex-app-server/v2/ConfigRequirementsReadResponse";
import type { ListMcpServerStatusResponse } from "@codenexus/generated/codex-app-server/v2/ListMcpServerStatusResponse";
import type { SkillsListResponse } from "@codenexus/generated/codex-app-server/v2/SkillsListResponse";
import type { SandboxMode } from "@codenexus/generated/codex-app-server/v2/SandboxMode";
import { configValueToCodexMcpServerConfig } from "@codenexus/shared/codexMcp";

export type ConfigWriteChange = {
  keyPath: string;
  value: unknown;
};

function normalizeConfigReadRoot(result: unknown): Record<string, unknown> {
  const root = toRecord((result as ConfigReadResponse | null | undefined)?.config);
  return root ?? {};
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readPathValue(root: unknown, path: string): { found: boolean; value: unknown } {
  const parts = String(path ?? "")
    .split(".")
    .filter(Boolean);
  let cur: unknown = root;
  for (const part of parts) {
    const record = toRecord(cur);
    if (!record || !(part in record)) return { found: false, value: undefined };
    cur = record[part];
  }
  return { found: true, value: cur };
}

export const OFFICIAL_REASONING_SUMMARY_OPTIONS = ["auto", "concise", "detailed", "none"] as const;
export const OFFICIAL_APPROVAL_POLICY_STRING_OPTIONS = [
  "untrusted",
  "on-request",
  "never",
] as const satisfies readonly Extract<AskForApproval, string>[];
export const OFFICIAL_APPROVAL_POLICY_OPTIONS = [...OFFICIAL_APPROVAL_POLICY_STRING_OPTIONS, "granular"] as const;
export const OFFICIAL_APPROVALS_REVIEWER_OPTIONS = [
  "user",
  "auto_review",
  "guardian_subagent",
] as const satisfies readonly ApprovalsReviewer[];
export const OFFICIAL_SANDBOX_MODE_OPTIONS = [
  "read-only",
  "workspace-write",
  "danger-full-access",
] as const satisfies readonly SandboxMode[];

function normalizeEnumValue<T extends string>(value: unknown, fallback: T, allowed: readonly T[]): T {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const normalized = raw.toLowerCase();
  const canonical = allowed.find((item) => item.toLowerCase() === normalized);
  return canonical ?? fallback;
}

export function normalizeModelName(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeEffort(value: unknown): ReasoningEffort {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function createDefaultGranularApprovalPolicy(): Extract<AskForApproval, { granular: unknown }> {
  return {
    granular: {
      sandbox_approval: true,
      rules: true,
      skill_approval: true,
      request_permissions: true,
      mcp_elicitations: false,
    },
  };
}

function normalizeGranularApprovalPolicy(value: unknown): Extract<AskForApproval, { granular: unknown }> {
  const defaults = createDefaultGranularApprovalPolicy();
  const granular = toRecord(toRecord(value)?.granular);
  if (!granular) return defaults;
  return {
    granular: {
      sandbox_approval: normalizeBooleanFlag(granular.sandbox_approval, defaults.granular.sandbox_approval),
      rules: normalizeBooleanFlag(granular.rules, defaults.granular.rules),
      skill_approval: normalizeBooleanFlag(granular.skill_approval, defaults.granular.skill_approval),
      request_permissions: normalizeBooleanFlag(granular.request_permissions, defaults.granular.request_permissions),
      mcp_elicitations: normalizeBooleanFlag(granular.mcp_elicitations, defaults.granular.mcp_elicitations),
    },
  };
}

export function isGranularApprovalPolicy(value: unknown): value is Extract<AskForApproval, { granular: unknown }> {
  return Boolean(toRecord(value)?.granular && toRecord(toRecord(value)?.granular));
}

export function normalizeApprovalPolicy(value: unknown): AskForApproval {
  if (isGranularApprovalPolicy(value)) return normalizeGranularApprovalPolicy(value);
  if (String(value ?? "").trim() === "granular") return createDefaultGranularApprovalPolicy();
  return normalizeEnumValue(value, "never", OFFICIAL_APPROVAL_POLICY_STRING_OPTIONS);
}

export function normalizeApprovalsReviewer(value: unknown): ApprovalsReviewer {
  return normalizeEnumValue(value, "user", OFFICIAL_APPROVALS_REVIEWER_OPTIONS);
}

export function normalizeSandboxMode(value: unknown): SandboxMode {
  return normalizeEnumValue(value, "danger-full-access", OFFICIAL_SANDBOX_MODE_OPTIONS);
}

export function normalizeReasoningSummary(value: unknown): ReasoningSummary {
  return normalizeEnumValue(value, "auto", OFFICIAL_REASONING_SUMMARY_OPTIONS);
}

function normalizeBooleanFlag(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return fallback;
  if (raw === "true" || raw === "1" || raw === "yes" || raw === "on" || raw === "enabled") return true;
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off" || raw === "disabled") return false;
  return fallback;
}

function normalizeOptionalPositiveInteger(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const rounded = Math.round(value);
    return rounded > 0 ? rounded : null;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function createDefaultGlobalConfigDraft(): GlobalConfigDraft {
  return {
    model: "",
    fastModeEnabled: true,
    modelContextWindow: null,
    modelAutoCompactTokenLimit: null,
    modelReasoningEffort: "",
    modelReasoningSummary: "auto",
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandboxMode: "danger-full-access",
    windowsElevatedSandboxEnabled: false,
    unifiedExecEnabled: true,
    applyPatchStreamingEventsEnabled: false,
  };
}

export function extractGlobalConfigFromReadResult(result: unknown): GlobalConfigDraft {
  const root = normalizeConfigReadRoot(result);
  const defaults = createDefaultGlobalConfigDraft();
  const modelNode = readPathValue(root, "model");
  const serviceTierNode = readPathValue(root, "service_tier");
  const contextWindowNode = readPathValue(root, "model_context_window");
  const compactLimitNode = readPathValue(root, "model_auto_compact_token_limit");
  const effortNode = readPathValue(root, "model_reasoning_effort");
  const summaryNode = readPathValue(root, "model_reasoning_summary");
  const approvalNode = readPathValue(root, "approval_policy");
  const approvalsReviewerNode = readPathValue(root, "approvals_reviewer");
  const sandboxNode = readPathValue(root, "sandbox_mode");
  const windowsSandboxNode = readPathValue(root, "windows.sandbox");
  const unifiedExecNode = readPathValue(root, "features.unified_exec");
  const applyPatchStreamingEventsNode = readPathValue(root, "features.apply_patch_streaming_events");

  return {
    model: normalizeModelName(modelNode.value),
    fastModeEnabled: !serviceTierNode.found
      ? defaults.fastModeEnabled
      : String(serviceTierNode.value ?? "")
            .trim()
            .toLowerCase() === "flex"
        ? false
        : String(serviceTierNode.value ?? "")
              .trim()
              .toLowerCase() === "fast"
          ? true
          : defaults.fastModeEnabled,
    modelContextWindow: normalizeOptionalPositiveInteger(contextWindowNode.value ?? defaults.modelContextWindow),
    modelAutoCompactTokenLimit: normalizeOptionalPositiveInteger(
      compactLimitNode.value ?? defaults.modelAutoCompactTokenLimit
    ),
    modelReasoningEffort: normalizeEffort(effortNode.value),
    modelReasoningSummary: normalizeReasoningSummary(summaryNode.value ?? defaults.modelReasoningSummary),
    approvalPolicy: normalizeApprovalPolicy(approvalNode.value ?? defaults.approvalPolicy),
    approvalsReviewer: normalizeApprovalsReviewer(approvalsReviewerNode.value ?? defaults.approvalsReviewer),
    sandboxMode: normalizeSandboxMode(sandboxNode.value ?? defaults.sandboxMode),
    windowsElevatedSandboxEnabled:
      String(windowsSandboxNode.value ?? "")
        .trim()
        .toLowerCase() === "elevated",
    unifiedExecEnabled: normalizeBooleanFlag(unifiedExecNode.value, defaults.unifiedExecEnabled),
    applyPatchStreamingEventsEnabled: normalizeBooleanFlag(
      applyPatchStreamingEventsNode.value,
      defaults.applyPatchStreamingEventsEnabled
    ),
  };
}

export function buildConfigBatchChangesFromDraft(
  draft: GlobalConfigDraft,
  baseline: GlobalConfigDraft
): ConfigWriteChange[] {
  const changes: ConfigWriteChange[] = [];
  const normalizedDraftApprovalPolicy = normalizeApprovalPolicy(draft.approvalPolicy);
  const normalizedBaselineApprovalPolicy = normalizeApprovalPolicy(baseline.approvalPolicy);
  if (JSON.stringify(normalizedDraftApprovalPolicy) !== JSON.stringify(normalizedBaselineApprovalPolicy)) {
    changes.push({ keyPath: "approval_policy", value: normalizedDraftApprovalPolicy });
  }
  if (normalizeApprovalsReviewer(draft.approvalsReviewer) !== normalizeApprovalsReviewer(baseline.approvalsReviewer)) {
    changes.push({ keyPath: "approvals_reviewer", value: normalizeApprovalsReviewer(draft.approvalsReviewer) });
  }
  if (normalizeSandboxMode(draft.sandboxMode) !== normalizeSandboxMode(baseline.sandboxMode)) {
    // config/value/write 的 sandbox_mode 采用 kebab-case。
    changes.push({ keyPath: "sandbox_mode", value: sandboxKebabFromUi(normalizeSandboxMode(draft.sandboxMode)) });
  }
  if (Boolean(draft.windowsElevatedSandboxEnabled) !== Boolean(baseline.windowsElevatedSandboxEnabled)) {
    changes.push({
      keyPath: "windows.sandbox",
      value: Boolean(draft.windowsElevatedSandboxEnabled) ? "elevated" : "unelevated",
    });
  }
  if (Boolean(draft.unifiedExecEnabled) !== Boolean(baseline.unifiedExecEnabled)) {
    changes.push({ keyPath: "features.unified_exec", value: Boolean(draft.unifiedExecEnabled) });
  }
  if (Boolean(draft.applyPatchStreamingEventsEnabled) !== Boolean(baseline.applyPatchStreamingEventsEnabled)) {
    changes.push({
      keyPath: "features.apply_patch_streaming_events",
      value: Boolean(draft.applyPatchStreamingEventsEnabled),
    });
  }
  return changes;
}

function normalizeSkillEnabled(raw: { enabled: boolean } | null | undefined): boolean {
  return typeof raw?.enabled === "boolean" ? raw.enabled : true;
}

export function normalizeSkillsListResult(result: SkillsListResponse | null | undefined): SkillState[] {
  const data = Array.isArray(result?.data) ? result.data : [];
  const list = data.flatMap((entry) => (Array.isArray(entry.skills) ? entry.skills : []));
  const entries: SkillState[] = [];
  for (const item of list) {
    const path = String(item.path ?? "").trim();
    const nameRaw = String(item.name ?? "").trim();
    const name = nameRaw || (path ? path.split(/[\\/]/).filter(Boolean).slice(-1)[0] : "") || "unknown-skill";
    const description = typeof item.description === "string" ? item.description : undefined;
    const displayName = typeof item.interface?.displayName === "string" ? item.interface.displayName : undefined;
    const shortDescription =
      typeof item.interface?.shortDescription === "string"
        ? item.interface.shortDescription
        : typeof item.shortDescription === "string"
          ? item.shortDescription
          : undefined;
    const defaultPrompt = typeof item.interface?.defaultPrompt === "string" ? item.interface.defaultPrompt : undefined;
    const iconSmall = typeof item.interface?.iconSmall === "string" ? item.interface.iconSmall : undefined;
    const iconLarge = typeof item.interface?.iconLarge === "string" ? item.interface.iconLarge : undefined;
    const iconSmallUrl = typeof item.interface?.iconSmallUrl === "string" ? item.interface.iconSmallUrl : undefined;
    const iconLargeUrl = typeof item.interface?.iconLargeUrl === "string" ? item.interface.iconLargeUrl : undefined;
    const brandColor = typeof item.interface?.brandColor === "string" ? item.interface.brandColor : undefined;
    const enabled = normalizeSkillEnabled(item);
    const configurable = Boolean(path);
    entries.push({
      path: path || null,
      name,
      description,
      ...(displayName ? { displayName } : {}),
      ...(shortDescription ? { shortDescription } : {}),
      ...(defaultPrompt ? { defaultPrompt } : {}),
      ...(iconSmall ? { iconSmall } : {}),
      ...(iconLarge ? { iconLarge } : {}),
      ...(iconSmallUrl ? { iconSmallUrl } : {}),
      ...(iconLargeUrl ? { iconLargeUrl } : {}),
      ...(brandColor ? { brandColor } : {}),
      enabled,
      configurable,
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

export function normalizeSkillsErrors(result: SkillsListResponse | null | undefined): string[] {
  const data = Array.isArray(result?.data) ? result.data : [];
  const errors: string[] = [];
  for (const entry of data) {
    const list = Array.isArray(entry.errors) ? entry.errors : [];
    for (const err of list) {
      const msg = typeof err.message === "string" ? err.message : JSON.stringify(err);
      if (msg && msg.trim()) errors.push(msg.trim());
    }
  }
  return errors;
}

export function summarizeSkillsListResult(result: SkillsListResponse | null | undefined): string {
  const data = Array.isArray(result?.data) ? result.data : [];
  const parts: string[] = [];
  for (const entry of data) {
    const cwd = String(entry.cwd ?? "").trim() || "(missing cwd)";
    const skills = Array.isArray(entry.skills) ? entry.skills.length : 0;
    const errors = Array.isArray(entry.errors) ? entry.errors.length : 0;
    parts.push(`${cwd} skills=${skills} errors=${errors}`);
  }
  return `shape=data groups=${data.length}\n${parts.join("\n")}`;
}

export function extractConfigRequirementsFromReadResult(result: unknown): ConfigRequirements | null {
  const raw = (result as ConfigRequirementsReadResponse | null | undefined)?.requirements;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
}

export function normalizeMcpServersFromConfig(
  result: ConfigReadResponse | null | undefined
): Array<Pick<McpServerState, "id" | "enabled" | "type" | "url" | "command" | "args" | "env" | "cwd" | "headers">> {
  const root = normalizeConfigReadRoot(result);
  const serversNode = toRecord(root.mcp_servers);

  const entries: Array<
    Pick<McpServerState, "id" | "enabled" | "type" | "url" | "command" | "args" | "env" | "cwd" | "headers">
  > = [];

  const pushEntry = (idRaw: unknown, raw: Record<string, unknown> | null) => {
    const config = configValueToCodexMcpServerConfig(idRaw, raw);
    if (!config) return;
    const server = config.server;
    entries.push({
      id: config.id,
      enabled: config.enabled,
      type: server.type,
      url: server.url,
      command: server.command,
      args: server.args,
      env: server.env,
      cwd: server.cwd,
      headers: server.headers,
    });
  };

  if (serversNode) {
    for (const [key, value] of Object.entries(serversNode)) {
      pushEntry(key, toRecord(value));
    }
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  return entries;
}

export function normalizeMcpStatusListResult(
  result: ListMcpServerStatusResponse | null | undefined
): Array<
  Pick<
    McpServerState,
    "id" | "state" | "authenticated" | "authStatus" | "message" | "tools" | "resources" | "resourceTemplates"
  >
> {
  const list = Array.isArray(result?.data) ? result.data : [];

  const entries: Array<
    Pick<
      McpServerState,
      "id" | "state" | "authenticated" | "authStatus" | "message" | "tools" | "resources" | "resourceTemplates"
    >
  > = [];
  for (const item of list) {
    const id = String(item.name ?? "").trim();
    if (!id) continue;
    const authStatus = String(item.authStatus ?? "").trim();
    const statusRaw = authStatus.toLowerCase();
    const authenticated =
      authStatus === "bearerToken" || authStatus === "oAuth" ? true : authStatus === "notLoggedIn" ? false : undefined;
    const message = authStatus || undefined;

    let state: McpServerState["state"] = "unknown";
    if (!statusRaw) state = "unknown";
    else if (
      statusRaw === "unsupported" ||
      statusRaw === "notloggedin" ||
      statusRaw === "bearertoken" ||
      statusRaw === "oauth"
    )
      state = "connected";

    const tools =
      item.tools && typeof item.tools === "object"
        ? Object.entries(item.tools)
            .flatMap(([toolKey, toolValue]) => {
              if (!toolValue || typeof toolValue !== "object") return [];
              const tool = toolValue as Record<string, unknown>;
              const name = String(tool.name ?? toolKey ?? "").trim();
              if (!name) return [];
              return [
                {
                  name,
                  ...(typeof tool.title === "string" && tool.title.trim() ? { title: tool.title.trim() } : {}),
                  ...(typeof tool.description === "string" && tool.description.trim()
                    ? { description: tool.description.trim() }
                    : {}),
                  inputSchema: tool.inputSchema ?? {},
                  ...("outputSchema" in tool ? { outputSchema: tool.outputSchema } : {}),
                  ...("annotations" in tool ? { annotations: tool.annotations } : {}),
                  ...("_meta" in tool ? { _meta: tool._meta } : {}),
                },
              ];
            })
            .sort((a, b) => {
              const aKey = String(a.title ?? a.name ?? "")
                .trim()
                .toLowerCase();
              const bKey = String(b.title ?? b.name ?? "")
                .trim()
                .toLowerCase();
              return aKey.localeCompare(bKey);
            })
        : [];
    const resources = Array.isArray(item.resources)
      ? item.resources
          .map((resource) => ({
            uri: String(resource.uri ?? "").trim(),
            name: String(resource.name ?? "").trim(),
            ...(typeof resource.title === "string" && resource.title.trim() ? { title: resource.title.trim() } : {}),
            ...(typeof resource.description === "string" && resource.description.trim()
              ? { description: resource.description.trim() }
              : {}),
            ...(typeof resource.mimeType === "string" && resource.mimeType.trim()
              ? { mimeType: resource.mimeType.trim() }
              : {}),
            ...(Number.isFinite(resource.size) ? { size: Math.max(0, Math.round(Number(resource.size))) } : {}),
          }))
          .sort((a, b) => {
            const aKey = String(a.title ?? a.name ?? a.uri ?? "")
              .trim()
              .toLowerCase();
            const bKey = String(b.title ?? b.name ?? b.uri ?? "")
              .trim()
              .toLowerCase();
            return aKey.localeCompare(bKey);
          })
      : [];
    const resourceTemplates = Array.isArray(item.resourceTemplates)
      ? item.resourceTemplates
          .map((template) => ({
            uriTemplate: String(template.uriTemplate ?? "").trim(),
            name: String(template.name ?? "").trim(),
            ...(typeof template.title === "string" && template.title.trim() ? { title: template.title.trim() } : {}),
            ...(typeof template.description === "string" && template.description.trim()
              ? { description: template.description.trim() }
              : {}),
            ...(typeof template.mimeType === "string" && template.mimeType.trim()
              ? { mimeType: template.mimeType.trim() }
              : {}),
          }))
          .sort((a, b) => {
            const aKey = String(a.title ?? a.name ?? a.uriTemplate ?? "")
              .trim()
              .toLowerCase();
            const bKey = String(b.title ?? b.name ?? b.uriTemplate ?? "")
              .trim()
              .toLowerCase();
            return aKey.localeCompare(bKey);
          })
      : [];

    entries.push({
      id,
      state,
      authenticated,
      authStatus: authStatus || undefined,
      message,
      tools,
      resources,
      resourceTemplates,
    });
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  return entries;
}

export function normalizePlanItems(rawPlan: unknown): PlanStepState[] {
  const planItemsRaw: unknown[] = Array.isArray(rawPlan) ? rawPlan : [];
  return planItemsRaw
    .map((rawItem: unknown): PlanStepState | null => {
      if (!rawItem || typeof rawItem !== "object") return null;
      const item = rawItem as Record<string, unknown>;
      const step = String(item.step ?? "").trim();
      if (!step) return null;
      return { step, status: normalizePlanStepStatus(item.status) };
    })
    .filter((item: PlanStepState | null): item is PlanStepState => Boolean(item));
}
