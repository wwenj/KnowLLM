import {
  CheckCircle2,
  CircleAlert,
  FileCheck2,
  Loader2,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  CompileEvaluationFactResult,
  CompileEvaluationFactStatus,
  CompileEvaluationPassLevel,
  CompileEvaluationRun,
} from "@/api/evaluation";
import { StatusTag } from "@/components/StatusTag";
import { formatDate } from "../utils";

const factStatusConfig: Record<
  CompileEvaluationFactStatus,
  {
    label: string;
    cls: string;
    Icon: typeof CheckCircle2;
  }
> = {
  correct: {
    label: "正确",
    cls: "border-emerald-200 bg-emerald-50 text-emerald-700",
    Icon: CheckCircle2,
  },
  missing: {
    label: "缺失",
    cls: "border-amber-200 bg-amber-50 text-amber-700",
    Icon: CircleAlert,
  },
  incorrect: {
    label: "错误",
    cls: "border-rose-200 bg-rose-50 text-rose-700",
    Icon: XCircle,
  },
};

const passLevelText: Record<CompileEvaluationPassLevel, string> = {
  excellent: "优秀",
  pass: "合格",
  needs_improvement: "待优化",
  failed: "不合格",
};

type StatusFilter = "issues" | "all" | CompileEvaluationFactStatus;
type ImportanceFilter = "all" | "must" | "should" | "nice";

interface FactRow {
  caseId: string;
  caseName: string;
  matchedSourceCount: number;
  totalSourceCount: number;
  pageCount: number;
  fact: CompileEvaluationFactResult;
}

export function EvaluationResult({ run }: { run: CompileEvaluationRun | null }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("issues");
  const [importanceFilter, setImportanceFilter] = useState<ImportanceFilter>("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const rows = useMemo(() => flattenFacts(run), [run]);
  const types = useMemo(() => {
    const values = new Set(rows.map((row) => row.fact.type || "general"));
    return [...values].sort();
  }, [rows]);
  const filteredRows = rows.filter((row) => {
    const statusMatched =
      statusFilter === "all"
        ? true
        : statusFilter === "issues"
          ? row.fact.status !== "correct"
          : row.fact.status === statusFilter;
    const importanceMatched =
      importanceFilter === "all" ? true : row.fact.importance === importanceFilter;
    const typeMatched = typeFilter === "all" ? true : (row.fact.type || "general") === typeFilter;
    return statusMatched && importanceMatched && typeMatched;
  });

  if (!run) {
    return (
      <div className="flex h-full min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-6 text-center">
        <span className="inline-flex size-10 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          <FileCheck2 className="size-5" />
        </span>
        <div className="mt-3 text-sm font-semibold text-slate-800">未打开评测结果</div>
        <div className="mt-1 text-xs text-slate-500">从右侧历史记录打开，或运行新评测。</div>
      </div>
    );
  }

  const summary = run.summary;
  const progress =
    run.progress.total > 0
      ? Math.round((run.progress.completed / run.progress.total) * 100)
      : 0;
  const weightedScore = summary.weightedScore ?? summary.accuracy * 100;
  const mustAccuracy = summary.mustAccuracy ?? 0;
  const passLevel = summary.passLevel || "failed";

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-[160px] items-start gap-3">
            <div>
              <div className="text-4xl font-semibold leading-none tabular-nums text-slate-950">
                {formatScore(weightedScore)}
              </div>
              <div className="mt-1 text-xs text-slate-500">加权分</div>
            </div>
            <div className="flex flex-col gap-1 pt-1">
              <span className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-xs ${passLevelClass(passLevel)}`}>
                {passLevelText[passLevel]}
              </span>
              <StatusTag status={run.status} />
            </div>
          </div>

          <div className="min-w-[280px] flex-1">
            <div className="truncate text-base font-semibold text-slate-950">
              {run.datasetName}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
              <span>{run.judgeModel}</span>
              <span>{run.progress.completed}/{run.progress.total} cases</span>
              <span>{formatDate(run.startedAt)}</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-slate-950 transition-[width] duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="grid min-w-[320px] grid-cols-4 gap-2">
            <SummaryStat label="正确" value={summary.correct} />
            <SummaryStat label="缺失" value={summary.missing} tone="amber" />
            <SummaryStat label="错误" value={summary.incorrect} tone="rose" />
            <SummaryStat label="must" value={formatPercent(mustAccuracy)} />
          </div>
        </div>
      </section>

      {run.status === "running" && run.progress.currentCaseId && (
        <div className="inline-flex items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
          <Loader2 className="size-4 animate-spin" />
          {run.progress.currentCaseId}
        </div>
      )}
      {run.errors.map((error) => (
        <div
          key={error}
          className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
        >
          {error}
        </div>
      ))}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
          <div className="text-sm font-semibold text-slate-950">
            事实明细 <span className="font-normal text-slate-500">{filteredRows.length}/{rows.length}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700"
            >
              <option value="issues">只看问题</option>
              <option value="all">全部状态</option>
              <option value="correct">正确</option>
              <option value="missing">缺失</option>
              <option value="incorrect">错误</option>
            </select>
            <select
              value={importanceFilter}
              onChange={(event) => setImportanceFilter(event.target.value as ImportanceFilter)}
              className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700"
            >
              <option value="all">全部重要性</option>
              <option value="must">must</option>
              <option value="should">should</option>
              <option value="nice">nice</option>
            </select>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700"
            >
              <option value="all">全部类型</option>
              {types.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {filteredRows.map((row) => (
            <FactDetail key={`${row.caseId}-${row.fact.id}`} row={row} />
          ))}
          {!filteredRows.length && (
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              暂无缺失或错误事实
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function flattenFacts(run: CompileEvaluationRun | null): FactRow[] {
  if (!run) return [];
  return run.cases.flatMap((item) => {
    const matchedSourceCount = item.matchedSources.filter((source) => source.sourceId).length;
    return item.facts.map((fact) => ({
      caseId: item.caseId,
      caseName: item.name,
      matchedSourceCount,
      totalSourceCount: item.matchedSources.length,
      pageCount: item.pagePaths.length,
      fact,
    }));
  });
}

function FactDetail({ row }: { row: FactRow }) {
  const sourceEvidence = row.fact.wikiEvidence ? row.fact.evidence || "" : "";
  const wikiEvidence = row.fact.wikiEvidence || (row.fact.evidencePath ? row.fact.evidence || "" : "");
  const importance = row.fact.importance || "must";
  const type = row.fact.type || "general";
  return (
    <details className="group" open={row.fact.status !== "correct"}>
      <summary className="grid cursor-pointer list-none gap-2 px-4 py-3 md:grid-cols-[76px_minmax(0,1fr)_104px]">
        <StatusBadge status={row.fact.status} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-900">
            {row.fact.fact}
          </span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">
            {row.caseName} · {importance} · {type}
          </span>
        </span>
        <span className="whitespace-nowrap text-right text-xs text-slate-500">
          {row.matchedSourceCount}/{row.totalSourceCount} · {row.pageCount}p
        </span>
      </summary>
      <div className="grid gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3 md:grid-cols-2">
        <EvidenceText label="原文" value={sourceEvidence || row.fact.evidence || "旧结果未记录原文证据"} />
        <EvidenceText label="Wiki" value={wikiEvidence || "未找到支持证据"} path={row.fact.evidencePath} />
        {row.fact.reason && (
          <div className="md:col-span-2 text-xs leading-5 text-slate-600">
            {row.fact.reason}
          </div>
        )}
      </div>
    </details>
  );
}

function EvidenceText({ label, value, path }: { label: string; value: string; path?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 max-h-28 overflow-auto text-xs leading-5 text-slate-800">
        {value}
      </div>
      {path && <div className="mt-1 truncate font-mono text-xs text-indigo-700">{path}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: CompileEvaluationFactStatus }) {
  const config = factStatusConfig[status];
  return (
    <span
      className={`inline-flex h-6 w-[64px] shrink-0 items-center justify-center gap-1 rounded-full border text-xs font-medium ${config.cls}`}
    >
      <config.Icon className="size-3.5" />
      {config.label}
    </span>
  );
}

function SummaryStat({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number | string;
  tone?: "slate" | "amber" | "rose";
}) {
  const valueClass =
    tone === "amber"
      ? "text-amber-700"
      : tone === "rose"
        ? "text-rose-700"
        : "text-slate-950";
  return (
    <div className="min-w-[68px] rounded-md bg-slate-50 px-2.5 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}

function passLevelClass(level: CompileEvaluationPassLevel): string {
  if (level === "excellent") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (level === "pass") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  if (level === "needs_improvement") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatScore(value: number): string {
  return `${Math.round(value)}`;
}
