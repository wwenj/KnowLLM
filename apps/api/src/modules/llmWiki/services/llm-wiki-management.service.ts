import { Injectable, OnModuleInit } from "@nestjs/common";
import type {
  LlmWikiLintMode,
  LlmWikiSourceArtifacts,
  LlmWikiSourceMeta,
  LlmWikiSourceWithCompile,
} from "../contracts/llm-wiki.types";
import { llmWikiConfig } from "../llm-wiki.config";
import { LlmWikiIngestService } from "./llm-wiki-ingest.service";
import { LlmWikiIssueService } from "./llm-wiki-issue.service";
import { LlmWikiLintService } from "./llm-wiki-lint.service";
import { LlmWikiSchemaService } from "./llm-wiki-schema.service";
import { LlmWikiSearchService } from "./llm-wiki-search.service";
import { LlmWikiStoreService } from "./llm-wiki-store.service";

@Injectable()
export class LlmWikiManagementService implements OnModuleInit {
  constructor(
    private readonly store: LlmWikiStoreService,
    private readonly ingest: LlmWikiIngestService,
    private readonly issues: LlmWikiIssueService,
    private readonly search: LlmWikiSearchService,
    private readonly schema: LlmWikiSchemaService,
    private readonly lint: LlmWikiLintService,
  ) {}

  onModuleInit(): void {
    this.search.invalidate();
    this.markCompilerVersionDriftStale();
  }

  overview() {
    const items = this.enrichSources(this.store.listSources());
    const jobs = this.store.listIngestJobs(5);
    return {
      stats: this.store.stats(items),
      recent: items.slice(0, 5),
      jobs,
      publishGate: summarizePublishGate(jobs),
    };
  }

  listSources() {
    const items = this.enrichSources(this.store.listSources());
    return { items, stats: this.store.stats(items) };
  }

  sourceArtifacts(sourceId: string): LlmWikiSourceArtifacts {
    const source = this.enrichSource(this.store.getSource(sourceId));
    const sourceMap = this.store.readSourceMap(source.source_id);
    const factLedger = this.store.readFactLedger(source.source_id);
    const latestCandidate = source.latest_candidate_id
      ? tryReadCandidate(this.store, source.latest_candidate_id)
      : this.store.getLatestCompileCandidateForSource(source.source_id);
    const staleMarkers = this.store.listStaleMarkers(source.source_id);
    const claims = this.store
      .listPageClaims()
      .filter((claim) => claim.sourceIds.includes(source.source_id));
    const claimPaths = new Set(claims.map((claim) => claim.path));
    const pages = this.store
      .listPageRefs()
      .filter((page) => page.sources.includes(source.source_id) || claimPaths.has(page.path));
    const latestJob = this.store.getLatestIngestJobForSource(source.source_id);
    return {
      source,
      sourceMap: sourceMap
        ? {
            title: sourceMap.title,
            sha256: sourceMap.sha256,
            sectionCount: sourceMap.sections.length,
            sections: sourceMap.sections.map(({ sectionId, title, headingPath, startOffset, endOffset }) => ({
              sectionId,
              title,
              headingPath,
              startOffset,
              endOffset,
            })),
          }
        : null,
      factLedger: factLedger
        ? {
            model: factLedger.model,
            generatedAt: factLedger.generatedAt,
            factCount: factLedger.facts.length,
            typeCounts: countBy(factLedger.facts, (fact) => fact.type),
            importanceCounts: countBy(factLedger.facts, (fact) => fact.importance),
            retentionCounts: countBy(factLedger.facts, (fact) => fact.retention),
          }
        : null,
      pageClaims: claims.map((claim) => ({
        path: claim.path,
        factCount: claim.factIds.length + (claim.claims?.length || 0),
        sourceIds: claim.sourceIds,
        updatedAt: claim.updatedAt,
      })),
      pages,
      latestJob,
      latestCandidate,
      staleMarkers,
    };
  }

  uploadSource(filename: string, data: Buffer) {
    return this.store.createSource(filename, data);
  }

  estimateCompile(sourceIds: string[]) {
    return this.ingest.estimateCompile(sourceIds);
  }

  compileSources(sourceIds: string[], model = "", confirmHash = "") {
    return this.ingest.compileSources(sourceIds, model, confirmHash);
  }

  ingestSource(sourceId: string, model = "", confirmHash = "") {
    return this.ingest.ingestSource(sourceId, model, confirmHash);
  }

  stopIngest(sourceId: string) {
    const result = this.ingest.stopIngest(sourceId);
    this.search.invalidate();
    return result;
  }

  renameSource(sourceId: string, filename: string) {
    return this.store.renameSource(sourceId, filename);
  }

  deleteSource(sourceId: string) {
    const result = this.store.deleteSourceCascade(sourceId);
    this.search.invalidate();
    return { ok: true, source_id: sourceId, stalePages: result.touched_pages, staleMarkers: result.stale_markers || [] };
  }

  getIngestJob(jobId: string) {
    return this.store.getIngestJob(jobId);
  }

  rebuild(model = "") {
    const jobs = this.ingest.rebuildAll(model);
    this.search.invalidate();
    return { ok: true, jobs, mode: "manifest_only" };
  }

  getSchema() {
    return this.schema.read();
  }

  saveSchema(content: string) {
    const previous = this.schema.read();
    const next = this.schema.save(content);
    if (previous.sha256 && next.sha256 !== previous.sha256) {
      for (const source of this.store.listSources()) {
        if (source.status !== "published" && source.status !== "ready" && source.status !== "candidate_ready") continue;
        this.store.markSourcePagesStale(source.source_id, "schema_changed");
      }
    }
    return next;
  }

  savePage(path: string, content: string) {
    const page = this.store.savePage(path, content);
    this.search.invalidate();
    return page;
  }

  deletePage(path: string) {
    this.store.deletePage(path);
    this.search.invalidate();
    return { ok: true, path };
  }

  lintWiki(mode?: LlmWikiLintMode) {
    return this.lint.run(mode);
  }

  listIssues(status?: "open" | "resolved" | "all") {
    const result = this.issues.list(status || "open");
    return {
      ...result,
      items: result.items.filter((issue) => issue.kind === "human_review" || issue.kind === "conflict" || issue.kind === "needs_review"),
    };
  }

  resolveIssue(issueId: string) {
    return this.issues.resolve(issueId);
  }

  listCandidates(limit = 50) {
    return { items: this.store.listCompileCandidates(limit) };
  }

  publishCandidate(candidateId: string) {
    const receipt = this.store.publishCandidate(candidateId);
    this.search.invalidate();
    return { ok: true, receipt };
  }

  listStaleMarkers(sourceId = "") {
    return { items: this.store.listStaleMarkers(sourceId || undefined) };
  }

  repairStale(sourceIds: string[], model = "", confirmHash = "") {
    const ids = sourceIds?.length
      ? sourceIds
      : uniqueStrings(
          this.store
            .listStaleMarkers()
            .filter((marker) => !marker.resolvedAt && this.store.sourceExists(marker.sourceId))
            .map((marker) => marker.sourceId),
        );
    if (!ids.length) return { ok: true, plan: null, sourcePlans: [], jobs: [], skipped: [] };
    return this.ingest.compileSources(ids, model, confirmHash);
  }

  private enrichSources(sources: LlmWikiSourceMeta[]): LlmWikiSourceWithCompile[] {
    const jobs = this.store.listIngestJobs(100);
    const pages = this.store.listPageRefs();
    const claims = this.store.listPageClaims();
    return sources.map((source) => this.enrichSource(source, jobs, pages, claims));
  }

  private markCompilerVersionDriftStale(): void {
    for (const source of this.store.listSources()) {
      if (source.status !== "published" && source.status !== "candidate_ready") continue;
      const latestCandidate = source.latest_candidate_id
        ? tryReadCandidate(this.store, source.latest_candidate_id)
        : this.store.getLatestCompileCandidateForSource(source.source_id);
      if (!latestCandidate) continue;
      if (
        latestCandidate.compilerVersion === llmWikiConfig.compilerVersion &&
        latestCandidate.promptVersion === llmWikiConfig.promptVersion
      ) {
        continue;
      }
      this.store.markSourcePagesStale(source.source_id, "prompt_changed");
    }
  }

  private enrichSource(
    source: LlmWikiSourceMeta,
    jobs = this.store.listIngestJobs(100),
    pages = this.store.listPageRefs(),
    claims = this.store.listPageClaims(),
  ): LlmWikiSourceWithCompile {
    const latestJob = jobs.find((job) => job.sourceId === source.source_id);
    const factLedger = this.store.readFactLedger(source.source_id);
    const latestCandidate = source.latest_candidate_id
      ? tryReadCandidate(this.store, source.latest_candidate_id)
      : this.store.getLatestCompileCandidateForSource(source.source_id);
    const sourceClaims = claims.filter((claim) => claim.sourceIds.includes(source.source_id));
    const claimPaths = new Set(sourceClaims.map((claim) => claim.path));
    const sourcePages = pages.filter((page) => page.sources.includes(source.source_id) || claimPaths.has(page.path));
    return {
      ...source,
      compile: {
        model: latestJob?.model || latestCandidate?.model || factLedger?.model || "",
        latestJobId: latestJob?.jobId || "",
        latestJobStatus: latestJob?.status || "",
        latestStage: latestJob?.stage || "",
        startedAt: latestJob?.startedAt || "",
        endedAt: latestJob?.endedAt || "",
        factCount: factLedger?.facts.length || latestCandidate?.claims.length || latestJob?.factCount || 0,
        pageCount: sourcePages.length || latestCandidate?.pages.length || latestJob?.pages.length || 0,
        pageClaimCount: sourceClaims.length,
        mustCoverage: latestJob?.coverage?.mustTotal ? latestJob.coverage.mustCoverage : null,
        blockedIssues:
          latestCandidate?.issues.filter((issue) => issue.kind === "blocked_publish").length ||
          latestJob?.issues.filter((issue) => issue.kind === "blocked_publish").length ||
          0,
        humanReviewIssues:
          latestCandidate?.issues.filter((issue) => issue.kind === "human_review").length ||
          latestJob?.issues.filter((issue) => issue.kind === "human_review").length ||
          0,
        error: latestJob?.error || source.error || "",
      },
    };
  }
}

function summarizePublishGate(jobs: ReturnType<LlmWikiStoreService["listIngestJobs"]>) {
  const latest = jobs[0];
  return {
    latestStatus: latest?.status || "",
    latestStage: latest?.stage || "",
    latestCoverage: latest?.coverage?.mustTotal ? latest.coverage.mustCoverage : null,
    blockedCount: jobs.filter((job) => job.issues.some((issue) => issue.kind === "blocked_publish")).length,
    humanReviewCount: jobs.reduce(
      (total, job) => total + job.issues.filter((issue) => issue.kind === "human_review").length,
      0,
    ),
  };
}

function countBy<T>(items: T[], getter: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = getter(item) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function tryReadCandidate(store: LlmWikiStoreService, candidateId: string) {
  try {
    return store.readCompileCandidate(candidateId);
  } catch {
    return null;
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}
