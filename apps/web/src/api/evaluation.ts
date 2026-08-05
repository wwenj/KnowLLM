import { http } from "./http";

export const BUILTIN_COMPILE_EVALUATION_DATASET_ID = "zh_klipper3d_manual_mini";
export const COMPILE_EVALUATION_SMOKE_CASE_IDS = [
  "C001",
  "C003",
  "C017",
  "C024",
  "C049",
] as const;

export type CompileEvaluationFactStatus = "correct" | "missing" | "incorrect";
export type CompileEvaluationCaseStatus =
  | "pending"
  | "running"
  | "success"
  | "source_missing"
  | "evaluation_failed"
  | "failed";
export type CompileEvaluationRunStatus =
  | "running"
  | "success"
  | "partial"
  | "failed";
export type CompileEvaluationFactImportance = "must" | "should" | "nice";
export type CompileEvaluationPassLevel =
  | "excellent"
  | "pass"
  | "needs_improvement"
  | "failed";

export interface CompileEvaluationDatasetSummary {
  datasetId: string;
  name: string;
  uploadedAt: string;
  sourceCount: number;
  caseCount: number;
  factCount: number;
}

export interface CompileEvaluationDataset {
  datasetId: string;
  name: string;
  uploadedAt: string;
  sources: Array<{
    id: string;
    filename: string;
    content: string;
    sha256: string;
  }>;
  cases: Array<{
    id: string;
    name: string;
    sourceIds: string[];
    expectedFacts: Array<{
      id: string;
      fact: string;
      sourceFile: string;
      evidence: string;
      type: string;
      importance: CompileEvaluationFactImportance;
    }>;
  }>;
}

export interface CompileEvaluationFactResult {
  id: string;
  fact: string;
  sourceFile?: string;
  evidence?: string;
  type?: string;
  importance?: CompileEvaluationFactImportance;
  status: CompileEvaluationFactStatus;
  evidencePath: string;
  wikiEvidence?: string;
  reason: string;
  confidence?: number | null;
  weight?: number;
  score?: number;
}

export interface CompileEvaluationCaseResult {
  caseId: string;
  name: string;
  status: CompileEvaluationCaseStatus;
  matchedSources: Array<{
    datasetSourceId: string;
    filename: string;
    sha256: string;
    sourceId: string | null;
    ingestedAt: string;
  }>;
  pagePaths: string[];
  facts: CompileEvaluationFactResult[];
  usage?: CompileEvaluationUsage;
  error: string;
}

export interface CompileEvaluationSummary {
  totalFacts: number;
  correct: number;
  missing: number;
  incorrect: number;
  accuracy: number;
  rawAccuracy?: number;
  weightedScore?: number;
  mustAccuracy?: number;
  missingRate?: number;
  incorrectRate?: number;
  totalWeight?: number;
  correctWeight?: number;
  mustTotal?: number;
  mustCorrect?: number;
  passLevel?: CompileEvaluationPassLevel;
  sourceMissingCases: number;
  failedCases: number;
}

export interface CompileEvaluationUsage {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CompileEvaluationRunSummary {
  runId: string;
  datasetId: string;
  datasetName: string;
  judgeModel: string;
  judgeProvider: string;
  datasetHash: string;
  wikiSnapshotHash: string;
  compilerVersions: string[];
  promptVersions: string[];
  compileModels: string[];
  workerCount: number;
  retryOfRunId: string;
  usage?: CompileEvaluationUsage;
  status: CompileEvaluationRunStatus;
  startedAt: string;
  endedAt: string;
  progress: { completed: number; total: number; currentCaseId: string };
  summary: CompileEvaluationSummary;
}

export interface CompileEvaluationRun extends CompileEvaluationRunSummary {
  caseIds: string[];
  cases: CompileEvaluationCaseResult[];
  errors: string[];
}

export const compileEvaluationApi = {
  uploadDataset: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return http.postForm<CompileEvaluationDataset>(
      "/api/evaluations/llm-wiki-compile/datasets/upload",
      form,
    );
  },
  listDatasets: (silent = false) =>
    http.get<{ items: CompileEvaluationDatasetSummary[] }>(
      "/api/evaluations/llm-wiki-compile/datasets",
      undefined,
      silent ? { silent: true } : undefined,
    ),
  getDataset: (datasetId: string, silent = false) =>
    http.get<CompileEvaluationDataset>(
      `/api/evaluations/llm-wiki-compile/datasets/${encodeURIComponent(datasetId)}`,
      undefined,
      silent ? { silent: true } : undefined,
    ),
  deleteDataset: (datasetId: string) =>
    http.delete<{ deleted: true }>(
      `/api/evaluations/llm-wiki-compile/datasets/${encodeURIComponent(datasetId)}`,
    ),
  createRun: (body: {
    datasetId: string;
    caseIds?: string[];
    judgeModel?: string;
    concurrency?: number;
  }) =>
    http.post<CompileEvaluationRun>(
      "/api/evaluations/llm-wiki-compile/runs",
      body,
    ),
  retryFailed: (
    runId: string,
    body?: { judgeModel?: string; concurrency?: number },
  ) =>
    http.post<CompileEvaluationRun>(
      `/api/evaluations/llm-wiki-compile/runs/${encodeURIComponent(runId)}/retry-failed`,
      body || {},
    ),
  listRuns: (limit = 50, silent = false) =>
    http.get<{ items: CompileEvaluationRunSummary[] }>(
      "/api/evaluations/llm-wiki-compile/runs",
      { limit },
      silent ? { silent: true } : undefined,
    ),
  getRun: (runId: string, silent = false) =>
    http.get<CompileEvaluationRun>(
      `/api/evaluations/llm-wiki-compile/runs/${encodeURIComponent(runId)}`,
      undefined,
      silent ? { silent: true } : undefined,
    ),
  deleteRun: (runId: string) =>
    http.delete<{ deleted: true }>(
      `/api/evaluations/llm-wiki-compile/runs/${encodeURIComponent(runId)}`,
    ),
};
