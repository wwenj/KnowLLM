import {
  BarChart3,
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
    <header className="flex flex-none flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-white">
            <BarChart3 className="size-4" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-slate-950">
              LLM Wiki 编译评测
            </h1>
            <p className="mt-0.5 truncate text-xs text-slate-600">
              固定数据集、固定事实清单、Judge 模型评分；只读取已编译 Wiki。
            </p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
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
