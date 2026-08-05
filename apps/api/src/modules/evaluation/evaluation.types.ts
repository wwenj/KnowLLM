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
