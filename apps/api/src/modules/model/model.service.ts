import { Injectable } from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";
import { getApiRoot } from "../../config/env";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | string;
  content: unknown;
}

export interface RawChatOptions {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  response_format?: { type: "json_object" };
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
      reasoning_content?: unknown;
    };
    text?: unknown;
  }>;
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
}

interface LocalModelConfig {
  name?: unknown;
  unsupportedParameters?: unknown;
}

interface NormalizedLocalModel {
  name: string;
  unsupportedParameters: string[];
}

interface ResolvedModel extends ModelOption {
  baseUrl: string;
  apiKey: string;
  unsupportedParameters: string[];
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
    return (await response.json()) as ChatCompletionResponse;
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
    if (
      options.response_format &&
      !resolved.unsupportedParameters.includes("response_format")
    ) {
      body.response_format = options.response_format;
    }

    const response = await fetch(`${resolved.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${resolved.apiKey}`,
      },
      body: JSON.stringify(body),
    });
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
    };
  }

  private modelConfigPath(): string {
    return path.resolve(
      process.env.KNOWLLM_MODELS_CONFIG ||
        path.join(getApiRoot(), "env", "models.local.json"),
    );
  }
}

function publicModel({
  baseUrl: _baseUrl,
  apiKey: _apiKey,
  unsupportedParameters: _unsupportedParameters,
  ...model
}: ResolvedModel): ModelOption {
  return model;
}

function normalizeLocalModels(value: unknown): NormalizedLocalModel[] {
  if (!Array.isArray(value)) return [];
  const models = value.flatMap((item): NormalizedLocalModel[] => {
    if (typeof item === "string") {
      const name = item.trim();
      return name ? [{ name, unsupportedParameters: [] }] : [];
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
      },
    ];
  });
  return [...new Map(models.map((model) => [model.name, model])).values()];
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
