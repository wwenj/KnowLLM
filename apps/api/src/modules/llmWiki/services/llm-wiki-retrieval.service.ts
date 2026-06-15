import { Injectable } from "@nestjs/common";
import type {
  LlmWikiRetrievalManifest,
  LlmWikiRetrievedPage,
  LlmWikiRetrievedSource,
  LlmWikiSearchResult,
} from "../contracts/llm-wiki-retrieval.types";
import { assertWikiMarkdownPath, extractWikiPagePaths } from "../llm-wiki-page.utils";
import { LlmWikiSchemaService } from "./llm-wiki-schema.service";
import { LlmWikiSearchService } from "./llm-wiki-search.service";
import { LlmWikiStoreService } from "./llm-wiki-store.service";

@Injectable()
export class LlmWikiRetrievalService {
  constructor(
    private readonly store: LlmWikiStoreService,
    private readonly searchService: LlmWikiSearchService,
    private readonly schema: LlmWikiSchemaService,
  ) {}

  getManifest(): LlmWikiRetrievalManifest {
    const sources = this.store.listSources();
    const pages = this.store.tree().groups.flatMap((group) => group.pages);
    let index = "";
    if (this.store.pageExists("index.md")) index = this.store.getPage("index.md").content;
    return {
      stats: {
        sourceCount: sources.length,
        readySources: sources.filter((source) => source.status === "ready").length,
        pageCount: pages.length,
      },
      schema: this.schema.read(),
      index,
      pages,
      sources: sources.map(({ source_id, filename, status, touched_pages, sha256, ingested_at }) => ({
        source_id,
        filename,
        status,
        touched_pages,
        sha256,
        ingested_at,
      })),
    };
  }

  search(query: string, limit?: number): LlmWikiSearchResult {
    return this.searchService.search(query, limit);
  }

  readPage(path: string): LlmWikiRetrievedPage {
    assertWikiMarkdownPath(path);
    const page = this.store.getPage(path);
    return { ...page, links: extractWikiPagePaths(page.content) };
  }

  readSource(sourceId: string): LlmWikiRetrievedSource {
    const meta = this.store.getSource(sourceId);
    return {
      source_id: meta.source_id,
      filename: meta.filename,
      content: this.store.readSource(meta.source_id),
    };
  }
}
