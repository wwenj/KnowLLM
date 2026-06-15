import { Injectable } from "@nestjs/common";
import { LlmWikiRetrievalService } from "../../../llmWiki/services/llm-wiki-retrieval.service";

@Injectable()
export class LlmWikiAgentTools {
  constructor(private readonly retrieval: LlmWikiRetrievalService) {}

  getManifest() {
    return this.retrieval.getManifest();
  }

  searchWiki(query: string, limit?: number) {
    return this.retrieval.search(query, limit);
  }

  readWikiPage(path: string) {
    return this.retrieval.readPage(path);
  }

  readRawSource(sourceId: string) {
    return this.retrieval.readSource(sourceId);
  }
}
