import { http } from "./http";

export type AgentRunStatus =
  | "running"
  | "success"
  | "insufficient"
  | "failed"
  | "cancelled";

export interface AgentProfile {
  agentType: string;
  label: string;
  description: string;
}

export interface AgentRunEvent {
  type: string;
  msg?: string;
  ts?: string;
  runId?: string;
  agentType?: string;
  status?: string;
  model?: string;
  phase?: string;
  tool?: string;
  result?: unknown;
  preview?: string;
  content?: string;
  [key: string]: unknown;
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

export interface AgentRunDetail extends AgentRunSummary {
  input: Record<string, unknown>;
  errors: string[];
  contentFormat: "markdown";
  events: AgentRunEvent[];
  resultMd: string;
  resultJson: Record<string, unknown> | null;
}

export interface AgentCreateRunResp {
  runId: string;
  agentType: string;
  status: "running";
}

export interface AgentCancelResp {
  ok: boolean;
  runId: string;
  status: string;
}

export const agentApi = {
  listAgents: (silent = false) =>
    http.get<{ items: AgentProfile[] }>(
      "/api/agents",
      undefined,
      silent ? { silent: true } : undefined,
    ),
  getDefaults: <T = Record<string, unknown>>(agentType: string, silent = false) =>
    http.get<T>(
      `/api/agents/${encodeURIComponent(agentType)}/defaults`,
      undefined,
      silent ? { silent: true } : undefined,
    ),
  listAllRuns: (limit = 50, silent = false) =>
    http.get<{ items: AgentRunSummary[] }>(
      `/api/agents/runs?limit=${limit}`,
      undefined,
      silent ? { silent: true } : undefined,
    ),
  createRun: (agentType: string, body: Record<string, unknown>) =>
    http.post<AgentCreateRunResp>(
      `/api/agents/${encodeURIComponent(agentType)}/runs`,
      body,
    ),
  getRun: (agentType: string, runId: string, silent = false) =>
    http.get<AgentRunDetail>(
      `/api/agents/${encodeURIComponent(agentType)}/runs/${encodeURIComponent(runId)}`,
      undefined,
      silent ? { silent: true } : undefined,
    ),
  cancelRun: (agentType: string, runId: string) =>
    http.post<AgentCancelResp>(
      `/api/agents/${encodeURIComponent(agentType)}/runs/${encodeURIComponent(runId)}/cancel`,
    ),
};
