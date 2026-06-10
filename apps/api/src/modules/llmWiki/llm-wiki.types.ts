export type LlmWikiSourceStatus = "uploaded" | "ingesting" | "ready" | "failed";

export type LlmWikiPageType = "index" | "summary" | "concept" | "entity" | "comparison" | "manual";

export interface LlmWikiSourceMeta {
  source_id: string;
  filename: string;
  ext: string;
  size: number;
  sha256: string;
  schema_hash: string;
  status: LlmWikiSourceStatus;
  uploaded_at: string;
  ingested_at?: string;
  error?: string;
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

export interface LlmWikiPageRef {
  path: string;
  title: string;
  type: LlmWikiPageType;
  tags: string[];
  sources: string[];
  schema_hash?: string;
  updated_at?: string;
}

export interface LlmWikiPage extends LlmWikiPageRef {
  content: string;
}

export interface LlmWikiTreeGroup {
  group: string;
  pages: LlmWikiPageRef[];
}

export interface LlmWikiTree {
  groups: LlmWikiTreeGroup[];
}

export interface LlmWikiSearchHit extends LlmWikiPageRef {
  snippet: string;
  score: number;
}

export interface LlmWikiSchema {
  content: string;
  sha256: string;
  updated_at: string;
}

export type LlmWikiIssueSeverity = "info" | "warning" | "error";
export type LlmWikiIssueStatus = "open" | "resolved";
export type LlmWikiLintMode = "structural" | "evidence" | "all";

export interface LlmWikiIssue {
  id: string;
  kind: string;
  severity: LlmWikiIssueSeverity;
  status: LlmWikiIssueStatus;
  target: string;
  message: string;
  details?: string;
  source_ids?: string[];
  created_at: string;
  updated_at: string;
}

export interface LlmWikiDraftPage {
  path: string;
  title: string;
  type: LlmWikiPageType;
  tags: string[];
  body: string;
  source_id: string;
}
