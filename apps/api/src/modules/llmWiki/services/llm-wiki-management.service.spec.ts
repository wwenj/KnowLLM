import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { ModelService } from "../../model/model.service";
import type { LlmWikiCompileCandidate, LlmWikiCompilePlan } from "../contracts/llm-wiki.types";
import { compilerPromptHash, type LlmWikiCompilerService } from "./llm-wiki-compiler.service";
import { LlmWikiIngestService } from "./llm-wiki-ingest.service";
import type { LlmWikiIssueService } from "./llm-wiki-issue.service";
import type { LlmWikiLintService } from "./llm-wiki-lint.service";
import { LlmWikiManagementService } from "./llm-wiki-management.service";
import type { LlmWikiSchemaService } from "./llm-wiki-schema.service";
import type { LlmWikiSearchService } from "./llm-wiki-search.service";
import type { LlmWikiStoreService } from "./llm-wiki-store.service";
import { llmWikiConfig } from "../llm-wiki.config";

test("compile without confirmHash only returns estimate and creates no job", () => {
  const sourceId = "a".repeat(32);
  let resolveModelCalls = 0;
  let createdJobs = 0;
  const service = new LlmWikiIngestService(
    {
      getSource: () => ({ source_id: sourceId, filename: "a.md", status: "raw_uploaded" }),
      readSource: () => "# A",
      readAnalysisArtifact: () => null,
      listPageRefs: () => [],
      createIngestJob: () => {
        createdJobs += 1;
        throw new Error("must not create job");
      },
    } as unknown as LlmWikiStoreService,
    { estimateAnalyzePlan: () => plan(sourceId, "hash-a", "analyze") } as unknown as LlmWikiCompilerService,
    { invalidate: () => undefined } as unknown as LlmWikiSearchService,
    { read: () => ({ content: "# Schema", sha256: "schema", updated_at: "" }) } as unknown as LlmWikiSchemaService,
    { resolveModel: () => {
      resolveModelCalls += 1;
      return "provider:model";
    } } as unknown as ModelService,
  );

  const result = service.compileSources([sourceId], "provider:model");

  assert.equal(result.requiresConfirmation, true);
  assert.equal(result.plan.maxModelCalls, 1);
  assert.equal(resolveModelCalls, 1);
  assert.equal(createdJobs, 0);
});

test("bulk estimate blocks mixed analyze and compose phases instead of silently reanalyzing", () => {
  const analyzedSourceId = "a".repeat(32);
  const rawSourceId = "d".repeat(32);
  const service = new LlmWikiIngestService(
    {
      getSource: (sourceId: string) => ({ source_id: sourceId, filename: `${sourceId[0]}.md`, status: "raw_uploaded" }),
      readSource: (sourceId: string) => sourceId === analyzedSourceId ? "# A" : "# D",
      readAnalysisArtifact: (sourceId: string) => sourceId === analyzedSourceId ? analysisFor(sourceId, "# A") : null,
      listPageRefs: () => [],
    } as unknown as LlmWikiStoreService,
    {
      estimateAnalyzePlan: ({ sourceId }: { sourceId: string }) => plan(sourceId, `analyze-${sourceId}`, "analyze"),
      estimateComposePlan: ({ sourceId }: { sourceId: string }) => plan(sourceId, `compose-${sourceId}`, "compose"),
    } as unknown as LlmWikiCompilerService,
    { invalidate: () => undefined } as unknown as LlmWikiSearchService,
    { read: () => ({ content: "# Schema", sha256: "schema", updated_at: "" }) } as unknown as LlmWikiSchemaService,
    { resolveModel: () => "provider:model" } as unknown as ModelService,
  );

  const estimate = service.estimateCompile([analyzedSourceId, rawSourceId], "provider:model");

  assert.equal(estimate.plan.blocked, true);
  assert.match(estimate.plan.reason, /按阶段分批执行/);
  assert.deepEqual(estimate.sourcePlans.map((item) => item.phase), ["compose", "analyze"]);
});

test("unchanged source/schema/prompt hash reuses candidate with zero model calls", () => {
  const sourceId = "b".repeat(32);
  const candidate = candidateFor(sourceId, "hash-b");
  let createdJobs = 0;
  let compileCalls = 0;
  let publishedCandidateId = "";
  const service = new LlmWikiIngestService(
    {
      getSource: () => ({
        source_id: sourceId,
        filename: "b.md",
        status: "candidate_ready",
        latest_candidate_id: candidate.candidateId,
        latest_compile_hash: "hash-b",
      }),
      readSource: () => "# B",
      readAnalysisArtifact: () => analysisFor(sourceId, "# B"),
      listPageRefs: () => [],
      readCompileCandidate: () => candidate,
      getLatestCompileCandidateForSource: () => candidate,
      publishCandidate: (candidateId: string) => {
        publishedCandidateId = candidateId;
        return { publishedPages: [] };
      },
      updateSource: () => ({}),
      createIngestJob: () => {
        createdJobs += 1;
        throw new Error("must not create job");
      },
    } as unknown as LlmWikiStoreService,
    {
      estimateComposePlan: () => plan(sourceId, "hash-b", "compose"),
      composeSource: () => {
        compileCalls += 1;
        throw new Error("must not compile");
      },
    } as unknown as LlmWikiCompilerService,
    { invalidate: () => undefined } as unknown as LlmWikiSearchService,
    { read: () => ({ content: "# Schema", sha256: "schema", updated_at: "" }) } as unknown as LlmWikiSchemaService,
    { resolveModel: () => "provider:model" } as unknown as ModelService,
  );
  const estimate = service.estimateCompile([sourceId], "provider:model");

  const result = service.compileSources([sourceId], "provider:model", estimate.plan.hash);

  assert.equal(result.requiresConfirmation, false);
  assert.equal("skipped" in result ? result.skipped.length : 0, 1);
  assert.equal("jobs" in result ? result.jobs.length : -1, 0);
  assert.equal(createdJobs, 0);
  assert.equal(compileCalls, 0);
  assert.equal(publishedCandidateId, candidate.candidateId);
});

test("confirmed analyze stops at analysis_ready and does not publish", async () => {
  const sourceId = "c".repeat(32);
  const reports = new Map<string, any>();
  let analyzed = 0;
  let savedAnalysis = 0;
  let publishedCandidateId = "";
  const store = {
    getSource: () => ({ source_id: sourceId, filename: "c.md", status: "raw_uploaded", latest_candidate_id: "", latest_compile_hash: "" }),
    readSource: () => "# C",
    readAnalysisArtifact: () => null,
    listPageRefs: () => [],
    createIngestJob: (id: string, model: string) => {
      const report = {
        jobId: "1".repeat(32),
        sourceId: id,
        status: "running" as const,
        stage: "queued",
        model,
        startedAt: "2026-07-08T00:00:00.000Z",
        endedAt: "",
        pages: [],
        factCount: 0,
        coverage: { mustTotal: 0, mustCovered: 0, mustCoverage: 0, missingMustFactIds: [] },
        issues: [],
        error: "",
        events: [],
      };
      reports.set(report.jobId, report);
      return report;
    },
    saveIngestJob: (report: any) => {
      reports.set(report.jobId, report);
      return report;
    },
    getIngestJob: (jobId: string) => reports.get(jobId),
    prepareIngest: () => ({}),
    saveSourceMap: () => undefined,
    saveFactLedger: () => undefined,
    saveAnalysisArtifact: () => { savedAnalysis += 1; },
    updateSource: () => ({}),
    publishCandidate: (candidateId: string) => {
      publishedCandidateId = candidateId;
      return { publishedPages: [`summaries/${sourceId}.md`] };
    },
    markIngestFailed: () => {
      throw new Error("must not fail");
    },
    appendLog: () => undefined,
  };
  const service = new LlmWikiIngestService(
    store as unknown as LlmWikiStoreService,
    {
      estimateAnalyzePlan: () => plan(sourceId, "hash-c", "analyze"),
      analyzeSource: async () => {
        analyzed += 1;
        return analysisFor(sourceId, "# C");
      },
    } as unknown as LlmWikiCompilerService,
    { invalidate: () => undefined } as unknown as LlmWikiSearchService,
    { read: () => ({ content: "# Schema", sha256: "schema", updated_at: "" }) } as unknown as LlmWikiSchemaService,
    { resolveModel: () => "provider:model" } as unknown as ModelService,
  );

  const estimate = service.estimateCompile([sourceId], "provider:model");
  const result = service.compileSources([sourceId], "provider:model", estimate.plan.hash);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal("jobs" in result ? result.jobs.length : 0, 1);
  assert.equal(analyzed, 1);
  assert.equal(savedAnalysis, 1);
  assert.equal(publishedCandidateId, "");
  assert.equal(reports.get("1".repeat(32))?.stage, "analysis_ready");
});

test("rebuildAll is manifest-only and does not enqueue LLM compiles", () => {
  let rebuilt = 0;
  let createdJobs = 0;
  const service = new LlmWikiIngestService(
    {
      rebuildWikiIndex: () => {
        rebuilt += 1;
      },
      createIngestJob: () => {
        createdJobs += 1;
        throw new Error("must not create job");
      },
    } as unknown as LlmWikiStoreService,
    {} as LlmWikiCompilerService,
    {} as LlmWikiSearchService,
    {} as LlmWikiSchemaService,
    { resolveModel: () => "provider:model" } as unknown as ModelService,
  );

  const jobs = service.rebuildAll("provider:model");

  assert.deepEqual(jobs, []);
  assert.equal(rebuilt, 1);
  assert.equal(createdJobs, 0);
});

test("deleting a source marks stale pages and does not reingest remaining sources", () => {
  const calls: string[] = [];
  const service = new LlmWikiManagementService(
    {
      deleteSourceCascade: () => ({ touched_pages: ["summaries/a.md"], needs_reconcile: [], stale_markers: [] }),
    } as unknown as LlmWikiStoreService,
    {
      reingestSources: () => {
        calls.push("reingest");
        throw new Error("must not reingest");
      },
    } as unknown as LlmWikiIngestService,
    { list: () => ({ items: [] }), resolve: (id: string) => ({ id }) } as unknown as LlmWikiIssueService,
    { invalidate: () => calls.push("invalidate") } as unknown as LlmWikiSearchService,
    {} as LlmWikiSchemaService,
    {} as LlmWikiLintService,
  );

  const result = service.deleteSource("a".repeat(32));

  assert.deepEqual(result.stalePages, ["summaries/a.md"]);
  assert.deepEqual(calls, ["invalidate"]);
});

test("listIssues returns structural lint issues", () => {
  const issue = {
    id: "1".repeat(32),
    kind: "dead_link",
    severity: "warning",
    status: "open",
    target: "concepts/a.md",
    message: "死链：[[concepts/missing.md]]",
    details: "",
    source_ids: [],
    created_at: "2026-07-09T00:00:00.000Z",
    updated_at: "2026-07-09T00:00:00.000Z",
  };
  const service = new LlmWikiManagementService(
    {} as LlmWikiStoreService,
    {} as LlmWikiIngestService,
    { list: () => ({ items: [issue] }) } as unknown as LlmWikiIssueService,
    {} as LlmWikiSearchService,
    {} as LlmWikiSchemaService,
    {} as LlmWikiLintService,
  );

  assert.deepEqual(service.listIssues("open").items, [issue]);
});

function plan(sourceId: string, hash: string, phase: "analyze" | "compose" = "analyze"): LlmWikiCompilePlan {
  return {
    phase,
    planId: hash,
    planHash: hash,
    sourceIds: [sourceId],
    hash,
    schemaHash: "schema",
    compilerVersion: "source-integration-v1",
    promptVersion: "integration-patch-v1",
    sourceHash: "source",
    model: "provider:model",
    estimatedCalls: 1,
    estimatedTokens: 150,
    maxTokens: 300,
    callPlan: [{ stage: "analyze", expectedCalls: 1, maxCalls: 1 }],
    estimatedInputTokens: 100,
    estimatedOutputTokens: 50,
    estimatedCostUsd: 0.001,
    maxModelCalls: 1,
    affectedPageCandidates: [`summaries/${sourceId}.md`],
    requiresDigest: false,
    blocked: false,
    reason: "",
    createdAt: "2026-07-08T00:00:00.000Z",
  };
}

function analysisFor(sourceId: string, source: string) {
  return {
    sourceId,
    sourceHash: createHash("sha256").update(source).digest("hex"),
    schemaHash: "schema",
    model: "provider:model",
    compilerVersion: llmWikiConfig.compilerVersion,
    promptVersion: llmWikiConfig.promptVersion,
    modelHash: createHash("sha256").update("provider:model").digest("hex"),
    promptHash: compilerPromptHash(),
    analysisHash: "analysis-hash",
    planHash: "analysis-plan",
    sourceMap: { sourceId, filename: "source.md", sha256: "sha", title: "Source", sections: [] },
    factLedger: { sourceId, schemaHash: "schema", model: "provider:model", generatedAt: "", facts: [] },
    pagePlan: [],
    usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, retries: 0, calls: [] },
    createdAt: "2026-07-13T00:00:00.000Z",
  };
}

function candidateFor(sourceId: string, hash: string): LlmWikiCompileCandidate {
  return {
    candidateId: "c".repeat(32),
    sourceId,
    plan: plan(sourceId, hash, "compose"),
    status: "candidate_ready",
    model: "provider:model",
    schemaHash: "schema",
    compilerVersion: "source-integration-v1",
    promptVersion: "integration-patch-v1",
    sourceHash: "source",
    sourceTitle: "B",
    pages: [
      {
        path: `summaries/${sourceId}.md`,
        title: "B",
        type: "summary",
        tags: ["summary"],
        body: "# B\n",
        sourceIds: [sourceId],
        action: "create",
      },
    ],
    claims: [],
    affectedPages: [`summaries/${sourceId}.md`],
    issues: [],
    modelUsage: { modelCalls: 1, inputTokens: 100, outputTokens: 50, estimatedCostUsd: 0.001, retries: 0, calls: [] },
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
  };
}
