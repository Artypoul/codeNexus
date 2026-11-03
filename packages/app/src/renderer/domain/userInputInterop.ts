import type { ToolRequestUserInputQuestion } from "@codenexus/generated/codex-app-server/v2/ToolRequestUserInputQuestion";
import type { OfficialCodexServerRequest } from "@codenexus/shared/codex-protocol";
import type { UserInputOption, UserInputPrompt, UserInputQuestion } from "./types";

const MCP_ELICITATION_CONTENT_QUESTION_ID = "__mcp_elicitation_content__";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOption(labelValue: string, descriptionValue: string): UserInputOption {
  const label = normalizeText(labelValue);
  const description = normalizeText(descriptionValue);
  return description ? { label, description } : { label };
}

function normalizeOfficialQuestion(question: ToolRequestUserInputQuestion): UserInputQuestion | null {
  const id = normalizeText(question.id);
  const header = normalizeText(question.header);
  const prompt = normalizeText(question.question);
  if (!id || !header || !prompt) return null;

  const options = (question.options ?? [])
    .map((option) => normalizeOption(option.label, option.description))
    .filter((option) => option.label);

  return {
    id,
    header,
    question: prompt,
    options,
    isOther: Boolean(question.isOther),
    isSecret: Boolean(question.isSecret),
  };
}

function normalizeQuestions(questions: ToolRequestUserInputQuestion[]): UserInputQuestion[] {
  return questions
    .map((question) => normalizeOfficialQuestion(question))
    .filter((question): question is UserInputQuestion => Boolean(question));
}

export function normalizeUserInputPrompt(
  request: OfficialCodexServerRequest,
  serverId: string
): UserInputPrompt | null {
  if (request.method === "item/tool/requestUserInput") {
    const questions = normalizeQuestions(request.params.questions);
    if (questions.length === 0) return null;

    return {
      kind: "questions",
      serverId: normalizeText(serverId),
      requestId: request.id,
      method: request.method,
      threadId: normalizeText(request.params.threadId) || undefined,
      turnId: normalizeText(request.params.turnId) || undefined,
      itemId: normalizeText(request.params.itemId) || undefined,
      questions,
    };
  }

  if (request.method !== "mcpServer/elicitation/request") return null;

  const threadId = normalizeText(request.params.threadId);
  const serverName = normalizeText(request.params.serverName);
  if (!threadId || !serverName) return null;

  const buildFormPrompt = (message: string, requestedSchema: unknown): UserInputPrompt => ({
    kind: "elicitationForm",
    serverId: normalizeText(serverId),
    requestId: request.id,
    method: request.method,
    threadId,
    turnId: normalizeText(request.params.turnId) || undefined,
    serverName,
    message,
    requestedSchema,
    questions: [
      {
        id: MCP_ELICITATION_CONTENT_QUESTION_ID,
        header: `MCP · ${serverName}`,
        question: message,
        options: [],
        isOther: false,
        isSecret: false,
      },
    ],
  });

  const mode = request.params.mode;
  if (mode === "form" || mode === "openai/form" || mode === "openaiForm") {
    const message = normalizeText(request.params.message);
    if (!message) return null;
    return buildFormPrompt(message, request.params.requestedSchema);
  }

  if (mode === "url") {
    const message = normalizeText(request.params.message);
    const url = normalizeText(request.params.url);
    const elicitationId = normalizeText(request.params.elicitationId);
    if (!message || !url || !elicitationId) return null;
    return {
      kind: "elicitationUrl",
      serverId: normalizeText(serverId),
      requestId: request.id,
      method: request.method,
      threadId,
      turnId: normalizeText(request.params.turnId) || undefined,
      serverName,
      message,
      url,
      elicitationId,
      questions: [],
    };
  }

  // openai/userVerification 没有对应的桌面交互形态，交给 responder 回协议错误。
  return null;
}
