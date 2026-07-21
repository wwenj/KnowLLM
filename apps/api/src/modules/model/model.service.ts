import { Injectable } from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";
import { getApiRoot } from "../../config/env";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | string;
  content: unknown;
}

export type JsonSchema = Record<string, unknown>;

export type RawChatResponseFormat =
  | { type: "json_object" }
  | {
      type: "json_schema";
      json_schema: {
        name: string;
        strict?: boolean;
        schema: JsonSchema;
      };
    };

export interface RawChatOptions {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  response_format?: RawChatResponseFormat;
  maxTokens?: number;
  signal?: AbortSignal;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
      reasoning_content?: unknown;
      tool_calls?: ChatToolCall[];
    };
    text?: unknown;
  }>;
}

interface ChatToolCall {
  function?: {
    arguments?: unknown;
  };
}

export interface ModelOption {
  model: string;
  id: string;
  name: string;
  provider: string;
  providerName: string;
  priority: number;
  channels: Array<{ name: string; provider: string; priority: number }>;
}

interface LocalModelProviderConfig {
  name?: unknown;
  provider?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  apiKeyEnv?: unknown;
  models?: unknown;
  enabled?: unknown;
  priority?: unknown;
  unsupportedParameters?: unknown;
  outputTokenParameter?: unknown;
}

interface LocalModelConfig {
  name?: unknown;
  unsupportedParameters?: unknown;
  outputTokenParameter?: unknown;
}

interface NormalizedLocalModel {
  name: string;
  unsupportedParameters: string[];
  outputTokenParameter: "max_tokens" | "max_completion_tokens" | "";
}

interface ResolvedModel extends ModelOption {
  baseUrl: string;
  apiKey: string;
  unsupportedParameters: string[];
  outputTokenParameter: "max_tokens" | "max_completion_tokens" | "";
}

@Injectable()
export class ModelService {
  private modelCache: ResolvedModel[] | null = null;

  listModels(): ModelOption[] {
    return this.loadModels().map((model) => publicModel(model));
  }

  hasConfiguredModel(): boolean {
    return this.loadModels().length > 0;
  }

  findModel(model: string): ModelOption | null {
    const target = String(model || "").trim();
    if (!target) return null;
    const resolved = this.findResolvedModel(target);
    if (!resolved) return null;
    return publicModel(resolved);
  }

  resolveModel(explicit?: string): string {
    const target = String(explicit || "").trim();
    if (target) return this.findResolvedModel(target)?.id || "";
    const envModel = this.findResolvedModel(
      firstNonEmpty([
        process.env.OPENAI_MODEL,
        process.env.MODEL,
        process.env.LLM_WIKI_MODEL,
      ]),
    );
    if (envModel) return envModel.id;
    return this.loadModels()[0]?.id || "";
  }

  async chat(options: RawChatOptions): Promise<ChatCompletionResponse> {
    const response = await this.request(options);
    return normalizeChatCompletionResponse(
      (await response.json()) as ChatCompletionResponse,
    );
  }

  private async request(options: RawChatOptions): Promise<Response> {
    const resolved = this.resolveModelForRequest(options.model);
    if (!resolved) throw new Error("未配置可用模型");

    const body: Record<string, unknown> = {
      model: resolved.model,
      messages: options.messages,
      stream: false,
    };
    if (!resolved.unsupportedParameters.includes("temperature")) {
      body.temperature = options.temperature ?? 0.2;
    }
    if (Number.isInteger(options.maxTokens) && Number(options.maxTokens) > 0) {
      if (resolved.outputTokenParameter === "max_completion_tokens") {
        if (resolved.unsupportedParameters.includes("max_completion_tokens")) {
          throw new Error(`模型 ${resolved.id} 不支持可执行的输出 token 硬上限`);
        }
        body.max_completion_tokens = Number(options.maxTokens);
      } else if (resolved.outputTokenParameter === "max_tokens") {
        if (resolved.unsupportedParameters.includes("max_tokens")) {
          throw new Error(`模型 ${resolved.id} 不支持可执行的输出 token 硬上限`);
        }
        body.max_tokens = Number(options.maxTokens);
      } else if (!resolved.unsupportedParameters.includes("max_tokens")) {
        body.max_tokens = Number(options.maxTokens);
      } else if (!resolved.unsupportedParameters.includes("max_completion_tokens")) {
        body.max_completion_tokens = Number(options.maxTokens);
      } else {
        throw new Error(`模型 ${resolved.id} 不支持可执行的输出 token 硬上限`);
      }
    }
    applyResponseFormat(body, resolved, options.response_format);

    let response: Response;
    const url = chatCompletionsUrl(resolved, options);
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${resolved.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: options.signal,
      });
    } catch (err) {
      throw new Error(formatFetchFailure(err, url));
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`模型调用失败: ${response.status} ${text.slice(0, 300)}`);
    }
    return response;
  }

  private resolveModelForRequest(model?: string): ResolvedModel | null {
    const target = String(model || "").trim();
    if (target) return this.findResolvedModel(target);
    const defaultId = this.resolveModel("");
    return this.findResolvedModel(defaultId) || null;
  }

  private findResolvedModel(target: string): ResolvedModel | null {
    if (!target) return null;
    const models = this.loadModels();
    const byId = models.find((item) => item.id === target);
    if (byId) return byId;
    const byModel = models.filter((item) => item.model === target);
    return byModel.length === 1 ? byModel[0] : null;
  }

  private loadModels(): ResolvedModel[] {
    if (!this.modelCache) {
      const localModels = this.loadLocalModels();
      this.modelCache = (
        localModels.length ? localModels : this.loadEnvModels()
      ).sort(
        (a, b) =>
          a.priority - b.priority ||
          a.providerName.localeCompare(b.providerName) ||
          a.model.localeCompare(b.model),
      );
    }
    return this.modelCache;
  }

  private loadLocalModels(): ResolvedModel[] {
    const file = this.modelConfigPath();
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!Array.isArray(parsed)) throw new Error(`模型配置必须是数组: ${file}`);
    return parsed.flatMap((item, index) =>
      this.normalizeProviderConfig(item, index),
    );
  }

  private loadEnvModels(): ResolvedModel[] {
    const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
    const models = unique([
      process.env.OPENAI_MODEL,
      process.env.MODEL,
      process.env.LLM_WIKI_MODEL,
    ]);
    if (!apiKey || !models.length) return [];
    const baseUrl = normalizeBaseUrl(
      process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    );
    return models.map((model, index) =>
      this.toResolvedModel({
        providerName: "Env",
        provider: "openai",
        baseUrl,
        apiKey,
        model,
        priority: 100 + index,
        index,
        unsupportedParameters: [],
        outputTokenParameter: "",
      }),
    );
  }

  private normalizeProviderConfig(
    value: unknown,
    index: number,
  ): ResolvedModel[] {
    const raw =
      value && typeof value === "object"
        ? (value as LocalModelProviderConfig)
        : {};
    if (raw.enabled === false) return [];
    const providerName = stringField(raw.name) || `Provider ${index + 1}`;
    const provider = stringField(raw.provider) || "openai";
    const baseUrl = normalizeBaseUrl(stringField(raw.baseUrl));
    const apiKey =
      stringField(raw.apiKey) || envValue(stringField(raw.apiKeyEnv));
    const models = normalizeLocalModels(raw.models);
    if (!baseUrl || !apiKey || !models.length) return [];
    const priority = numberField(raw.priority, 0);
    const providerUnsupportedParameters = normalizeUnsupportedParameters(
      raw.unsupportedParameters,
    );
    const providerOutputTokenParameter = normalizeOutputTokenParameter(raw.outputTokenParameter);
    return models.map((model, modelIndex) =>
      this.toResolvedModel({
        providerName,
        provider,
        baseUrl,
        apiKey,
        model: model.name,
        priority,
        index: index * 1000 + modelIndex,
        unsupportedParameters: unique([
          ...providerUnsupportedParameters,
          ...model.unsupportedParameters,
        ]),
        outputTokenParameter: model.outputTokenParameter || providerOutputTokenParameter,
      }),
    );
  }

  private toResolvedModel(args: {
    providerName: string;
    provider: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    priority: number;
    index: number;
    unsupportedParameters: string[];
    outputTokenParameter: "max_tokens" | "max_completion_tokens" | "";
  }): ResolvedModel {
    const providerSlug = slug(args.providerName || args.provider);
    return {
      model: args.model,
      id: `${providerSlug}:${args.model}`,
      name: args.model,
      provider: args.provider,
      providerName: args.providerName,
      priority: args.priority,
      channels: [
        {
          name: args.providerName,
          provider: args.provider,
          priority: args.priority,
        },
      ],
      baseUrl: args.baseUrl,
      apiKey: args.apiKey,
      unsupportedParameters: args.unsupportedParameters,
      outputTokenParameter: args.outputTokenParameter,
    };
  }

  private modelConfigPath(): string {
    return path.resolve(
      process.env.KNOWLLM_MODELS_CONFIG ||
        path.join(getApiRoot(), "env", "models.local.json"),
    );
  }
}

function chatCompletionsUrl(
  model: ResolvedModel,
  options: Pick<RawChatOptions, "response_format">,
): string {
  let baseUrl = model.baseUrl;
  if (usesDeepSeekStrictToolCall(model, options.response_format)) {
    baseUrl = baseUrl.endsWith("/beta") ? baseUrl : `${baseUrl}/beta`;
  }
  return `${baseUrl}/chat/completions`;
}

function formatFetchFailure(err: unknown, url: string): string {
  const target = safeUrlForError(url);
  if (!(err instanceof Error)) return `模型请求失败: ${target}: ${String(err)}`;
  const cause = formatErrorCause(err);
  return `模型请求失败: ${target}: ${err.message}${cause ? ` (${cause})` : ""}`;
}

function formatErrorCause(err: Error): string {
  const cause = (err as Error & { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") return "";
  const record = cause as { code?: unknown; errno?: unknown; syscall?: unknown; message?: unknown };
  return [record.code, record.errno, record.syscall, record.message]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" ");
}

function safeUrlForError(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.replace(/[?].*$/, "");
  }
}

function applyResponseFormat(
  body: Record<string, unknown>,
  model: ResolvedModel,
  format?: RawChatResponseFormat,
): void {
  if (!format) return;
  const provider = model.provider.toLowerCase();
  if (provider === "anthropic" || provider === "claude") {
    applyAnthropicResponseFormat(body, model, format);
    return;
  }
  if (provider === "gemini" || provider === "google") {
    applyGeminiResponseFormat(body, model, format);
    return;
  }
  if (provider === "deepseek") {
    applyDeepSeekResponseFormat(body, model, format);
    return;
  }
  if (model.unsupportedParameters.includes("response_format")) return;
  body.response_format = format;
}

function applyAnthropicResponseFormat(
  body: Record<string, unknown>,
  model: ResolvedModel,
  format: RawChatResponseFormat,
): void {
  if (
    model.unsupportedParameters.includes("output_config") ||
    model.unsupportedParameters.includes("response_format")
  ) {
    return;
  }
  if (format.type === "json_schema") {
    body.output_config = {
      format: {
        type: "json_schema",
        schema: format.json_schema.schema,
      },
    };
    return;
  }
  body.output_config = {
    format: {
      type: "json_schema",
      schema: {
        type: "object",
        additionalProperties: true,
      },
    },
  };
}

function applyGeminiResponseFormat(
  body: Record<string, unknown>,
  model: ResolvedModel,
  format: RawChatResponseFormat,
): void {
  if (
    model.unsupportedParameters.includes("response_format") ||
    model.unsupportedParameters.includes("gemini_response_format")
  ) {
    return;
  }
  if (format.type === "json_schema") {
    body.response_format = {
      type: "text",
      mime_type: "application/json",
      schema: format.json_schema.schema,
    };
    return;
  }
  body.response_format = { type: "json_object" };
}

function applyDeepSeekResponseFormat(
  body: Record<string, unknown>,
  model: ResolvedModel,
  format: RawChatResponseFormat,
): void {
  if (format.type === "json_schema") {
    if (!canUseStrictToolCall(model)) return;
    const name = normalizeToolName(format.json_schema.name);
    body.tools = [
      {
        type: "function",
        function: {
          name,
          description: "Return the response in the required JSON schema.",
          strict: format.json_schema.strict !== false,
          parameters: format.json_schema.schema,
        },
      },
    ];
    body.tool_choice = { type: "function", function: { name } };
    return;
  }
  if (!model.unsupportedParameters.includes("response_format")) {
    body.response_format = { type: "json_object" };
  }
}

function usesDeepSeekStrictToolCall(
  model: ResolvedModel,
  format?: RawChatResponseFormat,
): boolean {
  return (
    model.provider.toLowerCase() === "deepseek" &&
    format?.type === "json_schema" &&
    canUseStrictToolCall(model)
  );
}

function canUseStrictToolCall(model: ResolvedModel): boolean {
  return (
    !model.unsupportedParameters.includes("tools") &&
    !model.unsupportedParameters.includes("tool_choice")
  );
}

function normalizeChatCompletionResponse(
  body: ChatCompletionResponse,
): ChatCompletionResponse {
  for (const choice of body.choices || []) {
    const message = choice.message;
    if (!message) continue;
    const existing = typeof message.content === "string" ? message.content : "";
    if (existing.trim()) continue;
    const toolArguments = firstToolCallArguments(message.tool_calls);
    if (toolArguments) message.content = toolArguments;
  }
  return body;
}

function firstToolCallArguments(toolCalls?: ChatToolCall[]): string {
  for (const call of toolCalls || []) {
    const args = call.function?.arguments;
    if (typeof args === "string" && args.trim()) return args;
  }
  return "";
}

function normalizeToolName(name: string): string {
  const normalized = name
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return normalized || "structured_output";
}

function publicModel({
  baseUrl: _baseUrl,
  apiKey: _apiKey,
  unsupportedParameters: _unsupportedParameters,
  outputTokenParameter: _outputTokenParameter,
  ...model
}: ResolvedModel): ModelOption {
  return model;
}

function normalizeLocalModels(value: unknown): NormalizedLocalModel[] {
  if (!Array.isArray(value)) return [];
  const models = value.flatMap((item): NormalizedLocalModel[] => {
    if (typeof item === "string") {
      const name = item.trim();
      return name ? [{ name, unsupportedParameters: [], outputTokenParameter: "" }] : [];
    }
    const raw =
      item && typeof item === "object" ? (item as LocalModelConfig) : {};
    const name = stringField(raw.name);
    if (!name) return [];
    return [
      {
        name,
        unsupportedParameters: normalizeUnsupportedParameters(
          raw.unsupportedParameters,
        ),
        outputTokenParameter: normalizeOutputTokenParameter(raw.outputTokenParameter),
      },
    ];
  });
  return [...new Map(models.map((model) => [model.name, model])).values()];
}

function normalizeOutputTokenParameter(value: unknown): "max_tokens" | "max_completion_tokens" | "" {
  const parameter = stringField(value);
  return parameter === "max_tokens" || parameter === "max_completion_tokens" ? parameter : "";
}

function normalizeUnsupportedParameters(value: unknown): string[] {
  return unique(
    Array.isArray(value)
      ? value.map((parameter) => stringField(parameter))
      : [],
  );
}

function unique(values: Array<string | undefined>): string[] {
  return [
    ...new Set(
      values.map((value) => String(value || "").trim()).filter(Boolean),
    ),
  ];
}

function firstNonEmpty(values: Array<string | undefined>): string {
  return String(
    values.find((value) => String(value || "").trim()) || "",
  ).trim();
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberField(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function envValue(name: string): string {
  return name ? String(process.env[name] || "").trim() : "";
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function slug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "provider";
}
