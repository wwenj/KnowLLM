export type AgentRunStatus = "running" | "success" | "insufficient" | "failed" | "cancelled";

export interface AgentProfile {
  agentType: string;
  label: string;
  description: string;
}

export interface AgentRunEvent {
  type: string;
  msg?: string;
  ts?: string;
  [key: string]: unknown;
}

export interface AgentRunSummary {
  runId: string;
  agentType: string;
  title: string;
  status: AgentRunStatus;
  startedAt: string;
  endedAt?: string;
  runnerMeta?: Record<string, unknown>;
}

export interface AgentRunMeta extends AgentRunSummary {
  input: Record<string, unknown>;
  errors: string[];
  contentFormat: "markdown";
}

export interface AgentRunDetail extends AgentRunMeta {
  events: AgentRunEvent[];
  resultMd: string;
  resultJson: Record<string, unknown> | null;
}

export interface AgentRunnerResult {
  status?: AgentRunStatus;
  content: string;
  resultJson?: Record<string, unknown>;
  errors?: string[];
  runnerMeta?: Record<string, unknown>;
}

export interface AgentRunnerContext<TInput extends Record<string, unknown>> {
  runId: string;
  agentType: string;
  input: TInput;
  signal: AbortSignal;
  appendEvent(event: AgentRunEvent): void;
}

export interface AgentRunner<TInput extends Record<string, unknown> = Record<string, unknown>> {
  readonly agentType: string;
  getProfile(): AgentProfile;
  getDefaults(): Record<string, unknown>;
  validateInput(input: unknown): TInput;
  title(input: TInput): string;
  start(ctx: AgentRunnerContext<TInput>): Promise<AgentRunnerResult>;
}
