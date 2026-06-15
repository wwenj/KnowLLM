import {
  CheckCircle2,
  CircleAlert,
  FileCheck2,
  Loader2,
  Play,
  RefreshCw,
  Upload,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  compileEvaluationApi,
  type CompileEvaluationCaseResult,
  type CompileEvaluationDataset,
  type CompileEvaluationDatasetSummary,
  type CompileEvaluationFactStatus,
  type CompileEvaluationRun,
  type CompileEvaluationRunSummary,
} from "@/api/evaluation";
import type { ModelOption } from "@/api/model";
import { modelApi } from "@/api/model";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusTag } from "@/components/StatusTag";

export function LlmWikiEvaluation() {
  const [datasets, setDatasets] = useState<CompileEvaluationDatasetSummary[]>([]);
  const [datasetId, setDatasetId] = useState("");
  const [dataset, setDataset] = useState<CompileEvaluationDataset | null>(null);
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [judgeModel, setJudgeModel] = useState("");
  const [runs, setRuns] = useState<CompileEvaluationRunSummary[]>([]);
  const [activeRun, setActiveRun] = useState<CompileEvaluationRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const refreshRuns = useCallback(async (silent = true) => {
    const response = await compileEvaluationApi.listRuns(50, silent).catch(() => ({ items: [] }));
    setRuns(response.items || []);
  }, []);

  const refreshDatasets = useCallback(async (silent = true) => {
    const response = await compileEvaluationApi.listDatasets(silent).catch(() => ({ items: [] }));
    const items = response.items || [];
    setDatasets(items);
    setDatasetId((current) => current || items[0]?.datasetId || "");
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const modelResponse = await modelApi.list(true);
        const nextModels = modelResponse.items || [];
        setModels(nextModels);
        setJudgeModel(nextModels[0]?.model || "");
        await Promise.all([refreshDatasets(true), refreshRuns(true)]);
      } finally {
        setLoading(false);
      }
    };
    void init();
    return () => stopPolling();
  }, [refreshDatasets, refreshRuns, stopPolling]);

  useEffect(() => {
    if (!datasetId) return;
    void compileEvaluationApi.getDataset(datasetId, true).then((next) => {
      setDataset(next);
      setSelectedCaseIds(next.cases.map((item) => item.id));
    }).catch(() => {
      setDataset(null);
      setSelectedCaseIds([]);
    });
  }, [datasetId]);

  const startPolling = useCallback((runId: string) => {
    stopPolling();
    const tick = async () => {
      const next = await compileEvaluationApi.getRun(runId, true).catch(() => null);
      if (!next) return;
      setActiveRun(next);
      if (next.status !== "running") {
        stopPolling();
        void refreshRuns(true);
      }
    };
    void tick();
    pollRef.current = window.setInterval(tick, 1500);
  }, [refreshRuns, stopPolling]);

  const handleUpload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await compileEvaluationApi.uploadDataset(file);
      await refreshDatasets(true);
      setDataset(uploaded);
      setSelectedCaseIds(uploaded.cases.map((item) => item.id));
      setDatasetId(uploaded.datasetId);
      toast.success("评测数据集已上传");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleStart = async () => {
    if (!dataset || !selectedCaseIds.length || !judgeModel) return;
    setSubmitting(true);
    try {
      const run = await compileEvaluationApi.createRun({
        datasetId: dataset.datasetId,
        caseIds: selectedCaseIds,
        judgeModel,
      });
      setActiveRun(run);
      startPolling(run.runId);
      void refreshRuns(true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenRun = async (runId: string) => {
    stopPolling();
    const run = await compileEvaluationApi.getRun(runId).catch(() => null);
    if (!run) return;
    setActiveRun(run);
    if (run.status === "running") startPolling(run.runId);
  };

  const allSelected = Boolean(dataset?.cases.length) && selectedCaseIds.length === dataset?.cases.length;
  const toggleAll = () => setSelectedCaseIds(allSelected ? [] : dataset?.cases.map((item) => item.id) || []);
  const toggleCase = (caseId: string) => {
    setSelectedCaseIds((current) =>
      current.includes(caseId) ? current.filter((item) => item !== caseId) : [...current, caseId],
    );
  };

  return (
    <div className="h-full min-h-0 p-4 sm:p-5">
      <div className="grid h-full min-h-0 gap-3 overflow-hidden xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
          <section className="space-y-3 border-b border-slate-200 p-4">
            <div>
              <h1 className="text-base font-semibold text-slate-900">LLM Wiki 编译评测</h1>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                内置 private benchmark 已自动加载。评测只读取已编译 Wiki，不会重新编译。
              </p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => void handleUpload(event.target.files?.[0])}
            />
            <Button
              variant="outline"
              className="w-full"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
              上传其他评测数据集
            </Button>
            <Field label="数据集">
              <Select value={datasetId} onValueChange={setDatasetId} disabled={loading || !datasets.length}>
                <SelectTrigger className="w-full bg-white">
                  <SelectValue placeholder="选择数据集" />
                </SelectTrigger>
                <SelectContent>
                  {datasets.map((item) => (
                    <SelectItem key={item.datasetId} value={item.datasetId}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Judge 模型">
              <Select value={judgeModel} onValueChange={setJudgeModel} disabled={!models.length}>
                <SelectTrigger className="w-full bg-white">
                  <SelectValue placeholder="选择模型" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((item) => (
                    <SelectItem key={item.model} value={item.model}>{item.model}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </section>

          <section className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-11 items-center justify-between border-b border-slate-200 bg-slate-50 px-3">
              <span className="text-sm font-semibold text-slate-800">
                评测 Cases {dataset ? `(${selectedCaseIds.length}/${dataset.cases.length})` : ""}
              </span>
              <button type="button" className="text-xs font-medium text-indigo-600" onClick={toggleAll}>
                {allSelected ? "取消全选" : "全选"}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {dataset?.cases.map((item) => (
                <label
                  key={item.id}
                  className="mb-1 flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedCaseIds.includes(item.id)}
                    onChange={() => toggleCase(item.id)}
                    className="mt-0.5 size-4 accent-indigo-600"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-800">{item.name}</span>
                    <span className="block text-xs text-slate-400">{item.expectedFacts.length} 条预期事实</span>
                  </span>
                </label>
              ))}
              {!dataset && (
                <div className="flex h-32 items-center justify-center text-sm text-slate-400">未找到内置或上传的数据集</div>
              )}
            </div>
            <div className="border-t border-slate-200 p-3">
              <Button
                className="w-full bg-slate-900 text-white hover:bg-slate-800"
                disabled={!dataset || !selectedCaseIds.length || !judgeModel || submitting}
                onClick={handleStart}
              >
                {submitting ? <Loader2 className="animate-spin" /> : <Play />}
                开始评测
              </Button>
            </div>
          </section>
        </aside>

        <main className="grid min-h-0 gap-3 overflow-hidden lg:grid-cols-[minmax(0,1fr)_250px]">
          <section className="min-h-0 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <EvaluationResult run={activeRun} />
          </section>
          <RunHistory runs={runs} activeRunId={activeRun?.runId || ""} onRefresh={() => refreshRuns(false)} onOpen={handleOpenRun} />
        </main>
      </div>
    </div>
  );
}

function EvaluationResult({ run }: { run: CompileEvaluationRun | null }) {
  if (!run) {
    return (
      <div className="flex h-full min-h-64 flex-col items-center justify-center text-center">
        <FileCheck2 className="size-9 text-slate-300" />
        <div className="mt-3 text-sm font-medium text-slate-600">尚未选择评测记录</div>
        <div className="mt-1 text-xs text-slate-400">开始新评测或从历史记录打开结果</div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 rounded-xl bg-white p-4 ring-1 ring-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-slate-900">{run.datasetName}</h2>
            <StatusTag status={run.status} />
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Judge: {run.judgeModel} · {run.progress.completed}/{run.progress.total} cases
          </div>
        </div>
        {run.status === "running" && <Loader2 className="size-5 animate-spin text-indigo-500" />}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="正确率" value={`${Math.round(run.summary.accuracy * 100)}%`} tone="indigo" />
        <Metric label="正确" value={run.summary.correct} tone="green" />
        <Metric label="缺失" value={run.summary.missing} tone="amber" />
        <Metric label="错误" value={run.summary.incorrect} tone="red" />
      </div>

      {run.cases.map((item) => <CaseResult key={item.caseId} item={item} />)}
      {run.status === "running" && run.progress.currentCaseId && (
        <div className="flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
          <Loader2 className="size-4 animate-spin" />
          正在评测 {run.progress.currentCaseId}
        </div>
      )}
      {run.errors.map((error) => (
        <div key={error} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      ))}
    </div>
  );
}

function CaseResult({ item }: { item: CompileEvaluationCaseResult }) {
  return (
    <section className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
      <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{item.name}</h3>
          <div className="mt-1 text-xs text-slate-400">
            匹配 {item.matchedSources.filter((source) => source.sourceId).length}/{item.matchedSources.length} sources · 读取 {item.pagePaths.length} pages
          </div>
        </div>
        <CaseStatus status={item.status} />
      </header>
      <div className="divide-y divide-slate-100">
        {item.facts.map((fact) => (
          <div key={fact.id} className="grid gap-2 px-4 py-3 md:grid-cols-[90px_minmax(0,1fr)]">
            <FactStatus status={fact.status} />
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-800">{fact.fact}</div>
              {fact.evidence && <div className="mt-1 text-xs leading-5 text-slate-500">证据：{fact.evidence}</div>}
              {fact.evidencePath && <div className="mt-1 truncate text-xs text-indigo-500">{fact.evidencePath}</div>}
              {fact.reason && <div className="mt-1 text-xs leading-5 text-slate-400">{fact.reason}</div>}
            </div>
          </div>
        ))}
        {!item.facts.length && item.error && (
          <div className="px-4 py-3 text-sm text-rose-600">{item.error}</div>
        )}
      </div>
    </section>
  );
}

function RunHistory({
  runs,
  activeRunId,
  onRefresh,
  onOpen,
}: {
  runs: CompileEvaluationRunSummary[];
  activeRunId: string;
  onRefresh: () => void;
  onOpen: (runId: string) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex h-11 items-center justify-between border-b border-slate-200 bg-slate-50 px-3">
        <span className="text-sm font-semibold text-slate-800">历史评测</span>
        <Button variant="ghost" size="xs" onClick={onRefresh}><RefreshCw />刷新</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {runs.map((run) => (
          <button
            type="button"
            key={run.runId}
            onClick={() => onOpen(run.runId)}
            className={[
              "mb-1 w-full rounded-lg px-2.5 py-2 text-left transition-colors",
              activeRunId === run.runId ? "bg-indigo-50 ring-1 ring-indigo-100" : "hover:bg-slate-50",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-medium text-slate-800">{run.datasetName}</span>
              <StatusTag status={run.status} />
            </div>
            <div className="mt-1 flex justify-between gap-2 text-xs text-slate-400">
              <span>{Math.round(run.summary.accuracy * 100)}% 正确</span>
              <span>{formatDate(run.startedAt)}</span>
            </div>
          </button>
        ))}
        {!runs.length && <div className="flex h-32 items-center justify-center text-sm text-slate-400">暂无历史记录</div>}
      </div>
    </aside>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone: "indigo" | "green" | "amber" | "red" }) {
  const tones = {
    indigo: "text-indigo-700",
    green: "text-emerald-700",
    amber: "text-amber-700",
    red: "text-rose-700",
  };
  return (
    <div className="rounded-lg bg-white px-3 py-2.5 ring-1 ring-slate-200">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums ${tones[tone]}`}>{value}</div>
    </div>
  );
}

function FactStatus({ status }: { status: CompileEvaluationFactStatus }) {
  const config = {
    correct: { label: "正确", cls: "bg-emerald-50 text-emerald-700", icon: CheckCircle2 },
    missing: { label: "缺失", cls: "bg-amber-50 text-amber-700", icon: CircleAlert },
    incorrect: { label: "错误", cls: "bg-rose-50 text-rose-700", icon: XCircle },
  }[status];
  return (
    <span className={`inline-flex h-6 w-fit items-center gap-1 rounded-full px-2 text-xs font-medium ${config.cls}`}>
      <config.icon className="size-3.5" />
      {config.label}
    </span>
  );
}

function CaseStatus({ status }: { status: CompileEvaluationCaseResult["status"] }) {
  const labels: Record<string, string> = {
    success: "完成",
    source_missing: "Source 未匹配",
    failed: "失败",
    running: "运行中",
    pending: "等待中",
  };
  return <StatusTag status={status} labels={labels} />;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
