import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "../../../common/fs-json";
import type { AgentRunDetail } from "../../agent/agent.types";
import type { AgentRunExecutionService } from "../../agent/services/agent-run-execution.service";
import type { LlmWikiRetrievalService } from "../../llmWiki/services/llm-wiki-retrieval.service";
import type { ModelService } from "../../model/model.service";
import type {
  AgentEvaluationCaseResult,
  AgentEvaluationDataset,
  AgentEvaluationRun,
} from "../evaluation.types";
import type { AgentEvaluationStoreService } from "./agent-evaluation-store.service";
import {
  emptyAgentSummary,
  scoreAgentCase,
  scoreAgentSummary,
} from "./agent-evaluation-store.service";
import { AgentEvaluationService, summarizeAgentEvaluation } from "./agent-evaluation.service";

test("agent evaluation starts a normal llmWiki agent run and judges its result", async () => {
  const sourceId = "a".repeat(32);
  const sourceContent = "TTL is 2 hours.";
  const dataset: AgentEvaluationDataset = {
    datasetId: "dataset",
    name: "Dataset",
    uploadedAt: "",
    sources: [
      { id: "source-a", filename: "a.md", content: sourceContent, sha256: sha256(sourceContent) },
      { id: "source-b", filename: "b.md", content: "Missing source.", sha256: sha256("Missing source.") },
    ],
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
      {
        id: "A002",
        question: "What is missing?",
        answerable: true,
        expectedAnswer: "Missing source.",
        expectedFacts: [{ id: "A002-F01", fact: "Missing source." }],
        relevantSourceIds: ["source-b"],
        mustInclude: [],
        evaluationType: "source_missing",
      },
      {
        id: "A003",
        question: "Will the Agent fail?",
        answerable: true,
        expectedAnswer: "No.",
        expectedFacts: [{ id: "A003-F01", fact: "No." }],
        relevantSourceIds: ["source-a"],
        mustInclude: [],
        evaluationType: "agent_failure",
      },
      {
        id: "A004",
        question: "Will the Judge fail?",
        answerable: true,
        expectedAnswer: "No.",
        expectedFacts: [{ id: "A004-F01", fact: "No." }],
        relevantSourceIds: ["source-a"],
        mustInclude: [],
        evaluationType: "judge_failure",
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
  let executionShouldFail = false;
  let judgeShouldFail = false;
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
      if (executionShouldFail) throw new Error("Agent failed");
      return { runId: agentRunId, agentType: "llmWiki", status: "running", done: Promise.resolve(agentDetail) };
    },
  };
  const model = {
    resolveModel: () => "judge",
    chat: async () => ({
      choices: [
        {
          message: {
            content: judgeShouldFail
              ? "invalid"
              : JSON.stringify({
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
  assert.equal(finalRun.cases[0].expectedAnswer, "TTL is 2 hours.");
  assert.equal(finalRun.cases[0].evaluationType, "single_doc_fact");
  assert.equal(finalRun.summary.sourceHitRate, 1);
  assert.equal(finalRun.summary.factAccuracy, 1);
  assert.equal(finalRun.summary.avgRounds, 1);

  service.createRun({ datasetId: "dataset", judgeModel: "judge", agentModel: "judge", caseIds: ["A002"] });
  await waitFor(() => run?.status === "success");
  assert.equal((store.getRun() as AgentEvaluationRun).cases[0].status, "source_missing");
  assert.equal((store.getRun() as AgentEvaluationRun).cases[0].expectedAnswer, "Missing source.");

  executionShouldFail = true;
  service.createRun({ datasetId: "dataset", judgeModel: "judge", agentModel: "judge", caseIds: ["A003"] });
  await waitFor(() => run?.status === "success");
  assert.equal((store.getRun() as AgentEvaluationRun).cases[0].status, "agent_failed");
  assert.equal((store.getRun() as AgentEvaluationRun).cases[0].evaluationType, "agent_failure");

  executionShouldFail = false;
  judgeShouldFail = true;
  service.createRun({ datasetId: "dataset", judgeModel: "judge", agentModel: "judge", caseIds: ["A004"] });
  await waitFor(() => run?.status === "success");
  assert.equal((store.getRun() as AgentEvaluationRun).cases[0].status, "judge_failed");
  assert.equal((store.getRun() as AgentEvaluationRun).cases[0].expectedAnswer, "No.");
});

test("agent evaluation score penalizes failed cases with answer-priority weights", () => {
  const summary = summarizeAgentEvaluation([
    createCaseResult(),
    createCaseResult({
      caseId: "A002",
      status: "agent_failed",
      agentRunId: "",
      facts: [],
      sourceHit: null,
      faithfulness: { status: "not_applicable", reason: "" },
      answerCorrectness: { status: "not_applicable", reason: "" },
    }),
  ]);

  assert.equal(summary.taskCorrectnessRate, 0.5);
  assert.equal(summary.completionRate, 0.5);
  assert.equal(summary.overallScore, 72.5);
  assert.equal(summary.passLevel, "needs_improvement");
});

test("agent evaluation score uses graded fact coverage for task correctness", () => {
  const summary = summarizeAgentEvaluation([
    createCaseResult({ caseId: "A001", facts: createFacts(2, 3), answerCorrectness: { status: "incorrect", reason: "" } }),
    createCaseResult({ caseId: "A002", facts: createFacts(3, 3) }),
    createCaseResult({ caseId: "A003", facts: createFacts(2, 3), answerCorrectness: { status: "incorrect", reason: "" } }),
    createCaseResult({ caseId: "A004", facts: createFacts(3, 3) }),
    createCaseResult({ caseId: "A005", facts: createFacts(3, 3) }),
    createCaseResult({ caseId: "A006", facts: createFacts(3, 3) }),
    createCaseResult({ caseId: "A007", facts: createFacts(2, 3), answerCorrectness: { status: "incorrect", reason: "" } }),
    createCaseResult({ caseId: "A008", facts: createFacts(4, 4) }),
    createCaseResult({ caseId: "A009", facts: createFacts(2, 4), answerCorrectness: { status: "incorrect", reason: "" } }),
    createCaseResult({ caseId: "A010", facts: createFacts(4, 4) }),
  ]);

  assert.equal(summary.answerCorrectnessRate, 0.6);
  assert.equal(summary.factAccuracy, 28 / 33);
  assert.equal(summary.taskCorrectnessRate, 0.775);
  assert.equal(Math.round(summary.overallScore * 100) / 100, 86.48);
  assert.equal(summary.passLevel, "pass");
});

test("agent evaluation case score gives partial credit and penalizes incorrect facts harder", () => {
  const missing = scoreAgentCase(createCaseResult({
    facts: createFacts(1, 2),
    answerCorrectness: { status: "incorrect", reason: "" },
  }));
  const incorrect = scoreAgentCase(createCaseResult({
    facts: [
      { id: "F1", fact: "correct", status: "correct", evidencePath: "", evidence: "", reason: "" },
      { id: "F2", fact: "wrong", status: "incorrect", evidencePath: "", evidence: "", reason: "" },
    ],
    answerCorrectness: { status: "incorrect", reason: "" },
  }));

  assert.equal(missing.factScore, 0.5);
  assert.equal(missing.taskScore, 0.35);
  assert.equal(incorrect.factScore, 0);
  assert.equal(incorrect.taskScore, 0);
});

test("agent evaluation case score gives zero task score for non-success cases", () => {
  const sourceMissing = scoreAgentCase(createCaseResult({ status: "source_missing", facts: createFacts(0, 2) }));
  const failed = scoreAgentCase(createCaseResult({ status: "agent_failed", facts: [] }));

  assert.equal(sourceMissing.taskScore, 0);
  assert.equal(failed.taskScore, 0);
});

test("agent evaluation score normalizes non-applicable metrics for abstain cases", () => {
  const summary = summarizeAgentEvaluation([
    createCaseResult({
      answerable: false,
      facts: [],
      sourceHit: null,
      faithfulness: { status: "not_applicable", reason: "" },
      answerCorrectness: { status: "not_applicable", reason: "" },
      abstainCorrectness: { status: "correct", reason: "" },
    }),
  ]);

  assert.equal(summary.overallScore, 100);
  assert.equal(summary.passLevel, "excellent");
});

test("agent evaluation score uses 90, 80 and 60 grade boundaries", () => {
  assert.equal(summaryAtRate(0.9).passLevel, "excellent");
  assert.equal(summaryAtRate(0.8).passLevel, "pass");
  assert.equal(summaryAtRate(0.6).passLevel, "needs_improvement");
  assert.equal(summaryAtRate(0.59).passLevel, "failed");
});

function summaryAtRate(rate: number) {
  const count = Math.round(rate * 100);
  return scoreAgentSummary({
    ...emptyAgentSummary(),
    totalCases: 100,
    completedCases: count,
    totalFacts: 100,
    correctFacts: count,
    factAccuracy: rate,
    sourceHitCases: count,
    sourceHitTotal: 100,
    sourceHitRate: rate,
    faithfulCases: count,
    faithfulnessTotal: 100,
    faithfulnessRate: rate,
    answerCorrectCases: count,
    answerCorrectnessTotal: 100,
    answerCorrectnessRate: rate,
    taskCorrectnessRate: rate,
  });
}

function createFacts(correct: number, total: number): AgentEvaluationCaseResult["facts"] {
  return Array.from({ length: total }, (_, index) => ({
    id: `F${index + 1}`,
    fact: `Fact ${index + 1}`,
    status: index < correct ? "correct" : "missing",
    evidencePath: "",
    evidence: "",
    reason: "",
  }));
}

function createCaseResult(overrides: Partial<AgentEvaluationCaseResult> = {}): AgentEvaluationCaseResult {
  return {
    caseId: "A001",
    question: "Question?",
    expectedAnswer: "Answer.",
    evaluationType: "single_doc_fact",
    answerable: true,
    status: "success",
    agentRunId: "run",
    agentStatus: "success",
    matchedSources: [],
    expectedSourceIds: ["source-a"],
    hitSourceIds: ["source-a"],
    sourceHit: true,
    mustInclude: [],
    mustIncludeHits: [],
    answerMarkdown: "Answer.",
    facts: [{ id: "A001-F01", fact: "Answer.", status: "correct", evidencePath: "a.md", evidence: "Answer.", reason: "" }],
    factScore: 1,
    taskScore: 1,
    faithfulness: { status: "correct", reason: "" },
    answerCorrectness: { status: "correct", reason: "" },
    abstainCorrectness: { status: "not_applicable", reason: "" },
    metrics: { rounds: 1, readPages: 1, keptPages: 1, rawSources: 0, modelCalls: 1, totalTokens: 10, stopReason: "complete" },
    events: [],
    error: "",
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timeout");
}
