import { Loader2, Play, Trash2, Upload } from "lucide-react";
import type { RefObject } from "react";
import type {
  CompileEvaluationDataset,
  CompileEvaluationDatasetSummary,
} from "@/api/evaluation";
import { BUILTIN_COMPILE_EVALUATION_DATASET_ID } from "@/api/evaluation";
import type { ModelOption } from "@/api/model";
import { modelOptionLabel } from "@/api/model";
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
  concurrency: number;
  loading: boolean;
  uploading: boolean;
  submitting: boolean;
  deletingDatasetId: string;
  allSelected: boolean;
  selectedSourceCount: number;
  selectedFactCount: number;
  fileRef: RefObject<HTMLInputElement | null>;
  onUpload: (file?: File) => void;
  onDatasetChange: (datasetId: string) => void;
  onDeleteDataset: (datasetId: string) => void;
  onJudgeModelChange: (model: string) => void;
  onConcurrencyChange: (value: number) => void;
  onToggleAll: () => void;
  onSelectSmokeCases: () => void;
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
  concurrency,
  loading,
  uploading,
  submitting,
  deletingDatasetId,
  allSelected,
  selectedSourceCount,
  selectedFactCount,
  fileRef,
  onUpload,
  onDatasetChange,
  onDeleteDataset,
  onJudgeModelChange,
  onConcurrencyChange,
  onToggleAll,
  onSelectSmokeCases,
  onToggleCase,
  onStart,
}: EvaluationConfigPanelProps) {
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <section className="border-b border-slate-200 p-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-950">评测数据集</h2>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => onUpload(event.target.files?.[0])}
          />
          <Button
            variant="outline"
            disabled={uploading || Boolean(deletingDatasetId)}
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

        <div className="mt-3 max-h-44 space-y-1 overflow-y-auto">
          {datasets.map((item) => {
            const active = item.datasetId === datasetId;
            const deleting = deletingDatasetId === item.datasetId;
            const builtIn = item.datasetId === BUILTIN_COMPILE_EVALUATION_DATASET_ID;
            return (
              <div
                key={item.datasetId}
                className={[
                  "grid grid-cols-[minmax(0,1fr)_28px] items-center rounded-md border transition-colors",
                  active
                    ? "border-indigo-200 bg-indigo-50"
                    : "border-transparent hover:border-slate-200 hover:bg-slate-50",
                ].join(" ")}
              >
                <button
                  type="button"
                  aria-pressed={active}
                  disabled={deleting}
                  onClick={() => onDatasetChange(item.datasetId)}
                  className="min-w-0 py-2 text-left"
                >
                  <span className="block truncate text-sm font-medium text-slate-900">
                    {item.name}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">
                    {item.caseCount} Cases · {item.sourceCount} Sources · {item.factCount} Facts
                  </span>
                </button>
                {builtIn ? (
                  <span className="px-1 text-[10px] font-medium text-indigo-600">内置</span>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    title="删除评测数据集"
                    disabled={Boolean(deletingDatasetId)}
                    className="text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    onClick={() => onDeleteDataset(item.datasetId)}
                  >
                    {deleting ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="size-3.5" />
                    )}
                  </Button>
                )}
              </div>
            );
          })}
          {!loading && !datasets.length && (
            <div className="flex h-20 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
              暂无评测数据集
            </div>
          )}
          {loading && (
            <div className="flex h-20 items-center justify-center text-sm text-slate-500">
              <Loader2 className="mr-2 size-4 animate-spin" />
              加载中
            </div>
          )}
        </div>

        <div className="mt-3 grid gap-3">
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
                  <SelectItem key={item.id} value={item.id}>
                    {modelOptionLabel(item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-700">并发 worker</span>
            <input
              type="number"
              min={1}
              max={50}
              value={concurrency}
              onChange={(event) => onConcurrencyChange(Math.min(50, Math.max(1, Number(event.target.value) || 1)))}
              className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-800"
            />
          </label>
        </div>

        <div className="mt-3 grid grid-cols-3 divide-x divide-slate-200 rounded-lg border border-slate-200 bg-slate-50">
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
        {dataset?.datasetId === BUILTIN_COMPILE_EVALUATION_DATASET_ID && (
          <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs leading-5 text-indigo-900">
            <div className="font-medium">Klipper 内置编译评测</div>
            <div>
              当前并发 {concurrency}；预计 {selectedCaseIds.length || dataset.cases.length} 次 Judge 调用；完整集约 46-48 万
              tokens。
            </div>
          </div>
        )}
      </section>

      <section className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-11 flex-none items-center justify-between border-b border-slate-200 bg-slate-50/80 px-3">
          <span className="text-sm font-semibold text-slate-900">
            评测 Cases{" "}
            {dataset ? `(${selectedCaseIds.length}/${dataset.cases.length})` : ""}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!dataset?.cases.length}
              className="rounded-md px-2 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-50 disabled:pointer-events-none disabled:text-slate-400"
              onClick={onSelectSmokeCases}
            >
              开发集 5
            </button>
            <button
              type="button"
              disabled={!dataset?.cases.length}
              className="rounded-md px-2 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-50 disabled:pointer-events-none disabled:text-slate-400"
              onClick={onToggleAll}
            >
              {allSelected ? "取消全选" : "全选"}
            </button>
          </div>
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
              正在加载内置评测集
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
        </div>
      </section>
    </aside>
  );
}
