export type CompileEvaluationFactStatus = "correct" | "missing" | "incorrect";
export type CompileEvaluationCaseStatus =
  | "pending"
  | "running"
  | "success"
  | "source_missing"
  | "evaluation_failed"
  | "failed";
export type CompileEvaluationRunStatus = "running" | "success" | "partial" | "failed";
export type CompileEvaluationFactImportance = "must" | "should" | "nice";
export type CompileEvaluationPassLevel = "excellent" | "pass" | "needs_improvement" | "failed";

export interface CompileEvaluationDatasetSource {
  id: string;
  filename: string;
  content: string;
  sha256: string;
}

export interface CompileEvaluationExpectedFact {
  id: string;
  fact: string;
  sourceFile: string;
  evidence: string;
  type: string;
  importance: CompileEvaluationFactImportance;
}

export interface CompileEvaluationDatasetCase {
  id: string;
  name: string;
  sourceIds: string[];
  expectedFacts: CompileEvaluationExpectedFact[];
}

export interface CompileEvaluationDataset {
  datasetId: string;
  name: string;
  uploadedAt: string;
  sources: CompileEvaluationDatasetSource[];
  cases: CompileEvaluationDatasetCase[];
}

export interface CompileEvaluationDatasetSummary {
  datasetId: string;
  name: string;
  uploadedAt: string;
  sourceCount: number;
  caseCount: number;
  factCount: number;
}

export interface CompileEvaluationMatchedSource {
  datasetSourceId: string;
  filename: string;
  sha256: string;
  sourceId: string | null;
  ingestedAt: string;
}

export interface CompileEvaluationUsage {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CompileEvaluationFactResult extends CompileEvaluationExpectedFact {
  status: CompileEvaluationFactStatus;
  evidencePath: string;
  wikiEvidence: string;
  reason: string;
  confidence: number | null;
  weight: number;
  score: number;
  coveredByClaims: boolean;
  judgeNeedsReview: boolean;
  unsupportedCorrect: boolean;
}

export interface CompileEvaluationCaseResult {
  caseId: string;
  name: string;
  status: CompileEvaluationCaseStatus;
  matchedSources: CompileEvaluationMatchedSource[];
  pagePaths: string[];
  facts: CompileEvaluationFactResult[];
  usage?: CompileEvaluationUsage;
  error: string;
}

export interface CompileEvaluationWikiSnapshot {
  snapshotHash: string;
  createdAt: string;
  sources: Array<{
    sourceId: string;
    filename: string;
    status: string;
    sha256: string;
    ingestedAt: string;
    compilerVersion: string;
    promptVersion: string;
    compileModel: string;
  }>;
  pages: Array<{
    path: string;
    title: string;
    content: string;
    sourceIds: string[];
  }>;
  pageClaims: Array<{
    path: string;
    factIds: string[];
    sourceIds: string[];
  }>;
  facts: Array<{
    factId: string;
    sourceId: string;
    fact: string;
    evidence: string;
    entities: string[];
    type: string;
  }>;
}

export interface CompileEvaluationSummary {
  totalFacts: number;
  correct: number;
  missing: number;
  incorrect: number;
  accuracy: number;
  rawAccuracy: number;
  weightedScore: number;
  mustAccuracy: number;
  missingRate: number;
  incorrectRate: number;
  totalWeight: number;
  correctWeight: number;
  mustTotal: number;
  mustCorrect: number;
  coveredByClaims: number;
  judgeNeedsReview: number;
  unsupportedCorrect: number;
  passLevel: CompileEvaluationPassLevel;
  sourceMissingCases: number;
  failedCases: number;
}

export interface CompileEvaluationRun {
  runId: string;
  datasetId: string;
  datasetName: string;
  caseIds: string[];
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
  progress: {
    completed: number;
    total: number;
    currentCaseId: string;
  };
  cases: CompileEvaluationCaseResult[];
  summary: CompileEvaluationSummary;
  errors: string[];
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
  progress: CompileEvaluationRun["progress"];
  summary: CompileEvaluationSummary;
}

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

export interface AgentEvaluationDatasetSource {
  id: string;
  filename: string;
  content: string;
  sha256: string;
}

export interface AgentEvaluationExpectedFact {
  id: string;
  fact: string;
}

export interface AgentEvaluationDatasetCase {
  id: string;
  question: string;
  answerable: boolean;
  expectedAnswer: string;
  expectedFacts: AgentEvaluationExpectedFact[];
  relevantSourceIds: string[];
  mustInclude: string[];
  evaluationType: string;
}

export interface AgentEvaluationDataset {
  datasetId: string;
  name: string;
  uploadedAt: string;
  sources: AgentEvaluationDatasetSource[];
  cases: AgentEvaluationDatasetCase[];
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

export interface AgentEvaluationMatchedSource {
  datasetSourceId: string;
  filename: string;
  sha256: string;
  sourceId: string | null;
  ingestedAt: string;
}

export interface AgentEvaluationFactResult extends AgentEvaluationExpectedFact {
  status: AgentEvaluationFactStatus;
  evidencePath: string;
  evidence: string;
  reason: string;
}

export interface AgentEvaluationMetricResult {
  status: AgentEvaluationMetricStatus;
  reason: string;
}

export interface AgentEvaluationCaseMetrics {
  rounds: number;
  readPages: number;
  keptPages: number;
  rawSources: number;
  modelCalls: number;
  totalTokens: number;
  stopReason: string;
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
  matchedSources: AgentEvaluationMatchedSource[];
  expectedSourceIds: string[];
  hitSourceIds: string[];
  sourceHit: boolean | null;
  mustInclude: string[];
  mustIncludeHits: string[];
  answerMarkdown: string;
  facts: AgentEvaluationFactResult[];
  factScore: number;
  taskScore: number;
  faithfulness: AgentEvaluationMetricResult;
  answerCorrectness: AgentEvaluationMetricResult;
  abstainCorrectness: AgentEvaluationMetricResult;
  metrics: AgentEvaluationCaseMetrics;
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

export interface AgentEvaluationRun {
  runId: string;
  datasetId: string;
  datasetName: string;
  caseIds: string[];
  judgeModel: string;
  sourcePolicy: AgentEvaluationSourcePolicy;
  budget: AgentEvaluationBudget;
  models: AgentEvaluationModels;
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

export interface AgentEvaluationRunSummary {
  runId: string;
  datasetId: string;
  datasetName: string;
  judgeModel: string;
  sourcePolicy: AgentEvaluationSourcePolicy;
  status: AgentEvaluationRunStatus;
  startedAt: string;
  endedAt: string;
  progress: AgentEvaluationRun["progress"];
  summary: AgentEvaluationSummary;
}
