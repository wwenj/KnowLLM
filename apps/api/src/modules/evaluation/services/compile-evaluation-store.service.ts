import { Injectable, OnModuleInit } from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";
import { ensureDir, nowIso, randomId, readJson, writeJson } from "../../../common/fs-json";
import { getDataRoot } from "../../../config/data-root";
import type {
  CompileEvaluationDataset,
  CompileEvaluationDatasetSummary,
  CompileEvaluationRun,
  CompileEvaluationRunSummary,
} from "../evaluation.types";

@Injectable()
export class CompileEvaluationStoreService implements OnModuleInit {
  private readonly root = path.join(getDataRoot(), "evaluations", "llm-wiki-compile");

  onModuleInit(): void {
    ensureDir(this.datasetsRoot());
    ensureDir(this.runsRoot());
    this.markInterruptedRunsFailed();
  }

  saveDataset(dataset: CompileEvaluationDataset): CompileEvaluationDataset {
    writeJson(this.datasetPath(dataset.datasetId), dataset);
    return dataset;
  }

  listDatasets(): CompileEvaluationDatasetSummary[] {
    ensureDir(this.datasetsRoot());
    return fs
      .readdirSync(this.datasetsRoot(), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => readJson<CompileEvaluationDataset | null>(path.join(this.datasetsRoot(), entry.name), null))
      .filter((item): item is CompileEvaluationDataset => Boolean(item))
      .map(toDatasetSummary)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  getDataset(datasetId: string): CompileEvaluationDataset {
    const dataset = readJson<CompileEvaluationDataset | null>(this.datasetPath(datasetId), null);
    if (!dataset) throw new Error("评测数据集不存在");
    return dataset;
  }

  createRun(args: {
    dataset: CompileEvaluationDataset;
    caseIds: string[];
    judgeModel: string;
  }): CompileEvaluationRun {
    const run: CompileEvaluationRun = {
      runId: randomId(),
      datasetId: args.dataset.datasetId,
      datasetName: args.dataset.name,
      caseIds: args.caseIds,
      judgeModel: args.judgeModel,
      status: "running",
      startedAt: nowIso(),
      endedAt: "",
      progress: { completed: 0, total: args.caseIds.length, currentCaseId: "" },
      cases: [],
      summary: emptySummary(),
      errors: [],
    };
    writeJson(this.runPath(run.runId), run);
    return run;
  }

  saveRun(run: CompileEvaluationRun): CompileEvaluationRun {
    writeJson(this.runPath(run.runId), run);
    return run;
  }

  getRun(runId: string): CompileEvaluationRun {
    const run = readJson<CompileEvaluationRun | null>(this.runPath(runId), null);
    if (!run) throw new Error("评测运行记录不存在");
    return run;
  }

  listRuns(limit = 50): CompileEvaluationRunSummary[] {
    ensureDir(this.runsRoot());
    return fs
      .readdirSync(this.runsRoot(), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => readJson<CompileEvaluationRun | null>(path.join(this.runsRoot(), entry.name), null))
      .filter((item): item is CompileEvaluationRun => Boolean(item))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, Math.min(Math.max(Number(limit) || 50, 1), 200))
      .map(toRunSummary);
  }

  private markInterruptedRunsFailed(): void {
    for (const run of this.listRuns(200)) {
      if (run.status !== "running") continue;
      const detail = this.getRun(run.runId);
      this.saveRun({
        ...detail,
        status: "failed",
        endedAt: nowIso(),
        errors: [...detail.errors, "服务重启，评测任务已中断"],
      });
    }
  }

  private datasetsRoot(): string {
    return path.join(this.root, "datasets");
  }

  private runsRoot(): string {
    return path.join(this.root, "runs");
  }

  private datasetPath(datasetId: string): string {
    return path.join(this.datasetsRoot(), `${safeId(datasetId)}.json`);
  }

  private runPath(runId: string): string {
    return path.join(this.runsRoot(), `${safeId(runId)}.json`);
  }
}

export function emptySummary() {
  return {
    totalFacts: 0,
    correct: 0,
    missing: 0,
    incorrect: 0,
    accuracy: 0,
    sourceMissingCases: 0,
    failedCases: 0,
  };
}

function toDatasetSummary(dataset: CompileEvaluationDataset): CompileEvaluationDatasetSummary {
  return {
    datasetId: dataset.datasetId,
    name: dataset.name,
    uploadedAt: dataset.uploadedAt,
    sourceCount: dataset.sources.length,
    caseCount: dataset.cases.length,
    factCount: dataset.cases.reduce((sum, item) => sum + item.expectedFacts.length, 0),
  };
}

function toRunSummary(run: CompileEvaluationRun): CompileEvaluationRunSummary {
  return {
    runId: run.runId,
    datasetId: run.datasetId,
    datasetName: run.datasetName,
    judgeModel: run.judgeModel,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    progress: run.progress,
    summary: run.summary,
  };
}

function safeId(value: string): string {
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(text)) throw new Error("id 非法");
  return text;
}
