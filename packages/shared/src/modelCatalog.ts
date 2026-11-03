import type { Model } from "@codenexus/generated/codex-app-server/v2/Model";

/**
 * Codex `model/list` 目录的纯函数工具。
 *
 * 选择值统一使用 `Model.model`（后端模型名）；`Model.id` 只用于目录去重和元数据。
 */

export type ModelPickerOption = {
  /** 发送给 Codex 的后端模型名。 */
  value: string;
  /** 目录中的稳定 id。 */
  catalogId: string;
  /** 选择器展示文本。 */
  label: string;
  description?: string;
  reasoningEfforts: Array<{ value: string; description?: string }>;
  defaultReasoningEffort: string;
  /** false 表示当前值不在目录中（例如第三方 provider 模型）。 */
  known: boolean;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function trimText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeReasoningEfforts(
  value: unknown,
): Array<{ value: string; description?: string }> {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const efforts: Array<{ value: string; description?: string }> = [];
  for (const item of list) {
    const record = toRecord(item);
    const effort = trimText(record?.reasoningEffort ?? record?.value);
    if (!effort || seen.has(effort)) continue;
    seen.add(effort);
    const description = trimText(record?.description);
    efforts.push(
      description ? { value: effort, description } : { value: effort },
    );
  }
  return efforts;
}

function normalizeModelEntry(value: unknown): Model | null {
  const record = toRecord(value);
  if (!record) return null;
  const id = trimText(record.id);
  const model = trimText(record.model);
  if (!id || !model) return null;
  return { ...(record as unknown as Model), id, model };
}

export function normalizeModelCatalog(data: unknown): Model[] {
  const list = Array.isArray(data) ? data : [];
  const seen = new Set<string>();
  const models: Model[] = [];
  for (const item of list) {
    const model = normalizeModelEntry(item);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models;
}

export async function collectModelPages(
  fetchPage: (
    cursor: string | null,
  ) => Promise<{ data: unknown; nextCursor: unknown }>,
  opts?: { maxPages?: number },
): Promise<Model[]> {
  const maxPages = Math.max(1, Math.min(50, Math.round(opts?.maxPages ?? 12)));
  const seenCursors = new Set<string>();
  const seenIds = new Set<string>();
  const models: Model[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const response = await fetchPage(cursor);
    for (const model of normalizeModelCatalog(response.data)) {
      if (seenIds.has(model.id)) continue;
      seenIds.add(model.id);
      models.push(model);
    }
    const nextCursor = trimText(response.nextCursor);
    if (!nextCursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return models;
}

export function resolveModelEntry(
  models: readonly Model[],
  value: unknown,
): Model | null {
  const text = trimText(value);
  if (!text) return null;
  const matches = models.filter(
    (model) => model.model === text || model.id === text,
  );
  return matches.find((model) => !model.hidden) ?? matches[0] ?? null;
}

export function resolveDefaultModel(
  models: readonly Model[],
  preferredModelValue?: string | null,
): Model | null {
  const preferred = resolveModelEntry(models, preferredModelValue);
  if (preferred) return preferred;
  return (
    models.find((model) => model.isDefault && !model.hidden) ??
    models.find((model) => !model.hidden) ??
    models[0] ??
    null
  );
}

export function resolveModelSelectionValue(
  models: readonly Model[],
  value: unknown,
  preferredModelValue?: string | null,
): string {
  const text = trimText(value);
  if (!text)
    return resolveDefaultModel(models, preferredModelValue)?.model ?? "";
  return resolveModelEntry(models, text)?.model ?? text;
}

export function resolveModelBackendValue(
  models: readonly Model[],
  value: unknown,
  preferredModelValue?: string | null,
): string {
  return resolveModelSelectionValue(models, value, preferredModelValue);
}

function toPickerOption(model: Model, known = true): ModelPickerOption {
  const efforts = normalizeReasoningEfforts(model.supportedReasoningEfforts);
  return {
    value: model.model,
    catalogId: model.id,
    label:
      trimText(model.displayName) ||
      trimText(model.model) ||
      trimText(model.id),
    description: trimText(model.description) || undefined,
    reasoningEfforts: efforts,
    defaultReasoningEffort:
      trimText(model.defaultReasoningEffort) || efforts[0]?.value || "",
    known,
  };
}

export function buildModelPickerOptions(args: {
  models: readonly Model[];
  current?: unknown;
  preferredModelValue?: string | null;
}): ModelPickerOption[] {
  const visibleOptions: ModelPickerOption[] = [];
  const seenValues = new Set<string>();
  for (const model of args.models) {
    if (model.hidden || seenValues.has(model.model)) continue;
    seenValues.add(model.model);
    visibleOptions.push(toPickerOption(model));
  }

  const current = resolveModelSelectionValue(
    args.models,
    args.current,
    args.preferredModelValue,
  );
  if (!current || visibleOptions.some((option) => option.value === current)) {
    return visibleOptions;
  }

  const entry = resolveModelEntry(args.models, current);
  if (entry) return [toPickerOption(entry), ...visibleOptions];

  return [
    {
      value: current,
      catalogId: "",
      label: current,
      reasoningEfforts: [],
      defaultReasoningEffort: "",
      known: false,
    },
    ...visibleOptions,
  ];
}

function resolveEffortEntry(
  models: readonly Model[],
  value: unknown,
): Model | null {
  const text = trimText(value);
  const entry = resolveModelEntry(models, text);
  if (entry) return entry;
  return text ? null : resolveDefaultModel(models);
}

export function resolveReasoningEfforts(
  models: readonly Model[],
  value: unknown,
): ModelPickerOption["reasoningEfforts"] {
  const entry = resolveEffortEntry(models, value);
  return entry
    ? normalizeReasoningEfforts(entry.supportedReasoningEfforts)
    : [];
}

export function resolveReasoningEffort(
  models: readonly Model[],
  value: unknown,
  requested: unknown,
  preferredEffort?: string | null,
): string {
  const entry = resolveEffortEntry(models, value);
  const efforts = entry
    ? normalizeReasoningEfforts(entry.supportedReasoningEfforts)
    : [];
  const requestedText = trimText(requested);

  if (efforts.length === 0) {
    return requestedText || trimText(preferredEffort);
  }

  const findEffort = (candidate: unknown): string | undefined => {
    const normalized = trimText(candidate).toLowerCase();
    if (!normalized) return undefined;
    return efforts.find((effort) => effort.value.toLowerCase() === normalized)
      ?.value;
  };

  return (
    findEffort(requestedText) ??
    findEffort(entry?.defaultReasoningEffort) ??
    findEffort(preferredEffort) ??
    efforts[0]?.value ??
    ""
  );
}
