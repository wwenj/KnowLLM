import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "../../../common/fs-json";
import type { LlmWikiRetrievalService } from "../../llmWiki/services/llm-wiki-retrieval.service";
import type { ModelService } from "../../model/model.service";
import type { CompileEvaluationDataset, CompileEvaluationExpectedFact, CompileEvaluationRun } from "../evaluation.types";
import type { CompileEvaluationStoreService } from "./compile-evaluation-store.service";
import { CompileEvaluationService, summarize } from "./compile-evaluation.service";

test("compile evaluation reads only pages linked to matched ready sources", async () => {
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
  const store = {
    getDataset: () => dataset,
    createRun: ({ caseIds, judgeModel }: { caseIds: string[]; judgeModel: string }) => {
      run = {
        runId: "c".repeat(32),
        datasetId: dataset.datasetId,
        datasetName: dataset.name,
        caseIds,
        judgeModel,
        status: "running",
        startedAt: "",
        endedAt: "",
        progress: { completed: 0, total: caseIds.length, currentCaseId: "" },
        cases: [],
        summary: summarize([]),
        errors: [],
      };
      return run;
    },
    getRun: () => run,
    saveRun: (next: CompileEvaluationRun) => {
      run = next;
      return next;
    },
    listRuns: () => [],
  };
  const readPaths: string[] = [];
  const retrieval = {
    getManifest: () => ({
      stats: { sourceCount: 2, readySources: 2, pageCount: 2 },
      schema: { content: "", sha256: "", updated_at: "" },
      index: "",
      sources: [
        {
          source_id: sourceId,
          filename: "a.md",
          status: "ready",
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
      return {
        path,
        title: "A",
        type: "concept",
        tags: [],
        sources: [sourceId],
        schema_hash: "",
        updated_at: "",
        content: "P1 TTL is 2 hours",
        links: [],
      };
    },
  };
  const model = {
    resolveModel: () => "judge",
    chat: async () => ({
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
    }),
  };
  const service = new CompileEvaluationService(
    store as unknown as CompileEvaluationStoreService,
    retrieval as unknown as LlmWikiRetrievalService,
    model as unknown as ModelService,
  );

  service.createRun({ datasetId: dataset.datasetId, judgeModel: "judge" });
  await waitFor(() => run?.status === "success");
  const finalRun = store.getRun() as CompileEvaluationRun;

  assert.deepEqual(readPaths, ["concepts/a.md"]);
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
    chat: async () => {
      chatCalled = true;
      return { choices: [] };
    },
  });

  service.createRun({ datasetId: dataset.datasetId, judgeModel: "judge" });
  await waitFor(() => getRun()?.status === "success");
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
    chat: async () => ({ choices: [{ message: { content: "not json" } }] }),
  });

  service.createRun({ datasetId: dataset.datasetId, judgeModel: "judge" });
  await waitFor(() => getRun()?.status === "success");
  const finalRun = getRun() as CompileEvaluationRun;

  assert.equal(finalRun.cases[0].status, "failed");
  assert.match(finalRun.cases[0].error, /Judge 未返回合法 JSON/);
  assert.equal(finalRun.summary.failedCases, 1);
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

function createDataset(): CompileEvaluationDataset {
  const sourceContent = "P1 TTL is 2 hours";
  return {
    datasetId: "dataset",
    name: "Dataset",
    uploadedAt: "",
    sources: [{ id: "source-a", filename: "a.md", content: sourceContent, sha256: sha256(sourceContent) }],
    cases: [
      {
        id: "case-a",
        name: "Case A",
        sourceIds: ["source-a"],
        expectedFacts: [expectedFact("fact-a", sourceContent)],
      },
    ],
  };
}

function createHarness(args: {
  dataset: CompileEvaluationDataset;
  manifestSources: unknown[];
  manifestPages: unknown[];
  readPage: (path: string) => unknown;
  chat: () => Promise<unknown>;
}) {
  let run: CompileEvaluationRun | null = null;
  const store = {
    getDataset: () => args.dataset,
    createRun: ({ caseIds, judgeModel }: { caseIds: string[]; judgeModel: string }) => {
      run = {
        runId: "c".repeat(32),
        datasetId: args.dataset.datasetId,
        datasetName: args.dataset.name,
        caseIds,
        judgeModel,
        status: "running",
        startedAt: "",
        endedAt: "",
        progress: { completed: 0, total: caseIds.length, currentCaseId: "" },
        cases: [],
        summary: summarize([]),
        errors: [],
      };
      return run;
    },
    getRun: () => run,
    saveRun: (next: CompileEvaluationRun) => {
      run = next;
      return next;
    },
    listRuns: () => [],
  };
  const retrieval = {
    getManifest: () => ({
      stats: { sourceCount: args.manifestSources.length, readySources: args.manifestSources.length, pageCount: args.manifestPages.length },
      schema: { content: "", sha256: "", updated_at: "" },
      index: "",
      sources: args.manifestSources,
      pages: args.manifestPages,
    }),
    readPage: args.readPage,
  };
  const model = {
    resolveModel: () => "judge",
    chat: args.chat,
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
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timeout");
}
