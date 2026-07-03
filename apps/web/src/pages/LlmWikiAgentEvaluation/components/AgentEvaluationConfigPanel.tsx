import { Loader2, Play, Trash2, Upload } from "lucide-react";
import { useMemo, type RefObject } from "react";
import type {
  AgentEvaluationBudget,
  AgentEvaluationDataset,
  AgentEvaluationDatasetSummary,
  AgentEvaluationSourcePolicy,
} from "@/api/evaluation";
import type { ModelOption } from "@/api/model";
import { modelOptionLabel } from "@/api/model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { sourcePolicyLabels } from "../constants";

interface AgentEvaluationConfigPanelProps {
  datasets: AgentEvaluationDatasetSummary[];
  datasetId: string;
  dataset: AgentEvaluationDataset | null;
  selectedCaseIds: string[];
  models: ModelOption[];
  agentModel: string;
  judgeModel: string;
  sourcePolicy: AgentEvaluationSourcePolicy;
  budget: AgentEvaluationBudget;
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
  onAgentModelChange: (model: string) => void;
  onJudgeModelChange: (model: string) => void;
  onSourcePolicyChange: (policy: AgentEvaluationSourcePolicy) => void;
  onBudgetChange: (budget: AgentEvaluationBudget) => void;
  onToggleAll: () => void;
  onToggleCase: (caseId: string) => void;
  onStart: () => void;
}

export function AgentEvaluationConfigPanel({
  datasets,
  datasetId,
  dataset,
  selectedCaseIds,
  models,
  agentModel,
  judgeModel,
  sourcePolicy,
  budget,
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
  onAgentModelChange,
  onJudgeModelChange,
  onSourcePolicyChange,
  onBudgetChange,
  onToggleAll,
  onToggleCase,
  onStart,
}: AgentEvaluationConfigPanelProps) {
  const sourceNameById = useMemo(
    () => new Map((dataset?.sources || []).map((source) => [source.id, source.filename])),
    [dataset],
  );

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
      <section className="border-b border-slate-200 p-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-950">Agent 评测数据集</h2>
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
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            上传
          </Button>
        </div>

        <div className="mt-3 max-h-36 space-y-1 overflow-y-auto">
          {datasets.map((item) => {
            const active = item.datasetId === datasetId;
            const deleting = deletingDatasetId === item.datasetId;
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
                  className="min-w-0 py-2 pl-2.5 pr-2 text-left"
                >
                  <span className="block truncate text-sm font-medium text-slate-900">
                    {item.name}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">
                    {item.caseCount} Cases · {item.sourceCount} Sources · {item.factCount} Facts
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  title="删除 Agent 评测数据集"
                  disabled={Boolean(deletingDatasetId)}
                  className="text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  onClick={() => onDeleteDataset(item.datasetId)}
                >
                  {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                </Button>
              </div>
            );
          })}
          {!loading && !datasets.length && (
            <div className="flex h-20 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
              暂无 Agent 评测数据集
            </div>
          )}
          {loading && (
            <div className="flex h-20 items-center justify-center text-sm text-slate-500">
              <Loader2 className="mr-2 size-4 animate-spin" />
              加载中
            </div>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <ModelSelect label="Agent 模型" value={agentModel} models={models} onChange={onAgentModelChange} />
          <ModelSelect label="Judge 模型" value={judgeModel} models={models} onChange={onJudgeModelChange} />
        </div>

        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_72px_72px] gap-2">
          <label className="block min-w-0 space-y-1.5">
            <span className="text-xs font-medium text-slate-700">Source 策略</span>
            <Select
              value={sourcePolicy}
              onValueChange={(value) => onSourcePolicyChange(value as AgentEvaluationSourcePolicy)}
            >
              <SelectTrigger className="h-8 w-full bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                {Object.entries(sourcePolicyLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <NumberField
            label="轮数"
            value={budget.maxRounds}
            min={1}
            max={8}
            onChange={(value) => onBudgetChange({ ...budget, maxRounds: value })}
          />
          <NumberField
            label="原文"
            value={budget.maxRawSources}
            min={0}
            max={24}
            onChange={(value) => onBudgetChange({ ...budget, maxRawSources: value })}
          />
        </div>

        <div className="mt-3">
          <NumberField
            label="最多读取 Wiki 页面"
            value={budget.maxEvidencePages}
            min={8}
            max={96}
            onChange={(value) => onBudgetChange({ ...budget, maxEvidencePages: value })}
          />
        </div>

        <div className="mt-3 grid grid-cols-3 divide-x divide-slate-200 rounded-lg border border-slate-200 bg-slate-50">
          <MiniStat label="Cases" value={dataset?.cases.length || 0} />
          <MiniStat label="Sources" value={selectedSourceCount} />
          <MiniStat label="Facts" value={selectedFactCount} />
        </div>
      </section>

      <section className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-11 flex-none items-center justify-between border-b border-slate-200 bg-slate-50/80 px-3">
          <span className="text-sm font-semibold text-slate-900">
            Agent Cases {dataset ? `(${selectedCaseIds.length}/${dataset.cases.length})` : ""}
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
            const sources = item.relevantSourceIds
              .map((id) => sourceNameById.get(id) || id)
              .slice(0, 3)
              .join(", ");
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
                    {item.id} · {item.answerable ? "可回答" : "拒答"}
                  </span>
                  <span className="mt-0.5 block line-clamp-2 text-xs leading-5 text-slate-600">
                    {item.question}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">
                    {item.expectedFacts.length} facts · {sources || "无指定来源"}
                  </span>
                </span>
              </label>
            );
          })}
          {!dataset && (
            <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
              请先上传 Agent 评测数据集 JSON
            </div>
          )}
        </div>
        <div className="flex-none border-t border-slate-200 bg-white p-3">
          <Button
            className="h-9 w-full bg-slate-950 text-white hover:bg-slate-800"
            disabled={!dataset || !selectedCaseIds.length || !judgeModel || !agentModel || submitting}
            onClick={onStart}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            开始 Agent 评测
          </Button>
        </div>
      </section>
    </aside>
  );
}

function ModelSelect({
  label,
  value,
  models,
  onChange,
}: {
  label: string;
  value: string;
  models: ModelOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block min-w-0 space-y-1.5">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <Select value={value} onValueChange={onChange} disabled={!models.length}>
        <SelectTrigger className="h-8 w-full bg-white">
          <SelectValue placeholder="选择模型" />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {models.map((item) => (
            <SelectItem key={item.id} value={item.id}>{modelOptionLabel(item)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block min-w-0 space-y-1.5">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(clamp(Number(event.target.value), min, max))}
        className="h-8 bg-white"
      />
    </label>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-3 py-2 text-center">
      <div className="text-base font-semibold tabular-nums text-slate-950">{value}</div>
      <div className="mt-0.5 text-xs text-slate-600">{label}</div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.round(value), min), max);
}
