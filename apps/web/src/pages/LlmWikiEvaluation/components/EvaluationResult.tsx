import {
  Activity,
  CheckCircle2,
  CircleAlert,
  FileCheck2,
  Loader2,
  XCircle,
} from "lucide-react";
import type {
  CompileEvaluationCaseResult,
  CompileEvaluationFactStatus,
  CompileEvaluationRun,
} from "@/api/evaluation";
import { StatusTag } from "@/components/StatusTag";
import { formatDate } from "../utils";

const caseStatusLabels: Record<string, string> = {
  success: "完成",
  source_missing: "Source 未匹配",
  failed: "失败",
  running: "运行中",
  pending: "等待中",
};

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

export function EvaluationResult({ run }: { run: CompileEvaluationRun | null }) {
  if (!run) {
    return (
      <div className="flex h-full min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-6 text-center">
        <span className="inline-flex size-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
          <FileCheck2 className="size-6" />
        </span>
        <div className="mt-3 text-sm font-semibold text-slate-800">
          尚未选择评测记录
        </div>
        <div className="mt-1 text-xs text-slate-500">
          开始新评测，或从右侧历史记录打开已有结果。
        </div>
      </div>
    );
  }

  const progress =
    run.progress.total > 0
      ? Math.round((run.progress.completed / run.progress.total) * 100)
      : 0;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 truncate text-base font-semibold text-slate-950">
                {run.datasetName}
              </h2>
              <StatusTag status={run.status} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
              <span>Judge: {run.judgeModel}</span>
              <span>
                {run.progress.completed}/{run.progress.total} cases
              </span>
              <span>{formatDate(run.startedAt)}</span>
            </div>
          </div>
          {run.status === "running" && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
              <Loader2 className="size-3.5 animate-spin" />
              运行中
            </span>
          )}
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-indigo-600 transition-[width] duration-200 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-slate-600">正确率</div>
            <span className="inline-flex size-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
              <Activity className="size-4" />
            </span>
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">
            {Math.round(run.summary.accuracy * 100)}%
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-slate-600">正确</div>
            <span className="inline-flex size-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="size-4" />
            </span>
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">
            {run.summary.correct}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-slate-600">缺失</div>
            <span className="inline-flex size-7 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
              <CircleAlert className="size-4" />
            </span>
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">
            {run.summary.missing}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-slate-600">错误</div>
            <span className="inline-flex size-7 items-center justify-center rounded-lg bg-rose-50 text-rose-700">
              <XCircle className="size-4" />
            </span>
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">
            {run.summary.incorrect}
          </div>
        </div>
      </div>

      {run.status === "running" && run.progress.currentCaseId && (
        <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
          <Loader2 className="size-4 animate-spin" />
          正在评测 {run.progress.currentCaseId}
        </div>
      )}
      {run.errors.map((error) => (
        <div
          key={error}
          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
        >
          {error}
        </div>
      ))}
      {run.cases.map((item: CompileEvaluationCaseResult) => {
        const matchedSourceCount = item.matchedSources.filter(
          (source) => source.sourceId,
        ).length;
        return (
          <section
            key={item.caseId}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white"
          >
            <header className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-slate-950">
                  {item.name}
                </h3>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                  <span>
                    匹配 {matchedSourceCount}/{item.matchedSources.length} sources
                  </span>
                  <span>读取 {item.pagePaths.length} pages</span>
                </div>
              </div>
              <StatusTag status={item.status} labels={caseStatusLabels} />
            </header>
            <div className="divide-y divide-slate-100">
              {item.facts.map((fact) => {
                const config = factStatusConfig[fact.status];
                return (
                  <div
                    key={fact.id}
                    className="grid gap-2 px-4 py-3 md:grid-cols-[112px_minmax(0,1fr)]"
                  >
                    <span
                      className={`inline-flex h-6 w-fit items-center gap-1 rounded-full border px-2 text-xs font-medium ${config.cls}`}
                    >
                      <config.Icon className="size-3.5" />
                      {config.label}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium leading-5 text-slate-900">
                        {fact.fact}
                      </div>
                      {fact.evidence && (
                        <div className="mt-1 text-xs leading-5 text-slate-600">
                          证据：{fact.evidence}
                        </div>
                      )}
                      {fact.evidencePath && (
                        <div className="mt-1 truncate font-mono text-xs text-indigo-700">
                          {fact.evidencePath}
                        </div>
                      )}
                      {fact.reason && (
                        <div className="mt-1 text-xs leading-5 text-slate-500">
                          {fact.reason}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {!item.facts.length && item.error && (
                <div className="px-4 py-3 text-sm text-rose-700">
                  {item.error}
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
