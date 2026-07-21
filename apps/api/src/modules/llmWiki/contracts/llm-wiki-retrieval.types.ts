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
    factCount: number;
    pageClaimCount: number;
  };
  schema: LlmWikiSchema;
  index: string;
  pages: LlmWikiPageRef[];
  pageClaims: Array<{
    path: string;
    factCount: number;
    sourceIds: string[];
  }>;
  facts: Array<{
    sourceId: string;
    count: number;
  }>;
  sources: Array<
    Pick<
      LlmWikiSourceMeta,
      "source_id" | "filename" | "status" | "touched_pages" | "sha256" | "ingested_at"
    > & {
      compiler_version?: string;
      prompt_version?: string;
      compile_model?: string;
    }
  >;
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
