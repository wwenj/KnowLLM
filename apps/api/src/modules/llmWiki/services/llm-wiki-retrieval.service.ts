import { Injectable } from "@nestjs/common";
import type {
  LlmWikiRetrievalManifest,
  LlmWikiRetrievedPage,
  LlmWikiRetrievedSource,
  LlmWikiSearchResult,
} from "../contracts/llm-wiki-retrieval.types";
import type { LlmWikiFact, LlmWikiPageClaims } from "../contracts/llm-wiki.types";
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
    const pageClaims = this.store.listPageClaims();
    const facts = this.store.listFacts();
    let index = "";
    if (this.store.pageExists("index.md")) index = this.store.getPage("index.md").content;
    return {
      stats: {
        sourceCount: sources.length,
        readySources: sources.filter((source) => source.status === "published" || source.status === "ready").length,
        pageCount: pages.length,
        factCount: facts.length,
        pageClaimCount: pageClaims.length,
      },
      schema: this.schema.read(),
      index,
      pages,
      pageClaims: pageClaims.map((claim) => ({
        path: claim.path,
        factCount: claim.factIds.length,
        sourceIds: claim.sourceIds,
      })),
      facts: sources.map((source) => ({
        sourceId: source.source_id,
        count: this.store.readFactLedger(source.source_id)?.facts.length || 0,
      })),
      sources: sources.map(({ source_id, filename, status, touched_pages, sha256, ingested_at, latest_candidate_id }) => {
        let candidate: ReturnType<LlmWikiStoreService["readCompileCandidate"]> | null = null;
        if (latest_candidate_id) {
          try {
            candidate = this.store.readCompileCandidate(latest_candidate_id);
          } catch {
            candidate = null;
          }
        }
        return {
          source_id,
          filename,
          status,
          touched_pages,
          sha256,
          ingested_at,
          compiler_version: candidate?.compilerVersion || "",
          prompt_version: candidate?.promptVersion || "",
          compile_model: candidate?.model || "",
        };
      }),
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

  readPageClaims(path: string): LlmWikiPageClaims | null {
    assertWikiMarkdownPath(path);
    return this.store.readPageClaims(path);
  }

  listFacts(sourceIds?: string[]): LlmWikiFact[] {
    return this.store.listFacts(sourceIds);
  }
}
