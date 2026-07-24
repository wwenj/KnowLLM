import type {
  ToolsCatalog,
  ToolsPageDetail,
  ToolsSearchResult,
  ToolsSourceDetail,
} from "../../../llmWikiNext/llm-wiki-next.types";
import type { AgentRunTokens } from "../../agent.types";

export const DEFAULT_FAST_MODEL = "openapi-gpt:gpt-5.4-mini";
export const DEFAULT_QUALITY_MODEL = "openapi-gpt:gpt-5.5";
export const DEFAULT_LIMIT = 8;
export const MAX_LIMIT = 20;
export const MAX_PLAN_TASKS = 6;
export const MAX_REACT_ROUNDS = 3;
export const MAX_ACTIONS_PER_ROUND = 6;
export const MAX_SEARCHES = 6;
export const MAX_SOURCE_READS = 6;
export const MAX_MODEL_CALLS = 6;
export const MAX_MODEL_ATTEMPTS = 8;
export const MAX_MODEL_RETRIES = 2;
export const TOKEN_LIMIT = 48_000;
export const FINAL_TOKEN_RESERVE = 12_000;

export type EvidenceRequirement = "page" | "fact" | "source";
export type ToolName = "searchWiki" | "readPage" | "readSource" | "finish";
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

/**
 * Planner 从 getCatalog.pages 中消费的最小页面元组：
 * pageKey = readPage 的页面 ID；title = 页面主题；goal = 页面覆盖范围。
 */
export type PlannerCatalogPage = [pageKey: string, title: string, goal: string];

export interface QueryTask {
  taskId: string;
  question: string;
  evidenceRequirement: EvidenceRequirement;
}

export interface PlannerAction {
  tool: "searchWiki" | "readPage";
  value: string;
}

export interface QueryPlan {
  relevant: boolean;
  tasks: QueryTask[];
  actions: PlannerAction[];
}

export interface SearchAction {
  tool: "searchWiki";
  query: string;
  reason?: string;
}

export interface ReadPageAction {
  tool: "readPage";
  pageKey: string;
  reason?: string;
}

export interface ReadSourceAction {
  tool: "readSource";
  sourceId: string;
  startLine?: number;
  endLine?: number;
  reason?: string;
}

export interface FinishAction {
  tool: "finish";
  reason?: string;
}

export type ReactAction = SearchAction | ReadPageAction | ReadSourceAction | FinishAction;

export interface EvidenceSelection {
  taskId: string;
  kind: "page" | "fact" | "source";
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

export interface ReactDecision {
  coverage: Array<{ taskId: string; status: "covered" | "partial" | "missing"; note: string }>;
  evidence: EvidenceSelection[];
  actions: ReactAction[];
  conflicts: string[];
  gaps: string[];
  finish: boolean;
  finishReason: string;
  escalateToQuality: boolean;
}

export interface RetrievalRound {
  round: number;
  model: string;
  actions: ReactAction[];
  observations: Array<{ tool: ToolName; key: string; cached: boolean; summary: string }>;
  evidenceIds: string[];
  coverage: ReactDecision["coverage"];
  conflicts: string[];
  gaps: string[];
  finish: boolean;
}

export interface LlmWikiAgentState {
  query: string;
  input: LlmWikiAgentInput;
  catalog: ToolsCatalog | null;
  plannerCatalog: PlannerCatalogPage[] | null;
  catalogFingerprint: string;
  plan: QueryPlan | null;
  round: number;
  pages: Map<string, ToolsPageDetail>;
  searches: Map<string, ToolsSearchResult>;
  sources: Map<string, ToolsSourceDetail>;
  evidence: VerifiedEvidence[];
  coverage: ReactDecision["coverage"];
  gaps: string[];
  conflicts: string[];
  retrievalRounds: RetrievalRound[];
  stopReason: StopReason | null;
  tokens: AgentRunTokens;
  modelAttempts: number;
  retries: number;
  baseModelCalls: number;
  lastRoundProgress: boolean;
  qualityReactNext: boolean;
  newObservations: Record<string, unknown>;
}

export interface FinalAnswer {
  answerable: boolean;
  answerMarkdown: string;
  citations: string[];
  gaps: string[];
}
