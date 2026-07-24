import type {
  ToolsCatalog,
  ToolsPageDetail,
  ToolsSearchResult,
  ToolsSourceDetail,
  ToolsSourceSummary,
} from "../../../llmWikiNext/llm-wiki-next.types";
import type { ResponseTextFormat } from "../../../model/model.service";
import type { AgentRunTokens } from "../../agent.types";

export const DEFAULT_FAST_MODEL = "openapi-gpt:gpt-5.4-mini";
export const DEFAULT_QUALITY_MODEL = "openapi-gpt:gpt-5.5";
export const DEFAULT_LIMIT = 8;
export const MAX_LIMIT = 20;
export const MAX_PLAN_TASKS = 6;
export const MAX_REACT_ROUNDS = 3;
export const MAX_ACTIONS_PER_ROUND = 6;
export const MAX_SEARCHES = 6;
export const MAX_MAIN_MODEL_CALLS = 6;
export const MAX_SOURCE_MODEL_CALLS = 10;
export const MAX_MODEL_ATTEMPTS = 32;
export const TOKEN_LIMIT = 48_000;
export const FINAL_TOKEN_RESERVE = 12_000;
export const SOURCE_CHUNK_LINES = 1_000;
export const MAX_SOURCE_ROUNDS = 5;

export type TaskStatus = "active" | "completed" | "insufficient";
export type AnswerStatus = "complete" | "partial" | "insufficient";
export type ToolName = "searchWiki" | "readPage" | "traceSource";
export type StopReason =
  | "complete"
  | "no_relevant_wiki"
  | "insufficient_evidence"
  | "max_rounds"
  | "no_new_evidence"
  | "token_limit"
  | "cancelled"
  | "wiki_changed";

export interface LlmWikiAgentInput extends Record<string, unknown> {
  query: string;
  limit: number;
  fastModel: string;
  qualityModel: string;
}

/** Planner 只消费 [pageKey, title, goal]，目录不能作为事实证据。 */
export type PlannerCatalogPage = [pageKey: string, title: string, goal: string];

export interface QueryTask {
  taskId: string;
  question: string;
}

export interface PlannerAction {
  taskId: string;
  tool: "searchWiki" | "readPage";
  value: string;
}

export interface QueryPlan {
  relevant: boolean;
  tasks: QueryTask[];
  actions: PlannerAction[];
}

interface TaskAction {
  taskId: string;
}

export interface SearchAction extends TaskAction {
  tool: "searchWiki";
  query: string;
}

export interface ReadPageAction extends TaskAction {
  tool: "readPage";
  pageKey: string;
}

export interface TraceSourceAction extends TaskAction {
  tool: "traceSource";
  sourceId: string;
}

export type ReactAction = SearchAction | ReadPageAction | TraceSourceAction;

export interface EvidenceSelection {
  taskId: string;
  kind: "page" | "source";
  pageKey?: string;
  sourceId?: string;
  quote: string;
  claim: string;
  sourceLine?: number;
}

export interface VerifiedEvidence extends EvidenceSelection {
  evidenceId: string;
  sourceFilename?: string;
  range?: { startLine: number; endLine: number };
}

export interface TaskState extends QueryTask {
  status: TaskStatus;
  conclusion: string;
  evidenceIds: string[];
  insufficientReason?: string;
  observationRefs: string[];
  attemptedActions: string[];
  gaps: string[];
}

export interface TaskStateDecision {
  taskId: string;
  status: TaskStatus;
  conclusion: string;
  reason: string;
  gaps: string[];
}

export interface ReactDecision {
  evidence: EvidenceSelection[];
  taskStates: TaskStateDecision[];
  actions: ReactAction[];
  conflicts: string[];
}

export interface TaskProgress {
  taskId: string;
  status: TaskStatus;
  note: string;
}

export interface RetrievalRound {
  round: number;
  model: string;
  actions: ReactAction[];
  observations: Array<{
    tool: ToolName;
    taskId: string;
    key: string;
    cached: boolean;
    summary: string;
  }>;
  evidenceIds: string[];
  taskProgress: TaskProgress[];
  conflicts: string[];
  rejectedActions: string[];
  finished: boolean;
}

export interface SourceTraceDecision {
  evidence: Array<{ quote: string; claim: string }>;
  sufficient: boolean;
  conclusion: string;
  unresolved: string[];
}

export interface SourceTraceModelRequest {
  stage: string;
  system: string;
  payload: Record<string, unknown>;
  format: ResponseTextFormat;
  maxTokens: number;
  parse(value: Record<string, unknown>): SourceTraceDecision;
}

export interface SourceTraceEvidence {
  taskId: string;
  kind: "source";
  sourceId: string;
  sourceFilename: string;
  quote: string;
  claim: string;
  sourceLine: number;
  range: { startLine: number; endLine: number };
}

export type SourceTraceStatus = "sufficient" | "insufficient" | "failed";

export interface SourceTraceRunResult {
  taskId: string;
  sourceId: string;
  status: SourceTraceStatus;
  conclusion: string;
  evidence: SourceTraceEvidence[];
  unresolved: string[];
  rounds: number;
  reason?: string;
  reads: ToolsSourceDetail[];
}

export interface SourceTraceSummary {
  taskId: string;
  sourceId: string;
  filename: string;
  status: SourceTraceStatus;
  conclusion: string;
  evidenceIds: string[];
  evidence: Array<{
    evidenceId: string;
    quote: string;
    claim: string;
    filename: string;
    startLine: number;
    endLine: number;
  }>;
  unresolved: string[];
  rounds: number;
  reason?: string;
}

export interface SourceTraceInput {
  taskId: string;
  question: string;
  source: ToolsSourceSummary;
  maxRounds: number;
  signal: AbortSignal;
  callModel(
    request: SourceTraceModelRequest,
  ): Promise<SourceTraceDecision | null>;
  canCallModel?(): boolean;
  onRead?(detail: ToolsSourceDetail, round: number): void;
}

export interface LlmWikiAgentState {
  query: string;
  input: LlmWikiAgentInput;
  catalog: ToolsCatalog | null;
  plannerCatalog: PlannerCatalogPage[] | null;
  catalogFingerprint: string;
  plan: QueryPlan | null;
  tasks: Map<string, TaskState>;
  round: number;
  pages: Map<string, ToolsPageDetail>;
  searches: Map<string, ToolsSearchResult>;
  sources: Map<string, ToolsSourceDetail>;
  sourceTraces: SourceTraceSummary[];
  evidence: VerifiedEvidence[];
  conflicts: string[];
  retrievalRounds: RetrievalRound[];
  stopReason: StopReason | null;
  tokens: AgentRunTokens;
  modelAttempts: number;
  retries: number;
  baseModelCalls: number;
  sourceModelCalls: number;
  lastRoundProgress: boolean;
}

export interface FinalAnswer {
  answerable: boolean;
  answerStatus: AnswerStatus;
  answerMarkdown: string;
  citations: string[];
  gaps: string[];
}
