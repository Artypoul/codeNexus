export type ReasoningEffortOption = {
  value: string;
  label: string;
  description?: string;
};

export function reasoningEffortLabel(value: string, t: (key: string) => string, te: (key: string) => boolean): string {
  const key = `composer.${String(value ?? "")
    .trim()
    .toLowerCase()}`;
  return te(key) ? t(key) : value;
}

export function buildReasoningEffortOptions(
  efforts: ReadonlyArray<{ value: string; description?: string }>,
  t: (key: string) => string,
  te: (key: string) => boolean
): ReasoningEffortOption[] {
  return efforts.map((effort) => ({
    value: effort.value,
    label: reasoningEffortLabel(effort.value, t, te),
    description: effort.description,
  }));
}
