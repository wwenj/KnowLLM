import { Injectable, OnModuleInit } from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";
import { ensureDir, nowIso, randomId, readJson, writeJson } from "../../../common/fs-json";
import { getDataRoot } from "../../../config/data-root";
import type {
  AgentEvaluationCaseResult,
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

  deleteDataset(datasetId: string): { deleted: true } {
    const file = this.datasetPath(datasetId);
    if (!fs.existsSync(file)) throw new Error("Agent 评测数据集不存在");
    fs.unlinkSync(file);
    return { deleted: true };
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
    const normalized = normalizeAgentRun(run);
    writeJson(this.runPath(run.runId), normalized);
    return normalized;
  }

  getRun(runId: string): AgentEvaluationRun {
    const run = readJson<AgentEvaluationRun | null>(this.runPath(runId), null);
    if (!run) throw new Error("Agent 评测运行记录不存在");
    return normalizeAgentRun(run);
  }

  deleteRun(runId: string): { deleted: true } {
    const run = this.getRun(runId);
    if (run.status === "running") throw new Error("运行中的 Agent 评测不能删除");
    fs.unlinkSync(this.runPath(runId));
    return { deleted: true };
  }

  listRuns(limit = 50): AgentEvaluationRunSummary[] {
    ensureDir(this.runsRoot());
    return fs
      .readdirSync(this.runsRoot(), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => readJson<AgentEvaluationRun | null>(path.join(this.runsRoot(), entry.name), null))
      .filter((item): item is AgentEvaluationRun => Boolean(item))
      .map(normalizeAgentRun)
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
  return scoreAgentSummary({
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
    taskCorrectnessRate: 0,
    completionRate: 0,
    overallScore: 0,
    passLevel: "failed",
    avgRounds: 0,
    avgReadPages: 0,
    avgKeptPages: 0,
    avgRawSources: 0,
    avgModelCalls: 0,
    avgTotalTokens: 0,
  });
}

export function summarizeAgentCases(cases: AgentEvaluationCaseResult[]): AgentEvaluationRun["summary"] {
  const summary = emptyAgentSummary();
  summary.totalCases = cases.length;
  const metricCases = cases.filter((item) => item.agentRunId);
  let taskScoreTotal = 0;
  for (const raw of cases) {
    const item = normalizeAgentCaseResult(raw);
    taskScoreTotal += item.taskScore;
    if (item.status === "success") summary.completedCases += 1;
    if (item.status === "source_missing") summary.sourceMissingCases += 1;
    if (item.status !== "success" && item.status !== "source_missing") summary.failedCases += 1;
    if (item.sourceHit !== null) {
      summary.sourceHitTotal += 1;
      if (item.sourceHit) summary.sourceHitCases += 1;
    }
    for (const fact of item.facts) {
      summary.totalFacts += 1;
      if (fact.status === "correct") summary.correctFacts += 1;
      if (fact.status === "missing") summary.missingFacts += 1;
      if (fact.status === "incorrect") summary.incorrectFacts += 1;
    }
    if (item.faithfulness.status !== "not_applicable") {
      summary.faithfulnessTotal += 1;
      if (item.faithfulness.status === "correct") summary.faithfulCases += 1;
    }
    if (item.answerCorrectness.status !== "not_applicable") {
      summary.answerCorrectnessTotal += 1;
      if (item.answerCorrectness.status === "correct") summary.answerCorrectCases += 1;
    }
    if (item.abstainCorrectness.status !== "not_applicable") {
      summary.abstainTotal += 1;
      if (item.abstainCorrectness.status === "correct") summary.abstainCorrectCases += 1;
    }
  }
  summary.factAccuracy = ratio(summary.correctFacts, summary.totalFacts);
  summary.sourceHitRate = ratio(summary.sourceHitCases, summary.sourceHitTotal);
  summary.faithfulnessRate = ratio(summary.faithfulCases, summary.faithfulnessTotal);
  summary.answerCorrectnessRate = ratio(summary.answerCorrectCases, summary.answerCorrectnessTotal);
  summary.abstainAccuracy = ratio(summary.abstainCorrectCases, summary.abstainTotal);
  summary.taskCorrectnessRate = ratio(taskScoreTotal, summary.totalCases);
  summary.avgRounds = average(metricCases.map((item) => item.metrics.rounds));
  summary.avgReadPages = average(metricCases.map((item) => item.metrics.readPages));
  summary.avgKeptPages = average(metricCases.map((item) => item.metrics.keptPages));
  summary.avgRawSources = average(metricCases.map((item) => item.metrics.rawSources));
  summary.avgModelCalls = average(metricCases.map((item) => item.metrics.modelCalls));
  summary.avgTotalTokens = average(metricCases.map((item) => item.metrics.totalTokens));
  return scoreAgentSummary(summary);
}

export function normalizeAgentCaseResult(item: AgentEvaluationCaseResult): AgentEvaluationCaseResult {
  const normalized = {
    ...item,
    expectedAnswer: item.expectedAnswer || "",
    evaluationType: item.evaluationType || "general",
  };
  const scores = scoreAgentCase(normalized);
  return { ...normalized, ...scores };
}

export function scoreAgentCase(item: AgentEvaluationCaseResult): { factScore: number; taskScore: number } {
  const binaryAnswerScore = item.answerable
    ? item.answerCorrectness.status === "correct" ? 1 : 0
    : item.abstainCorrectness.status === "correct" ? 1 : 0;
  const correctFacts = item.facts.filter((fact) => fact.status === "correct").length;
  const incorrectFacts = item.facts.filter((fact) => fact.status === "incorrect").length;
  const factScore = item.facts.length
    ? clampRate((correctFacts - incorrectFacts) / item.facts.length)
    : binaryAnswerScore;
  const taskScore = item.status === "success"
    ? item.answerable ? 0.7 * factScore + 0.3 * binaryAnswerScore : binaryAnswerScore
    : 0;
  return { factScore, taskScore };
}

export function scoreAgentSummary(summary: AgentEvaluationRun["summary"]): AgentEvaluationRun["summary"] {
  const taskCorrectnessRate = Number.isFinite(summary.taskCorrectnessRate)
    ? clampRate(summary.taskCorrectnessRate)
    : ratio(summary.answerCorrectCases + summary.abstainCorrectCases, summary.totalCases);
  const completionRate = ratio(summary.completedCases, summary.totalCases);
  const dimensions = [
    { rate: taskCorrectnessRate, weight: 50, applicable: summary.totalCases > 0 },
    { rate: summary.faithfulnessRate, weight: 25, applicable: summary.faithfulnessTotal > 0 },
    { rate: summary.factAccuracy, weight: 15, applicable: summary.totalFacts > 0 },
    { rate: summary.sourceHitRate, weight: 5, applicable: summary.sourceHitTotal > 0 },
    { rate: completionRate, weight: 5, applicable: summary.totalCases > 0 },
  ].filter((item) => item.applicable);
  const totalWeight = dimensions.reduce((sum, item) => sum + item.weight, 0);
  const overallScore = totalWeight
    ? (dimensions.reduce((sum, item) => sum + item.rate * item.weight, 0) / totalWeight) * 100
    : 0;

  return {
    ...summary,
    taskCorrectnessRate,
    completionRate,
    overallScore,
    passLevel: agentPassLevel(overallScore),
  };
}

function normalizeAgentRun(run: AgentEvaluationRun): AgentEvaluationRun {
  const cases = run.cases.map(normalizeAgentCaseResult);
  return {
    ...run,
    cases,
    summary: cases.length ? summarizeAgentCases(cases) : scoreAgentSummary(run.summary),
  };
}

function agentPassLevel(score: number): AgentEvaluationRun["summary"]["passLevel"] {
  if (score >= 90) return "excellent";
  if (score >= 80) return "pass";
  if (score >= 60) return "needs_improvement";
  return "failed";
}

function ratio(value: number, total: number): number {
  return total ? value / total : 0;
}

function clampRate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

function average(values: number[]): number {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
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
