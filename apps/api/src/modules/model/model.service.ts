import { Injectable } from "@nestjs/common";

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

@Injectable()
export class ModelService {
  listModels(): Array<{
    model: string;
    id: string;
    name: string;
    provider: string;
    channels: Array<{ name: string; provider: string; priority: number }>;
  }> {
    const configured = unique([
      process.env.OPENAI_MODEL,
      process.env.MODEL,
      process.env.LLM_WIKI_MODEL
    ]);
    const models = configured.length ? configured : ["local-fallback"];
    return models.map((model) => ({
      model,
      id: model,
      name: model,
      provider: configured.length ? "openai-compatible" : "local",
      channels: [
        {
          name: configured.length ? "env" : "local",
          provider: configured.length ? "openai-compatible" : "local",
          priority: 1
        }
      ]
    }));
  }

  hasConfiguredModel(): boolean {
    return Boolean(this.apiKey() && this.resolveModel(""));
  }

  findModel(model: string): { model: string } | null {
    const target = String(model || "").trim();
    if (!target) return null;
    return this.listModels().find((item) => item.model === target) || null;
  }

  resolveModel(explicit?: string): string {
    return (
      String(explicit || "").trim() ||
      String(process.env.OPENAI_MODEL || "").trim() ||
      String(process.env.MODEL || "").trim() ||
      String(process.env.LLM_WIKI_MODEL || "").trim()
    );
  }

  async chat(options: RawChatOptions): Promise<ChatCompletionResponse> {
    const response = await this.request(options);
    return (await response.json()) as ChatCompletionResponse;
  }

  private async request(options: RawChatOptions): Promise<Response> {
    const model = this.resolveModel(options.model);
    const key = this.apiKey();
    if (!model) throw new Error("未配置模型名称");
    if (!key) throw new Error("未配置 OPENAI_API_KEY");

    const body: Record<string, unknown> = {
      model,
      messages: options.messages,
      temperature: options.temperature ?? 0.2,
      stream: false
    };
    if (options.response_format) body.response_format = options.response_format;

    const response = await fetch(`${this.baseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`模型调用失败: ${response.status} ${text.slice(0, 300)}`);
    }
    return response;
  }

  private baseUrl(): string {
    return String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  }

  private apiKey(): string {
    return String(process.env.OPENAI_API_KEY || "").trim();
  }
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}
