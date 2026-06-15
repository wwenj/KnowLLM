import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "../../../common/fs-json";
import type { LlmWikiRetrievalService } from "../../llmWiki/services/llm-wiki-retrieval.service";
import type { ModelService } from "../../model/model.service";
import type { CompileEvaluationDataset, CompileEvaluationRun } from "../evaluation.types";
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
        expectedFacts: [{ id: "fact-a", fact: "P1 TTL is 2 hours" }],
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
              facts: [{ factId: "fact-a", status: "correct", evidencePath: "concepts/a.md", evidence: "2 hours" }],
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
  assert.equal(finalRun.cases[0].matchedSources[0].sourceId, sourceId);
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
        { id: "a", fact: "a", status: "correct", evidencePath: "", evidence: "", reason: "" },
        { id: "b", fact: "b", status: "missing", evidencePath: "", evidence: "", reason: "" },
        { id: "c", fact: "c", status: "incorrect", evidencePath: "", evidence: "", reason: "" },
      ],
    },
  ]);
  assert.deepEqual(
    { total: summary.totalFacts, correct: summary.correct, missing: summary.missing, incorrect: summary.incorrect },
    { total: 3, correct: 1, missing: 1, incorrect: 1 },
  );
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timeout");
}
