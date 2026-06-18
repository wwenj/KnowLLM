import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  CheckCircle2,
  CircleAlert,
  Database,
  FileSearch,
  Gauge,
  History,
  Loader2,
  Play,
  RefreshCw,
  SearchCheck,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  agentEvaluationApi,
  type AgentEvaluationCaseResult,
  type AgentEvaluationDataset,
  type AgentEvaluationDatasetSummary,
  type AgentEvaluationFactStatus,
  type AgentEvaluationRun,
  type AgentEvaluationRunSummary,
  type AgentEvaluationSourcePolicy,
} from "@/api/evaluation";
import type { ModelOption } from "@/api/model";
import { modelOptionLabel } from "@/api/model";
import { modelApi } from "@/api/model";
import { StatusTag } from "@/components/StatusTag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "../LlmWikiEvaluation/utils";

const caseStatusLabels: Record<string, string> = {
  success: "完成",
  source_missing: "Source 未匹配",
  agent_failed: "Agent 失败",
  judge_failed: "Judge 失败",
  failed: "失败",
  running: "运行中",
  pending: "等待中",
};

const sourcePolicyLabels: Record<AgentEvaluationSourcePolicy, string> = {
  "key-sources": "关键原文",
  auto: "自动",
  exhaustive: "尽量核验",
  "wiki-only": "只读 Wiki",
};

const factStatusConfig: Record<
  AgentEvaluationFactStatus,
  { label: string; cls: string; Icon: typeof CheckCircle2 }
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

const defaultBudget = {
  maxRounds: 4,
  maxEvidencePages: 48,
  maxRawSources: 12,
  tokenLimit: null,
};

export function LlmWikiAgentEvaluation() {
  const [datasets, setDatasets] = useState<AgentEvaluationDatasetSummary[]>([]);
  const [datasetId, setDatasetId] = useState("");
  const [dataset, setDataset] = useState<AgentEvaluationDataset | null>(null);
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [judgeModel, setJudgeModel] = useState("");
  const [agentModel, setAgentModel] = useState("");
  const [sourcePolicy, setSourcePolicy] = useState<AgentEvaluationSourcePolicy>("key-sources");
  const [budget, setBudget] = useState(defaultBudget);
  const [runs, setRuns] = useState<AgentEvaluationRunSummary[]>([]);
  const [activeRun, setActiveRun] = useState<AgentEvaluationRun | null>(null);
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
    const response = await agentEvaluationApi
      .listRuns(50, silent)
      .catch(() => ({ items: [] }));
    setRuns(response.items || []);
  }, []);

  const refreshDatasets = useCallback(async (silent = true) => {
    const response = await agentEvaluationApi
      .listDatasets(silent)
      .catch(() => ({ items: [] }));
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
        setJudgeModel(nextModels[0]?.id || "");
        setAgentModel(nextModels[0]?.id || "");
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
    void agentEvaluationApi
      .getDataset(datasetId, true)
      .then((next) => {
        setDataset(next);
        setSelectedCaseIds(next.cases.map((item) => item.id));
      })
      .catch(() => {
        setDataset(null);
        setSelectedCaseIds([]);
      });
  }, [datasetId]);

  const startPolling = useCallback(
    (runId: string) => {
      stopPolling();
      const tick = async () => {
        const next = await agentEvaluationApi
          .getRun(runId, true)
          .catch(() => null);
        if (!next) return;
        setActiveRun(next);
        if (next.status !== "running") {
          stopPolling();
          void refreshRuns(true);
        }
      };
      void tick();
      pollRef.current = window.setInterval(tick, 1500);
    },
    [refreshRuns, stopPolling],
  );

  const handleUpload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await agentEvaluationApi.uploadDataset(file);
      await refreshDatasets(true);
      setDataset(uploaded);
      setSelectedCaseIds(uploaded.cases.map((item) => item.id));
      setDatasetId(uploaded.datasetId);
      toast.success("Agent 评测数据集已上传");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleStart = async () => {
    if (!dataset || !selectedCaseIds.length || !judgeModel || !agentModel) return;
    setSubmitting(true);
    try {
      const run = await agentEvaluationApi.createRun({
        datasetId: dataset.datasetId,
        caseIds: selectedCaseIds,
        judgeModel,
        agentModel,
        sourcePolicy,
        budget,
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
    const run = await agentEvaluationApi.getRun(runId).catch(() => null);
    if (!run) return;
    setActiveRun(run);
    if (run.status === "running") startPolling(run.runId);
  };

  const allSelected =
    Boolean(dataset?.cases.length) &&
    selectedCaseIds.length === dataset?.cases.length;
  const toggleAll = () =>
    setSelectedCaseIds(
      allSelected ? [] : dataset?.cases.map((item) => item.id) || [],
    );
  const toggleCase = (caseId: string) => {
    setSelectedCaseIds((current) =>
      current.includes(caseId)
        ? current.filter((item) => item !== caseId)
        : [...current, caseId],
    );
  };

  const selectedCases =
    dataset?.cases.filter((item) => selectedCaseIds.includes(item.id)) || [];
  const selectedFactCount = selectedCases.reduce(
    (total, item) => total + item.expectedFacts.length,
    0,
  );
  const selectedSourceCount = new Set(
    selectedCases.flatMap((item) => item.relevantSourceIds),
  ).size;
  const sourceNameById = useMemo(
    () => new Map((dataset?.sources || []).map((source) => [source.id, source.filename])),
    [dataset],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100/80">
      <header className="flex flex-none border-b border-slate-200 bg-white/90 px-3 py-2.5">
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <HeaderMetric icon={Database} label="数据集" value={datasets.length} />
          <HeaderMetric label="已选 Cases" icon={FileSearch} value={`${selectedCaseIds.length}/${dataset?.cases.length || 0}`} />
          <HeaderMetric label="预期事实" icon={SearchCheck} value={selectedFactCount} />
          <HeaderMetric label="历史运行" icon={History} value={runs.length} />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(340px,0.48fr)_minmax(0,1fr)] gap-3 overflow-hidden p-3 xl:grid-cols-[400px_minmax(0,1fr)] xl:grid-rows-1">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
          <section className="border-b border-slate-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-950">Agent 评测配置</h2>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  数据集 JSON 需要包含 sources 和 Agent cases。
                </p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => onMaybeFile(event.target.files?.[0], handleUpload)}
              />
              <Button
                variant="outline"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                上传
              </Button>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-700">数据集</span>
                <Select
                  value={datasetId}
                  onValueChange={setDatasetId}
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

              <div className="grid grid-cols-2 gap-2">
                <ModelSelect
                  label="Agent 模型"
                  value={agentModel}
                  models={models}
                  onChange={setAgentModel}
                />
                <ModelSelect
                  label="Judge 模型"
                  value={judgeModel}
                  models={models}
                  onChange={setJudgeModel}
                />
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)_78px_78px] gap-2">
                <label className="block min-w-0 space-y-1.5">
                  <span className="text-xs font-medium text-slate-700">Source 策略</span>
                  <Select
                    value={sourcePolicy}
                    onValueChange={(value) => setSourcePolicy(value as AgentEvaluationSourcePolicy)}
                  >
                    <SelectTrigger className="h-8 w-full bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" align="start">
                      {Object.entries(sourcePolicyLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <NumberField
                  label="轮数"
                  value={budget.maxRounds}
                  min={1}
                  max={8}
                  onChange={(value) => setBudget((current) => ({ ...current, maxRounds: value }))}
                />
                <NumberField
                  label="原文"
                  value={budget.maxRawSources}
                  min={0}
                  max={24}
                  onChange={(value) => setBudget((current) => ({ ...current, maxRawSources: value }))}
                />
              </div>

              <NumberField
                label="最多读取 Wiki 页面"
                value={budget.maxEvidencePages}
                min={8}
                max={96}
                onChange={(value) => setBudget((current) => ({ ...current, maxEvidencePages: value }))}
              />
            </div>

            <div className="mt-4 grid grid-cols-3 divide-x divide-slate-200 rounded-lg border border-slate-200 bg-slate-50">
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
                onClick={toggleAll}
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
                      onChange={() => toggleCase(item.id)}
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
                onClick={handleStart}
              >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                开始 Agent 评测
              </Button>
              <p className="mt-2 text-center text-xs text-slate-500">
                将逐个 case 调用真实 llmWiki Agent，评测结果独立保存。
              </p>
            </div>
          </section>
        </aside>

        <main className="grid min-h-0 gap-3 overflow-hidden lg:grid-cols-[minmax(0,1fr)_300px]">
          <section className="min-h-0 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
            <AgentEvaluationResult run={activeRun} />
          </section>
          <AgentRunHistory
            runs={runs}
            activeRunId={activeRun?.runId || ""}
            onRefresh={() => refreshRuns(false)}
            onOpen={handleOpenRun}
          />
        </main>
      </div>
    </div>
  );
}

function AgentEvaluationResult({ run }: { run: AgentEvaluationRun | null }) {
  if (!run) {
    return (
      <div className="flex h-full min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-6 text-center">
        <span className="inline-flex size-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
          <FileSearch className="size-6" />
        </span>
        <div className="mt-3 text-sm font-semibold text-slate-800">
          尚未选择 Agent 评测记录
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
              <span>Agent: {run.models.synthesizerModel}</span>
              <span>Judge: {run.judgeModel}</span>
              <span>{sourcePolicyLabels[run.sourcePolicy]}</span>
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

      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <SummaryCard icon={SearchCheck} label="Source Hit" value={percent(run.summary.sourceHitRate, run.summary.sourceHitTotal)} />
        <SummaryCard icon={CheckCircle2} label="事实覆盖" value={percent(run.summary.factAccuracy, run.summary.totalFacts)} />
        <SummaryCard icon={Activity} label="证据支持" value={percent(run.summary.faithfulnessRate, run.summary.faithfulnessTotal)} />
        <SummaryCard icon={Gauge} label="平均轮数" value={formatNumber(run.summary.avgRounds)} />
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

      {run.cases.map((item) => (
        <AgentCaseResultCard key={item.caseId} item={item} />
      ))}
    </div>
  );
}

function AgentCaseResultCard({ item }: { item: AgentEvaluationCaseResult }) {
  const matchedSourceCount = item.matchedSources.filter((source) => source.sourceId).length;
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-slate-950">
            {item.caseId} · {item.question}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
            <span>{item.answerable ? "可回答" : "拒答题"}</span>
            <span>source {matchedSourceCount}/{item.matchedSources.length}</span>
            <span>hit {item.sourceHit === null ? "-" : item.sourceHit ? "是" : "否"}</span>
            <span>{item.metrics.rounds} 轮</span>
            <span>{item.metrics.totalTokens} tokens</span>
            {item.agentRunId && (
              <a
                href={`/agents?agentType=llmWiki&runId=${item.agentRunId}`}
                className="font-medium text-indigo-700 hover:text-indigo-900"
              >
                执行记录
              </a>
            )}
          </div>
        </div>
        <StatusTag status={item.status} labels={caseStatusLabels} />
      </header>

      <div className="grid gap-2 border-b border-slate-100 px-4 py-3 md:grid-cols-3">
        <MetricPill label="Faithfulness" result={item.faithfulness} />
        <MetricPill label="Correctness" result={item.answerCorrectness} />
        <MetricPill label="Abstain" result={item.abstainCorrectness} />
      </div>

      {item.answerMarkdown && (
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Agent 答案</div>
          <pre className="max-h-44 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-700">
            {item.answerMarkdown}
          </pre>
        </div>
      )}

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
          <div className="px-4 py-3 text-sm text-rose-700">{item.error}</div>
        )}
      </div>
    </section>
  );
}

function AgentRunHistory({
  runs,
  activeRunId,
  onRefresh,
  onOpen,
}: {
  runs: AgentEvaluationRunSummary[];
  activeRunId: string;
  onRefresh: () => void;
  onOpen: (runId: string) => void;
}) {
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
                <span>{percent(run.summary.answerCorrectnessRate, run.summary.answerCorrectnessTotal)} 正确</span>
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

function HeaderMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Database;
  label: string;
  value: string | number;
}) {
  return (
    <div className="inline-flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
      <Icon className="size-3.5 shrink-0 text-slate-500" />
      <span className="min-w-0 truncate text-xs text-slate-600">{label}</span>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-950">
        {value}
      </span>
    </div>
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
            <SelectItem key={item.id} value={item.id}>
              {modelOptionLabel(item)}
            </SelectItem>
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
      <div className="text-base font-semibold tabular-nums text-slate-950">
        {value}
      </div>
      <div className="mt-0.5 text-xs text-slate-600">{label}</div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-slate-600">{label}</div>
        <span className="inline-flex size-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
          <Icon className="size-4" />
        </span>
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">
        {value}
      </div>
    </div>
  );
}

function MetricPill({
  label,
  result,
}: {
  label: string;
  result: { status: string; reason: string };
}) {
  const cls =
    result.status === "correct"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : result.status === "incorrect"
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : "border-slate-200 bg-slate-50 text-slate-600";
  const text =
    result.status === "correct"
      ? "正确"
      : result.status === "incorrect"
        ? "错误"
        : "不适用";
  return (
    <div className={`rounded-lg border px-3 py-2 ${cls}`}>
      <div className="text-xs font-medium">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{text}</div>
      {result.reason && (
        <div className="mt-1 line-clamp-2 text-xs leading-5 opacity-80">
          {result.reason}
        </div>
      )}
    </div>
  );
}

function onMaybeFile(file: File | undefined, handler: (file?: File) => Promise<void>) {
  void handler(file);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.round(value), min), max);
}

function percent(value: number, total: number): string {
  return total ? `${Math.round(value * 100)}%` : "-";
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "-";
}
