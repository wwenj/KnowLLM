export type LlmWikiSourceStatus = "uploaded" | "ingesting" | "ready" | "failed";

export type LlmWikiPageType =
  | "index"
  | "summary"
  | "concept"
  | "entity"
  | "reference"
  | "procedure"
  | "changelog"
  | "troubleshooting";

export type LlmWikiFactType =
  | "definition"
  | "command"
  | "config"
  | "parameter"
  | "default"
  | "procedure_step"
  | "warning"
  | "constraint"
  | "exception"
  | "version_change"
  | "api_request"
  | "api_response"
  | "error_case"
  | "relationship";

export type LlmWikiFactImportance = "must" | "should" | "nice";
export type LlmWikiFactRetention = "exact" | "semantic" | "background";

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

export interface LlmWikiSourceCompileSummary {
  model: string;
  latestJobId: string;
  latestJobStatus: LlmWikiIngestJobStatus | "";
  latestStage: string;
  startedAt: string;
  endedAt: string;
  factCount: number;
  pageCount: number;
  pageClaimCount: number;
  mustCoverage: number | null;
  blockedIssues: number;
  humanReviewIssues: number;
  error: string;
}

export interface LlmWikiSourceWithCompile extends LlmWikiSourceMeta {
  compile: LlmWikiSourceCompileSummary;
}

export interface LlmWikiSourceSection {
  sectionId: string;
  title: string;
  headingPath: string[];
  level: number;
  startOffset: number;
  endOffset: number;
  content: string;
}

export interface LlmWikiSourceMap {
  sourceId: string;
  filename: string;
  sha256: string;
  title: string;
  sections: LlmWikiSourceSection[];
}

export interface LlmWikiFact {
  factId: string;
  sourceId: string;
  sectionId: string;
  type: LlmWikiFactType;
  importance: LlmWikiFactImportance;
  fact: string;
  evidence: string;
  sourceSpan: {
    start: number;
    end: number;
  };
  entities: string[];
  retention: LlmWikiFactRetention;
}

export interface LlmWikiFactLedger {
  sourceId: string;
  schemaHash: string;
  model: string;
  generatedAt: string;
  facts: LlmWikiFact[];
}

export interface LlmWikiPageClaims {
  path: string;
  factIds: string[];
  sourceIds: string[];
  updatedAt?: string;
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
  | "stale_source_digest"
  | "auto_fixed"
  | "blocked_publish"
  | "human_review";

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
  references?: LlmWikiCompilerPage[];
  procedures?: LlmWikiCompilerPage[];
  changelogs?: LlmWikiCompilerPage[];
  troubleshooting?: LlmWikiCompilerPage[];
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
  factIds?: string[];
}

export interface LlmWikiSemanticPagePlan {
  path: string;
  title: string;
  type: Exclude<LlmWikiPageType, "index">;
  tags: string[];
  semanticGoal: string;
  factIds: string[];
  linkTargets: string[];
}

export interface LlmWikiSemanticWriterPage extends LlmWikiNormalizedPage {
  claimedFactIds: string[];
}

export interface LlmWikiCompileResult {
  sourceMap: LlmWikiSourceMap;
  factLedger: LlmWikiFactLedger;
  pages: LlmWikiDraftPage[];
  pageClaims: LlmWikiPageClaims[];
  coverage: LlmWikiCoverageReport;
  issues: LlmWikiPublishGateIssue[];
}

export interface LlmWikiFusionResult {
  action: "create" | "update" | "skip" | "conflict";
  page: LlmWikiNormalizedPage | null;
  sources: string[];
  change_summary: string;
  issues: LlmWikiIssue[];
}

export type LlmWikiIngestJobStatus = "running" | "success" | "failed";
export type LlmWikiIngestJobEventStatus = "pending" | "running" | "success" | "failed";

export interface LlmWikiIngestJobEvent {
  stage: string;
  status: LlmWikiIngestJobEventStatus;
  message: string;
  at: string;
}

export interface LlmWikiPublishGateIssue {
  kind: "auto_fixed" | "blocked_publish" | "human_review";
  target: string;
  message: string;
  details: string;
  source_ids: string[];
}

export interface LlmWikiCoverageReport {
  mustTotal: number;
  mustCovered: number;
  mustCoverage: number;
  missingMustFactIds: string[];
}

export interface LlmWikiIngestJobReport {
  jobId: string;
  sourceId: string;
  status: LlmWikiIngestJobStatus;
  stage: string;
  model: string;
  startedAt: string;
  endedAt: string;
  pages: string[];
  factCount: number;
  coverage: LlmWikiCoverageReport;
  issues: LlmWikiPublishGateIssue[];
  error: string;
  events?: LlmWikiIngestJobEvent[];
}

export interface LlmWikiSourceArtifacts {
  source: LlmWikiSourceWithCompile;
  sourceMap: {
    title: string;
    sha256: string;
    sectionCount: number;
    sections: Array<Pick<LlmWikiSourceSection, "sectionId" | "title" | "headingPath" | "startOffset" | "endOffset">>;
  } | null;
  factLedger: {
    model: string;
    generatedAt: string;
    factCount: number;
    typeCounts: Record<string, number>;
    importanceCounts: Record<string, number>;
    retentionCounts: Record<string, number>;
  } | null;
  pageClaims: Array<{
    path: string;
    factCount: number;
    sourceIds: string[];
    updatedAt?: string;
  }>;
  pages: LlmWikiPageRef[];
  latestJob: LlmWikiIngestJobReport | null;
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
