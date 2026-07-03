import { http } from "./http";

export type CompileEvaluationFactStatus = "correct" | "missing" | "incorrect";
export type CompileEvaluationCaseStatus = "pending" | "running" | "success" | "source_missing" | "failed";
export type CompileEvaluationRunStatus = "running" | "success" | "failed";
export type CompileEvaluationFactImportance = "must" | "should" | "nice";
export type CompileEvaluationPassLevel = "excellent" | "pass" | "needs_improvement" | "failed";

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
  deleteDataset: (datasetId: string) =>
    http.delete<{ deleted: true }>(
      `/api/evaluations/llm-wiki-compile/datasets/${encodeURIComponent(datasetId)}`,
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
  deleteRun: (runId: string) =>
    http.delete<{ deleted: true }>(
      `/api/evaluations/llm-wiki-compile/runs/${encodeURIComponent(runId)}`,
    ),
};

export type AgentEvaluationMetricStatus = "correct" | "incorrect" | "not_applicable";
export type AgentEvaluationFactStatus = CompileEvaluationFactStatus;
export type AgentEvaluationCaseStatus =
  | "pending"
  | "running"
  | "success"
  | "source_missing"
  | "agent_failed"
  | "judge_failed"
  | "failed";
export type AgentEvaluationRunStatus = "running" | "success" | "failed";
export type AgentEvaluationSourcePolicy = "auto" | "wiki-only" | "key-sources" | "exhaustive";
export type AgentEvaluationPassLevel = "excellent" | "pass" | "needs_improvement" | "failed";

export interface AgentEvaluationBudget {
  maxRounds: number;
  maxEvidencePages: number;
  maxRawSources: number;
  tokenLimit: number | null;
}

export interface AgentEvaluationModels {
  plannerModel: string;
  reviewerModel: string;
  synthesizerModel: string;
}

export interface AgentEvaluationDatasetSummary {
  datasetId: string;
  name: string;
  uploadedAt: string;
  sourceCount: number;
  caseCount: number;
  factCount: number;
  abstainCaseCount: number;
}

export interface AgentEvaluationDataset {
  datasetId: string;
  name: string;
  uploadedAt: string;
  sources: Array<{ id: string; filename: string; content: string; sha256: string }>;
  cases: Array<{
    id: string;
    question: string;
    answerable: boolean;
    expectedAnswer: string;
    expectedFacts: Array<{ id: string; fact: string }>;
    relevantSourceIds: string[];
    mustInclude: string[];
    evaluationType: string;
  }>;
}

export interface AgentEvaluationMetricResult {
  status: AgentEvaluationMetricStatus;
  reason: string;
}

export interface AgentEvaluationFactResult {
  id: string;
  fact: string;
  status: AgentEvaluationFactStatus;
  evidencePath: string;
  evidence: string;
  reason: string;
}

export interface AgentEvaluationCaseResult {
  caseId: string;
  question: string;
  expectedAnswer: string;
  evaluationType: string;
  answerable: boolean;
  status: AgentEvaluationCaseStatus;
  agentRunId: string;
  agentStatus: string;
  matchedSources: Array<{
    datasetSourceId: string;
    filename: string;
    sha256: string;
    sourceId: string | null;
    ingestedAt: string;
  }>;
  expectedSourceIds: string[];
  hitSourceIds: string[];
  sourceHit: boolean | null;
  mustInclude: string[];
  mustIncludeHits: string[];
  answerMarkdown: string;
  facts: AgentEvaluationFactResult[];
  faithfulness: AgentEvaluationMetricResult;
  answerCorrectness: AgentEvaluationMetricResult;
  abstainCorrectness: AgentEvaluationMetricResult;
  metrics: {
    rounds: number;
    readPages: number;
    keptPages: number;
    rawSources: number;
    modelCalls: number;
    totalTokens: number;
    stopReason: string;
  };
  events: Array<Record<string, unknown>>;
  error: string;
}

export interface AgentEvaluationSummary {
  totalCases: number;
  completedCases: number;
  sourceMissingCases: number;
  failedCases: number;
  totalFacts: number;
  correctFacts: number;
  missingFacts: number;
  incorrectFacts: number;
  factAccuracy: number;
  sourceHitCases: number;
  sourceHitTotal: number;
  sourceHitRate: number;
  faithfulCases: number;
  faithfulnessTotal: number;
  faithfulnessRate: number;
  answerCorrectCases: number;
  answerCorrectnessTotal: number;
  answerCorrectnessRate: number;
  abstainCorrectCases: number;
  abstainTotal: number;
  abstainAccuracy: number;
  taskCorrectnessRate: number;
  completionRate: number;
  overallScore: number;
  passLevel: AgentEvaluationPassLevel;
  avgRounds: number;
  avgReadPages: number;
  avgKeptPages: number;
  avgRawSources: number;
  avgModelCalls: number;
  avgTotalTokens: number;
}

export interface AgentEvaluationRunSummary {
  runId: string;
  datasetId: string;
  datasetName: string;
  judgeModel: string;
  sourcePolicy: AgentEvaluationSourcePolicy;
  status: AgentEvaluationRunStatus;
  startedAt: string;
  endedAt: string;
  progress: { completed: number; total: number; currentCaseId: string };
  summary: AgentEvaluationSummary;
}

export interface AgentEvaluationRun extends AgentEvaluationRunSummary {
  caseIds: string[];
  budget: AgentEvaluationBudget;
  models: AgentEvaluationModels;
  cases: AgentEvaluationCaseResult[];
  errors: string[];
}

export const agentEvaluationApi = {
  uploadDataset: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return http.postForm<AgentEvaluationDataset>(
      "/api/evaluations/llm-wiki-agent/datasets/upload",
      form,
    );
  },
  listDatasets: (silent = false) =>
    http.get<{ items: AgentEvaluationDatasetSummary[] }>(
      "/api/evaluations/llm-wiki-agent/datasets",
      undefined,
      silent ? { silent: true } : undefined,
    ),
  getDataset: (datasetId: string, silent = false) =>
    http.get<AgentEvaluationDataset>(
      `/api/evaluations/llm-wiki-agent/datasets/${encodeURIComponent(datasetId)}`,
      undefined,
      silent ? { silent: true } : undefined,
    ),
  deleteDataset: (datasetId: string) =>
    http.delete<{ deleted: true }>(
      `/api/evaluations/llm-wiki-agent/datasets/${encodeURIComponent(datasetId)}`,
    ),
  createRun: (body: {
    datasetId: string;
    caseIds?: string[];
    judgeModel?: string;
    agentModel?: string;
    sourcePolicy?: AgentEvaluationSourcePolicy;
    budget?: Partial<AgentEvaluationBudget>;
  }) => http.post<AgentEvaluationRun>("/api/evaluations/llm-wiki-agent/runs", body),
  listRuns: (limit = 50, silent = false) =>
    http.get<{ items: AgentEvaluationRunSummary[] }>(
      "/api/evaluations/llm-wiki-agent/runs",
      { limit },
      silent ? { silent: true } : undefined,
    ),
  getRun: (runId: string, silent = false) =>
    http.get<AgentEvaluationRun>(
      `/api/evaluations/llm-wiki-agent/runs/${encodeURIComponent(runId)}`,
      undefined,
      silent ? { silent: true } : undefined,
    ),
  deleteRun: (runId: string) =>
    http.delete<{ deleted: true }>(
      `/api/evaluations/llm-wiki-agent/runs/${encodeURIComponent(runId)}`,
    ),
};
