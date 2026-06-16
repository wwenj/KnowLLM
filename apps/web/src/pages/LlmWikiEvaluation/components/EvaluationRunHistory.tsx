import { History, RefreshCw } from "lucide-react";
import type { CompileEvaluationRunSummary } from "@/api/evaluation";
import { StatusTag } from "@/components/StatusTag";
import { Button } from "@/components/ui/button";
import { formatDate } from "../utils";

interface EvaluationRunHistoryProps {
  runs: CompileEvaluationRunSummary[];
  activeRunId: string;
  onRefresh: () => void;
  onOpen: (runId: string) => void;
}

export function EvaluationRunHistory({
  runs,
  activeRunId,
  onRefresh,
  onOpen,
}: EvaluationRunHistoryProps) {
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex h-11 flex-none items-center justify-between border-b border-slate-200 bg-slate-50/80 px-3">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <History className="size-4 text-slate-500" />
          历史评测
        </span>
        <Button variant="ghost" size="xs" onClick={onRefresh}>
          <RefreshCw className="size-3.5" />
          刷新
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {runs.map((run) => {
          const active = activeRunId === run.runId;
          const progress =
            run.progress.total > 0
              ? Math.round((run.progress.completed / run.progress.total) * 100)
              : 0;
          return (
            <button
              type="button"
              key={run.runId}
              aria-pressed={active}
              onClick={() => onOpen(run.runId)}
              className={[
                "w-full rounded-lg border px-2.5 py-2 text-left transition-colors",
                active
                  ? "border-indigo-200 bg-indigo-50"
                  : "border-transparent hover:border-slate-200 hover:bg-slate-50",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium text-slate-900">
                  {run.datasetName}
                </span>
                <StatusTag status={run.status} />
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-600">
                <span>{Math.round(run.summary.accuracy * 100)}% 正确</span>
                <span>{formatDate(run.startedAt)}</span>
              </div>
              {run.status === "running" && (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-indigo-100">
                  <div
                    className="h-full rounded-full bg-indigo-600"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
            </button>
          );
        })}
        {!runs.length && (
          <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
            暂无历史记录
          </div>
        )}
      </div>
    </aside>
  );
}
