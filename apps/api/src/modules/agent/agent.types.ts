export type AgentRunStatus =
  | "running"
  | "success"
  | "insufficient"
  | "failed"
  | "cancelled";

export interface AgentRunEvent {
  type: string;
  msg?: string;
  ts?: string;
  runId?: string;
  agentType?: string;
  [key: string]: unknown;
}

export interface AgentRunTokens {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  rounds: number;
  modelCalls: number;
  tokenLimit: number | null;
}

export interface AgentRunStats {
  modelCalls: number;
  toolRounds: number;
  [key: string]: unknown;
}

export interface AgentArtifact {
  path: string;
  workspacePath: string;
  size: number;
  modifiedAt: number;
  mime: string;
  url: string;
  downloadUrl: string;
}

export interface AgentRunMeta {
  runId: string;
  agentType: string;
  title: string;
  status: AgentRunStatus;
  startedAt: string;
  endedAt: string;
  input: Record<string, unknown>;
  errors: string[];
  contentFormat: "markdown";
  artifacts: AgentArtifact[];
  runnerMeta: Record<string, unknown>;
  tokens?: AgentRunTokens;
  stats?: AgentRunStats;
}

export interface AgentRunSummary {
  runId: string;
  agentType: string;
  title: string;
  status: AgentRunStatus;
  startedAt: string;
  endedAt: string;
  runnerMeta: Record<string, unknown>;
}

export interface AgentRunDetail extends AgentRunMeta {
  events: AgentRunEvent[];
  resultMd: string;
  resultJson: Record<string, unknown> | null;
}

export interface AgentProfile {
  agentType: string;
  label: string;
  description: string;
}

export interface AgentRunnerResult {
  status?: AgentRunStatus;
  content: string;
  resultJson?: Record<string, unknown>;
  artifacts?: AgentArtifact[];
  errors?: string[];
  runnerMeta?: Record<string, unknown>;
  tokens?: AgentRunTokens;
  stats?: AgentRunStats;
}

export interface AgentRunnerContext<TInput extends Record<string, unknown> = Record<string, unknown>> {
  runId: string;
  agentType: string;
  input: TInput;
  signal: AbortSignal;
  appendEvent(event: AgentRunEvent): void;
  updateRunnerMeta(meta: Record<string, unknown>): void;
}

export interface AgentRunner<TInput extends Record<string, unknown> = Record<string, unknown>> {
  readonly agentType: string;
  getProfile(): AgentProfile;
  getDefaults(): Record<string, unknown>;
  validateInput(input: unknown): TInput;
  title(input: TInput): string;
  start(ctx: AgentRunnerContext<TInput>): Promise<AgentRunnerResult>;
  cancel?(runId: string): Promise<void> | void;
}

export function nowIso(): string {
  return new Date().toISOString();
}
