import type { AgentProfile, AgentRunStatus } from "@/api/agent";

export type AgentType = string;
export type StatusKey = "idle" | AgentRunStatus;

export interface LlmWikiConfig {
  query: string;
  limit: number;
  fastModel: string;
  qualityModel: string;
}

export const TERMINAL: AgentRunStatus[] = [
  "success",
  "insufficient",
  "failed",
  "cancelled",
];

export const FALLBACK_PROFILES: AgentProfile[] = [
  {
    agentType: "llmWiki",
    label: "LLM Wiki Agent",
    description: "基于本地 LLM Wiki 检索结果回答问题",
  },
];
