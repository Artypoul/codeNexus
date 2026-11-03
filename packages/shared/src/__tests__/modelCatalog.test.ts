import { describe, expect, it } from "vitest";
import type { Model } from "@codenexus/generated/codex-app-server/v2/Model";
import {
  buildModelPickerOptions,
  collectModelPages,
  normalizeModelCatalog,
  resolveDefaultModel,
  resolveModelBackendValue,
  resolveModelSelectionValue,
  resolveReasoningEffort,
} from "../modelCatalog";

function makeModel(
  overrides: Partial<Model> & { id: string; model: string },
): Model {
  return {
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: overrides.model,
    description: "",
    modelSpecialty: null,
    hidden: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "",
    inputModalities: ["text"],
    supportsPersonality: false,
    multiAgentVersion: null,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    availableAccessPrograms: null,
    isDefault: false,
    ...overrides,
  };
}

describe("normalizeModelCatalog", () => {
  it("drops entries without id or model and dedupes by id", () => {
    const catalog = normalizeModelCatalog([
      { id: "a", model: "model-a", displayName: "A" },
      { id: "", model: "missing-id" },
      { id: "b", model: "" },
      { id: "a", model: "model-a-2", displayName: "A2" },
    ]);
    expect(catalog).toHaveLength(1);
    expect(catalog[0].id).toBe("a");
    expect(catalog[0].model).toBe("model-a");
  });

  it("preserves directory metadata", () => {
    const model = makeModel({
      id: "a",
      model: "model-a",
      displayName: "Model A",
      hidden: true,
      isDefault: true,
      supportedReasoningEfforts: [
        { reasoningEffort: "high", description: "High" },
      ],
      defaultReasoningEffort: "high",
    });
    const [entry] = normalizeModelCatalog([model]);
    expect(entry.hidden).toBe(true);
    expect(entry.isDefault).toBe(true);
    expect(entry.defaultReasoningEffort).toBe("high");
    expect(entry.supportedReasoningEfforts).toHaveLength(1);
  });
});

describe("collectModelPages", () => {
  it("concatenates pages until nextCursor is null", async () => {
    const pages = [
      { data: [makeModel({ id: "a", model: "a" })], nextCursor: "c1" },
      { data: [makeModel({ id: "b", model: "b" })], nextCursor: null },
    ];
    let calls = 0;
    const models = await collectModelPages(async () => pages[calls++]);
    expect(models.map((model) => model.id)).toEqual(["a", "b"]);
    expect(calls).toBe(2);
  });

  it("stops on a repeated cursor", async () => {
    let calls = 0;
    const models = await collectModelPages(async () => {
      calls += 1;
      return {
        data: [makeModel({ id: `m${calls}`, model: `m${calls}` })],
        nextCursor: "same",
      };
    });
    expect(calls).toBe(2);
    expect(models).toHaveLength(2);
  });

  it("respects maxPages", async () => {
    let calls = 0;
    await collectModelPages(
      async () => {
        calls += 1;
        return { data: [], nextCursor: `c${calls}` };
      },
      { maxPages: 2 },
    );
    expect(calls).toBe(2);
  });

  it("propagates fetch errors", async () => {
    await expect(
      collectModelPages(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});

describe("model resolution", () => {
  const models = [
    makeModel({ id: "a", model: "model-a", displayName: "A" }),
    makeModel({ id: "b", model: "model-b", displayName: "B", isDefault: true }),
    makeModel({
      id: "hidden",
      model: "model-hidden",
      displayName: "Hidden",
      hidden: true,
    }),
  ];

  it("resolves default by preferred value, then isDefault, then first visible", () => {
    expect(resolveDefaultModel(models)?.id).toBe("b");
    expect(resolveDefaultModel(models, "model-a")?.id).toBe("a");
    expect(resolveDefaultModel(models, "hidden")?.id).toBe("hidden");
    expect(resolveDefaultModel([models[2]])?.id).toBe("hidden");
    expect(resolveDefaultModel([])).toBeNull();
  });

  it("maps ids and backend values to the backend model string", () => {
    expect(resolveModelSelectionValue(models, "b")).toBe("model-b");
    expect(resolveModelSelectionValue(models, "model-a")).toBe("model-a");
    expect(resolveModelBackendValue(models, "a")).toBe("model-a");
    expect(resolveModelSelectionValue(models, "")).toBe("model-b");
    expect(resolveModelSelectionValue(models, "unknown-model")).toBe(
      "unknown-model",
    );
  });

  it("builds picker options with hidden filtering and pinned current values", () => {
    const visible = buildModelPickerOptions({ models, current: "model-a" });
    expect(visible.map((option) => option.value)).toEqual([
      "model-a",
      "model-b",
    ]);

    const hiddenCurrent = buildModelPickerOptions({
      models,
      current: "model-hidden",
    });
    expect(hiddenCurrent.map((option) => option.value)).toEqual([
      "model-hidden",
      "model-a",
      "model-b",
    ]);
    expect(hiddenCurrent[0].label).toBe("Hidden");

    const unknownCurrent = buildModelPickerOptions({
      models,
      current: "external-model",
    });
    expect(unknownCurrent[0]).toMatchObject({
      value: "external-model",
      label: "external-model",
      known: false,
    });

    expect(buildModelPickerOptions({ models: [] })).toEqual([]);
  });

  it("uses displayName and falls back to the model value", () => {
    const noDisplayName = makeModel({
      id: "c",
      model: "model-c",
      displayName: "",
    });
    const options = buildModelPickerOptions({ models: [noDisplayName] });
    expect(options[0].label).toBe("model-c");
  });
});

describe("reasoning effort resolution", () => {
  const models = [
    makeModel({
      id: "a",
      model: "model-a",
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "Low" },
        { reasoningEffort: "high", description: "High" },
      ],
      defaultReasoningEffort: "high",
    }),
  ];

  it("keeps supported values and falls back to the model default", () => {
    expect(resolveReasoningEffort(models, "model-a", "low")).toBe("low");
    expect(resolveReasoningEffort(models, "model-a", "medium")).toBe("high");
  });

  it("uses the preferred effort when the model default is unavailable", () => {
    const noDefault = [
      makeModel({
        id: "a",
        model: "model-a",
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "Low" },
        ],
        defaultReasoningEffort: "",
      }),
    ];
    expect(resolveReasoningEffort(noDefault, "model-a", "", "low")).toBe("low");
  });

  it("passes requested effort through when the model reports no efforts", () => {
    expect(resolveReasoningEffort(models, "external-model", "custom")).toBe(
      "custom",
    );
  });
});
