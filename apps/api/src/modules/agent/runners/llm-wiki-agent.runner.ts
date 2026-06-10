import { Injectable } from "@nestjs/common";
import { stripFrontmatter } from "../../../common/text";
import { LlmWikiSearchService } from "../../llmWiki/services/llm-wiki-search.service";
import { LlmWikiStoreService } from "../../llmWiki/services/llm-wiki-store.service";
import { ModelService } from "../../model/model.service";
import type { AgentRunner, AgentRunnerContext, AgentRunnerResult } from "../agent.types";

interface LlmWikiAgentInput extends Record<string, unknown> {
  query: string;
  limit: number;
  model?: string;
}

@Injectable()
export class LlmWikiAgentRunner implements AgentRunner<LlmWikiAgentInput> {
  readonly agentType = "llmWiki";

  constructor(
    private readonly search: LlmWikiSearchService,
    private readonly store: LlmWikiStoreService,
    private readonly model: ModelService
  ) {}

  getProfile() {
    return {
      agentType: this.agentType,
      label: "LLM Wiki Agent",
      description: "基于本地 LLM Wiki 检索结果回答问题"
    };
  }

  getDefaults(): Record<string, unknown> {
    return {
      query: "",
      limit: 8,
      model: this.model.resolveLlmWikiModel(),
      modelOptions: this.model.listModels()
    };
  }

  validateInput(input: unknown): LlmWikiAgentInput {
    const raw = isRecord(input) ? input : {};
    const query = String(raw.query || raw.goal || "").trim();
    if (!query) throw new Error("query 不能为空");
    const limit = Math.min(Math.max(Number(raw.limit) || 8, 1), 20);
    const model = typeof raw.model === "string" ? raw.model.trim() : undefined;
    return { query, limit, model };
  }

  title(input: LlmWikiAgentInput): string {
    return input.query.slice(0, 120);
  }

  async start(ctx: AgentRunnerContext<LlmWikiAgentInput>): Promise<AgentRunnerResult> {
    ctx.appendEvent({ type: "search", msg: "检索 LLM Wiki", query: ctx.input.query });
    const search = this.search.search(ctx.input.query, ctx.input.limit);
    const pages = search.hits.map((hit) => this.store.getPage(hit.path));
    if (!pages.length) {
      return {
        status: "insufficient",
        content: `# 证据不足\n\n本地 LLM Wiki 没有检索到和「${ctx.input.query}」直接相关的页面。\n`,
        resultJson: { query: ctx.input.query, hits: [] }
      };
    }

    const evidence = pages.map((page, index) => ({
      index: index + 1,
      path: page.path,
      title: page.title,
      sources: page.sources,
      content: stripFrontmatter(page.content).slice(0, 5000)
    }));

    if (this.model.hasConfiguredModel()) {
      try {
        ctx.appendEvent({ type: "model", msg: "调用模型综合答案" });
        const answer = await this.model.complete({
          model: ctx.input.model || this.model.resolveLlmWikiModel(),
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content: "你是 KnowLLM 的 LLM Wiki Agent。只能基于给定 evidence 回答，缺证据必须说明。用中文，答案要标注引用的 wiki path。"
            },
            {
              role: "user",
              content: JSON.stringify({ query: ctx.input.query, evidence }, null, 2)
            }
          ],
          signal: ctx.signal
        });
        return {
          status: "success",
          content: answer.trim() || fallbackAnswer(ctx.input.query, evidence),
          resultJson: { query: ctx.input.query, hits: search.hits, evidence }
        };
      } catch (error) {
        ctx.appendEvent({
          type: "model_error",
          msg: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      status: "success",
      content: fallbackAnswer(ctx.input.query, evidence),
      resultJson: { query: ctx.input.query, hits: search.hits, evidence }
    };
  }
}

function fallbackAnswer(
  query: string,
  evidence: Array<{ path: string; title: string; sources: string[]; content: string }>
): string {
  return [
    `# ${query}`,
    "",
    "当前未配置可用模型，以下是基于本地 Wiki 检索的直接证据摘录：",
    "",
    ...evidence.flatMap((item) => [
      `## ${item.title}`,
      "",
      `- path: \`${item.path}\``,
      `- sources: ${item.sources.length ? item.sources.join(", ") : "无"}`,
      "",
      item.content.slice(0, 1200),
      ""
    ])
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
