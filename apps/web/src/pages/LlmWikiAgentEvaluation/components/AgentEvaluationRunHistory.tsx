import { History, Loader2, RefreshCw, Trash2 } from "lucide-react";
import type { AgentEvaluationRunSummary } from "@/api/evaluation";
import { StatusTag } from "@/components/StatusTag";
import { Button } from "@/components/ui/button";
import { formatDate } from "../../LlmWikiEvaluation/utils";

interface AgentEvaluationRunHistoryProps {
  runs: AgentEvaluationRunSummary[];
  activeRunId: string;
  deletingRunId: string;
  onRefresh: () => void;
  onOpen: (runId: string) => void;
  onDelete: (runId: string) => void;
}

export function AgentEvaluationRunHistory({
  runs,
  activeRunId,
  deletingRunId,
  onRefresh,
  onOpen,
  onDelete,
}: AgentEvaluationRunHistoryProps) {
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex h-10 flex-none items-center justify-between border-b border-slate-200 px-3">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <History className="size-4 text-slate-500" />
          历史评测
        </span>
        <Button variant="ghost" size="icon-xs" title="刷新" onClick={onRefresh}>
          <RefreshCw className="size-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {runs.map((run) => {
          const active = activeRunId === run.runId;
          const deleting = deletingRunId === run.runId;
          const progress = run.progress.total > 0
            ? Math.round((run.progress.completed / run.progress.total) * 100)
            : 0;
          return (
            <div
              key={run.runId}
              className={[
                "grid grid-cols-[minmax(0,1fr)_28px] rounded-md border transition-colors",
                active
                  ? "border-indigo-200 bg-indigo-50"
                  : "border-transparent hover:border-slate-200 hover:bg-slate-50",
              ].join(" ")}
            >
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onOpen(run.runId)}
                className="min-w-0 px-2.5 py-2 text-left"
              >
                <div className="truncate text-sm font-medium text-slate-900">{run.datasetName}</div>
                <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-slate-500">
                  <span className="shrink-0 tabular-nums">{Math.round(run.summary.overallScore || 0)} 分</span>
                  <StatusTag status={run.status} />
                  <span className="min-w-0 truncate">{formatDate(run.startedAt)}</span>
                </div>
                {run.status === "running" && (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-indigo-100">
                    <div className="h-full rounded-full bg-indigo-600" style={{ width: `${progress}%` }} />
                  </div>
                )}
              </button>
              <Button
                type="button"
                variant="destructive"
                size="icon-xs"
                title="删除历史评测"
                disabled={run.status === "running" || deleting}
                className="mr-1 mt-1"
                onClick={() => onDelete(run.runId)}
              >
                {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              </Button>
            </div>
          );
        })}
        {!runs.length && (
          <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
            暂无历史记录
          </div>
        )}
      </div>
    </aside>
  );
}
