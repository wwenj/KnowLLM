import { Injectable } from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";
import { getApiRoot } from "../../config/env";

export interface ModelMessage {
  role: "system" | "user" | "assistant" | string;
  content: unknown;
}
export type JsonSchema = Record<string, unknown>;

export type ResponseTextFormat =
  | { type: "json_object" }
  | {
      type: "json_schema";
      name: string;
      strict?: boolean;
      schema: JsonSchema;
    };

export interface ResponseRequestOptions {
  model?: string;
  messages: ModelMessage[];
  textFormat?: ResponseTextFormat;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  onRequest?: (request: { url: string; body: Record<string, unknown> }) => void;
  onResponse?: (response: unknown) => void;
}

export interface ModelResponse extends Record<string, unknown> {
  id: string;
  model: string;
  status: string;
  content: string;
  output: unknown[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    [key: string]: unknown;
  };
}

export type ModelErrorCategory =
  | "timeout"
  | "network"
  | "rate_limit"
  | "quota"
  | "auth"
  | "invalid_request"
  | "server"
  | "invalid_response"
  | "incomplete"
  | "refusal"
  | "cancelled"
  | "unknown";

export interface ModelRequestErrorOptions {
  status?: number;
  type?: string;
  code?: string;
  param?: string;
  requestId?: string;
  retryAfterMs?: number;
  category: ModelErrorCategory;
  retryable: boolean;
  usage?: ModelResponse["usage"];
  cause?: unknown;
}

export class ModelRequestError extends Error {
  readonly status?: number;
  readonly type?: string;
  readonly code?: string;
  readonly param?: string;
  readonly requestId?: string;
  readonly retryAfterMs?: number;
  readonly category: ModelErrorCategory;
  readonly retryable: boolean;
  readonly usage?: ModelResponse["usage"];

  constructor(message: string, options: ModelRequestErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ModelRequestError";
    this.status = options.status;
    this.type = options.type;
    this.code = options.code;
    this.param = options.param;
    this.requestId = options.requestId;
    this.retryAfterMs = options.retryAfterMs;
    this.category = options.category;
    this.retryable = options.retryable;
    this.usage = options.usage;
  }
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
}

interface LocalModelConfig {
  name?: unknown;
}

interface NormalizedLocalModel {
  name: string;
}

interface ResolvedModel extends ModelOption {
  baseUrl: string;
  apiKey: string;
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
      ]),
    );
    if (envModel) return envModel.id;
    return this.loadModels()[0]?.id || "";
  }

  async respond(options: ResponseRequestOptions): Promise<ModelResponse> {
    return this.requestResponses(options);
  }

  private async requestResponses(
    options: ResponseRequestOptions,
  ): Promise<ModelResponse> {
    const resolved = this.resolveModelForRequest(options.model);
    if (!resolved) {
      throw new ModelRequestError("未配置可用模型", {
        category: "invalid_request",
        retryable: false,
      });
    }
    if (resolved.provider.toLowerCase() !== "openai") {
      throw new ModelRequestError(`模型 ${resolved.id} 不是 OpenAI Provider`, {
        category: "invalid_request",
        retryable: false,
      });
    }

    const { instructions, input } = responseInput(options.messages);
    const body: Record<string, unknown> = {
      model: resolved.model,
      input,
      store: false,
    };
    if (instructions) body.instructions = instructions;
    if (
      Number.isInteger(options.maxOutputTokens) &&
      Number(options.maxOutputTokens) > 0
    ) {
      body.max_output_tokens = Number(options.maxOutputTokens);
    }
    if (options.textFormat) body.text = { format: options.textFormat };

    let response: Response;
    const url = `${resolved.baseUrl}/responses`;
    options.onRequest?.({ url: safeUrlForError(url), body });
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
      const aborted = isAbortError(err);
      const timedOut = isTimeoutError(err);
      throw new ModelRequestError(formatFetchFailure(err, url), {
        category: timedOut ? "timeout" : aborted ? "cancelled" : "network",
        retryable: timedOut || !aborted,
        cause: err,
      });
    }
    if (!response.ok) {
      const text = await response.text();
      throw httpModelError(response, text);
    }
    let raw: Record<string, unknown>;
    try {
      const value = (await response.json()) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("响应顶层不是对象");
      }
      raw = value as Record<string, unknown>;
    } catch (error) {
      throw new ModelRequestError(
        `Responses API 返回非法 JSON: ${errorMessage(error)}`,
        {
          status: response.status,
          requestId: responseRequestId(response),
          category: "invalid_response",
          retryable: true,
          cause: error,
        },
      );
    }
    options.onResponse?.(raw);
    return normalizeResponse(raw, responseRequestId(response));
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
    if (provider.toLowerCase() !== "openai") return [];
    const baseUrl = normalizeBaseUrl(stringField(raw.baseUrl));
    const apiKey =
      stringField(raw.apiKey) || envValue(stringField(raw.apiKeyEnv));
    const models = normalizeLocalModels(raw.models);
    if (!baseUrl || !apiKey || !models.length) return [];
    const priority = numberField(raw.priority, 0);
    return models.map((model, modelIndex) =>
      this.toResolvedModel({
        providerName,
        provider,
        baseUrl,
        apiKey,
        model: model.name,
        priority,
        index: index * 1000 + modelIndex,
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
    };
  }

  private modelConfigPath(): string {
    return path.resolve(
      process.env.KNOWLLM_MODELS_CONFIG ||
        path.join(getApiRoot(), "env", "models.local.json"),
    );
  }
}

function responseInput(messages: ModelMessage[]): {
  instructions: string;
  input: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const instructions: string[] = [];
  const input: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const message of messages) {
    const content = messageContent(message.content);
    if (!content) continue;
    if (message.role === "system" || message.role === "developer") {
      instructions.push(content);
      continue;
    }
    input.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content,
    });
  }
  if (!input.length) throw new Error("Responses API input 不能为空");
  return { instructions: instructions.join("\n\n"), input };
}

function messageContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

function normalizeResponse(
  raw: Record<string, unknown>,
  requestId?: string,
): ModelResponse {
  const usage = normalizeUsage(raw.usage);
  const responseErrorDetails = apiErrorDetails(raw.error);
  if (responseErrorDetails.message) {
    const classification = classifyModelError(undefined, responseErrorDetails);
    throw new ModelRequestError(
      `Responses API 返回错误: ${responseErrorDetails.message}`,
      { ...responseErrorDetails, ...classification, requestId, usage },
    );
  }
  const status = stringField(raw.status);
  if (status && status !== "completed") {
    const incomplete = apiErrorDetails(raw.incomplete_details);
    const reason = incomplete.code || incomplete.message;
    throw new ModelRequestError(
      `Responses API 未完成: ${status}${reason ? ` (${reason})` : ""}`,
      {
        type: status,
        code: reason,
        requestId,
        category: "incomplete",
        retryable: false,
        usage,
      },
    );
  }
  const output = Array.isArray(raw.output) ? raw.output : [];
  const content = outputText(output);
  if (!content.trim()) {
    const refusal = outputRefusal(output);
    throw new ModelRequestError(
      refusal ? `模型拒绝回答: ${refusal}` : "Responses API 未返回文本内容",
      {
        category: refusal ? "refusal" : "invalid_response",
        retryable: !refusal,
        requestId,
        usage,
      },
    );
  }
  return {
    ...raw,
    id: stringField(raw.id),
    model: stringField(raw.model),
    status: status || "completed",
    content,
    output,
    usage,
  };
}

function outputText(output: unknown[]): string {
  const texts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rawItem = item as Record<string, unknown>;
    if (rawItem.type !== "message" || !Array.isArray(rawItem.content)) continue;
    for (const part of rawItem.content) {
      if (!part || typeof part !== "object" || Array.isArray(part)) continue;
      const rawPart = part as Record<string, unknown>;
      if (rawPart.type === "output_text" && typeof rawPart.text === "string") {
        texts.push(rawPart.text);
      }
    }
  }
  return texts.join("");
}

function outputRefusal(output: unknown[]): string {
  for (const item of output) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object" || Array.isArray(part)) continue;
      const raw = part as Record<string, unknown>;
      if (raw.type === "refusal" && typeof raw.refusal === "string") {
        return raw.refusal;
      }
    }
  }
  return "";
}

function normalizeUsage(value: unknown): ModelResponse["usage"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  return {
    ...raw,
    input_tokens: nonNegativeInteger(raw.input_tokens),
    output_tokens: nonNegativeInteger(raw.output_tokens),
    total_tokens: nonNegativeInteger(raw.total_tokens),
  };
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

interface ApiErrorDetails {
  message?: string;
  type?: string;
  code?: string;
  param?: string;
}

const QUOTA_ERROR_CODES = new Set([
  "insufficient_quota",
  "billing_hard_limit_reached",
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
]);

function apiErrorDetails(value: unknown): ApiErrorDetails {
  if (!value) return {};
  if (typeof value === "string") return { message: value };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { message: String(value) };
  }
  const raw = value as Record<string, unknown>;
  const code = stringField(raw.code) || stringField(raw.reason);
  return {
    message: stringField(raw.message) || code || JSON.stringify(raw),
    type: stringField(raw.type) || undefined,
    code: code || undefined,
    param: stringField(raw.param) || undefined,
  };
}

function httpModelError(response: Response, text: string): ModelRequestError {
  let details: ApiErrorDetails = {};
  try {
    const raw = JSON.parse(text) as unknown;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const record = raw as Record<string, unknown>;
      details = apiErrorDetails(record.error ?? raw);
    }
  } catch {
    details = { message: text.trim().slice(0, 300) };
  }
  const classification = classifyModelError(response.status, details);
  const message = details.message || response.statusText || "未知错误";
  return new ModelRequestError(`模型调用失败: ${response.status} ${message}`, {
    status: response.status,
    type: details.type,
    code: details.code,
    param: details.param,
    requestId: responseRequestId(response),
    retryAfterMs: retryAfterMs(response.headers.get("retry-after")),
    ...classification,
  });
}

function classifyModelError(
  status: number | undefined,
  details: ApiErrorDetails,
): Pick<ModelRequestErrorOptions, "category" | "retryable"> {
  const code = String(details.code || "").toLowerCase();
  const type = String(details.type || "").toLowerCase();
  if (QUOTA_ERROR_CODES.has(code) || type === "insufficient_quota") {
    return { category: "quota", retryable: false };
  }
  if (
    status === 401 ||
    status === 403 ||
    type === "authentication_error" ||
    type === "permission_error"
  ) {
    return { category: "auth", retryable: false };
  }
  if (status === 429 || type === "rate_limit_error") {
    return { category: "rate_limit", retryable: true };
  }
  if (status === 408 || status === 409 || (status !== undefined && status >= 500)) {
    return { category: "server", retryable: true };
  }
  if (type === "server_error" || type === "api_error") {
    return { category: "server", retryable: true };
  }
  if (
    status === 400 ||
    status === 404 ||
    status === 422 ||
    type === "invalid_request_error" ||
    code === "context_length_exceeded"
  ) {
    return { category: "invalid_request", retryable: false };
  }
  return { category: "unknown", retryable: false };
}

function responseRequestId(response: Response): string | undefined {
  return (
    response.headers.get("x-request-id") ||
    response.headers.get("request-id") ||
    undefined
  );
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return undefined;
  return Math.max(0, at - Date.now());
}

function isAbortError(value: unknown): boolean {
  return (
    value instanceof Error &&
    (value.name === "AbortError" || value.name === "TimeoutError")
  );
}

function isTimeoutError(value: unknown): boolean {
  return value instanceof Error && value.name === "TimeoutError";
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
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

function publicModel({
  baseUrl: _baseUrl,
  apiKey: _apiKey,
  ...model
}: ResolvedModel): ModelOption {
  return model;
}

function normalizeLocalModels(value: unknown): NormalizedLocalModel[] {
  if (!Array.isArray(value)) return [];
  const models = value.flatMap((item): NormalizedLocalModel[] => {
    if (typeof item === "string") {
      const name = item.trim();
      return name ? [{ name }] : [];
    }
    const raw =
      item && typeof item === "object" ? (item as LocalModelConfig) : {};
    const name = stringField(raw.name);
    if (!name) return [];
    return [{ name }];
  });
  return [...new Map(models.map((model) => [model.name, model])).values()];
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
