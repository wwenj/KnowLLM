import { Injectable } from "@nestjs/common";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | string;
  content: unknown;
}

export interface ChatOptions {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  responseFormat?: { type: "json_object" };
  signal?: AbortSignal;
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

export interface ModelStreamChunk {
  type: "stream" | "thinking";
  content: string;
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
      process.env.LLM_WIKI_MODEL,
      process.env.SESSION_DEFAULT_MODEL
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

  resolveModel(explicit?: string): string {
    return (
      String(explicit || "").trim() ||
      String(process.env.OPENAI_MODEL || "").trim() ||
      String(process.env.MODEL || "").trim() ||
      String(process.env.LLM_WIKI_MODEL || "").trim() ||
      String(process.env.SESSION_DEFAULT_MODEL || "").trim()
    );
  }

  resolveLlmWikiModel(): string {
    return (
      String(process.env.LLM_WIKI_MODEL || "").trim() ||
      this.resolveModel("")
    );
  }

  resolveSessionModel(explicit?: string): string {
    return (
      String(explicit || "").trim() ||
      String(process.env.SESSION_DEFAULT_MODEL || "").trim() ||
      this.resolveModel("")
    );
  }

  async complete(options: ChatOptions): Promise<string> {
    const response = await this.request(options, false);
    const payload = (await response.json()) as ChatCompletionResponse;
    return extractContent(payload);
  }

  async *stream(options: ChatOptions): AsyncGenerator<ModelStreamChunk> {
    try {
      const response = await this.request(options, true);
      if (!response.body) throw new Error("模型流式响应缺少响应体");

      const decoder = new TextDecoder();
      let buffer = "";
      for await (const raw of response.body as unknown as AsyncIterable<Uint8Array>) {
        if (options.signal?.aborted) return;
        buffer += decoder.decode(raw, { stream: true });
        const parsed = consumeSseBuffer(buffer);
        buffer = parsed.rest;
        yield* parsed.chunks;
      }
      const final = consumeSseBuffer(`${buffer}\n`);
      yield* final.chunks;
    } catch (error) {
      if (options.signal?.aborted) return;
      throw error;
    }
  }

  private async request(options: ChatOptions, stream: boolean): Promise<Response> {
    const model = this.resolveModel(options.model);
    const key = this.apiKey();
    if (!model) throw new Error("未配置模型名称");
    if (!key) throw new Error("未配置 OPENAI_API_KEY");

    const body: Record<string, unknown> = {
      model,
      messages: options.messages,
      temperature: options.temperature ?? 0.2,
      stream
    };
    if (options.responseFormat) body.response_format = options.responseFormat;

    const response = await fetch(`${this.baseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`
      },
      body: JSON.stringify(body),
      signal: options.signal
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

function extractContent(payload: ChatCompletionResponse): string {
  const choice = payload.choices?.[0];
  const content = choice?.message?.content ?? choice?.text;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text || "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

function parseStreamChunk(raw: string): { content: string; thinking: string } {
  try {
    const payload = JSON.parse(raw) as {
      choices?: Array<{
        delta?: {
          content?: unknown;
          reasoning_content?: unknown;
        };
      }>;
    };
    const delta = payload.choices?.[0]?.delta;
    return {
      content: normalizeText(delta?.content),
      thinking: normalizeText(delta?.reasoning_content)
    };
  } catch {
    return { content: "", thinking: "" };
  }
}

function consumeSseBuffer(buffer: string): { chunks: ModelStreamChunk[]; rest: string } {
  const lines = buffer.split(/\r?\n/);
  const rest = lines.pop() || "";
  const chunks: ModelStreamChunk[] = [];
  for (const line of lines) {
    const text = line.trim();
    if (!text.startsWith("data:")) continue;
    const data = text.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    const chunk = parseStreamChunk(data);
    if (chunk.thinking) chunks.push({ type: "thinking", content: chunk.thinking });
    if (chunk.content) chunks.push({ type: "stream", content: chunk.content });
  }
  return { chunks, rest };
}

function normalizeText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(normalizeText).join("");
  }
  if (value && typeof value === "object" && "text" in value) {
    return String((value as { text?: unknown }).text || "");
  }
  return "";
}
