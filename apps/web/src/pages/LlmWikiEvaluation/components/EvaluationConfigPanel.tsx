import { Loader2, Play, Upload } from "lucide-react";
import type { RefObject } from "react";
import type {
  CompileEvaluationDataset,
  CompileEvaluationDatasetSummary,
} from "@/api/evaluation";
import type { ModelOption } from "@/api/model";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface EvaluationConfigPanelProps {
  datasets: CompileEvaluationDatasetSummary[];
  datasetId: string;
  dataset: CompileEvaluationDataset | null;
  selectedCaseIds: string[];
  models: ModelOption[];
  judgeModel: string;
  loading: boolean;
  uploading: boolean;
  submitting: boolean;
  allSelected: boolean;
  selectedSourceCount: number;
  selectedFactCount: number;
  fileRef: RefObject<HTMLInputElement | null>;
  onUpload: (file?: File) => void;
  onDatasetChange: (datasetId: string) => void;
  onJudgeModelChange: (model: string) => void;
  onToggleAll: () => void;
  onToggleCase: (caseId: string) => void;
  onStart: () => void;
}

export function EvaluationConfigPanel({
  datasets,
  datasetId,
  dataset,
  selectedCaseIds,
  models,
  judgeModel,
  loading,
  uploading,
  submitting,
  allSelected,
  selectedSourceCount,
  selectedFactCount,
  fileRef,
  onUpload,
  onDatasetChange,
  onJudgeModelChange,
  onToggleAll,
  onToggleCase,
  onStart,
}: EvaluationConfigPanelProps) {
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <section className="border-b border-slate-200 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-950">评测配置</h2>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              上传评测配置 JSON，再选择 Judge 模型运行。
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => onUpload(event.target.files?.[0])}
          />
          <Button
            variant="outline"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            上传
          </Button>
        </div>

        <div className="mt-4 grid gap-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-700">数据集</span>
            <Select
              value={datasetId}
              onValueChange={onDatasetChange}
              disabled={loading || !datasets.length}
            >
              <SelectTrigger className="h-8 w-full bg-white">
                <SelectValue placeholder="选择数据集" />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                {datasets.map((item) => (
                  <SelectItem key={item.datasetId} value={item.datasetId}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-700">Judge 模型</span>
            <Select
              value={judgeModel}
              onValueChange={onJudgeModelChange}
              disabled={!models.length}
            >
              <SelectTrigger className="h-8 w-full bg-white">
                <SelectValue placeholder="选择模型" />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                {models.map((item) => (
                  <SelectItem key={item.model} value={item.model}>
                    {item.model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>

        <div className="mt-4 grid grid-cols-3 divide-x divide-slate-200 rounded-lg border border-slate-200 bg-slate-50">
          <div className="px-3 py-2 text-center">
            <div className="text-base font-semibold tabular-nums text-slate-950">
              {dataset?.cases.length || 0}
            </div>
            <div className="mt-0.5 text-xs text-slate-600">Cases</div>
          </div>
          <div className="px-3 py-2 text-center">
            <div className="text-base font-semibold tabular-nums text-slate-950">
              {selectedSourceCount}
            </div>
            <div className="mt-0.5 text-xs text-slate-600">Sources</div>
          </div>
          <div className="px-3 py-2 text-center">
            <div className="text-base font-semibold tabular-nums text-slate-950">
              {selectedFactCount}
            </div>
            <div className="mt-0.5 text-xs text-slate-600">Facts</div>
          </div>
        </div>
      </section>

      <section className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-11 flex-none items-center justify-between border-b border-slate-200 bg-slate-50/80 px-3">
          <span className="text-sm font-semibold text-slate-900">
            评测 Cases{" "}
            {dataset ? `(${selectedCaseIds.length}/${dataset.cases.length})` : ""}
          </span>
          <button
            type="button"
            disabled={!dataset?.cases.length}
            className="rounded-md px-2 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-50 disabled:pointer-events-none disabled:text-slate-400"
            onClick={onToggleAll}
          >
            {allSelected ? "取消全选" : "全选"}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {dataset?.cases.map((item) => {
            const checked = selectedCaseIds.includes(item.id);
            return (
              <label
                key={item.id}
                className={[
                  "mb-1 flex cursor-pointer items-start gap-2.5 rounded-lg border px-2.5 py-2.5 transition",
                  checked
                    ? "border-indigo-200 bg-indigo-50/80"
                    : "border-transparent hover:border-slate-200 hover:bg-slate-50",
                ].join(" ")}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleCase(item.id)}
                  className="mt-0.5 size-4 accent-indigo-600"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900">
                    {item.name}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-600">
                    {item.expectedFacts.length} 条预期事实 ·{" "}
                    {item.sourceIds.length} 个来源
                  </span>
                </span>
              </label>
            );
          })}
          {!dataset && (
            <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
              请先上传评测配置 JSON
            </div>
          )}
        </div>
        <div className="flex-none border-t border-slate-200 bg-white p-3">
          <Button
            className="h-9 w-full bg-slate-950 text-white hover:bg-slate-800"
            disabled={!dataset || !selectedCaseIds.length || !judgeModel || submitting}
            onClick={onStart}
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            开始评测
          </Button>
          <p className="mt-2 text-center text-xs text-slate-500">
            将运行 {selectedCaseIds.length} 个 case，读取已编译 Wiki。
          </p>
        </div>
      </section>
    </aside>
  );
}
