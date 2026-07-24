import { Injectable } from "@nestjs/common";
import { LlmWikiNextToolsService } from "../../../llmWikiNext/llm-wiki-next-tools.service";

/** Agent 只通过这一层访问已发布的新版 Wiki Tool 契约。 */
@Injectable()
export class LlmWikiAgentTools {
  constructor(private readonly tools: LlmWikiNextToolsService) {}

  getCatalog() {
    return this.tools.getCatalog();
  }

  searchWiki(query: string) {
    return this.tools.searchWiki(query);
  }

  readPage(pageKey: string) {
    return this.tools.readPage(pageKey);
  }

  readSource(sourceId: string, startLine?: number, endLine?: number) {
    return this.tools.readSource(sourceId, startLine, endLine);
  }
}
