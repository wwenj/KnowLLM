import type { LlmWikiIssue, LlmWikiSource } from "@/api/llmWiki";

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function formatPercent(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `${Math.round(value * 100)}%`;
}

export function isWikiPageTarget(target?: string): boolean {
  const value = String(target || "").trim();
  if (!value || /^[a-f0-9]{32}$/i.test(value)) return false;
  return value.endsWith(".md") || value.includes("/");
}

export function wikiStatusClass(status: LlmWikiSource["status"]): string {
  const statusClasses: Record<LlmWikiSource["status"], string> = {
    uploaded: "border-amber-200 bg-amber-50 text-amber-700",
    ingesting: "border-indigo-200 bg-indigo-50 text-indigo-700",
    ready: "border-emerald-200 bg-emerald-50 text-emerald-700",
    failed: "border-rose-200 bg-rose-50 text-rose-700",
  };
  return statusClasses[status];
}

export function jobStatusClass(status?: string): string {
  if (status === "success") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "failed") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "running") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function issueSeverityClass(severity: LlmWikiIssue["severity"]): string {
  if (severity === "error") return "border-rose-200 bg-rose-50 text-rose-700";
  if (severity === "info") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export function countIssues(issues: LlmWikiIssue[]) {
  return issues.reduce(
    (counts, issue) => {
      counts[issue.severity] += 1;
      return counts;
    },
    { error: 0, warning: 0, info: 0 },
  );
}

export function issueAdvice(kind: string): string {
  const advice: Record<string, string> = {
    conflict: "人工回读 source，对冲突结论做保留、改写或标注未确认。",
    human_review: "人工确认原文证据或语义冲突，再决定是否保留。",
    needs_review: "回到页面和 source 核对证据是否足够。",
    blocked_publish: "查看 ingest job，修正 source 或编译逻辑后重新解析。",
  };
  return advice[kind] || "核对对应 source 和页面后处理。";
}
