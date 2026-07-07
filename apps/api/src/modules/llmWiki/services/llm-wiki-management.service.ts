import { Injectable, OnModuleInit } from "@nestjs/common";
import type {
  LlmWikiLintMode,
  LlmWikiSourceArtifacts,
  LlmWikiSourceMeta,
  LlmWikiSourceWithCompile,
} from "../contracts/llm-wiki.types";
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
        factCount: claim.factIds.length,
        sourceIds: claim.sourceIds,
        updatedAt: claim.updatedAt,
      })),
      pages,
      latestJob,
    };
  }

  uploadSource(filename: string, data: Buffer) {
    return this.store.createSource(filename, data);
  }

  ingestSource(sourceId: string, model = "") {
    return this.ingest.ingestSource(sourceId, model);
  }

  stopIngest(sourceId: string) {
    const result = this.ingest.stopIngest(sourceId);
    this.search.invalidate();
    return result;
  }

  renameSource(sourceId: string, filename: string) {
    return this.store.renameSource(sourceId, filename);
  }

  deleteSource(sourceId: string, model = "") {
    const rebuildSourceIds = this.store
      .listSources()
      .filter((source) => source.source_id !== sourceId && source.status === "ready")
      .map((source) => source.source_id);
    this.store.deleteSourceCascade(sourceId);
    const rebuildJobs = this.ingest.reingestSources(rebuildSourceIds, model);
    this.search.invalidate();
    return { ok: true, source_id: sourceId, rebuildJobs };
  }

  getIngestJob(jobId: string) {
    return this.store.getIngestJob(jobId);
  }

  rebuild(model = "") {
    const jobs = this.ingest.rebuildAll(model);
    this.search.invalidate();
    return { ok: true, jobs };
  }

  getSchema() {
    return this.schema.read();
  }

  saveSchema(content: string) {
    return this.schema.save(content);
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

  private enrichSources(sources: LlmWikiSourceMeta[]): LlmWikiSourceWithCompile[] {
    const jobs = this.store.listIngestJobs(100);
    const pages = this.store.listPageRefs();
    const claims = this.store.listPageClaims();
    return sources.map((source) => this.enrichSource(source, jobs, pages, claims));
  }

  private enrichSource(
    source: LlmWikiSourceMeta,
    jobs = this.store.listIngestJobs(100),
    pages = this.store.listPageRefs(),
    claims = this.store.listPageClaims(),
  ): LlmWikiSourceWithCompile {
    const latestJob = jobs.find((job) => job.sourceId === source.source_id);
    const factLedger = this.store.readFactLedger(source.source_id);
    const sourceClaims = claims.filter((claim) => claim.sourceIds.includes(source.source_id));
    const claimPaths = new Set(sourceClaims.map((claim) => claim.path));
    const sourcePages = pages.filter((page) => page.sources.includes(source.source_id) || claimPaths.has(page.path));
    return {
      ...source,
      compile: {
        model: latestJob?.model || factLedger?.model || "",
        latestJobId: latestJob?.jobId || "",
        latestJobStatus: latestJob?.status || "",
        latestStage: latestJob?.stage || "",
        startedAt: latestJob?.startedAt || "",
        endedAt: latestJob?.endedAt || "",
        factCount: factLedger?.facts.length || latestJob?.factCount || 0,
        pageCount: sourcePages.length || latestJob?.pages.length || 0,
        pageClaimCount: sourceClaims.length,
        mustCoverage: latestJob?.coverage?.mustCoverage ?? null,
        blockedIssues: latestJob?.issues.filter((issue) => issue.kind === "blocked_publish").length || 0,
        humanReviewIssues: latestJob?.issues.filter((issue) => issue.kind === "human_review").length || 0,
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
    latestCoverage: latest?.coverage?.mustCoverage ?? null,
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
