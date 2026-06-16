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
    dead_link: "打开页面，修正或删除对应 wikilink。",
    orphan_page: "从相关页面增加链接，或确认该页可独立存在后标记解决。",
    index_missing: "打开页面核对后手动维护 index，或重新 ingest/rebuild index。",
    missing_claim_source: "在正文关键结论旁补充 source id 标注。",
    schema_drift: "按当前 schema 重新 ingest，或人工确认后标记解决。",
    conflict: "人工回读 source，对冲突结论做保留、改写或标注未确认。",
    weak_evidence: "补充证据 source，或在页面中标注证据不足。",
    needs_reconcile: "删除或变更 source 后需要人工核对页面剩余结论。",
  };
  return advice[kind] || "打开目标页面核对，完成处理后标记解决。";
}
