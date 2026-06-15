import type {
  LlmWikiPage,
  LlmWikiPageRef,
  LlmWikiSchema,
  LlmWikiSearchHit,
  LlmWikiSourceMeta,
} from "./llm-wiki.types";

export interface LlmWikiRetrievalManifest {
  stats: {
    sourceCount: number;
    readySources: number;
    pageCount: number;
  };
  schema: LlmWikiSchema;
  index: string;
  pages: LlmWikiPageRef[];
  sources: Array<Pick<LlmWikiSourceMeta, "source_id" | "filename" | "status" | "touched_pages">>;
}

export interface LlmWikiSearchResult {
  query: string;
  hits: LlmWikiSearchHit[];
  returned: number;
}

export interface LlmWikiRetrievedPage extends LlmWikiPage {
  links: string[];
}

export interface LlmWikiRetrievedSource {
  source_id: string;
  filename: string;
  content: string;
}
