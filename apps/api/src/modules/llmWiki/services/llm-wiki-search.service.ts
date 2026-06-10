import { Injectable } from "@nestjs/common";
import { normalizeWhitespace, snippet, stripFrontmatter } from "../../../common/text";
import { llmWikiConfig } from "../llm-wiki.config";
import type { LlmWikiSearchHit } from "../llm-wiki.types";
import { LlmWikiStoreService } from "./llm-wiki-store.service";

@Injectable()
export class LlmWikiSearchService {
  constructor(private readonly store: LlmWikiStoreService) {}

  search(query: string, limit = llmWikiConfig.maxSearchResults) {
    const q = String(query || "").trim();
    if (!q) return { query: q, hits: [], returned: 0 };
    const max = Math.min(Math.max(Number(limit) || llmWikiConfig.maxSearchResults, 1), 50);
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = this.store
      .listPages()
      .map((page): LlmWikiSearchHit => {
        const body = stripFrontmatter(page.content);
        const haystack = normalizeWhitespace([
          page.title,
          page.path,
          page.type,
          page.tags.join(" "),
          body
        ].join("\n")).toLowerCase();
        const score = scorePage(haystack, page.title.toLowerCase(), page.path.toLowerCase(), terms);
        return {
          path: page.path,
          title: page.title,
          type: page.type,
          tags: page.tags,
          sources: page.sources,
          schema_hash: page.schema_hash,
          updated_at: page.updated_at,
          snippet: snippet(body, q),
          score
        };
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, max);
    return { query: q, hits, returned: hits.length };
  }
}

function scorePage(haystack: string, title: string, pagePath: string, terms: string[]): number {
  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 100;
    if (pagePath.includes(term)) score += 40;
    if (haystack.includes(term)) score += 20;
  }
  return score;
}
