import { Injectable } from "@nestjs/common";
import { LlmWikiNextToolsService } from "../../../llmWikiNext/llm-wiki-next-tools.service";
import type { SourceTraceInput } from "./llm-wiki-agent.types";
import { LlmWikiSourceTraceTool } from "./llm-wiki-source-trace.tool";

/** Agent 只通过这一层访问已发布的新版 Wiki Tool 契约。 */
@Injectable()
export class LlmWikiAgentTools {
  constructor(
    private readonly tools: LlmWikiNextToolsService,
    private readonly sourceTrace: LlmWikiSourceTraceTool,
  ) {}

  getCatalog(knowledgeBaseId = "default") {
    return this.tools.getCatalog(knowledgeBaseId);
  }

  searchWiki(knowledgeBaseIdOrQuery: string, maybeQuery?: string) {
    return maybeQuery === undefined
      ? this.tools.searchWiki(knowledgeBaseIdOrQuery)
      : this.tools.searchWiki(knowledgeBaseIdOrQuery, maybeQuery);
  }

  readPage(knowledgeBaseIdOrPageKey: string, maybePageKey?: string) {
    return maybePageKey === undefined
      ? this.tools.readPage(knowledgeBaseIdOrPageKey)
      : this.tools.readPage(knowledgeBaseIdOrPageKey, maybePageKey);
  }

  traceSource(input: SourceTraceInput) {
    return this.sourceTrace.run(input);
  }
}
