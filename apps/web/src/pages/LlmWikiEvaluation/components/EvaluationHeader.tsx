import {
  Database,
  History,
  ListChecks,
  ShieldCheck,
} from "lucide-react";

interface EvaluationHeaderProps {
  datasetsCount: number;
  selectedCaseText: string;
  selectedFactCount: number;
  runsCount: number;
}

export function EvaluationHeader({
  datasetsCount,
  selectedCaseText,
  selectedFactCount,
  runsCount,
}: EvaluationHeaderProps) {
  return (
    <header className="flex flex-none border-b border-slate-200 bg-white/90 px-3 py-2.5">
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <div className="inline-flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
          <Database className="size-3.5 shrink-0 text-slate-500" />
          <span className="min-w-0 truncate text-xs text-slate-600">数据集</span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-950">
            {datasetsCount}
          </span>
        </div>
        <div className="inline-flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
          <ListChecks className="size-3.5 shrink-0 text-slate-500" />
          <span className="min-w-0 truncate text-xs text-slate-600">
            已选 Cases
          </span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-950">
            {selectedCaseText}
          </span>
        </div>
        <div className="inline-flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
          <ShieldCheck className="size-3.5 shrink-0 text-slate-500" />
          <span className="min-w-0 truncate text-xs text-slate-600">
            预期事实
          </span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-950">
            {selectedFactCount}
          </span>
        </div>
        <div className="inline-flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
          <History className="size-3.5 shrink-0 text-slate-500" />
          <span className="min-w-0 truncate text-xs text-slate-600">
            历史运行
          </span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-950">
            {runsCount}
          </span>
        </div>
      </div>
    </header>
  );
}
