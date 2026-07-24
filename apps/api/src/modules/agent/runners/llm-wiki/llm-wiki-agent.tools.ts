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

  getCatalog() {
    return this.tools.getCatalog();
  }

  searchWiki(query: string) {
    return this.tools.searchWiki(query);
  }

  readPage(pageKey: string) {
    return this.tools.readPage(pageKey);
  }

  traceSource(input: SourceTraceInput) {
    return this.sourceTrace.run(input);
  }
}
