import type { AgentRunTokens } from "../../agent.types";
import type {
  LlmWikiPageRef,
  LlmWikiSchema,
  LlmWikiSearchHit,
  LlmWikiSourceMeta,
} from "../../../llmWiki/contracts/llm-wiki.types";

export type LlmWikiSourcePolicy = "auto" | "wiki-only" | "key-sources" | "exhaustive";
export type StopReason = "complete" | "max_rounds" | "token_limit" | "no_new_actions" | "insufficient_evidence";
export type QueryIntent = "overview" | "specific" | "compare" | "howto" | "debug";
export type PageHitReason = "required_path" | "optional_path" | "search_hit" | "linked_page";
export type SourceSupport = "verified" | "wiki-only" | "partial" | "conflict" | "unknown";

export interface LlmWikiBudget {
  maxRounds: number;
  maxEvidencePages: number;
  maxRawSources: number;
  tokenLimit: number | null;
}

export interface LlmWikiModels {
  plannerModel: string;
  reviewerModel: string;
  synthesizerModel: string;
}

export interface LlmWikiAgentInput extends Record<string, unknown> {
  query: string;
  sourcePolicy: LlmWikiSourcePolicy;
  budget: LlmWikiBudget;
  models: LlmWikiModels;
}

export interface WikiManifest {
  stats: { sourceCount: number; pageCount: number; readySources: number };
  schema: LlmWikiSchema;
  index: string;
  pages: LlmWikiPageRef[];
  sources: Array<Pick<LlmWikiSourceMeta, "source_id" | "filename" | "status" | "touched_pages">>;
}

export interface QueryTask {
  goal: string;
  requiredPaths: string[];
  optionalPaths: string[];
  searchQueries: string[];
  expectedContribution: string;
}

export interface QueryCoverage {
  coreTopics: string[];
  optionalTopics: string[];
  excludedTopics: string[];
}

export interface QueryPlan {
  queryIntent: QueryIntent;
  keywords: string[];
  entities: string[];
  tasks: QueryTask[];
  coverage: QueryCoverage;
  candidatePaths: string[];
  searchQueries: string[];
  reason: string;
}

export interface PlannedPageHit extends LlmWikiSearchHit {
  taskIndex: number;
  taskGoal: string;
  taskContribution: string;
  why: PageHitReason;
  required: boolean;
  order: number;
}

export interface RetrievedPage {
  path: string;
  title: string;
  type: string;
  tags: string[];
  sources: string[];
  content: string;
  score: number;
  why: PageHitReason | string;
  taskIndex: number;
  taskGoal: string;
  taskContribution: string;
  required: boolean;
  readInRound: number;
  links: string[];
}

export interface RetrievalAction {
  type: "read_page" | "search_wiki" | "follow_link" | "read_source" | "stop";
  path?: string;
  query?: string;
  fromPath?: string;
  sourceId?: string;
  reason?: string;
  taskIndex?: number;
  taskGoal?: string;
  taskContribution?: string;
  why?: PageHitReason;
  score?: number;
  required?: boolean;
}

export interface KeptPage {
  path: string;
  taskGoals: string[];
  relevanceScore: number;
  evidenceScore: number;
  selectedInRound: number;
  whyKept: string;
}

export interface DiscardedPage {
  path: string;
  title: string;
  reason: string;
  round: number;
}

export interface RetrievalRound {
  round: number;
  readPages: string[];
  keptPages: string[];
  droppedPages: string[];
  nextActions: RetrievalAction[];
  coverage: unknown;
  stopReason: string | null;
}

export interface SourceEvidence {
  source_id: string;
  filename: string;
  content: string;
  taskGoals: string[];
  pagePaths: string[];
  supportSummary: string;
}

export interface SourceReview {
  path: string;
  sourceSupport: SourceSupport;
  supportSummary: string;
}

export interface KnowledgeSnippet {
  path: string;
  title: string;
  type: "summary" | "concept" | "entity" | "index";
  tags: string[];
  sources: string[];
  content: string;
  taskGoals: string[];
  relevanceScore: number;
  evidenceScore: number;
  selectedInRound: number;
  whyKept: string;
  sourceSupport: SourceSupport;
}

export interface LlmWikiAgentState {
  query: string;
  sourcePolicy: LlmWikiSourcePolicy;
  budget: LlmWikiBudget;
  models: LlmWikiModels;
  manifest: WikiManifest | null;
  plan: QueryPlan | null;
  round: number;
  candidatePages: PlannedPageHit[];
  pendingActions: RetrievalAction[];
  requestedSourceIds: string[];
  pages: RetrievedPage[];
  lastReadPages: string[];
  keptPages: KeptPage[];
  discardedPages: DiscardedPage[];
  retrievalRounds: RetrievalRound[];
  sources: SourceEvidence[];
  sourceReviews: SourceReview[];
  knowledgeSnippets: KnowledgeSnippet[];
  answerMarkdown: string;
  resultJson: Record<string, unknown>;
  stopReason: StopReason | null;
  gaps: string[];
  coverageSummary: string;
  tokens: AgentRunTokens;
}
