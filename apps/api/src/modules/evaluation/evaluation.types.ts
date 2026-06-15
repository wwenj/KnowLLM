export type CompileEvaluationFactStatus = "correct" | "missing" | "incorrect";
export type CompileEvaluationCaseStatus = "pending" | "running" | "success" | "source_missing" | "failed";
export type CompileEvaluationRunStatus = "running" | "success" | "failed";

export interface CompileEvaluationDatasetSource {
  id: string;
  filename: string;
  content: string;
  sha256: string;
}

export interface CompileEvaluationExpectedFact {
  id: string;
  fact: string;
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

export interface CompileEvaluationFactResult extends CompileEvaluationExpectedFact {
  status: CompileEvaluationFactStatus;
  evidencePath: string;
  evidence: string;
  reason: string;
}

export interface CompileEvaluationCaseResult {
  caseId: string;
  name: string;
  status: CompileEvaluationCaseStatus;
  matchedSources: CompileEvaluationMatchedSource[];
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

export interface CompileEvaluationRun {
  runId: string;
  datasetId: string;
  datasetName: string;
  caseIds: string[];
  judgeModel: string;
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
  status: CompileEvaluationRunStatus;
  startedAt: string;
  endedAt: string;
  progress: CompileEvaluationRun["progress"];
  summary: CompileEvaluationSummary;
}
