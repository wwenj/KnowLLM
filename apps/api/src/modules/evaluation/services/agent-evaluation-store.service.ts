import { Injectable, OnModuleInit } from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";
import { ensureDir, nowIso, randomId, readJson, writeJson } from "../../../common/fs-json";
import { getDataRoot } from "../../../config/data-root";
import type {
  AgentEvaluationDataset,
  AgentEvaluationDatasetSummary,
  AgentEvaluationRun,
  AgentEvaluationRunSummary,
} from "../evaluation.types";

@Injectable()
export class AgentEvaluationStoreService implements OnModuleInit {
  private readonly root = path.join(getDataRoot(), "evaluations", "llm-wiki-agent");

  onModuleInit(): void {
    ensureDir(this.datasetsRoot());
    ensureDir(this.runsRoot());
    this.markInterruptedRunsFailed();
  }

  saveDataset(dataset: AgentEvaluationDataset): AgentEvaluationDataset {
    writeJson(this.datasetPath(dataset.datasetId), dataset);
    return dataset;
  }

  listDatasets(): AgentEvaluationDatasetSummary[] {
    ensureDir(this.datasetsRoot());
    return fs
      .readdirSync(this.datasetsRoot(), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => readJson<AgentEvaluationDataset | null>(path.join(this.datasetsRoot(), entry.name), null))
      .filter((item): item is AgentEvaluationDataset => Boolean(item))
      .map(toDatasetSummary)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  getDataset(datasetId: string): AgentEvaluationDataset {
    const dataset = readJson<AgentEvaluationDataset | null>(this.datasetPath(datasetId), null);
    if (!dataset) throw new Error("Agent 评测数据集不存在");
    return dataset;
  }

  createRun(args: {
    dataset: AgentEvaluationDataset;
    caseIds: string[];
    judgeModel: string;
    sourcePolicy: AgentEvaluationRun["sourcePolicy"];
    budget: AgentEvaluationRun["budget"];
    models: AgentEvaluationRun["models"];
  }): AgentEvaluationRun {
    const run: AgentEvaluationRun = {
      runId: randomId(),
      datasetId: args.dataset.datasetId,
      datasetName: args.dataset.name,
      caseIds: args.caseIds,
      judgeModel: args.judgeModel,
      sourcePolicy: args.sourcePolicy,
      budget: args.budget,
      models: args.models,
      status: "running",
      startedAt: nowIso(),
      endedAt: "",
      progress: { completed: 0, total: args.caseIds.length, currentCaseId: "" },
      cases: [],
      summary: emptyAgentSummary(),
      errors: [],
    };
    writeJson(this.runPath(run.runId), run);
    return run;
  }

  saveRun(run: AgentEvaluationRun): AgentEvaluationRun {
    writeJson(this.runPath(run.runId), run);
    return run;
  }

  getRun(runId: string): AgentEvaluationRun {
    const run = readJson<AgentEvaluationRun | null>(this.runPath(runId), null);
    if (!run) throw new Error("Agent 评测运行记录不存在");
    return run;
  }

  listRuns(limit = 50): AgentEvaluationRunSummary[] {
    ensureDir(this.runsRoot());
    return fs
      .readdirSync(this.runsRoot(), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => readJson<AgentEvaluationRun | null>(path.join(this.runsRoot(), entry.name), null))
      .filter((item): item is AgentEvaluationRun => Boolean(item))
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
        errors: [...detail.errors, "服务重启，Agent 评测任务已中断"],
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

export function emptyAgentSummary(): AgentEvaluationRun["summary"] {
  return {
    totalCases: 0,
    completedCases: 0,
    sourceMissingCases: 0,
    failedCases: 0,
    totalFacts: 0,
    correctFacts: 0,
    missingFacts: 0,
    incorrectFacts: 0,
    factAccuracy: 0,
    sourceHitCases: 0,
    sourceHitTotal: 0,
    sourceHitRate: 0,
    faithfulCases: 0,
    faithfulnessTotal: 0,
    faithfulnessRate: 0,
    answerCorrectCases: 0,
    answerCorrectnessTotal: 0,
    answerCorrectnessRate: 0,
    abstainCorrectCases: 0,
    abstainTotal: 0,
    abstainAccuracy: 0,
    avgRounds: 0,
    avgReadPages: 0,
    avgKeptPages: 0,
    avgRawSources: 0,
    avgModelCalls: 0,
    avgTotalTokens: 0,
  };
}

function toDatasetSummary(dataset: AgentEvaluationDataset): AgentEvaluationDatasetSummary {
  return {
    datasetId: dataset.datasetId,
    name: dataset.name,
    uploadedAt: dataset.uploadedAt,
    sourceCount: dataset.sources.length,
    caseCount: dataset.cases.length,
    factCount: dataset.cases.reduce((sum, item) => sum + item.expectedFacts.length, 0),
    abstainCaseCount: dataset.cases.filter((item) => !item.answerable).length,
  };
}

function toRunSummary(run: AgentEvaluationRun): AgentEvaluationRunSummary {
  return {
    runId: run.runId,
    datasetId: run.datasetId,
    datasetName: run.datasetName,
    judgeModel: run.judgeModel,
    sourcePolicy: run.sourcePolicy,
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
