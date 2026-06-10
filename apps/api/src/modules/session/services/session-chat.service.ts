import { Injectable } from "@nestjs/common";
import { stripFrontmatter } from "../../../common/text";
import { LlmWikiSearchService } from "../../llmWiki/services/llm-wiki-search.service";
import { LlmWikiStoreService } from "../../llmWiki/services/llm-wiki-store.service";
import { type ChatMessage, ModelService } from "../../model/model.service";
import type { SessionMessageRecord } from "./session-store.service";

export type SessionChatChunk =
  | { type: "thinking"; content: string }
  | { type: "stream"; content: string };

export type SessionChatRoute = "chat" | "llmWiki";

export interface SessionChatResult {
  content: string;
  thinking: string;
  steps: Array<{ node: string; ms: number; status: "success" | "error" | "skipped" }>;
}

@Injectable()
export class SessionChatService {
  constructor(
    private readonly model: ModelService,
    private readonly search: LlmWikiSearchService,
    private readonly store: LlmWikiStoreService
  ) {}

  async *streamReply(args: {
    route: SessionChatRoute;
    content: string;
    history: SessionMessageRecord[];
    model: string;
    signal?: AbortSignal;
  }): AsyncGenerator<SessionChatChunk | { type: "done"; result: SessionChatResult }, void, void> {
    const started = Date.now();
    const history = toModelHistory(args.history);

    if (args.route === "llmWiki") {
      const retrievalThinking = "正在检索本地 LLM Wiki...\n";
      yield { type: "thinking", content: retrievalThinking };
      const result = yield* this.streamWiki(args.content, history, args.model, args.signal);
      yield {
        type: "done",
        result: {
          ...result,
          thinking: `${retrievalThinking}${result.thinking}`,
          steps: [{ node: "llmWiki", ms: Date.now() - started, status: "success" }]
        }
      };
      return;
    }

    const result = yield* this.streamBasic(history, args.model, args.signal);
    yield {
      type: "done",
      result: {
        ...result,
        steps: [{ node: "chat", ms: Date.now() - started, status: "success" }]
      }
    };
  }

  private async *streamWiki(
    content: string,
    history: ChatMessage[],
    model: string,
    signal?: AbortSignal
  ): AsyncGenerator<SessionChatChunk, SessionChatResult, void> {
    const search = this.search.search(content, 6);
    const pages = search.hits.map((hit) => this.store.getPage(hit.path));
    if (!pages.length) {
      return yield* emitFallback(`本地 LLM Wiki 没有检索到和「${content}」直接相关的内容。`, signal);
    }

    const evidence = pages.map((page) => ({
      path: page.path,
      title: page.title,
      sources: page.sources,
      content: stripFrontmatter(page.content).slice(0, 3000)
    }));
    if (!this.model.hasConfiguredModel() || model === "local-fallback") {
      return yield* emitFallback(fallbackWikiAnswer(content, evidence), signal);
    }

    return yield* this.streamModel(
      {
        model: this.model.resolveSessionModel(model),
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: "你是 KnowLLM Chat 的 LLM Wiki 模式。只能基于 evidence 回答，缺证据就说明。回答要简洁并标注 wiki path。"
          },
          {
            role: "system",
            content: `本轮检索 evidence：\n${JSON.stringify(evidence, null, 2)}`
          },
          ...history
        ],
        signal
      },
      signal
    );
  }

  private async *streamBasic(
    history: ChatMessage[],
    model: string,
    signal?: AbortSignal
  ): AsyncGenerator<SessionChatChunk, SessionChatResult, void> {
    if (!this.model.hasConfiguredModel() || model === "local-fallback") {
      return yield* emitFallback(
        "当前未配置外部模型。请选择 LLM Wiki 工具可基于本地 Wiki 检索回答，或在 `apps/api/env/.env.development` 配置模型环境变量。",
        signal
      );
    }

    return yield* this.streamModel(
      {
        model: this.model.resolveSessionModel(model),
        temperature: 0.2,
        messages: [
          { role: "system", content: "你是 KnowLLM 的基础 Chat 助手。直接、准确、用中文回答。" },
          ...history
        ],
        signal
      },
      signal
    );
  }

  private async *streamModel(
    options: Parameters<ModelService["stream"]>[0],
    signal?: AbortSignal
  ): AsyncGenerator<SessionChatChunk, SessionChatResult, void> {
    const content: string[] = [];
    const thinking: string[] = [];
    for await (const chunk of this.model.stream(options)) {
      if (signal?.aborted) break;
      if (chunk.type === "thinking") thinking.push(chunk.content);
      else content.push(chunk.content);
      yield chunk;
    }
    return {
      content: content.join("") || "模型没有返回有效内容。",
      thinking: thinking.join(""),
      steps: []
    };
  }
}

export function parseSessionRoute(content: string): { type: SessionChatRoute; content: string } {
  const match = content.match(/^\s*\[assistant:([^\]]+)]\s*([\s\S]*)$/);
  if (match?.[1] === "llmWiki") return { type: "llmWiki", content: match[2].trim() };
  return { type: "chat", content: stripRoutePrefix(content) };
}

function toModelHistory(messages: SessionMessageRecord[]): ChatMessage[] {
  return messages.map((message) => ({
    role: message.role === "agent" ? "assistant" : "user",
    content: stripRoutePrefix(message.content)
  }));
}

function stripRoutePrefix(content: string): string {
  return content.replace(/^\s*\[assistant:[^\]]+]\s*/, "").trim();
}

function fallbackWikiAnswer(
  question: string,
  evidence: Array<{ path: string; title: string; sources: string[]; content: string }>
): string {
  return [
    `基于本地 LLM Wiki 对「${question}」的检索结果：`,
    "",
    ...evidence.flatMap((item) => [
      `### ${item.title}`,
      "",
      `path: \`${item.path}\`；sources: ${item.sources.length ? item.sources.join(", ") : "无"}`,
      "",
      item.content.slice(0, 900),
      ""
    ])
  ].join("\n");
}

async function* emitFallback(
  content: string,
  signal?: AbortSignal
): AsyncGenerator<SessionChatChunk, SessionChatResult, void> {
  if (!signal?.aborted) yield { type: "stream", content };
  return { content, thinking: "", steps: [] };
}
