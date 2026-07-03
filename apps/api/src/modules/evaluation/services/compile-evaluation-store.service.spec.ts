import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { sha256 } from "../../../common/fs-json";
import type { CompileEvaluationDataset } from "../evaluation.types";
import { CompileEvaluationStoreService } from "./compile-evaluation-store.service";

test("compile evaluation store deletes uploaded datasets and finished runs", () => {
  const previousRoot = process.env.KNOWLLM_DATA_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowllm-eval-store-"));
  process.env.KNOWLLM_DATA_ROOT = root;
  try {
    const store = new CompileEvaluationStoreService();
    store.onModuleInit();
    const dataset = createDataset();

    store.saveDataset(dataset);
    assert.equal(store.getDataset(dataset.datasetId).datasetId, dataset.datasetId);
    assert.deepEqual(store.deleteDataset(dataset.datasetId), { deleted: true });
    assert.throws(() => store.getDataset(dataset.datasetId), /评测数据集不存在/);

    store.saveDataset(dataset);
    const run = store.createRun({ dataset, caseIds: ["case-a"], judgeModel: "judge" });
    assert.throws(() => store.deleteRun(run.runId), /运行中的评测不能删除/);
    store.saveRun({ ...run, status: "success", endedAt: "2026-07-02T00:00:00.000Z" });
    assert.deepEqual(store.deleteRun(run.runId), { deleted: true });
    assert.throws(() => store.getRun(run.runId), /评测运行记录不存在/);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.KNOWLLM_DATA_ROOT;
    } else {
      process.env.KNOWLLM_DATA_ROOT = previousRoot;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createDataset(): CompileEvaluationDataset {
  const content = "fact a";
  return {
    datasetId: "dataset-a",
    name: "Dataset A",
    uploadedAt: "2026-07-02T00:00:00.000Z",
    sources: [{ id: "source-a", filename: "a.md", content, sha256: sha256(content) }],
    cases: [
      {
        id: "case-a",
        name: "Case A",
        sourceIds: ["source-a"],
        expectedFacts: [
          {
            id: "fact-a",
            fact: "fact a",
            sourceFile: "a.md",
            evidence: "fact a",
            type: "general",
            importance: "must",
          },
        ],
      },
    ],
  };
}
