import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "../../../common/fs-json";
import type { LlmWikiRetrievalService } from "../../llmWiki/services/llm-wiki-retrieval.service";
import type { ModelService } from "../../model/model.service";
import type {
  CompileEvaluationDataset,
  CompileEvaluationExpectedFact,
  CompileEvaluationRun,
  CompileEvaluationWikiSnapshot,
} from "../evaluation.types";
import type { CompileEvaluationStoreService } from "./compile-evaluation-store.service";
import { CompileEvaluationService, summarize } from "./compile-evaluation.service";

test("compile evaluation freezes all pages but sends Judge only pages linked to matched sources", async () => {
  const sourceId = "a".repeat(32);
  const unrelatedSourceId = "b".repeat(32);
  const sourceContent = "P1 TTL is 2 hours";
  const dataset: CompileEvaluationDataset = {
    datasetId: "dataset",
    name: "Dataset",
    uploadedAt: "",
    sources: [{ id: "source-a", filename: "a.md", content: sourceContent, sha256: sha256(sourceContent) }],
    cases: [
      {
        id: "case-a",
        name: "Case A",
        sourceIds: ["source-a"],
        expectedFacts: [expectedFact("fact-a", "P1 TTL is 2 hours")],
      },
    ],
  };
  let run: CompileEvaluationRun | null = null;
  let snapshot: CompileEvaluationWikiSnapshot | null = null;
  const store = {
    getDataset: () => dataset,
    createRun: (args: {
      caseIds: string[];
      judgeModel: string;
      datasetHash: string;
      snapshot: CompileEvaluationWikiSnapshot;
      workerCount: number;
      retryOfRunId: string;
    }) => {
      snapshot = args.snapshot;
      run = {
        runId: "c".repeat(32),
        datasetId: dataset.datasetId,
        datasetName: dataset.name,
        caseIds: args.caseIds,
        judgeModel: args.judgeModel,
        judgeProvider: "default",
        datasetHash: args.datasetHash,
        wikiSnapshotHash: args.snapshot.snapshotHash,
        compilerVersions: args.snapshot.sources.map((item) => item.compilerVersion),
        promptVersions: args.snapshot.sources.map((item) => item.promptVersion),
        compileModels: args.snapshot.sources.map((item) => item.compileModel),
        workerCount: args.workerCount,
        retryOfRunId: args.retryOfRunId,
        status: "running",
        startedAt: "",
        endedAt: "",
        progress: { completed: 0, total: args.caseIds.length, currentCaseId: "" },
        cases: [],
        summary: summarize([]),
        errors: [],
      };
      return run;
    },
    getRun: () => run,
    getSnapshot: () => snapshot,
    saveRun: (next: CompileEvaluationRun) => {
      run = next;
      return next;
    },
    listRuns: () => [],
  };
  const readPaths: string[] = [];
  let judgedPaths: string[] = [];
  const retrieval = {
    getManifest: () => ({
      stats: { sourceCount: 2, readySources: 2, pageCount: 2, factCount: 0, pageClaimCount: 0 },
      schema: { content: "", sha256: "", updated_at: "" },
      index: "",
      pageClaims: [],
      facts: [],
      sources: [
        {
          source_id: sourceId,
          filename: "a.md",
          status: "published",
          touched_pages: ["concepts/a.md"],
          sha256: sha256(sourceContent),
          ingested_at: "2026-06-15T00:00:00.000Z",
        },
        {
          source_id: unrelatedSourceId,
          filename: "b.md",
          status: "ready",
          touched_pages: ["concepts/b.md"],
          sha256: sha256("other"),
          ingested_at: "2026-06-15T00:00:00.000Z",
        },
      ],
      pages: [
        { path: "concepts/a.md", title: "A", type: "concept", tags: [], sources: [sourceId], schema_hash: "", updated_at: "" },
        { path: "concepts/b.md", title: "B", type: "concept", tags: [], sources: [unrelatedSourceId], schema_hash: "", updated_at: "" },
      ],
    }),
    readPage: (path: string) => {
      readPaths.push(path);
      const isRelated = path === "concepts/a.md";
      return {
        path,
        title: isRelated ? "A" : "B",
        type: "concept",
        tags: [],
        sources: [isRelated ? sourceId : unrelatedSourceId],
        schema_hash: "",
        updated_at: "",
        content: isRelated ? "P1 TTL is 2 hours" : "unrelated",
        links: [],
      };
    },
    readPageClaims: () => null,
    listFacts: () => [],
  };
  const model = {
    resolveModel: () => "judge",
    respond: async (request: { messages: Array<{ content: string }> }) => {
      const input = JSON.parse(request.messages[1].content) as { finalWikiPages: Array<{ path: string }> };
      judgedPaths = input.finalWikiPages.map((page) => page.path);
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                facts: [
                  {
                    factId: "fact-a",
                    status: "correct",
                    evidencePath: "concepts/a.md",
                    wikiEvidence: "P1 TTL is 2 hours",
                    confidence: 0.98,
                  },
                ],
              }),
            },
          },
        ],
      };
    },
  };
  const service = new CompileEvaluationService(
    store as unknown as CompileEvaluationStoreService,
    retrieval as unknown as LlmWikiRetrievalService,
    model as unknown as ModelService,
  );

  service.createRun({ datasetId: dataset.datasetId, judgeModel: "judge" });
  await waitFor(() => run?.status === "success");
  const finalRun = store.getRun() as CompileEvaluationRun;

  assert.deepEqual(readPaths, ["concepts/a.md", "concepts/b.md", "concepts/a.md", "concepts/b.md"]);
  assert.deepEqual(judgedPaths, ["concepts/a.md"]);
  assert.equal(finalRun.summary.correct, 1);
  assert.equal(finalRun.summary.weightedScore, 100);
  assert.equal(finalRun.cases[0].matchedSources[0].sourceId, sourceId);
  assert.equal(finalRun.cases[0].facts[0].wikiEvidence, "P1 TTL is 2 hours");
  assert.equal(finalRun.cases[0].facts[0].confidence, 0.98);
});

test("compile evaluation summary counts fact statuses", () => {
  const summary = summarize([
    {
      caseId: "case",
      name: "Case",
      status: "success",
      matchedSources: [],
      pagePaths: [],
      error: "",
      facts: [
        factResult("a", "correct", "must"),
        factResult("b", "missing", "should"),
        factResult("c", "incorrect", "nice"),
      ],
    },
  ]);
  assert.deepEqual(
    {
      total: summary.totalFacts,
      correct: summary.correct,
      missing: summary.missing,
      incorrect: summary.incorrect,
      weightedScore: summary.weightedScore,
      mustAccuracy: summary.mustAccuracy,
      passLevel: summary.passLevel,
    },
    {
      total: 3,
      correct: 1,
      missing: 1,
      incorrect: 1,
      weightedScore: 50,
      mustAccuracy: 1,
      passLevel: "failed",
    },
  );
});

test("compile evaluation pass level gates excellent and pass by must accuracy", () => {
  const lowMustAccuracy = summarize([
    {
      caseId: "case",
      name: "Case",
      status: "success",
      matchedSources: [],
      pagePaths: [],
      error: "",
      facts: [
        ...Array.from({ length: 8 }, (_, index) => factResult(`must-correct-${index}`, "correct", "must")),
        ...Array.from({ length: 2 }, (_, index) => factResult(`must-missing-${index}`, "missing", "must")),
        ...Array.from({ length: 70 }, (_, index) => factResult(`should-correct-${index}`, "correct", "should")),
      ],
    },
  ]);
  const highMustAccuracy = summarize([
    {
      caseId: "case",
      name: "Case",
      status: "success",
      matchedSources: [],
      pagePaths: [],
      error: "",
      facts: Array.from({ length: 20 }, (_, index) => factResult(`must-correct-${index}`, "correct", "must")),
    },
  ]);

  assert.equal(Math.round(lowMustAccuracy.weightedScore), 96);
  assert.equal(lowMustAccuracy.mustAccuracy, 0.8);
  assert.equal(lowMustAccuracy.passLevel, "needs_improvement");
  assert.equal(highMustAccuracy.weightedScore, 100);
  assert.equal(highMustAccuracy.mustAccuracy, 1);
  assert.equal(highMustAccuracy.passLevel, "excellent");
});

test("compile evaluation pass level gates excellent and pass by incorrect rate", () => {
  const passButNotExcellent = summarize([
    {
      caseId: "case",
      name: "Case",
      status: "success",
      matchedSources: [],
      pagePaths: [],
      error: "",
      facts: [
        ...Array.from({ length: 98 }, (_, index) => factResult(`correct-${index}`, "correct", "must")),
        ...Array.from({ length: 2 }, (_, index) => factResult(`incorrect-${index}`, "incorrect", "must")),
      ],
    },
  ]);
  const tooManyIncorrect = summarize([
    {
      caseId: "case",
      name: "Case",
      status: "success",
      matchedSources: [],
      pagePaths: [],
      error: "",
      facts: [
        ...Array.from({ length: 96 }, (_, index) => factResult(`correct-${index}`, "correct", "must")),
        ...Array.from({ length: 4 }, (_, index) => factResult(`incorrect-${index}`, "incorrect", "must")),
      ],
    },
  ]);

  assert.equal(passButNotExcellent.weightedScore, 98);
  assert.equal(passButNotExcellent.incorrectRate, 0.02);
  assert.equal(passButNotExcellent.passLevel, "pass");
  assert.equal(tooManyIncorrect.weightedScore, 96);
  assert.equal(tooManyIncorrect.incorrectRate, 0.04);
  assert.equal(tooManyIncorrect.passLevel, "needs_improvement");
});

test("compile evaluation marks facts missing when source is not compiled", async () => {
  const dataset = createDataset();
  let chatCalled = false;
  const { service, getRun } = createHarness({
    dataset,
    manifestSources: [],
    manifestPages: [],
    readPage: () => {
      throw new Error("readPage should not be called");
    },
    respond: async () => {
      chatCalled = true;
      return { choices: [] };
    },
  });

  service.createRun({ datasetId: dataset.datasetId, judgeModel: "judge" });
  await waitFor(() => getRun()?.status !== "running");
  const finalRun = getRun() as CompileEvaluationRun;

  assert.equal(chatCalled, false);
  assert.equal(finalRun.cases[0].status, "source_missing");
  assert.equal(finalRun.cases[0].facts[0].status, "missing");
  assert.equal(finalRun.cases[0].facts[0].weight, 3);
  assert.equal(finalRun.summary.sourceMissingCases, 1);
  assert.equal(finalRun.summary.missing, 1);
});

test("compile evaluation records failed case when Judge JSON is invalid", async () => {
  const dataset = createDataset();
  const sourceId = "a".repeat(32);
  const { service, getRun } = createHarness({
    dataset,
    manifestSources: [
      {
        source_id: sourceId,
        filename: "a.md",
        status: "ready",
        touched_pages: ["concepts/a.md"],
        sha256: dataset.sources[0].sha256,
        ingested_at: "2026-06-15T00:00:00.000Z",
      },
    ],
    manifestPages: [
      { path: "concepts/a.md", title: "A", type: "concept", tags: [], sources: [sourceId], schema_hash: "", updated_at: "" },
    ],
    readPage: (path: string) => ({
      path,
      title: "A",
      type: "concept",
      tags: [],
      sources: [sourceId],
      schema_hash: "",
      updated_at: "",
      content: "P1 TTL is 2 hours",
      links: [],
    }),
    respond: async () => ({ choices: [{ message: { content: "not json" } }] }),
  });

  service.createRun({ datasetId: dataset.datasetId, judgeModel: "judge" });
  await waitFor(() => getRun()?.status !== "running");
  const finalRun = getRun() as CompileEvaluationRun;

  assert.equal(finalRun.status, "partial");
  assert.equal(finalRun.cases[0].status, "evaluation_failed");
  assert.match(finalRun.cases[0].error, /Judge 未返回合法 JSON/);
  assert.equal(finalRun.summary.failedCases, 1);
  assert.equal(finalRun.summary.totalFacts, 0);
});

test("compile evaluation does not count correct when Judge evidence is not in final pages", async () => {
  const dataset = createDataset();
  const sourceId = "a".repeat(32);
  const { service, getRun } = createHarness({
    dataset,
    manifestSources: [
      {
        source_id: sourceId,
        filename: "a.md",
        status: "ready",
        touched_pages: ["concepts/a.md"],
        sha256: dataset.sources[0].sha256,
        ingested_at: "2026-06-15T00:00:00.000Z",
      },
    ],
    manifestPages: [
      { path: "concepts/a.md", title: "A", type: "concept", tags: [], sources: [sourceId], schema_hash: "", updated_at: "" },
    ],
    readPage: (path: string) => ({
      path,
      title: "A",
      type: "concept",
      tags: [],
      sources: [sourceId],
      schema_hash: "",
      updated_at: "",
      content: "P1 TTL is 2 hours",
      links: [],
    }),
    respond: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              facts: [
                {
                  factId: "fact-a",
                  status: "correct",
                  evidencePath: "concepts/a.md",
                  wikiEvidence: "unsupported sentence",
                  confidence: 0.9,
                },
              ],
            }),
          },
        },
      ],
    }),
  });

  service.createRun({ datasetId: dataset.datasetId, judgeModel: "judge" });
  await waitFor(() => getRun()?.status === "success");
  const finalRun = getRun() as CompileEvaluationRun;

  assert.equal(finalRun.cases[0].facts[0].status, "missing");
  assert.equal(finalRun.cases[0].facts[0].unsupportedCorrect, true);
  assert.equal(finalRun.summary.correct, 0);
  assert.equal(finalRun.summary.unsupportedCorrect, 1);
});

test("compile evaluation uses configured worker concurrency and keeps all results", async () => {
  const dataset = createDataset(25);
  const sourceId = "a".repeat(32);
  let activeCalls = 0;
  let maxActiveCalls = 0;
  let totalCalls = 0;
  const { service, getRun } = createHarness({
    dataset,
    manifestSources: [
      {
        source_id: sourceId,
        filename: "a.md",
        status: "published",
        touched_pages: ["concepts/a.md"],
        sha256: dataset.sources[0].sha256,
        ingested_at: "2026-06-15T00:00:00.000Z",
      },
    ],
    manifestPages: [
      { path: "concepts/a.md", title: "A", type: "concept", tags: [], sources: [sourceId], schema_hash: "", updated_at: "" },
    ],
    readPage: (path: string) => ({
      path,
      title: "A",
      type: "concept",
      tags: [],
      sources: [sourceId],
      schema_hash: "",
      updated_at: "",
      content: "P1 TTL is 2 hours",
      links: [],
    }),
    respond: async () => {
      activeCalls += 1;
      totalCalls += 1;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
      await new Promise((resolve) => setTimeout(resolve, 20));
      activeCalls -= 1;
      return { choices: [{ message: { content: JSON.stringify({ facts: [] }) } }] };
    },
  });

  service.createRun({ datasetId: dataset.datasetId, judgeModel: "judge", concurrency: 3 });
  await waitFor(() => getRun()?.status === "success");
  const finalRun = getRun() as CompileEvaluationRun;

  assert.equal(totalCalls, 25);
  assert.equal(maxActiveCalls, 3);
  assert.equal(finalRun.cases.length, 25);
  assert.equal(finalRun.progress.completed, 25);
  assert.deepEqual(finalRun.cases.map((item) => item.caseId), dataset.cases.map((item) => item.id));
});

test("compile evaluation retries only infrastructure-failed cases in a new linked run", async () => {
  const dataset = createDataset();
  const sourceId = "a".repeat(32);
  let callCount = 0;
  const { service, getRun } = createHarness({
    dataset,
    manifestSources: [
      {
        source_id: sourceId,
        filename: "a.md",
        status: "published",
        touched_pages: ["concepts/a.md"],
        sha256: dataset.sources[0].sha256,
        ingested_at: "2026-06-15T00:00:00.000Z",
      },
    ],
    manifestPages: [
      { path: "concepts/a.md", title: "A", type: "concept", tags: [], sources: [sourceId], schema_hash: "", updated_at: "" },
    ],
    readPage: (path: string) => ({
      path,
      title: "A",
      type: "concept",
      tags: [],
      sources: [sourceId],
      schema_hash: "",
      updated_at: "",
      content: "P1 TTL is 2 hours",
      links: [],
    }),
    respond: async () => {
      callCount += 1;
      if (callCount === 1) return { choices: [{ message: { content: "not json" } }] };
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                facts: [
                  {
                    factId: "fact-a",
                    status: "correct",
                    evidencePath: "concepts/a.md",
                    wikiEvidence: "P1 TTL is 2 hours",
                  },
                ],
              }),
            },
          },
        ],
      };
    },
  });

  const first = service.createRun({ datasetId: dataset.datasetId, judgeModel: "judge" });
  await waitFor(() => getRun()?.status === "partial");
  const retry = service.retryFailed(first.runId, {});

  assert.deepEqual(retry.caseIds, ["case-a"]);
  assert.equal(retry.retryOfRunId, first.runId);
  await waitFor(() => getRun()?.status === "success");
  assert.equal((getRun() as CompileEvaluationRun).summary.correct, 1);
});

function expectedFact(id: string, fact: string, importance: CompileEvaluationExpectedFact["importance"] = "must"): CompileEvaluationExpectedFact {
  return {
    id,
    fact,
    sourceFile: "a.md",
    evidence: fact,
    type: "config",
    importance,
  };
}

function createDataset(caseCount = 1): CompileEvaluationDataset {
  const sourceContent = "P1 TTL is 2 hours";
  const cases =
    caseCount === 1
      ? [
          {
            id: "case-a",
            name: "Case A",
            sourceIds: ["source-a"],
            expectedFacts: [expectedFact("fact-a", sourceContent)],
          },
        ]
      : Array.from({ length: caseCount }, (_, index) => ({
          id: `case-${index + 1}`,
          name: `Case ${index + 1}`,
          sourceIds: ["source-a"],
          expectedFacts: [expectedFact(`fact-${index + 1}`, sourceContent)],
        }));
  return {
    datasetId: "dataset",
    name: "Dataset",
    uploadedAt: "",
    sources: [{ id: "source-a", filename: "a.md", content: sourceContent, sha256: sha256(sourceContent) }],
    cases,
  };
}

function createHarness(args: {
  dataset: CompileEvaluationDataset;
  manifestSources: unknown[];
  manifestPages: unknown[];
  readPage: (path: string) => unknown;
  readPageClaims?: (path: string) => unknown;
  listFacts?: (sourceIds?: string[]) => unknown[];
  respond: () => Promise<unknown>;
}) {
  let run: CompileEvaluationRun | null = null;
  let snapshot: CompileEvaluationWikiSnapshot | null = null;
  const store = {
    getDataset: () => args.dataset,
    createRun: (input: {
      caseIds: string[];
      judgeModel: string;
      datasetHash: string;
      snapshot: CompileEvaluationWikiSnapshot;
      workerCount: number;
      retryOfRunId: string;
    }) => {
      snapshot = input.snapshot;
      run = {
        runId: "c".repeat(32),
        datasetId: args.dataset.datasetId,
        datasetName: args.dataset.name,
        caseIds: input.caseIds,
        judgeModel: input.judgeModel,
        judgeProvider: "default",
        datasetHash: input.datasetHash,
        wikiSnapshotHash: input.snapshot.snapshotHash,
        compilerVersions: input.snapshot.sources.map((item) => item.compilerVersion),
        promptVersions: input.snapshot.sources.map((item) => item.promptVersion),
        compileModels: input.snapshot.sources.map((item) => item.compileModel),
        workerCount: input.workerCount,
        retryOfRunId: input.retryOfRunId,
        status: "running",
        startedAt: "",
        endedAt: "",
        progress: { completed: 0, total: input.caseIds.length, currentCaseId: "" },
        cases: [],
        summary: summarize([]),
        errors: [],
      };
      return run;
    },
    getRun: () => run,
    getSnapshot: () => snapshot,
    saveRun: (next: CompileEvaluationRun) => {
      run = next;
      return next;
    },
    listRuns: () => [],
  };
  const retrieval = {
    getManifest: () => ({
      stats: {
        sourceCount: args.manifestSources.length,
        readySources: args.manifestSources.length,
        pageCount: args.manifestPages.length,
        factCount: 0,
        pageClaimCount: 0,
      },
      schema: { content: "", sha256: "", updated_at: "" },
      index: "",
      pageClaims: [],
      facts: [],
      sources: args.manifestSources,
      pages: args.manifestPages,
    }),
    readPage: args.readPage,
    readPageClaims: args.readPageClaims || (() => null),
    listFacts: args.listFacts || (() => []),
  };
  const model = {
    resolveModel: () => "judge",
    respond: args.respond,
  };
  return {
    service: new CompileEvaluationService(
      store as unknown as CompileEvaluationStoreService,
      retrieval as unknown as LlmWikiRetrievalService,
      model as unknown as ModelService,
    ),
    getRun: store.getRun,
  };
}

function factResult(id: string, status: "correct" | "missing" | "incorrect", importance: CompileEvaluationExpectedFact["importance"]) {
  const base = expectedFact(id, id, importance);
  const weight = importance === "must" ? 3 : importance === "should" ? 2 : 1;
  return {
    ...base,
    status,
    evidencePath: "",
    wikiEvidence: "",
    reason: "",
    confidence: null,
    weight,
    score: status === "correct" ? weight : 0,
    coveredByClaims: false,
    judgeNeedsReview: false,
    unsupportedCorrect: false,
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timeout");
}
