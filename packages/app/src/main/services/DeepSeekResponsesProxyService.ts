import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

type ChatMessage = Record<string, unknown>;
type ResponseOutputItem = Record<string, unknown>;

type ToolCallState = {
  index: number;
  itemId: string;
  callId: string;
  name: string;
  arguments: string;
  outputIndex: number;
  added: boolean;
};

type ResponseHistoryEntry = {
  messages: ChatMessage[];
  createdAt: number;
};

class ProxyRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function normalizeHttpBaseUrl(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/+$/g, "");
  } catch {
    return "";
  }
}

function resolveChatCompletionsEndpoint(baseUrl: string): string {
  if (/\/chat\/completions$/i.test(baseUrl)) return baseUrl;
  if (/\/v1$/i.test(baseUrl)) return `${baseUrl}/chat/completions`;
  return `${baseUrl}/v1/chat/completions`;
}

function resolveModelsEndpoint(baseUrl: string): string {
  if (/\/models$/i.test(baseUrl)) return baseUrl;
  if (/\/v1$/i.test(baseUrl)) return `${baseUrl}/models`;
  return `${baseUrl}/v1/models`;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function toText(value: unknown): string {
  return String(value ?? "").trim();
}

function maybeJsonText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = item;
  }
  return out as T;
}

function contentPartText(part: Record<string, unknown>): string {
  const type = toText(part.type);
  if (type.includes("image") || type === "input_file") {
    throw new ProxyRequestError(400, `DeepSeek proxy does not support Responses content part: ${type}`);
  }
  if (typeof part.text === "string") return part.text;
  if (typeof part.output_text === "string") return part.output_text;
  if (typeof part.input_text === "string") return part.input_text;
  if (typeof part.refusal === "string") return part.refusal;
  return "";
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return maybeJsonText(content);
  const parts: string[] = [];
  for (const part of content) {
    const record = toRecord(part);
    if (!record) continue;
    const text = contentPartText(record);
    if (text) parts.push(text);
  }
  return parts.join("\n");
}

function normalizeRole(value: unknown): "system" | "user" | "assistant" | "tool" {
  const raw = toText(value).toLowerCase();
  if (raw === "assistant") return "assistant";
  if (raw === "tool") return "tool";
  if (raw === "system" || raw === "developer") return "system";
  return "user";
}

function responseInputItemToMessages(item: unknown): ChatMessage[] {
  const record = toRecord(item);
  if (!record) return [];
  const type = toText(record.type);
  if (type === "function_call_output") {
    const callId = toText(record.call_id ?? record.callId ?? record.id);
    return [
      compactObject({
        role: "tool",
        tool_call_id: callId || undefined,
        content: maybeJsonText(record.output ?? record.content),
      }),
    ];
  }
  if (type === "function_call") {
    const callId = toText(record.call_id ?? record.callId ?? record.id) || `call_${randomUUID()}`;
    const name = toText(record.name);
    return [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: callId,
            type: "function",
            function: {
              name,
              arguments: typeof record.arguments === "string" ? record.arguments : maybeJsonText(record.arguments),
            },
          },
        ],
      },
    ];
  }
  if (type === "input_text") {
    return [{ role: "user", content: toText(record.text) }];
  }
  if (type === "message" || record.role) {
    return [
      compactObject({
        role: normalizeRole(record.role),
        content: contentToText(record.content),
      }),
    ];
  }
  return [];
}

function responseInputToMessages(input: unknown): ChatMessage[] {
  if (typeof input === "string") return [{ role: "user", content: input }];
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => responseInputItemToMessages(item));
}

function responseToolToChatTool(tool: unknown): Record<string, unknown> | null {
  const record = toRecord(tool);
  if (!record) return null;
  const type = toText(record.type);
  if (type !== "function") return null;
  const parameters = record.parameters ?? toRecord(record.function)?.parameters ?? {};
  const functionRecord = toRecord(record.function);
  const name = toText(record.name ?? functionRecord?.name);
  if (!name) return null;
  return {
    type: "function",
    function: compactObject({
      name,
      description: toText(record.description ?? functionRecord?.description) || undefined,
      parameters,
    }),
  };
}

function responseToolChoiceToChatToolChoice(value: unknown): unknown {
  if (typeof value === "string") return value;
  const record = toRecord(value);
  if (!record) return undefined;
  if (toText(record.type) === "function") {
    const name = toText(record.name ?? toRecord(record.function)?.name);
    if (name) return { type: "function", function: { name } };
  }
  return undefined;
}

function mapUsage(value: unknown): Record<string, unknown> | undefined {
  const record = toRecord(value);
  if (!record) return undefined;
  const inputTokens = Number(record.prompt_tokens ?? record.input_tokens);
  const outputTokens = Number(record.completion_tokens ?? record.output_tokens);
  const totalTokens = Number(record.total_tokens);
  return compactObject({
    input_tokens: Number.isFinite(inputTokens) ? Math.max(0, Math.round(inputTokens)) : undefined,
    output_tokens: Number.isFinite(outputTokens) ? Math.max(0, Math.round(outputTokens)) : undefined,
    total_tokens: Number.isFinite(totalTokens) ? Math.max(0, Math.round(totalTokens)) : undefined,
  });
}

export class DeepSeekResponsesProxyService {
  private server?: Server;
  private port = 0;
  private upstreamBaseUrl = "";
  private readonly responseHistory = new Map<string, ResponseHistoryEntry>();

  async prepare(args: { upstreamBaseUrl: string }): Promise<{ ok: true; baseUrl: string }> {
    const upstreamBaseUrl = normalizeHttpBaseUrl(args.upstreamBaseUrl);
    if (!upstreamBaseUrl) throw new Error("DeepSeek Base URL is invalid. Enter an http(s) URL.");
    this.upstreamBaseUrl = upstreamBaseUrl;
    await this.ensureStarted();
    return { ok: true, baseUrl: this.localBaseUrl() };
  }

  stop(): void {
    try {
      this.server?.close();
    } catch {}
    this.server = undefined;
    this.port = 0;
  }

  private localBaseUrl(): string {
    if (!this.port) throw new Error("DeepSeek proxy is not running");
    return `http://127.0.0.1:${this.port}/v1`;
  }

  private async ensureStarted(): Promise<void> {
    if (this.server && this.port > 0) return;
    const server = createServer((req, res) => {
      void this.handle(req, res);
    });
    server.on("clientError", (_err, socket) => {
      try {
        socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      } catch {}
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("DeepSeek proxy failed to listen on 127.0.0.1");
    }
    this.server = server;
    this.port = address.port;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const method = String(req.method ?? "GET").toUpperCase();
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (method === "GET" && url.pathname === "/v1/models") {
        await this.handleModels(req, res);
        return;
      }
      if (method === "POST" && url.pathname === "/v1/responses") {
        await this.handleResponses(req, res);
        return;
      }
      this.sendJson(res, 404, { error: { message: `DeepSeek proxy route not found: ${method} ${url.pathname}` } });
    } catch (error: unknown) {
      const status = error instanceof ProxyRequestError ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      this.sendJson(res, status, { error: { message } });
    }
  }

  private async handleModels(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const endpoint = resolveModelsEndpoint(this.requireUpstreamBaseUrl());
    const response = await fetch(endpoint, {
      method: "GET",
      headers: this.forwardHeaders(req, { Accept: "application/json" }),
    });
    const text = await response.text().catch(() => "");
    res.writeHead(response.status, {
      "content-type": response.headers.get("content-type") || "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(text);
  }

  private async handleResponses(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = toRecord(await this.readJsonBody(req));
    if (!body) throw new ProxyRequestError(400, "Responses request body must be a JSON object.");
    const model = toText(body.model);
    if (!model) throw new ProxyRequestError(400, "Responses request requires model.");
    const stream = body.stream === true;
    const messages = this.buildMessages(body);
    const tools = Array.isArray(body.tools) ? body.tools.map(responseToolToChatTool).filter(Boolean) : undefined;
    const chatRequest = compactObject({
      model,
      messages,
      stream,
      tools: tools && tools.length > 0 ? tools : undefined,
      tool_choice: responseToolChoiceToChatToolChoice(body.tool_choice),
      temperature: typeof body.temperature === "number" ? body.temperature : undefined,
      top_p: typeof body.top_p === "number" ? body.top_p : undefined,
      max_tokens:
        typeof body.max_output_tokens === "number"
          ? body.max_output_tokens
          : typeof body.max_tokens === "number"
            ? body.max_tokens
            : undefined,
      stop: body.stop,
      stream_options: stream ? { include_usage: true } : undefined,
    });
    const upstream = await fetch(resolveChatCompletionsEndpoint(this.requireUpstreamBaseUrl()), {
      method: "POST",
      headers: this.forwardHeaders(req, {
        Accept: stream ? "text/event-stream" : "application/json",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(chatRequest),
    });
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      this.sendJson(res, upstream.status, { error: { message: text || upstream.statusText } });
      return;
    }
    if (stream) {
      await this.pipeChatStreamToResponses(upstream, res, { model, messages });
      return;
    }
    const parsed = await upstream.json().catch(() => null);
    this.sendNonStreamResponse(res, parsed, { model, messages });
  }

  private buildMessages(body: Record<string, unknown>): ChatMessage[] {
    const messages: ChatMessage[] = [];
    const previousResponseId = toText(body.previous_response_id);
    const previous = previousResponseId ? this.responseHistory.get(previousResponseId) : null;
    if (previous) messages.push(...previous.messages);
    const instructions = toText(body.instructions);
    if (instructions) messages.push({ role: "system", content: instructions });
    messages.push(...responseInputToMessages(body.input));
    if (messages.length === 0) throw new ProxyRequestError(400, "Responses request did not contain input messages.");
    return messages;
  }

  private async pipeChatStreamToResponses(
    upstream: Response,
    res: ServerResponse,
    args: { model: string; messages: ChatMessage[] }
  ): Promise<void> {
    if (!upstream.body) throw new ProxyRequestError(502, "DeepSeek stream response did not include a body.");
    const responseId = `resp_${randomUUID()}`;
    const createdAt = Math.floor(Date.now() / 1000);
    const outputItems: ResponseOutputItem[] = [];
    const toolCalls = new Map<number, ToolCallState>();
    let textItemId = "";
    let textOutputIndex = -1;
    let textStarted = false;
    let finalText = "";
    let usage: Record<string, unknown> | undefined;

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    this.writeSse(res, "response.created", {
      type: "response.created",
      response: this.responseObject(responseId, args.model, createdAt, "in_progress", []),
    });
    this.writeSse(res, "response.in_progress", {
      type: "response.in_progress",
      response: this.responseObject(responseId, args.model, createdAt, "in_progress", []),
    });

    const ensureTextStarted = () => {
      if (textStarted) return;
      textStarted = true;
      textItemId = `msg_${randomUUID()}`;
      textOutputIndex = outputItems.length;
      const item = {
        id: textItemId,
        type: "message",
        status: "in_progress",
        role: "assistant",
        content: [],
      };
      outputItems.push(item);
      this.writeSse(res, "response.output_item.added", {
        type: "response.output_item.added",
        output_index: textOutputIndex,
        item,
      });
      this.writeSse(res, "response.content_part.added", {
        type: "response.content_part.added",
        item_id: textItemId,
        output_index: textOutputIndex,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] },
      });
    };

    const finishText = () => {
      if (!textStarted) return;
      this.writeSse(res, "response.output_text.done", {
        type: "response.output_text.done",
        item_id: textItemId,
        output_index: textOutputIndex,
        content_index: 0,
        text: finalText,
      });
      const part = { type: "output_text", text: finalText, annotations: [] };
      this.writeSse(res, "response.content_part.done", {
        type: "response.content_part.done",
        item_id: textItemId,
        output_index: textOutputIndex,
        content_index: 0,
        part,
      });
      const item = {
        id: textItemId,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [part],
      };
      outputItems[textOutputIndex] = item;
      this.writeSse(res, "response.output_item.done", {
        type: "response.output_item.done",
        output_index: textOutputIndex,
        item,
      });
    };

    const ensureToolCall = (index: number, raw: Record<string, unknown>): ToolCallState => {
      let state = toolCalls.get(index);
      if (!state) {
        state = {
          index,
          itemId: `fc_${randomUUID()}`,
          callId: toText(raw.id) || `call_${randomUUID()}`,
          name: "",
          arguments: "",
          outputIndex: -1,
          added: false,
        };
        toolCalls.set(index, state);
      }
      const fn = toRecord(raw.function);
      const name = toText(fn?.name);
      if (name) state.name = name;
      return state;
    };

    const addToolCallIfReady = (state: ToolCallState) => {
      if (state.added || !state.name) return;
      state.added = true;
      state.outputIndex = outputItems.length;
      const item = {
        id: state.itemId,
        type: "function_call",
        status: "in_progress",
        call_id: state.callId,
        name: state.name,
        arguments: "",
      };
      outputItems.push(item);
      this.writeSse(res, "response.output_item.added", {
        type: "response.output_item.added",
        output_index: state.outputIndex,
        item,
      });
    };

    const processData = (data: string) => {
      if (!data || data === "[DONE]") return;
      const parsed = JSON.parse(data);
      usage = mapUsage(parsed.usage) ?? usage;
      const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
      for (const choice of choices) {
        const delta = toRecord(toRecord(choice)?.delta);
        if (!delta) continue;
        const content = typeof delta.content === "string" ? delta.content : "";
        if (content) {
          ensureTextStarted();
          finalText += content;
          this.writeSse(res, "response.output_text.delta", {
            type: "response.output_text.delta",
            item_id: textItemId,
            output_index: textOutputIndex,
            content_index: 0,
            delta: content,
          });
        }
        const rawToolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
        for (const rawToolCall of rawToolCalls) {
          const raw = toRecord(rawToolCall);
          if (!raw) continue;
          const index = Number(raw.index);
          const state = ensureToolCall(Number.isFinite(index) ? Math.round(index) : toolCalls.size, raw);
          addToolCallIfReady(state);
          const fn = toRecord(raw.function);
          const argDelta = typeof fn?.arguments === "string" ? fn.arguments : "";
          if (argDelta) {
            state.arguments += argDelta;
            addToolCallIfReady(state);
            if (state.added) {
              this.writeSse(res, "response.function_call_arguments.delta", {
                type: "response.function_call_arguments.delta",
                item_id: state.itemId,
                output_index: state.outputIndex,
                delta: argDelta,
              });
            }
          }
        }
      }
    };

    let buffer = "";
    const decoder = new TextDecoder();
    for await (const chunk of upstream.body as any) {
      buffer += decoder.decode(chunk, { stream: true });
      buffer = this.consumeSseBuffer(buffer, processData);
    }
    buffer += decoder.decode();
    this.consumeSseBuffer(`${buffer}\n\n`, processData);

    finishText();
    for (const state of [...toolCalls.values()].sort((a, b) => a.outputIndex - b.outputIndex)) {
      addToolCallIfReady(state);
      if (!state.added) continue;
      const item = {
        id: state.itemId,
        type: "function_call",
        status: "completed",
        call_id: state.callId,
        name: state.name,
        arguments: state.arguments,
      };
      outputItems[state.outputIndex] = item;
      this.writeSse(res, "response.function_call_arguments.done", {
        type: "response.function_call_arguments.done",
        item_id: state.itemId,
        output_index: state.outputIndex,
        arguments: state.arguments,
      });
      this.writeSse(res, "response.output_item.done", {
        type: "response.output_item.done",
        output_index: state.outputIndex,
        item,
      });
    }
    const completed = this.responseObject(responseId, args.model, createdAt, "completed", outputItems, usage);
    this.rememberResponse(responseId, args.messages, finalText, [...toolCalls.values()]);
    this.writeSse(res, "response.completed", { type: "response.completed", response: completed });
    res.end();
  }

  private sendNonStreamResponse(
    res: ServerResponse,
    parsed: unknown,
    args: { model: string; messages: ChatMessage[] }
  ): void {
    const record = toRecord(parsed);
    const choice = toRecord(Array.isArray(record?.choices) ? record.choices[0] : null);
    const message = toRecord(choice?.message);
    const responseId = `resp_${randomUUID()}`;
    const createdAt = Math.floor(Date.now() / 1000);
    const outputItems: ResponseOutputItem[] = [];
    const content = typeof message?.content === "string" ? message.content : "";
    if (content) {
      outputItems.push({
        id: `msg_${randomUUID()}`,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: content, annotations: [] }],
      });
    }
    const toolCalls: ToolCallState[] = [];
    const rawToolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    for (const rawToolCall of rawToolCalls) {
      const raw = toRecord(rawToolCall);
      const fn = toRecord(raw?.function);
      const state: ToolCallState = {
        index: toolCalls.length,
        itemId: `fc_${randomUUID()}`,
        callId: toText(raw?.id) || `call_${randomUUID()}`,
        name: toText(fn?.name),
        arguments: typeof fn?.arguments === "string" ? fn.arguments : "",
        outputIndex: outputItems.length,
        added: true,
      };
      toolCalls.push(state);
      outputItems.push({
        id: state.itemId,
        type: "function_call",
        status: "completed",
        call_id: state.callId,
        name: state.name,
        arguments: state.arguments,
      });
    }
    this.rememberResponse(responseId, args.messages, content, toolCalls);
    this.sendJson(
      res,
      200,
      this.responseObject(responseId, args.model, createdAt, "completed", outputItems, mapUsage(record?.usage))
    );
  }

  private rememberResponse(
    responseId: string,
    inputMessages: ChatMessage[],
    finalText: string,
    toolCalls: ToolCallState[]
  ): void {
    const assistant: ChatMessage = { role: "assistant", content: finalText || null };
    const completedToolCalls = toolCalls.filter((item) => item.added && item.name);
    if (completedToolCalls.length > 0) {
      assistant.tool_calls = completedToolCalls.map((item) => ({
        id: item.callId,
        type: "function",
        function: { name: item.name, arguments: item.arguments },
      }));
    }
    this.responseHistory.set(responseId, {
      messages: [...inputMessages, assistant],
      createdAt: Date.now(),
    });
    while (this.responseHistory.size > 100) {
      const oldest = [...this.responseHistory.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0]?.[0];
      if (!oldest) break;
      this.responseHistory.delete(oldest);
    }
  }

  private responseObject(
    id: string,
    model: string,
    createdAt: number,
    status: "in_progress" | "completed",
    output: ResponseOutputItem[],
    usage?: Record<string, unknown>
  ): Record<string, unknown> {
    return compactObject({
      id,
      object: "response",
      created_at: createdAt,
      status,
      model,
      output,
      parallel_tool_calls: true,
      tool_choice: "auto",
      tools: [],
      usage,
    });
  }

  private consumeSseBuffer(buffer: string, onData: (data: string) => void): string {
    let rest = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    while (true) {
      const idx = rest.indexOf("\n\n");
      if (idx < 0) return rest;
      const block = rest.slice(0, idx);
      rest = rest.slice(idx + 2);
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
        .trim();
      if (data) onData(data);
    }
  }

  private forwardHeaders(req: IncomingMessage, extra: Record<string, string>): Record<string, string> {
    const authorization = toText(req.headers.authorization);
    if (!authorization) throw new ProxyRequestError(401, "Authorization header is required.");
    return {
      ...extra,
      Authorization: authorization,
    };
  }

  private requireUpstreamBaseUrl(): string {
    if (!this.upstreamBaseUrl) throw new ProxyRequestError(503, "DeepSeek proxy target has not been configured.");
    return this.upstreamBaseUrl;
  }

  private async readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > 12 * 1024 * 1024) throw new ProxyRequestError(413, "Request body is too large.");
      chunks.push(buf);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  private async readJsonBody(req: IncomingMessage): Promise<unknown> {
    const text = await this.readBody(req);
    try {
      return JSON.parse(text);
    } catch {
      throw new ProxyRequestError(400, "Request body must be valid JSON.");
    }
  }

  private writeSse(res: ServerResponse, event: string, data: unknown): void {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  private sendJson(res: ServerResponse, status: number, payload: unknown): void {
    if (res.headersSent) {
      try {
        res.end();
      } catch {}
      return;
    }
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(payload));
  }
}
