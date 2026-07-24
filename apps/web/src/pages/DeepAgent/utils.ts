import type {
  AgentRunDetail,
  AgentRunEvent,
  AgentRunStatus,
} from "@/api/agent";
import type { ModelOption } from "@/api/model";
import type { LlmWikiConfig, StatusKey } from "./types";

export const RUN_CONFIG_STORAGE_KEY = "knowllm.llmWikiAgent.config.v2";

export function buildRunBody(config: LlmWikiConfig): Record<string, unknown> {
  return {
    query: config.query.trim(),
    limit: config.limit,
    fastModel: config.fastModel,
    qualityModel: config.qualityModel,
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

export function formatMetric(value?: number): string {
  if (!Number.isFinite(value)) return "-";
  return Math.max(0, Math.round(Number(value))).toLocaleString("zh-CN");
}

export function buildLogPayload(detail: AgentRunDetail | null, events: AgentRunEvent[]) {
  return { detail, events, exportedAt: new Date().toISOString() };
}

export function eventMeta(event: AgentRunEvent): string {
  const parts = [
    event.stage ? `阶段 ${String(event.stage)}` : "",
    event.model ? `模型 ${String(event.model)}` : "",
    event.attempt ? `第 ${String(event.attempt)} 次` : "",
    event.tool ? `Tool ${String(event.tool)}` : "",
    typeof event.round === "number" ? (event.round === 0 ? "初始调用" : `第 ${event.round} 轮`) : "",
    event.cached === true ? "缓存命中" : "",
    event.status ? `状态 ${String(event.status)}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

export interface EventDetail {
  label: string;
  text: string;
}

export function eventDetail(event: AgentRunEvent): EventDetail | null {
  const focused = event.type === "model_request"
    ? { label: "模型请求参数", value: event.request }
    : event.type === "model_response"
      ? { label: "模型返回结果", value: event.response }
      : event.type === "tool_request"
        ? { label: "Tool 请求参数", value: event.request }
        : event.type === "tool_response"
          ? { label: "Tool 返回结果", value: event.response ?? event.error }
          : null;
  if (focused && focused.value !== undefined) {
    const text = stringifyDetail(focused.value);
    return {
      label: focused.label,
      text,
    };
  }

  const excluded = new Set([
    "type", "msg", "ts", "runId", "agentType", "status", "model", "stage",
    "phase", "tool", "attempt", "round", "cached",
  ]);
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (!excluded.has(key) && value !== undefined) payload[key] = value;
  }
  if (!Object.keys(payload).length) return null;
  const text = stringifyDetail(payload);
  return {
    label: event.type === "plan_created" ? "规划结果" : event.type.includes("error") ? "错误详情" : "执行详情",
    text,
  };
}

function stringifyDetail(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
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
      fastModel: stringValue(raw.fastModel),
      qualityModel: stringValue(raw.qualityModel),
    };
  } catch {
    return { query: "", limit: 8, fastModel: "", qualityModel: "" };
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
