// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, reactive, type App } from "vue";
import ComposerPanel from "./ComposerPanel.vue";
import { buildUserTurnInputsFromComposeDraft } from "../../../domain/composeFileMentions";
import type { ComposeWorkspaceFileMention, SkillState } from "../../../domain/types";

vi.mock("vue-i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-i18n")>()),
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../stores/runtime.store", () => ({ useRuntimeStore: () => ({ currentThreadId: "" }) }));
vi.mock("../../../stores/userInput.store", () => ({ useUserInputStore: () => ({ queueSizeForThread: () => 0 }) }));
vi.mock("../../../features/media/localImageCache", () => ({
  readLocalImageDataUrl: vi.fn(async () => "data:image/png;base64,AA=="),
}));
vi.mock("../../approval/ApprovalDock.vue", () => ({ default: { render: () => null } }));
vi.mock("../../ui/SkillIcon.vue", () => ({ default: { render: () => null } }));
vi.mock("../../ui/WaveText.vue", () => ({ default: { render: () => null } }));
vi.mock("../../ui/WaterBallProgress.vue", () => ({ default: { render: () => null } }));
vi.mock("./ComposerModelReasoningPicker.vue", () => ({ default: { render: () => null } }));
vi.mock("./ComposerSandboxPicker.vue", () => ({ default: { render: () => null } }));

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.replaceChildren();
});

function mountComposer(skills?: SkillState[]) {
  const props = reactive({
    composeInput: "",
    composeAttachments: [],
    composeFileMentions: [] as ComposeWorkspaceFileMention[],
    ...(skills ? { skills } : {}),
    historyRewriteActive: false,
    historyRewriteSource: "history" as const,
    composeMode: "default" as const,
    model: "model",
    reasoningEffort: "high",
    sandboxMode: "workspace-write" as const,
    modelOptions: [],
    sandboxModeOptions: [],
    sandboxRiskText: "",
    contextUsageTooltip: "",
    contextUsagePercent: 0,
    contextUsageLevel: "",
    contextUsageTokensText: "",
    isTurnRunning: false,
    sendDisabled: false,
    sendTitle: "send",
    interruptDisabled: true,
    interruptTitle: "stop",
    composerPanelRef: () => {},
    composerInputRef: () => {},
    composerImageInputRef: () => {},
  });
  const requested = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  app = createApp(() =>
    h(ComposerPanel, {
      ...props,
      onRequestSkills: requested,
      "onUpdate:composeInput": (value: string) => {
        props.composeInput = value;
      },
      "onUpdate:composeFileMentions": (value: ComposeWorkspaceFileMention[]) => {
        props.composeFileMentions = value;
      },
    })
  );
  app.directive("tooltip", {});
  app.mount(host);
  return { host, props, requested };
}

describe("composer skill picker", () => {
  it("opens safely without a skill list", async () => {
    const { host, requested } = mountComposer();
    host.querySelector<HTMLButtonElement>("#btn-insert-skill")!.click();
    await nextTick();
    expect(requested).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".composer-skill-empty")).not.toBeNull();
  });

  it("lists enabled skills and inserts a structured token into the draft", async () => {
    const skill: SkillState = { name: "review", path: "C:/skills/review/SKILL.md", enabled: true, configurable: true };
    const { host, props } = mountComposer([skill, { ...skill, name: "disabled", enabled: false }]);
    host.querySelector<HTMLButtonElement>("#btn-insert-skill")!.click();
    await nextTick();
    expect(host.querySelectorAll(".composer-skill-option")).toHaveLength(1);
    host.querySelector<HTMLButtonElement>(".composer-skill-option")!.click();
    await nextTick();
    expect(buildUserTurnInputsFromComposeDraft(props.composeInput, props.composeFileMentions)).toEqual([
      { type: "skill", name: "review", path: "C:/skills/review/SKILL.md" },
    ]);
    expect(host.querySelector(".composer-skill-picker")).toBeNull();
    expect(host.querySelector(".composer-inline-file-token--skill")).not.toBeNull();
  });
});
