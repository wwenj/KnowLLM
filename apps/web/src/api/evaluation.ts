import { http } from "./http";

export type CompileEvaluationFactStatus = "correct" | "missing" | "incorrect";
export type CompileEvaluationCaseStatus = "pending" | "running" | "success" | "source_missing" | "failed";
export type CompileEvaluationRunStatus = "running" | "success" | "failed";

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
  sources: Array<{ id: string; filename: string; content: string; sha256: string }>;
  cases: Array<{
    id: string;
    name: string;
    sourceIds: string[];
    expectedFacts: Array<{ id: string; fact: string }>;
  }>;
}

export interface CompileEvaluationFactResult {
  id: string;
  fact: string;
  status: CompileEvaluationFactStatus;
  evidencePath: string;
  evidence: string;
  reason: string;
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
  error: string;
}

export interface CompileEvaluationSummary {
  totalFacts: number;
  correct: number;
  missing: number;
  incorrect: number;
  accuracy: number;
  sourceMissingCases: number;
  failedCases: number;
}

export interface CompileEvaluationRunSummary {
  runId: string;
  datasetId: string;
  datasetName: string;
  judgeModel: string;
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
  createRun: (body: { datasetId: string; caseIds?: string[]; judgeModel?: string }) =>
    http.post<CompileEvaluationRun>("/api/evaluations/llm-wiki-compile/runs", body),
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
};
