import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { sha256 } from "../../../common/fs-json";
import type { AgentEvaluationDataset } from "../evaluation.types";
import { AgentEvaluationStoreService } from "./agent-evaluation-store.service";

test("agent evaluation store deletes uploaded datasets and finished runs", () => {
  const previousRoot = process.env.KNOWLLM_DATA_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowllm-agent-eval-store-"));
  process.env.KNOWLLM_DATA_ROOT = root;
  try {
    const store = new AgentEvaluationStoreService();
    store.onModuleInit();
    const dataset = createDataset();

    store.saveDataset(dataset);
    assert.deepEqual(store.deleteDataset(dataset.datasetId), { deleted: true });
    assert.throws(() => store.getDataset(dataset.datasetId), /Agent 评测数据集不存在/);

    store.saveDataset(dataset);
    const run = store.createRun({
      dataset,
      caseIds: ["case-a"],
      judgeModel: "judge",
      sourcePolicy: "key-sources",
      budget: { maxRounds: 4, maxEvidencePages: 48, maxRawSources: 12, tokenLimit: null },
      models: { plannerModel: "agent", reviewerModel: "agent", synthesizerModel: "agent" },
    });
    assert.throws(() => store.deleteRun(run.runId), /运行中的 Agent 评测不能删除/);
    store.saveRun({ ...run, status: "success", endedAt: "2026-07-03T00:00:00.000Z" });
    assert.deepEqual(store.deleteRun(run.runId), { deleted: true });
    assert.throws(() => store.getRun(run.runId), /Agent 评测运行记录不存在/);

    const legacy = store.createRun({
      dataset,
      caseIds: ["case-a"],
      judgeModel: "judge",
      sourcePolicy: "key-sources",
      budget: { maxRounds: 4, maxEvidencePages: 48, maxRawSources: 12, tokenLimit: null },
      models: { plannerModel: "agent", reviewerModel: "agent", synthesizerModel: "agent" },
    });
    const legacySummary = {
      ...legacy.summary,
      totalCases: 1,
      completedCases: 1,
      answerCorrectCases: 1,
      answerCorrectnessTotal: 1,
      answerCorrectnessRate: 1,
    } as Record<string, unknown>;
    delete legacySummary.taskCorrectnessRate;
    delete legacySummary.completionRate;
    delete legacySummary.overallScore;
    delete legacySummary.passLevel;
    fs.writeFileSync(
      path.join(root, "evaluations", "llm-wiki-agent", "runs", `${legacy.runId}.json`),
      JSON.stringify({ ...legacy, status: "success", summary: legacySummary }),
    );
    const normalizedLegacy = store.getRun(legacy.runId);
    assert.equal(normalizedLegacy.summary.overallScore, 100);
    assert.equal(normalizedLegacy.summary.passLevel, "excellent");
  } finally {
    if (previousRoot === undefined) {
      delete process.env.KNOWLLM_DATA_ROOT;
    } else {
      process.env.KNOWLLM_DATA_ROOT = previousRoot;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createDataset(): AgentEvaluationDataset {
  const content = "Answer.";
  return {
    datasetId: "dataset-a",
    name: "Dataset A",
    uploadedAt: "2026-07-03T00:00:00.000Z",
    sources: [{ id: "source-a", filename: "a.md", content, sha256: sha256(content) }],
    cases: [
      {
        id: "case-a",
        question: "Question?",
        answerable: true,
        expectedAnswer: "Answer.",
        expectedFacts: [{ id: "fact-a", fact: "Answer." }],
        relevantSourceIds: ["source-a"],
        mustInclude: [],
        evaluationType: "single_doc_fact",
      },
    ],
  };
}
