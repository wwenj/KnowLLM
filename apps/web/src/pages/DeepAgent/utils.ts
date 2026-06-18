import type {
  AgentRunDetail,
  AgentRunEvent,
  AgentRunStatus,
} from "@/api/agent";
import type { ModelOption } from "@/api/model";
import type { LlmWikiConfig, StatusKey } from "./types";

export const RUN_CONFIG_STORAGE_KEY = "knowllm.llmWikiAgent.config.v1";

export function buildRunBody(config: LlmWikiConfig): Record<string, unknown> {
  return {
    query: config.query.trim(),
    limit: config.limit,
    model: config.model || undefined,
  };
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.round(value), min), max);
}

export function statusPillClass(status: AgentRunStatus): string {
  if (status === "success") return "bg-emerald-50 text-emerald-700";
  if (status === "failed") return "bg-rose-50 text-rose-700";
  if (status === "running") return "bg-sky-50 text-sky-700";
  if (status === "insufficient") return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

export function statusText(status: StatusKey): string {
  const map: Record<string, string> = {
    idle: "未开始",
    running: "运行中",
    success: "成功",
    insufficient: "不足",
    failed: "失败",
    cancelled: "取消",
  };
  return map[status] || status;
}

export function formatDateTime(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDuration(start?: string, end?: string): string {
  if (!start) return "-";
  const startAt = new Date(start).getTime();
  const endAt = end ? new Date(end).getTime() : Date.now();
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) return "-";
  const seconds = Math.max(0, Math.round((endAt - startAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function buildLogPayload(detail: AgentRunDetail | null, events: AgentRunEvent[]) {
  return { detail, events, exportedAt: new Date().toISOString() };
}

export function eventMeta(event: AgentRunEvent): string {
  const parts = [
    event.model ? `model ${String(event.model)}` : "",
    event.status ? `status ${String(event.status)}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

export function eventDetail(event: AgentRunEvent): string | null {
  const keys = ["query", "hits", "result", "resultJson", "error"];
  const payload: Record<string, unknown> = {};
  for (const key of keys) {
    if (event[key] !== undefined) payload[key] = event[key];
  }
  if (!Object.keys(payload).length) return null;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

export function agentTypeText(agentType: string): string {
  if (agentType === "llmWiki") return "Wiki";
  return agentType;
}

export function agentTypePillClass(agentType: string): string {
  if (agentType === "llmWiki") return "bg-sky-50 text-sky-700";
  return "bg-slate-100 text-slate-600";
}

export function readStoredConfig(): LlmWikiConfig {
  try {
    const raw = JSON.parse(
      window.localStorage.getItem(RUN_CONFIG_STORAGE_KEY) || "{}",
    ) as Record<string, unknown>;
    return {
      query: stringValue(raw.query),
      limit: clamp(numberValue(raw.limit, 8), 1, 20),
      model: stringValue(raw.model),
    };
  } catch {
    return { query: "", limit: 8, model: "" };
  }
}

export function pickModel(value: string, options: ModelOption[]): string {
  if (value) {
    const matched = options.find((option) => option.id === value || option.model === value);
    if (matched) return matched.id;
  }
  return options[0]?.id || "";
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
