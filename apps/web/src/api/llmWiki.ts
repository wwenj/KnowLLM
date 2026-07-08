import { http } from "./http";

export type LlmWikiSourceStatus =
  | "raw_uploaded"
  | "compile_planned"
  | "candidate_ready"
  | "published"
  | "failed"
  | "uploaded"
  | "ingesting"
  | "ready";
export type LlmWikiPageType =
  | "index"
  | "summary"
  | "concept"
  | "entity"
  | "reference"
  | "procedure"
  | "changelog"
  | "troubleshooting";

export type LlmWikiIngestJobStatus = "running" | "success" | "failed";
export type LlmWikiIngestJobEventStatus = "pending" | "running" | "success" | "failed";

export interface LlmWikiCoverageReport {
  mustTotal: number;
  mustCovered: number;
  mustCoverage: number;
  missingMustFactIds: string[];
}

export interface LlmWikiPublishGateIssue {
  kind: "auto_fixed" | "blocked_publish" | "human_review";
  target: string;
  message: string;
  details: string;
  source_ids: string[];
}

export interface LlmWikiIngestJobEvent {
  stage: string;
  status: LlmWikiIngestJobEventStatus;
  message: string;
  at: string;
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
  candidateId?: string;
  planHash?: string;
  estimatedCostUsd?: number;
  modelCalls?: number;
  events?: LlmWikiIngestJobEvent[];
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

export interface LlmWikiSource {
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
  latest_candidate_id?: string;
  latest_compile_hash?: string;
  compile?: LlmWikiSourceCompileSummary;
}

export interface LlmWikiStats {
  total: number;
  raw_uploaded: number;
  compile_planned: number;
  candidate_ready: number;
  published: number;
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
  schema_hash: string;
  updated_at: string;
}

export interface LlmWikiPage extends LlmWikiPageRef {
  content: string;
  links?: string[];
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

export interface LlmWikiManifest {
  stats: {
    sourceCount: number;
    readySources: number;
    pageCount: number;
    factCount?: number;
    pageClaimCount?: number;
  };
  schema: LlmWikiSchema;
  index: string;
  pages: LlmWikiPageRef[];
  pageClaims?: Array<{ path: string; factCount: number; sourceIds: string[] }>;
  facts?: Array<{ sourceId: string; count: number }>;
  sources: Array<Pick<LlmWikiSource, "source_id" | "filename" | "status" | "touched_pages" | "sha256" | "ingested_at">>;
}

export interface LlmWikiSourceArtifacts {
  source: LlmWikiSource;
  sourceMap: {
    title: string;
    sha256: string;
    sectionCount: number;
    sections: Array<{
      sectionId: string;
      title: string;
      headingPath: string[];
      startOffset: number;
      endOffset: number;
    }>;
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
  latestCandidate?: LlmWikiCompileCandidate | null;
  staleMarkers?: LlmWikiStaleMarker[];
}

export interface LlmWikiCompilePlan {
  planId: string;
  sourceIds: string[];
  hash: string;
  schemaHash: string;
  compilerVersion: string;
  promptVersion: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  maxModelCalls: number;
  affectedPageCandidates: string[];
  requiresDigest: boolean;
  blocked: boolean;
  reason: string;
  createdAt: string;
}

export interface LlmWikiClaim {
  claimId: string;
  path: string;
  text: string;
  sourceId: string;
}

export interface LlmWikiCompileCandidate {
  candidateId: string;
  sourceId: string;
  plan: LlmWikiCompilePlan;
  status: "candidate_ready" | "published" | "failed" | "needs_review";
  model: string;
  schemaHash: string;
  compilerVersion: string;
  promptVersion: string;
  sourceHash: string;
  sourceTitle: string;
  pages: Array<{
    path: string;
    title: string;
    type: Exclude<LlmWikiPageType, "index">;
    tags: string[];
    body: string;
    sourceIds: string[];
    action: "create" | "update" | "delete" | "unchanged";
  }>;
  claims: LlmWikiClaim[];
  affectedPages: string[];
  issues: LlmWikiPublishGateIssue[];
  modelUsage: {
    modelCalls: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  error?: string;
}

export interface LlmWikiStaleMarker {
  markerId: string;
  pagePath: string;
  reason: "source_deleted" | "schema_changed" | "prompt_changed" | "manual" | "repair_failed";
  sourceId: string;
  repairRequired: boolean;
  createdAt: string;
  resolvedAt?: string;
}

export interface LlmWikiCompileEstimate {
  plan: LlmWikiCompilePlan;
  sourcePlans: LlmWikiCompilePlan[];
  requiresConfirmation: boolean;
}

export interface LlmWikiCompileSubmit extends LlmWikiCompileEstimate {
  jobs?: Array<{ jobId: string; sourceId: string; status: string }>;
  skipped?: Array<{ sourceId: string; candidateId: string; status: string }>;
}

export type LlmWikiLintMode = "structural" | "evidence" | "all";

export interface LlmWikiIssue {
  id: string;
  kind: string;
  severity: "info" | "warning" | "error";
  status: "open" | "resolved";
  target: string;
  message: string;
  details: string;
  source_ids: string[];
  created_at: string;
  updated_at: string;
}

export const llmWikiApi = {
  overview: (silent = false) =>
    http.get<{
      stats: LlmWikiStats;
      recent: LlmWikiSource[];
      jobs: LlmWikiIngestJobReport[];
      publishGate: {
        latestStatus: string;
        latestStage: string;
        latestCoverage: number | null;
        blockedCount: number;
        humanReviewCount: number;
      };
    }>(
      "/api/llm-wiki/manage/overview",
      undefined,
      silent ? { silent: true } : undefined,
    ),
  listSources: (silent = false) =>
    http.get<{ items: LlmWikiSource[]; stats: LlmWikiStats }>(
      "/api/llm-wiki/manage/sources",
      undefined,
      silent ? { silent: true } : undefined,
    ),
  uploadSource: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return http.postForm<LlmWikiSource>("/api/llm-wiki/manage/sources/upload", form);
  },
  schema: () => http.get<LlmWikiSchema>("/api/llm-wiki/manage/schema"),
  saveSchema: (content: string) =>
    http.post<LlmWikiSchema>("/api/llm-wiki/manage/schema/save", { content }),
  estimateCompile: (sourceIds: string[]) =>
    http.post<LlmWikiCompileEstimate>("/api/llm-wiki/manage/compile/estimate", { sourceIds }),
  compileSources: (sourceIds: string[], model: string, confirmHash: string) =>
    http.post<LlmWikiCompileSubmit>("/api/llm-wiki/manage/compile", { sourceIds, model, confirmHash }),
  ingestSource: (sourceId: string, model: string, confirmHash = "") =>
    http.post<LlmWikiCompileSubmit>(
      `/api/llm-wiki/manage/sources/${encodeURIComponent(sourceId)}/ingest`,
      { model, confirmHash },
    ),
  stopIngest: (sourceId: string) =>
    http.post<{ ok: boolean; sourceId: string; status: LlmWikiSourceStatus; stopped: boolean }>(
      `/api/llm-wiki/manage/sources/${encodeURIComponent(sourceId)}/ingest/stop`,
    ),
  renameSource: (sourceId: string, filename: string) =>
    http.post<LlmWikiSource>(
      `/api/llm-wiki/manage/sources/${encodeURIComponent(sourceId)}/rename`,
      { filename },
    ),
  deleteSource: (sourceId: string) =>
    http.post<{ ok: boolean; source_id: string; stalePages: string[]; staleMarkers: LlmWikiStaleMarker[] }>(
      `/api/llm-wiki/manage/sources/${encodeURIComponent(sourceId)}/delete`,
    ),
  candidates: (limit = 50) =>
    http.get<{ items: LlmWikiCompileCandidate[] }>("/api/llm-wiki/manage/candidates", { limit }),
  publishCandidate: (candidateId: string) =>
    http.post<{ ok: boolean }>(`/api/llm-wiki/manage/candidates/${encodeURIComponent(candidateId)}/publish`),
  sourceArtifacts: (sourceId: string, silent = false) =>
    http.get<LlmWikiSourceArtifacts>(
      `/api/llm-wiki/manage/sources/${encodeURIComponent(sourceId)}/artifacts`,
      undefined,
      silent ? { silent: true } : undefined,
    ),
  rawSource: (sourceId: string) =>
    http.get<{ source_id: string; filename: string; content: string }>(
      `/api/llm-wiki/retrieval/source/${encodeURIComponent(sourceId)}`,
    ),
  manifest: () => http.get<LlmWikiManifest>("/api/llm-wiki/retrieval/manifest"),
  tree: async (): Promise<LlmWikiTree> => {
    const manifest = await http.get<LlmWikiManifest>("/api/llm-wiki/retrieval/manifest");
    const groups = [
      { group: "Root", pages: manifest.pages.filter((page) => page.path === "index.md") },
      { group: "Summaries", pages: manifest.pages.filter((page) => page.path.startsWith("summaries/")) },
      { group: "References", pages: manifest.pages.filter((page) => page.path.startsWith("references/")) },
      { group: "Procedures", pages: manifest.pages.filter((page) => page.path.startsWith("procedures/")) },
      { group: "Changelogs", pages: manifest.pages.filter((page) => page.path.startsWith("changelogs/")) },
      { group: "Troubleshooting", pages: manifest.pages.filter((page) => page.path.startsWith("troubleshooting/")) },
      { group: "Concepts", pages: manifest.pages.filter((page) => page.path.startsWith("concepts/")) },
      { group: "Entities", pages: manifest.pages.filter((page) => page.path.startsWith("entities/")) },
    ].filter((group) => group.pages.length > 0);
    return { groups };
  },
  page: (path: string) =>
    http.get<LlmWikiPage>("/api/llm-wiki/retrieval/page", { path }),
  savePage: (path: string, content: string) =>
    http.post<LlmWikiPage>("/api/llm-wiki/manage/pages/save", { path, content }),
  deletePage: (path: string) =>
    http.post<{ ok: boolean; path: string }>("/api/llm-wiki/manage/pages/delete", { path }),
  search: (q: string, limit = 20) =>
    http.get<{ query: string; hits: LlmWikiSearchHit[]; returned: number }>(
      "/api/llm-wiki/retrieval/search",
      { q, limit },
    ),
  lint: (mode: LlmWikiLintMode = "all") =>
    http.post<{ issues: LlmWikiIssue[]; total: number }>("/api/llm-wiki/manage/lint", { mode }),
  issues: (status: "open" | "resolved" | "all" = "open") =>
    http.get<{ items: LlmWikiIssue[] }>("/api/llm-wiki/manage/issues", { status }),
  resolveIssue: (issueId: string) =>
    http.post<LlmWikiIssue>(`/api/llm-wiki/manage/issues/${encodeURIComponent(issueId)}/resolve`),
};
