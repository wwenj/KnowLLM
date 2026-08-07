import { http } from "./http";

export type AgentEvaluationFactStatus =
  | "supported"
  | "partial"
  | "missing"
  | "incorrect";
export type AgentEvaluationFailureStage =
  | "retrieval_miss"
  | "evidence_extraction_miss"
  | "final_answer_miss"
  | "incorrect_answer"
  | "execution_failure";
export type AgentEvaluationCaseStatus =
  | "pending"
  | "running"
  | "judged"
  | "execution_failed"
  | "judge_failed"
  | "invalidated";
export type AgentEvaluationRunStatus =
  | "running"
  | "completed"
  | "cancelled"
  | "failed"
  | "invalidated";

export interface AgentEvaluationRequiredFact {
  id: string;
  fact: string;
  evidence: { pageKey: string; quote: string };
}

export interface AgentEvaluationDatasetCase {
  id: string;
  question: string;
  answerable: boolean;
  expectedAnswer: string;
  requiredFacts: AgentEvaluationRequiredFact[];
  expectedBehavior?: "abstain";
  evaluationType: string;
}

export interface AgentEvaluationDataset {
  schemaVersion: 2;
  datasetId: string;
  name: string;
  revisionId: string;
  generatedAt: string;
  source: "published_wiki";
  datasetHash: string;
  currentRevisionId: string;
  compatible: boolean;
  caseCount: number;
  factCount: number;
  answerableCount: number;
  abstainCount: number;
  cases: AgentEvaluationDatasetCase[];
}

export interface AgentEvaluationFactResult extends AgentEvaluationRequiredFact {
  status: AgentEvaluationFactStatus;
  score: number;
  evidenceIds: string[];
  reason: string;
  failureStage: AgentEvaluationFailureStage | null;
}

export interface AgentEvaluationCaseResult {
  caseId: string;
  question: string;
  answerable: boolean;
  expectedAnswer: string;
  requiredFacts: AgentEvaluationRequiredFact[];
  evaluationType: string;
  status: AgentEvaluationCaseStatus;
  agentRunId: string;
  agentStatus: string;
  answerMarkdown: string;
  verifiedEvidence: Array<{
    evidenceId: string;
    pageKey: string;
    quote: string;
    claim: string;
  }>;
  readPageKeys: string[];
  facts: AgentEvaluationFactResult[];
  abstainStatus: "correct" | "partial" | "incorrect" | "not_applicable";
  abstainReason: string;
  hallucinationLevel: "none" | "material" | "safety";
  hallucinationReason: string;
  caseScore: number | null;
  metrics: {
    durationMs: number;
    totalTokens: number;
    modelCalls: number;
    readPages: number;
    searches: number;
    retries: number;
    timeouts: number;
    stopReason: string;
  };
  error: string;
}

export interface AgentEvaluationSummary {
  totalCases: number;
  validCases: number;
  supportedFacts: number;
  partialFacts: number;
  missingFacts: number;
  incorrectFacts: number;
  abstainCorrect: number;
  abstainTotal: number;
  abstainAccuracy: number | null;
  materialHallucinationCount: number;
  overallScore: number | null;
  passLevel: "excellent" | "acceptable" | "needs_improvement" | "unavailable";
  executionSuccessRate: number;
  totalTokens: number;
  totalModelCalls: number;
  totalReadPages: number;
  totalSearches: number;
  totalRetries: number;
  totalTimeouts: number;
  averageDurationMs: number;
  failureBreakdown: {
    retrievalMiss: number;
    evidenceExtractionMiss: number;
    finalAnswerMiss: number;
    incorrectAnswer: number;
    executionFailure: number;
  };
}

export interface AgentEvaluationRunSummary {
  schemaVersion: 2;
  runId: string;
  knowledgeBaseId: string;
  datasetId: string;
  datasetName: string;
  datasetHash: string;
  revisionId: string;
  fastModel: string;
  qualityModel: string;
  judgeModel: string;
  status: AgentEvaluationRunStatus;
  startedAt: string;
  endedAt: string;
  progress: { completed: number; total: number; currentCaseId: string };
  summary: AgentEvaluationSummary;
  errors: string[];
}

export interface AgentEvaluationRun extends AgentEvaluationRunSummary {
  cases: AgentEvaluationCaseResult[];
}

export const agentEvaluationApi = {
  listDatasets: (knowledgeBaseId: string, silent = false) =>
    http.get<{ items: AgentEvaluationDataset[] }>(
      "/api/evaluations/llm-wiki-agent/datasets",
      { knowledgeBaseId },
      silent ? { silent: true } : undefined,
    ),
  getDataset: (knowledgeBaseId: string, datasetId: string, silent = false) =>
    http.get<AgentEvaluationDataset>(
      `/api/evaluations/llm-wiki-agent/datasets/${encodeURIComponent(datasetId)}`,
      { knowledgeBaseId },
      silent ? { silent: true } : undefined,
    ),
  uploadDataset: (knowledgeBaseId: string, file: File) => {
    const data = new FormData();
    data.append("file", file);
    return http.postForm<AgentEvaluationDataset>(
      `/api/evaluations/llm-wiki-agent/datasets/upload?knowledgeBaseId=${encodeURIComponent(knowledgeBaseId)}`,
      data,
    );
  },
  deleteDataset: (knowledgeBaseId: string, datasetId: string) =>
    http.delete<{ ok: true }>(
      `/api/evaluations/llm-wiki-agent/datasets/${encodeURIComponent(datasetId)}?knowledgeBaseId=${encodeURIComponent(knowledgeBaseId)}`,
    ),
  createRun: (body: {
    knowledgeBaseId: string;
    datasetId: string;
    caseIds?: string[];
    fastModel: string;
    qualityModel: string;
    judgeModel: string;
  }) =>
    http.post<AgentEvaluationRun>("/api/evaluations/llm-wiki-agent/runs", body),
  listRuns: (knowledgeBaseId: string, silent = false) =>
    http.get<{ items: AgentEvaluationRunSummary[] }>(
      "/api/evaluations/llm-wiki-agent/runs",
      { knowledgeBaseId },
      silent ? { silent: true } : undefined,
    ),
  getRun: (runId: string, silent = false) =>
    http.get<AgentEvaluationRun>(
      `/api/evaluations/llm-wiki-agent/runs/${encodeURIComponent(runId)}`,
      undefined,
      silent ? { silent: true } : undefined,
    ),
  cancelRun: (runId: string) =>
    http.post<{ ok: boolean; runId: string; status: string }>(
      `/api/evaluations/llm-wiki-agent/runs/${encodeURIComponent(runId)}/cancel`,
    ),
  deleteRun: (runId: string) =>
    http.delete<{ ok: true; runId: string }>(
      `/api/evaluations/llm-wiki-agent/runs/${encodeURIComponent(runId)}`,
    ),
};
