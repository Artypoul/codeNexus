import { describe, expect, it } from "vitest";
import {
  COMPOSE_FILE_TOKEN_CHAR,
  buildComposeDraftFromUserTurnInputs,
  buildUserTurnInputsFromComposeDraft,
  createComposeSkillMention,
} from "./composeFileMentions";
import type { SkillState, UserTurnInput } from "./types";

const skill: SkillState = {
  path: "C:/skills/review/SKILL.md",
  name: "review",
  displayName: "Code Review",
  iconSmallUrl: "https://example.com/review.png",
  enabled: true,
  configurable: true,
};

describe("compose skill mentions", () => {
  it("round-trips native mentions without changing their type or URI", () => {
    const inputs: UserTurnInput[] = [
      { type: "text", text: "use " },
      { type: "mention", name: "app", path: "app://connected-source" },
    ];
    const draft = buildComposeDraftFromUserTurnInputs(inputs);
    expect(buildUserTurnInputsFromComposeDraft(draft.composeInput, draft.composeFileMentions)).toEqual(inputs);
  });
  it("keeps local skill icons when no catalog URL is available", () => {
    expect(
      createComposeSkillMention({ ...skill, iconSmallUrl: "", iconSmall: "C:/skills/review/icon.png" })
    ).toMatchObject({ iconUrl: "C:/skills/review/icon.png" });
  });
  it("serializes a skill token into the official skill input", () => {
    const mention = createComposeSkillMention(skill);
    expect(mention).not.toBeNull();

    const inputs = buildUserTurnInputsFromComposeDraft(
      `please ${COMPOSE_FILE_TOKEN_CHAR} check`,
      mention ? [mention] : []
    );

    expect(inputs.map((item) => item.type)).toEqual(["text", "skill", "text"]);
    expect(inputs[1]).toEqual({
      type: "skill",
      name: "review",
      path: "C:/skills/review/SKILL.md",
    });
  });

  it("round-trips official skill inputs back into a compose token", () => {
    const inputs: UserTurnInput[] = [
      { type: "text", text: "please " },
      { type: "skill", name: "review", path: "C:/skills/review/SKILL.md" },
      { type: "text", text: " check" },
    ];

    const draft = buildComposeDraftFromUserTurnInputs(inputs);
    expect(draft.composeInput).toBe(`please ${COMPOSE_FILE_TOKEN_CHAR} check`);
    expect(draft.composeFileMentions).toHaveLength(1);
    expect(draft.composeFileMentions[0]).toMatchObject({
      kind: "skill",
      name: "review",
      path: "C:/skills/review/SKILL.md",
    });

    const rebuilt = buildUserTurnInputsFromComposeDraft(draft.composeInput, draft.composeFileMentions);
    expect(rebuilt).toMatchObject(inputs);
  });
});
