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
  CompileEvaluationWikiSnapshot,
} from "../evaluation.types";

@Injectable()
export class CompileEvaluationStoreService implements OnModuleInit {
  private readonly root = path.join(getDataRoot(), "evaluations", "llm-wiki-compile");

  onModuleInit(): void {
    ensureDir(this.datasetsRoot());
    ensureDir(this.runsRoot());
    ensureDir(this.snapshotsRoot());
    this.markInterruptedRunsFailed();
  }

  saveDataset(dataset: CompileEvaluationDataset): CompileEvaluationDataset {
    ensureDir(this.datasetsRoot());
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

  deleteDataset(datasetId: string): { deleted: true } {
    const file = this.datasetPath(datasetId);
    if (!fs.existsSync(file)) throw new Error("评测数据集不存在");
    fs.unlinkSync(file);
    return { deleted: true };
  }

  createRun(args: {
    dataset: CompileEvaluationDataset;
    caseIds: string[];
    judgeModel: string;
    datasetHash?: string;
    snapshot?: CompileEvaluationWikiSnapshot;
    workerCount?: number;
    retryOfRunId?: string;
  }): CompileEvaluationRun {
    ensureDir(this.runsRoot());
    const runId = randomId();
    const snapshot = args.snapshot || emptySnapshot();
    const run: CompileEvaluationRun = {
      runId,
      datasetId: args.dataset.datasetId,
      datasetName: args.dataset.name,
      caseIds: args.caseIds,
      judgeModel: args.judgeModel,
      judgeProvider: providerFromModel(args.judgeModel),
      datasetHash: args.datasetHash || "",
      wikiSnapshotHash: snapshot.snapshotHash,
      compilerVersions: uniqueStrings(snapshot.sources.map((item) => item.compilerVersion)),
      promptVersions: uniqueStrings(snapshot.sources.map((item) => item.promptVersion)),
      compileModels: uniqueStrings(snapshot.sources.map((item) => item.compileModel)),
      workerCount: Math.max(1, Number(args.workerCount) || 1),
      retryOfRunId: args.retryOfRunId || "",
      usage: emptyUsage(),
      status: "running",
      startedAt: nowIso(),
      endedAt: "",
      progress: { completed: 0, total: args.caseIds.length, currentCaseId: "" },
      cases: [],
      summary: emptySummary(),
      errors: [],
    };
    this.saveSnapshot(runId, snapshot);
    writeJson(this.runPath(run.runId), run);
    return run;
  }

  saveSnapshot(runId: string, snapshot: CompileEvaluationWikiSnapshot): CompileEvaluationWikiSnapshot {
    ensureDir(this.snapshotsRoot());
    writeJson(this.snapshotPath(runId), snapshot);
    return snapshot;
  }

  getSnapshot(runId: string): CompileEvaluationWikiSnapshot {
    const snapshot = readJson<CompileEvaluationWikiSnapshot | null>(this.snapshotPath(runId), null);
    if (!snapshot) throw new Error("评测 Wiki 快照不存在");
    return snapshot;
  }

  saveRun(run: CompileEvaluationRun): CompileEvaluationRun {
    ensureDir(this.runsRoot());
    writeJson(this.runPath(run.runId), run);
    return run;
  }

  getRun(runId: string): CompileEvaluationRun {
    const run = readJson<CompileEvaluationRun | null>(this.runPath(runId), null);
    if (!run) throw new Error("评测运行记录不存在");
    return normalizeRun(run);
  }

  deleteRun(runId: string): { deleted: true } {
    const run = this.getRun(runId);
    if (run.status === "running") throw new Error("运行中的评测不能删除");
    fs.unlinkSync(this.runPath(runId));
    fs.rmSync(this.snapshotPath(runId), { force: true });
    return { deleted: true };
  }

  listRuns(limit = 50): CompileEvaluationRunSummary[] {
    ensureDir(this.runsRoot());
    return fs
      .readdirSync(this.runsRoot(), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => readJson<CompileEvaluationRun | null>(path.join(this.runsRoot(), entry.name), null))
      .filter((item): item is CompileEvaluationRun => Boolean(item))
      .map(normalizeRun)
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

  private snapshotsRoot(): string {
    return path.join(this.root, "snapshots");
  }

  private datasetPath(datasetId: string): string {
    return path.join(this.datasetsRoot(), `${safeId(datasetId)}.json`);
  }

  private runPath(runId: string): string {
    return path.join(this.runsRoot(), `${safeId(runId)}.json`);
  }

  private snapshotPath(runId: string): string {
    return path.join(this.snapshotsRoot(), `${safeId(runId)}.json`);
  }
}

export function emptySummary(): CompileEvaluationRunSummary["summary"] {
  return {
    totalFacts: 0,
    correct: 0,
    missing: 0,
    incorrect: 0,
    accuracy: 0,
    rawAccuracy: 0,
    weightedScore: 0,
    mustAccuracy: 0,
    missingRate: 0,
    incorrectRate: 0,
    totalWeight: 0,
    correctWeight: 0,
    mustTotal: 0,
    mustCorrect: 0,
    coveredByClaims: 0,
    judgeNeedsReview: 0,
    unsupportedCorrect: 0,
    passLevel: "failed",
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
    judgeProvider: run.judgeProvider,
    datasetHash: run.datasetHash,
    wikiSnapshotHash: run.wikiSnapshotHash,
    compilerVersions: run.compilerVersions,
    promptVersions: run.promptVersions,
    compileModels: run.compileModels,
    workerCount: run.workerCount,
    retryOfRunId: run.retryOfRunId,
    usage: run.usage || emptyUsage(),
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    progress: run.progress,
    summary: run.summary,
  };
}

function normalizeRun(run: CompileEvaluationRun): CompileEvaluationRun {
  return {
    ...run,
    judgeProvider: run.judgeProvider || providerFromModel(run.judgeModel),
    datasetHash: run.datasetHash || "",
    wikiSnapshotHash: run.wikiSnapshotHash || "",
    compilerVersions: uniqueStrings(run.compilerVersions || []),
    promptVersions: uniqueStrings(run.promptVersions || []),
    compileModels: uniqueStrings(run.compileModels || []),
    workerCount: Math.max(1, Number(run.workerCount) || 1),
    retryOfRunId: run.retryOfRunId || "",
    usage: run.usage || emptyUsage(),
  };
}

function emptySnapshot(): CompileEvaluationWikiSnapshot {
  return {
    snapshotHash: "",
    createdAt: "",
    sources: [],
    pages: [],
    pageClaims: [],
    facts: [],
  };
}

function providerFromModel(model: string): string {
  const value = String(model || "");
  return value.includes(":") ? value.slice(0, value.indexOf(":")) : "default";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function emptyUsage() {
  return { modelCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function safeId(value: string): string {
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(text)) throw new Error("id 非法");
  return text;
}
