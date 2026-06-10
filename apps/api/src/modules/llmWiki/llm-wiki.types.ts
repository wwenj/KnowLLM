export type LlmWikiSourceStatus = "uploaded" | "ingesting" | "ready" | "failed";

export type LlmWikiPageType = "index" | "summary" | "concept" | "entity";

export interface LlmWikiSourceMeta {
  source_id: string;
  filename: string;
  ext: ".md" | ".txt";
  size: number;
  sha256: string;
  schema_hash: string;
  status: LlmWikiSourceStatus;
  uploaded_at: string;
  ingested_at: string;
  error: string;
  touched_pages: string[];
}

export interface LlmWikiStats {
  total: number;
  uploaded: number;
  ingesting: number;
  ready: number;
  failed: number;
  page_count: number;
}

export interface LlmWikiPage {
  path: string;
  title: string;
  type: LlmWikiPageType;
  tags: string[];
  sources: string[];
  schema_hash: string;
  updated_at: string;
  content: string;
}

export interface LlmWikiPageRef {
  path: string;
  title: string;
  type: LlmWikiPageType;
  tags: string[];
  sources: string[];
  schema_hash: string;
  updated_at: string;
}

export interface LlmWikiTreeGroup {
  group: string;
  pages: LlmWikiPageRef[];
}

export interface LlmWikiTree {
  groups: LlmWikiTreeGroup[];
}

export interface LlmWikiSearchHit {
  path: string;
  title: string;
  type: LlmWikiPageType;
  tags: string[];
  sources: string[];
  snippet: string;
  score: number;
}

export interface LlmWikiSchema {
  content: string;
  sha256: string;
  updated_at: string;
}

export type LlmWikiIssueKind =
  | "dead_link"
  | "orphan_page"
  | "missing_frontmatter"
  | "missing_source"
  | "deleted_source_ref"
  | "duplicate_title"
  | "schema_drift"
  | "missing_claim_source"
  | "conflict"
  | "weak_evidence"
  | "needs_reconcile"
  | "no_concept_generated"
  | "duplicate"
  | "needs_review"
  | "index_missing"
  | "oversized_page"
  | "stale_source_digest";

export type LlmWikiIssueSeverity = "info" | "warning" | "error";

export interface LlmWikiIssue {
  id: string;
  kind: LlmWikiIssueKind;
  severity: LlmWikiIssueSeverity;
  status: "open" | "resolved";
  target: string;
  message: string;
  details: string;
  source_ids: string[];
  created_at: string;
  updated_at: string;
}

export type LlmWikiLintMode = "structural" | "evidence" | "all";

export interface LlmWikiLintRequest {
  mode?: LlmWikiLintMode;
}

export interface LlmWikiLintResult {
  issues: LlmWikiIssue[];
  total: number;
}

export interface LlmWikiCompilerPage {
  path?: string;
  title?: string;
  content?: string;
  tags?: unknown;
}

export interface LlmWikiCompiledOutput {
  summary?: {
    title?: string;
    content?: string;
    tags?: unknown;
  };
  concepts?: LlmWikiCompilerPage[];
  entities?: LlmWikiCompilerPage[];
}

export interface LlmWikiNormalizedPage {
  path: string;
  title: string;
  type: LlmWikiPageType;
  tags: string[];
  body: string;
}

export interface LlmWikiDraftPage extends LlmWikiNormalizedPage {
  source_id: string;
}

export interface LlmWikiFusionResult {
  action: "create" | "update" | "skip" | "conflict";
  page: LlmWikiNormalizedPage | null;
  sources: string[];
  change_summary: string;
  issues: LlmWikiIssue[];
}

export interface LlmWikiPageContribution {
  path: string;
  sources: Record<
    string,
    {
      source_sha256: string;
      schema_hash: string;
      contributed_at: string;
      summary: string;
    }
  >;
}
