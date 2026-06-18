import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "../../../common/fs-json";
import type { AgentRunDetail } from "../../agent/agent.types";
import type { AgentRunExecutionService } from "../../agent/services/agent-run-execution.service";
import type { LlmWikiRetrievalService } from "../../llmWiki/services/llm-wiki-retrieval.service";
import type { ModelService } from "../../model/model.service";
import type { AgentEvaluationDataset, AgentEvaluationRun } from "../evaluation.types";
import type { AgentEvaluationStoreService } from "./agent-evaluation-store.service";
import { AgentEvaluationService, summarizeAgentEvaluation } from "./agent-evaluation.service";

test("agent evaluation starts a normal llmWiki agent run and judges its result", async () => {
  const sourceId = "a".repeat(32);
  const sourceContent = "TTL is 2 hours.";
  const dataset: AgentEvaluationDataset = {
    datasetId: "dataset",
    name: "Dataset",
    uploadedAt: "",
    sources: [{ id: "source-a", filename: "a.md", content: sourceContent, sha256: sha256(sourceContent) }],
    cases: [
      {
        id: "A001",
        question: "What is the TTL?",
        answerable: true,
        expectedAnswer: "TTL is 2 hours.",
        expectedFacts: [{ id: "A001-F01", fact: "TTL is 2 hours." }],
        relevantSourceIds: ["source-a"],
        mustInclude: ["TTL"],
        evaluationType: "single_doc_fact",
      },
    ],
  };

  let run: AgentEvaluationRun | null = null;
  const store = {
    getDataset: () => dataset,
    createRun: ({
      caseIds,
      judgeModel,
      sourcePolicy,
      budget,
      models,
    }: Pick<AgentEvaluationRun, "caseIds" | "judgeModel" | "sourcePolicy" | "budget" | "models">) => {
      run = {
        runId: "c".repeat(32),
        datasetId: dataset.datasetId,
        datasetName: dataset.name,
        caseIds,
        judgeModel,
        sourcePolicy,
        budget,
        models,
        status: "running",
        startedAt: "",
        endedAt: "",
        progress: { completed: 0, total: caseIds.length, currentCaseId: "" },
        cases: [],
        summary: summarizeAgentEvaluation([]),
        errors: [],
      };
      return run;
    },
    getRun: () => run,
    saveRun: (next: AgentEvaluationRun) => {
      run = next;
      return next;
    },
    listRuns: () => [],
  };
  const retrieval = {
    getManifest: () => ({
      stats: { sourceCount: 1, readySources: 1, pageCount: 1 },
      schema: { content: "", sha256: "", updated_at: "" },
      index: "",
      pages: [],
      sources: [
        {
          source_id: sourceId,
          filename: "a.md",
          status: "ready",
          touched_pages: ["concepts/a.md"],
          sha256: sha256(sourceContent),
          ingested_at: "2026-06-15T00:00:00.000Z",
        },
      ],
    }),
  };

  let executionStarted = false;
  const agentRunId = "d".repeat(32);
  const agentDetail: AgentRunDetail = {
    runId: agentRunId,
    agentType: "llmWiki",
    title: "TTL",
    status: "success",
    startedAt: "",
    endedAt: "",
    input: {},
    errors: [],
    contentFormat: "markdown",
    artifacts: [],
    runnerMeta: { rounds: 1, pageCount: 1, keptPageCount: 1, sourceCount: 1, stopReason: "complete" },
    tokens: { inputTokens: 10, outputTokens: 10, totalTokens: 20, rounds: 1, modelCalls: 3, tokenLimit: null },
    stats: { modelCalls: 3, toolRounds: 3 },
    events: [{ type: "start", msg: "started" }],
    resultMd: "TTL is 2 hours.",
    resultJson: {
      knowledgeSnippets: [{ path: "concepts/a.md", title: "A", sources: [sourceId], content: "TTL is 2 hours." }],
      rawSources: [{ source_id: sourceId, filename: "a.md" }],
      citations: [{ path: "concepts/a.md", sources: [sourceId] }],
      retrievalRounds: [{ round: 1 }],
      pageCount: 1,
      keptPageCount: 1,
      sourceCount: 1,
      stopReason: "complete",
    },
  };
  const execution = {
    start: () => {
      executionStarted = true;
      return { runId: agentRunId, agentType: "llmWiki", status: "running", done: Promise.resolve(agentDetail) };
    },
  };
  const model = {
    resolveModel: () => "judge",
    chat: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              facts: [{ factId: "A001-F01", status: "correct", evidencePath: "concepts/a.md", evidence: "TTL is 2 hours." }],
              faithfulness: { status: "correct", reason: "supported" },
              answerCorrectness: { status: "correct", reason: "matches expected" },
              abstainCorrectness: { status: "not_applicable", reason: "" },
            }),
          },
        },
      ],
    }),
  };

  const service = new AgentEvaluationService(
    store as unknown as AgentEvaluationStoreService,
    retrieval as unknown as LlmWikiRetrievalService,
    execution as unknown as AgentRunExecutionService,
    model as unknown as ModelService,
  );

  service.createRun({ datasetId: "dataset", judgeModel: "judge", agentModel: "judge", caseIds: ["A001"] });
  await waitFor(() => run?.status === "success");
  const finalRun = store.getRun() as AgentEvaluationRun;

  assert.equal(executionStarted, true);
  assert.equal(finalRun.cases[0].agentRunId, agentRunId);
  assert.equal(finalRun.cases[0].sourceHit, true);
  assert.equal(finalRun.cases[0].facts[0].status, "correct");
  assert.equal(finalRun.summary.sourceHitRate, 1);
  assert.equal(finalRun.summary.factAccuracy, 1);
  assert.equal(finalRun.summary.avgRounds, 1);
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timeout");
}
