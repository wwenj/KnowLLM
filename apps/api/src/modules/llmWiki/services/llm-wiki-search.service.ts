import { Injectable } from "@nestjs/common";
import { Index } from "flexsearch";
import { llmWikiConfig } from "../llm-wiki.config";
import { LlmWikiFact, LlmWikiPage, LlmWikiSearchHit } from "../contracts/llm-wiki.types";
import { LlmWikiStoreService } from "./llm-wiki-store.service";

interface IndexedPage {
  page: LlmWikiPage;
  body: string;
  text: string;
}

@Injectable()
export class LlmWikiSearchService {
  private index = new Index({ tokenize: "full", cache: false });
  private pages = new Map<string, IndexedPage>();
  private dirty = true;

  constructor(private readonly store: LlmWikiStoreService) {}

  invalidate(): void {
    this.dirty = true;
  }

  search(query: string, limit = llmWikiConfig.maxSearchResults): {
    query: string;
    hits: LlmWikiSearchHit[];
    returned: number;
  } {
    const q = query.trim();
    if (!q) return { query: q, hits: [], returned: 0 };
    this.ensureIndex();

    const max = Math.min(Math.max(Number(limit) || llmWikiConfig.maxSearchResults, 1), 50);
    const ids = new Set<string>();
    const flexResults = this.index.search(q, { limit: max * 3 });
    for (const id of flexResults) ids.add(String(id));

    const lower = q.toLowerCase();
    for (const [id, item] of this.pages) {
      if (item.text.toLowerCase().includes(lower)) ids.add(id);
    }

    const hits = [...ids]
      .map((id) => this.pages.get(id))
      .filter((item): item is IndexedPage => !!item)
      .map((item) => toHit(item, q))
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, max);

    return { query: q, hits, returned: hits.length };
  }

  private ensureIndex(): void {
    if (!this.dirty) return;
    this.index = new Index({ tokenize: "full", cache: false });
    this.pages.clear();
    const factById = new Map(this.store.listFacts().map((fact) => [fact.factId, fact]));
    const sourceFilename = new Map(this.store.listSources().map((source) => [source.source_id, source.filename]));
    for (const page of this.store.listPages()) {
      const body = stripFrontmatter(page.content);
      const claims = this.store.readPageClaims(page.path);
      const claimFacts = (claims?.factIds || [])
        .map((id) => factById.get(id))
        .filter((fact): fact is LlmWikiFact => !!fact);
      const sectionText = claimFacts
        .map((fact) => {
          const section = this.store
            .readSourceMap(fact.sourceId)
            ?.sections.find((item) => item.sectionId === fact.sectionId);
          return section?.headingPath.join(" > ") || "";
        })
        .join("\n");
      const factText = claimFacts
        .map((fact) =>
          [
            fact.fact,
            fact.evidence,
            fact.type,
            fact.entities.join(" "),
            sourceFilename.get(fact.sourceId) || "",
          ].join("\n"),
        )
        .join("\n");
      const text = [page.title, page.path, page.type, page.tags.join(" "), body, factText, sectionText].join("\n");
      this.index.add(page.path, text);
      this.pages.set(page.path, { page, body, text });
    }
    this.dirty = false;
  }
}

function toHit(item: IndexedPage, query: string): LlmWikiSearchHit {
  const lower = query.toLowerCase();
  const titleMatched = item.page.title.toLowerCase().includes(lower);
  const tagMatched = item.page.tags.some((tag) => tag.toLowerCase().includes(lower));
  const pathMatched = item.page.path.toLowerCase().includes(lower);
  const bodyMatched = item.body.toLowerCase().includes(lower);
  return {
    path: item.page.path,
    title: item.page.title,
    type: item.page.type,
    tags: item.page.tags,
    sources: item.page.sources,
    snippet: snippet(item.body, query),
    score:
      (titleMatched ? 100 : 0) +
      (tagMatched ? 60 : 0) +
      (pathMatched ? 30 : 0) +
      (bodyMatched ? 20 : 0),
  };
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\s*/m, "").trim();
}

function snippet(content: string, query: string): string {
  const text = stripFrontmatter(content).replace(/\s+/g, " ").trim();
  if (!text) return "";
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text.slice(0, 180);
  const start = Math.max(0, idx - 70);
  const end = Math.min(text.length, idx + query.length + 110);
  return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
}
