import { describe, expect, it } from "vitest";
import {
  buildConfigBatchChangesFromDraft,
  createDefaultGlobalConfigDraft,
  extractGlobalConfigFromReadResult,
  normalizeSkillsListResult,
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

  it("keeps the official standard approval and sandbox values", () => {
    const baseline = createDefaultGlobalConfigDraft();
    const extracted = extractGlobalConfigFromReadResult({
      config: {
        approval_policy: "on-request",
        sandbox_mode: "workspace-write",
      },
    });

    expect(extracted.approvalPolicy).toBe("on-request");
    expect(extracted.sandboxMode).toBe("workspace-write");
    expect(buildConfigBatchChangesFromDraft(extracted, baseline)).toEqual([
      { keyPath: "approval_policy", value: "on-request" },
      { keyPath: "sandbox_mode", value: "workspace-write" },
    ]);
  });
});

describe("skills metadata icons", () => {
  it("keeps official local and remote icon fields", () => {
    const items = normalizeSkillsListResult({
      data: [
        {
          cwd: "C:/repo",
          errors: [],
          skills: [
            {
              name: "review",
              description: "Review code",
              path: "C:/skills/review/SKILL.md",
              enabled: true,
              interface: {
                displayName: "Code Review",
                iconSmall: "C:/skills/review/icon.png",
                iconLarge: "C:/skills/review/icon-large.png",
                iconSmallUrl: "https://example.com/icon.png",
                iconLargeUrl: "https://example.com/icon-large.png",
                brandColor: "#12abef",
              },
            },
          ],
        },
      ],
    } as any);

    expect(items[0]).toMatchObject({
      name: "review",
      iconSmall: "C:/skills/review/icon.png",
      iconLarge: "C:/skills/review/icon-large.png",
      iconSmallUrl: "https://example.com/icon.png",
      iconLargeUrl: "https://example.com/icon-large.png",
      brandColor: "#12abef",
    });
  });
});
