import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { LlmWikiNextStore } from "./llm-wiki-next.store";
import {
  ToolsCatalog,
  ToolsCatalogPage,
  ToolsPageDetail,
  ToolsPageSummary,
  ToolsSearchItem,
  ToolsSearchMatchedField,
  ToolsSearchResult,
  ToolsSourceDetail,
  ToolsSourceSummary,
  WikiSnapshot,
} from "./llm-wiki-next.types";

const SEARCH_RESULT_LIMIT = 20;
const SEARCH_SNIPPET_LENGTH = 240;

@Injectable()
export class LlmWikiNextToolsService {
  constructor(private readonly store: LlmWikiNextStore) {}

  getCatalog(): ToolsCatalog {
    const snapshot = this.readPublishedSnapshot();
    const pages = snapshot.manifest.pages.map((page) =>
      catalogPage(snapshot, page.pageKey),
    );
    const sources = Object.keys(snapshot.sourceMap.sourceToPages)
      .sort()
      .map((sourceId) => this.sourceSummary(snapshot, sourceId));
    return {
      stats: {
        pageCount: pages.length,
        factCount: Object.values(snapshot.facts.byPage).reduce(
          (sum, facts) => sum + facts.length,
          0,
        ),
        sourceCount: sources.length,
      },
      pages,
      sources,
    };
  }

  readPage(pageKey: string): ToolsPageDetail {
    const normalizedPageKey = validId(
      pageKey,
      8,
      "pageKey",
      "INVALID_PAGE_KEY",
    );
    const snapshot = this.readPublishedSnapshot();
    const page = snapshot.manifest.pages.find(
      (item) => item.pageKey === normalizedPageKey,
    );
    if (!page || !(normalizedPageKey in snapshot.pages)) {
      throw new NotFoundException({
        message: "Wiki 页面不存在",
        error: "WIKI_PAGE_NOT_FOUND",
      });
    }

    const outgoing = summariesForKeys(
      snapshot,
      page.relatedPageKeys.filter((key) => key !== normalizedPageKey),
    );
    const incoming = snapshot.manifest.pages
      .filter(
        (candidate) =>
          candidate.pageKey !== normalizedPageKey &&
          candidate.relatedPageKeys.includes(normalizedPageKey),
      )
      .map((candidate) => pageSummary(snapshot, candidate.pageKey));
    const sameSourceKeys = page.sourceIds.flatMap(
      (sourceId) => snapshot.sourceMap.sourceToPages[sourceId] || [],
    );
    const sameSource = summariesForKeys(
      snapshot,
      sameSourceKeys.filter((key) => key !== normalizedPageKey),
    );

    return {
      page: {
        ...catalogPage(snapshot, normalizedPageKey),
        bodyMarkdown: snapshot.pages[normalizedPageKey],
        keyFacts: snapshot.facts.byPage[normalizedPageKey] || [],
      },
      relations: { outgoing, incoming, sameSource },
      sources: page.sourceIds.map((sourceId) =>
        this.sourceSummary(snapshot, sourceId),
      ),
    };
  }

  readSource(
    sourceId: string,
    startLine?: number,
    endLine?: number,
  ): ToolsSourceDetail {
    const normalizedSourceId = validId(
      sourceId,
      16,
      "sourceId",
      "INVALID_SOURCE_ID",
    );
    const snapshot = this.readPublishedSnapshot();
    const pageKeys = snapshot.sourceMap.sourceToPages[normalizedSourceId];
    if (!pageKeys?.length) {
      throw new NotFoundException({
        message: "正式 Wiki 未引用该原文",
        error: "PUBLISHED_SOURCE_NOT_FOUND",
      });
    }

    const normalizedStartLine = optionalLine(startLine, "startLine");
    const normalizedEndLine = optionalLine(endLine, "endLine");
    const source = this.readPublishedSource(normalizedSourceId);
    const selectedStartLine = normalizedStartLine ?? 1;
    const selectedEndLine = normalizedEndLine ?? source.lineCount;
    if (selectedStartLine > source.lineCount) {
      throw new BadRequestException({
        message: "startLine 超出原文行数",
        error: "INVALID_START_LINE",
      });
    }
    if (selectedEndLine > source.lineCount) {
      throw new BadRequestException({
        message: "endLine 超出原文行数",
        error: "INVALID_END_LINE",
      });
    }
    if (selectedStartLine > selectedEndLine) {
      throw new BadRequestException({
        message: "startLine 不能大于 endLine",
        error: "INVALID_LINE_RANGE",
      });
    }
    const lines = source.content.split(/\r?\n/);
    const selectedLines = lines.slice(selectedStartLine - 1, selectedEndLine);
    const hasMore = selectedEndLine < source.lineCount;
    const pages = summariesForKeys(snapshot, pageKeys);
    const factRefs = pages.flatMap((page) =>
      (snapshot.facts.byPage[page.pageKey] || [])
        .filter(
          (fact) =>
            fact.sourceId === normalizedSourceId &&
            fact.sourceLine !== null &&
            fact.sourceLine >= selectedStartLine &&
            fact.sourceLine <= selectedEndLine,
        )
        .map((fact) => ({
          pageKey: page.pageKey,
          fact: fact.fact,
          sourceLine: fact.sourceLine as number,
        })),
    );

    return {
      source: {
        sourceId: source.sourceId,
        filename: source.filename,
        contentHash: source.contentHash,
        charCount: source.charCount,
        lineCount: source.lineCount,
        pageKeys: unique(pageKeys),
      },
      range: {
        startLine: selectedStartLine,
        endLine: selectedEndLine,
        totalLines: source.lineCount,
        hasMore,
        nextStartLine: hasMore ? selectedEndLine + 1 : null,
      },
      content: selectedLines.join("\n"),
      pages,
      factRefs,
    };
  }

  searchWiki(query: string): ToolsSearchResult {
    const normalizedQuery = String(query || "").trim();
    if (!normalizedQuery) {
      throw new BadRequestException({
        message: "查询关键词不能为空",
        error: "EMPTY_QUERY",
      });
    }
    const snapshot = this.readPublishedSnapshot();
    const loweredQuery = normalizedQuery.toLocaleLowerCase();
    const tokens = loweredQuery.split(/\s+/).filter(Boolean);
    const items = snapshot.searchIndex.documents
      .map((document) => ({
        document,
        score: searchScore(document, loweredQuery, tokens),
      }))
      .filter(({ score }) => score > 0)
      .sort(
        (a, b) =>
          b.score - a.score || a.document.title.localeCompare(b.document.title),
      )
      .slice(0, SEARCH_RESULT_LIMIT)
      .map(({ document, score }): ToolsSearchItem => {
        const matchedFields = matchingFields(document, loweredQuery, tokens);
        const matchedFacts = document.facts
          .filter((fact) => matches(fact, loweredQuery, tokens))
          .slice(0, 3);
        return {
          ...pageSummary(snapshot, document.pageKey),
          score,
          matchedFields,
          matchedFacts,
          snippet: searchSnippet(
            document.goal,
            document.bodyMarkdown,
            matchedFacts,
            loweredQuery,
            tokens,
          ),
        };
      });
    return { query: normalizedQuery, items };
  }

  private readPublishedSnapshot(): WikiSnapshot {
    if (!this.store.readPublishedPointer()) {
      throw new NotFoundException({
        message: "正式 Wiki 不存在",
        error: "PUBLISHED_WIKI_NOT_FOUND",
      });
    }
    try {
      return this.store.readPublishedSnapshot();
    } catch {
      throw new InternalServerErrorException({
        message: "正式 Wiki 产物不可用",
        error: "PUBLISHED_WIKI_UNAVAILABLE",
      });
    }
  }

  private sourceSummary(
    snapshot: WikiSnapshot,
    sourceId: string,
  ): ToolsSourceSummary {
    const source = this.readPublishedSourceRecord(sourceId);
    return {
      sourceId: source.sourceId,
      filename: source.filename,
      contentHash: source.contentHash,
      charCount: source.charCount,
      lineCount: source.lineCount,
      pageKeys: unique(snapshot.sourceMap.sourceToPages[sourceId] || []),
    };
  }

  private readPublishedSourceRecord(sourceId: string) {
    try {
      return this.store.getSourceRecord(sourceId);
    } catch {
      throw new InternalServerErrorException({
        message: "正式 Wiki 原文不可用",
        error: "PUBLISHED_SOURCE_UNAVAILABLE",
      });
    }
  }

  private readPublishedSource(sourceId: string) {
    try {
      return this.store.getSource(sourceId);
    } catch {
      throw new InternalServerErrorException({
        message: "正式 Wiki 原文不可用",
        error: "PUBLISHED_SOURCE_UNAVAILABLE",
      });
    }
  }
}

function optionalLine(
  value: number | undefined,
  field: "startLine" | "endLine",
): number | undefined {
  if (value === undefined) return undefined;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new BadRequestException({
      message: `${field} 必须是正整数`,
      error: field === "startLine" ? "INVALID_START_LINE" : "INVALID_END_LINE",
    });
  }
  return normalized;
}

function validId(
  value: string,
  length: number,
  field: string,
  error: string,
): string {
  const normalized = String(value || "").trim();
  if (!new RegExp(`^[A-Za-z0-9]{${length}}$`).test(normalized)) {
    throw new BadRequestException({ message: `${field} 非法`, error });
  }
  return normalized;
}

function catalogPage(
  snapshot: WikiSnapshot,
  pageKey: string,
): ToolsCatalogPage {
  const page = snapshot.manifest.pages.find((item) => item.pageKey === pageKey);
  if (!page) throw new Error("Wiki 页面目录不完整");
  return {
    ...pageSummary(snapshot, pageKey),
    relatedPageKeys: unique(page.relatedPageKeys).filter(
      (relatedPageKey) => relatedPageKey !== pageKey,
    ),
  };
}

function pageSummary(
  snapshot: WikiSnapshot,
  pageKey: string,
): ToolsPageSummary {
  const page = snapshot.manifest.pages.find((item) => item.pageKey === pageKey);
  if (!page) throw new Error("Wiki 页面目录不完整");
  return {
    pageKey: page.pageKey,
    title: page.title,
    goal: page.goal,
    sourceIds: page.sourceIds,
    factCount: snapshot.facts.byPage[page.pageKey]?.length || 0,
  };
}

function summariesForKeys(
  snapshot: WikiSnapshot,
  pageKeys: string[],
): ToolsPageSummary[] {
  const available = new Set(
    snapshot.manifest.pages.map((page) => page.pageKey),
  );
  return unique(pageKeys)
    .filter((pageKey) => available.has(pageKey))
    .map((pageKey) => pageSummary(snapshot, pageKey));
}

function matchingFields(
  document: WikiSnapshot["searchIndex"]["documents"][number],
  query: string,
  tokens: string[],
): ToolsSearchMatchedField[] {
  const fields: ToolsSearchMatchedField[] = [];
  if (matches(document.title, query, tokens)) fields.push("title");
  if (matches(document.goal, query, tokens)) fields.push("goal");
  if (document.facts.some((fact) => matches(fact, query, tokens))) {
    fields.push("fact");
  }
  if (matches(document.bodyMarkdown, query, tokens)) fields.push("body");
  return fields;
}

function matches(value: string, query: string, tokens: string[]): boolean {
  const normalized = value.toLocaleLowerCase();
  return (
    normalized.includes(query) ||
    tokens.some((token) => normalized.includes(token))
  );
}

function searchScore(
  document: WikiSnapshot["searchIndex"]["documents"][number],
  query: string,
  tokens: string[],
): number {
  const title = document.title.toLocaleLowerCase();
  const goal = document.goal.toLocaleLowerCase();
  const facts = document.facts.join("\n").toLocaleLowerCase();
  const body = document.bodyMarkdown.toLocaleLowerCase();
  let score = title.includes(query) ? 20 : goal.includes(query) ? 12 : 0;
  for (const token of tokens) {
    if (title.includes(token)) score += 8;
    if (goal.includes(token)) score += 5;
    if (facts.includes(token)) score += 3;
    if (body.includes(token)) score += 1;
  }
  return score;
}

function searchSnippet(
  goal: string,
  bodyMarkdown: string,
  matchedFacts: string[],
  query: string,
  tokens: string[],
): string {
  if (matchedFacts.length) return trimSnippet(matchedFacts[0]);
  if (matches(goal, query, tokens)) return trimSnippet(goal);
  const body = bodyMarkdown.replace(/\s+/g, " ").trim();
  if (!body) return "";
  const lowered = body.toLocaleLowerCase();
  const candidates = [query, ...tokens]
    .map((value) => lowered.indexOf(value))
    .filter((index) => index >= 0);
  const matchIndex = candidates.length ? Math.min(...candidates) : 0;
  const start = Math.max(0, matchIndex - 60);
  const prefix = start > 0 ? "…" : "";
  let snippet = body.slice(
    start,
    start + SEARCH_SNIPPET_LENGTH - prefix.length,
  );
  const hasSuffix = start + snippet.length < body.length;
  if (hasSuffix)
    snippet = snippet.slice(0, SEARCH_SNIPPET_LENGTH - prefix.length - 1);
  return `${prefix}${snippet}${hasSuffix ? "…" : ""}`;
}

function trimSnippet(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > SEARCH_SNIPPET_LENGTH
    ? `${normalized.slice(0, SEARCH_SNIPPET_LENGTH - 1)}…`
    : normalized;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
