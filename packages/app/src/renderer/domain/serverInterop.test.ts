import { describe, expect, it } from "vitest";
import {
  buildConfigBatchChangesFromDraft,
  createDefaultGlobalConfigDraft,
  extractGlobalConfigFromReadResult,
} from "./serverInterop";

describe("global config feature defaults", () => {
  it("defaults unified execution to the official enabled state", () => {
    expect(createDefaultGlobalConfigDraft().unifiedExecEnabled).toBe(true);
    expect(extractGlobalConfigFromReadResult({ config: {} }).unifiedExecEnabled).toBe(true);
  });

  it("keeps an explicit unified execution override", () => {
    const baseline = createDefaultGlobalConfigDraft();
    const extracted = extractGlobalConfigFromReadResult({
      config: { features: { unified_exec: false } },
    });

    expect(extracted.unifiedExecEnabled).toBe(false);
    expect(buildConfigBatchChangesFromDraft(extracted, baseline)).toContainEqual({
      keyPath: "features.unified_exec",
      value: false,
    });
  });

  it("does not write model or model-specific settings back to Codex", () => {
    const baseline = createDefaultGlobalConfigDraft();
    const draft = {
      ...baseline,
      model: "model-b",
      fastModeEnabled: false,
      modelContextWindow: 400000,
      modelAutoCompactTokenLimit: 360000,
      modelReasoningEffort: "high",
      modelReasoningSummary: "detailed" as const,
    };

    expect(buildConfigBatchChangesFromDraft(draft, baseline)).toEqual([]);
  });
});
