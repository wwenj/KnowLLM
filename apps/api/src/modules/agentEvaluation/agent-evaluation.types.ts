export const AGENT_EVALUATION_SCHEMA_VERSION = 2 as const;

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

export type AgentEvaluationAbstainStatus =
  | "correct"
  | "partial"
  | "incorrect"
  | "not_applicable";

export type AgentEvaluationHallucinationLevel = "none" | "material" | "safety";

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

export type AgentEvaluationPassLevel =
  | "excellent"
  | "acceptable"
  | "needs_improvement"
  | "unavailable";

export interface AgentEvaluationGoldEvidence {
  pageKey: string;
  quote: string;
}

export interface AgentEvaluationRequiredFact {
  id: string;
  fact: string;
  evidence: AgentEvaluationGoldEvidence;
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
  schemaVersion: typeof AGENT_EVALUATION_SCHEMA_VERSION;
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

export interface AgentEvaluationVerifiedEvidence {
  evidenceId: string;
  pageKey: string;
  quote: string;
  claim: string;
}

export interface AgentEvaluationFactResult extends AgentEvaluationRequiredFact {
  status: AgentEvaluationFactStatus;
  score: number;
  evidenceIds: string[];
  reason: string;
  failureStage: AgentEvaluationFailureStage | null;
}

export interface AgentEvaluationCaseMetrics {
  durationMs: number;
  totalTokens: number;
  modelCalls: number;
  readPages: number;
  searches: number;
  retries: number;
  timeouts: number;
  stopReason: string;
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
  verifiedEvidence: AgentEvaluationVerifiedEvidence[];
  readPageKeys: string[];
  facts: AgentEvaluationFactResult[];
  abstainStatus: AgentEvaluationAbstainStatus;
  abstainReason: string;
  hallucinationLevel: AgentEvaluationHallucinationLevel;
  hallucinationReason: string;
  caseScore: number | null;
  metrics: AgentEvaluationCaseMetrics;
  error: string;
}

export interface AgentEvaluationFailureBreakdown {
  retrievalMiss: number;
  evidenceExtractionMiss: number;
  finalAnswerMiss: number;
  incorrectAnswer: number;
  executionFailure: number;
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
  passLevel: AgentEvaluationPassLevel;
  executionSuccessRate: number;
  totalTokens: number;
  totalModelCalls: number;
  totalReadPages: number;
  totalSearches: number;
  totalRetries: number;
  totalTimeouts: number;
  averageDurationMs: number;
  failureBreakdown: AgentEvaluationFailureBreakdown;
}

export interface AgentEvaluationRun {
  schemaVersion: typeof AGENT_EVALUATION_SCHEMA_VERSION;
  runId: string;
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
  progress: {
    completed: number;
    total: number;
    currentCaseId: string;
  };
  cases: AgentEvaluationCaseResult[];
  summary: AgentEvaluationSummary;
  errors: string[];
}

export type AgentEvaluationRunSummary = Omit<AgentEvaluationRun, "cases">;
