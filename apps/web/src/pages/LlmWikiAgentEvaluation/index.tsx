import {
  Activity,
  AlertTriangle,
  Award,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  Clock3,
  ExternalLink,
  FileSearch,
  History,
  Loader2,
  PieChart,
  PlayCircle,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  Target,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { agentApi } from "@/api/agent";
import {
  agentEvaluationApi,
  type AgentEvaluationCaseResult,
  type AgentEvaluationDataset,
  type AgentEvaluationFactStatus,
  type AgentEvaluationRun,
  type AgentEvaluationRunSummary,
} from "@/api/agentEvaluation";
import { modelApi, modelOptionLabel, type ModelOption } from "@/api/model";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { StatusTag } from "@/components/StatusTag";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatDate } from "../LlmWikiEvaluation/utils";

type LeftTab = "new" | "history";
type SelectionMode = "all" | "custom";
type ResultFilter =
  | "issues"
  | "all"
  | "complete"
  | AgentEvaluationFactStatus
  | "failed";

const runLabels: Record<string, string> = {
  completed: "已完成",
  invalidated: "版本失效",
  judge_failed: "Judge 失败",
  execution_failed: "执行失败",
  judged: "已判分",
  pending: "等待中",
};

const factMeta: Record<
  AgentEvaluationFactStatus,
  { label: string; className: string }
> = {
  supported: {
    label: "完整",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  partial: {
    label: "部分",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  missing: {
    label: "缺失",
    className: "border-slate-200 bg-slate-100 text-slate-600",
  },
  incorrect: {
    label: "错误",
    className: "border-rose-200 bg-rose-50 text-rose-700",
  },
};

export function LlmWikiAgentEvaluation() {
  const [dataset, setDataset] = useState<AgentEvaluationDataset | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [fastModel, setFastModel] = useState("");
  const [qualityModel, setQualityModel] = useState("");
  const [judgeModel, setJudgeModel] = useState("");
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("all");
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const [leftTab, setLeftTab] = useState<LeftTab>("new");
  const [runs, setRuns] = useState<AgentEvaluationRunSummary[]>([]);
  const [activeRun, setActiveRun] = useState<AgentEvaluationRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingRunId, setDeletingRunId] = useState("");
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const refreshRuns = useCallback(async (silent = true) => {
    const response = await agentEvaluationApi.listRuns(silent);
    setRuns(response.items || []);
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const [nextDataset, modelResponse, defaults] = await Promise.all([
          agentEvaluationApi.getDataset(true),
          modelApi.list(true),
          agentApi.getDefaults<{ fastModel?: string; qualityModel?: string }>(
            "llmWiki",
            true,
          ),
          refreshRuns(true),
        ]);
        const nextModels = modelResponse.items || [];
        const modelIds = new Set(nextModels.map((item) => item.id));
        const defaultFast = modelIds.has(defaults.fastModel || "")
          ? defaults.fastModel!
          : nextModels[0]?.id || "";
        const defaultQuality = modelIds.has(defaults.qualityModel || "")
          ? defaults.qualityModel!
          : nextModels[0]?.id || "";
        setDataset(nextDataset);
        setModels(nextModels);
        setFastModel(defaultFast);
        setQualityModel(defaultQuality);
        setJudgeModel(defaultQuality);
        setSelectedCaseIds(nextDataset.cases.map((item) => item.id));
      } finally {
        setLoading(false);
      }
    };
    void init();
    return stopPolling;
  }, [refreshRuns, stopPolling]);

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

  const effectiveCaseIds =
    selectionMode === "all"
      ? dataset?.cases.map((item) => item.id) || []
      : selectedCaseIds;

  const handleStart = async () => {
    if (
      !dataset?.compatible ||
      !effectiveCaseIds.length ||
      !fastModel ||
      !qualityModel ||
      !judgeModel
    ) {
      return;
    }
    setSubmitting(true);
    try {
      const run = await agentEvaluationApi.createRun({
        caseIds: selectionMode === "all" ? undefined : effectiveCaseIds,
        fastModel,
        qualityModel,
        judgeModel,
      });
      setActiveRun(run);
      startPolling(run.runId);
      void refreshRuns(true);
      toast.success("Agent 评测已开始");
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenRun = async (runId: string) => {
    stopPolling();
    const run = await agentEvaluationApi.getRun(runId);
    setActiveRun(run);
    if (run.status === "running") startPolling(runId);
  };

  const handleCancel = async () => {
    if (!activeRun || activeRun.status !== "running") return;
    await agentEvaluationApi.cancelRun(activeRun.runId);
    const next = await agentEvaluationApi.getRun(activeRun.runId, true);
    setActiveRun(next);
    stopPolling();
    void refreshRuns(true);
    toast.success("评测已取消");
  };

  const handleDelete = async (run: AgentEvaluationRunSummary) => {
    if (run.status === "running") {
      toast.info("运行中的评测不能删除");
      return;
    }
    if (!window.confirm(`删除 ${formatDate(run.startedAt)} 的评测记录？`))
      return;
    setDeletingRunId(run.runId);
    try {
      await agentEvaluationApi.deleteRun(run.runId);
      if (activeRun?.runId === run.runId) setActiveRun(null);
      await refreshRuns(true);
      toast.success("评测记录已删除");
    } finally {
      setDeletingRunId("");
    }
  };

  const toggleCase = (caseId: string) => {
    setSelectedCaseIds((current) =>
      current.includes(caseId)
        ? current.filter((item) => item !== caseId)
        : [...current, caseId],
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100/80">
      <DatasetHeader dataset={dataset} loading={loading} />
      <div className="grid min-h-0 flex-1 gap-3 overflow-hidden p-3 pt-0 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="grid grid-cols-2 gap-1 border-b border-slate-200 bg-slate-50/80 p-1.5">
            <TabButton
              active={leftTab === "new"}
              icon={<PlayCircle />}
              onClick={() => setLeftTab("new")}
            >
              新评测
            </TabButton>
            <TabButton
              active={leftTab === "history"}
              icon={<History />}
              onClick={() => setLeftTab("history")}
            >
              历史记录
              {runs.length > 0 && (
                <span className="ml-1 text-[11px] text-slate-400">
                  {runs.length}
                </span>
              )}
            </TabButton>
          </div>
          {leftTab === "new" ? (
            <NewRunPanel
              dataset={dataset}
              models={models}
              loading={loading}
              fastModel={fastModel}
              qualityModel={qualityModel}
              judgeModel={judgeModel}
              selectionMode={selectionMode}
              selectedCaseIds={selectedCaseIds}
              submitting={submitting}
              running={activeRun?.status === "running"}
              onFastModel={setFastModel}
              onQualityModel={setQualityModel}
              onJudgeModel={setJudgeModel}
              onSelectionMode={setSelectionMode}
              onToggleCase={toggleCase}
              onStart={() => void handleStart()}
              onCancel={() => void handleCancel()}
            />
          ) : (
            <HistoryPanel
              runs={runs}
              activeRunId={activeRun?.runId || ""}
              deletingRunId={deletingRunId}
              onRefresh={() => void refreshRuns(false)}
              onOpen={(runId) => void handleOpenRun(runId)}
              onDelete={(run) => void handleDelete(run)}
            />
          )}
        </aside>

        <main className="min-h-0 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
          <EvaluationResult run={activeRun} loading={loading} />
        </main>
      </div>
    </div>
  );
}

function DatasetHeader({
  dataset,
  loading,
}: {
  dataset: AgentEvaluationDataset | null;
  loading: boolean;
}) {
  return (
    <header className="m-3 flex min-h-14 flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5">
      {loading ? (
        <div className="h-5 w-64 animate-pulse rounded bg-slate-100" />
      ) : dataset ? (
        <>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-950">
              {dataset.name}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
              <span>Revision {shortId(dataset.revisionId)}</span>
              <span>{dataset.caseCount} 题</span>
              <span>{dataset.factCount} 条事实</span>
              <span>{dataset.abstainCount} 道拒答题</span>
            </div>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
              dataset.compatible
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-rose-200 bg-rose-50 text-rose-700",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                dataset.compatible ? "bg-emerald-500" : "bg-rose-500",
              )}
            />
            {dataset.compatible ? "版本一致，可评测" : "Revision 不匹配"}
          </span>
        </>
      ) : (
        <div className="text-sm text-rose-700">内置评测集加载失败</div>
      )}
    </header>
  );
}

interface NewRunPanelProps {
  dataset: AgentEvaluationDataset | null;
  models: ModelOption[];
  loading: boolean;
  fastModel: string;
  qualityModel: string;
  judgeModel: string;
  selectionMode: SelectionMode;
  selectedCaseIds: string[];
  submitting: boolean;
  running: boolean;
  onFastModel(value: string): void;
  onQualityModel(value: string): void;
  onJudgeModel(value: string): void;
  onSelectionMode(value: SelectionMode): void;
  onToggleCase(caseId: string): void;
  onStart(): void;
  onCancel(): void;
}

function NewRunPanel(props: NewRunPanelProps) {
  const selectedCount =
    props.selectionMode === "all"
      ? props.dataset?.caseCount || 0
      : props.selectedCaseIds.length;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      {!props.dataset?.compatible && !props.loading && (
        <div className="mb-4 flex gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          当前 Published Revision 为{" "}
          {shortId(props.dataset?.currentRevisionId || "")}
          ，与评测集不一致，已禁止执行。
        </div>
      )}

      <div className="space-y-3">
        <ModelField
          label="Fast Model"
          value={props.fastModel}
          models={props.models}
          onChange={props.onFastModel}
        />
        <ModelField
          label="Quality Model"
          value={props.qualityModel}
          models={props.models}
          onChange={props.onQualityModel}
        />
        <ModelField
          label="Judge Model"
          value={props.judgeModel}
          models={props.models}
          onChange={props.onJudgeModel}
        />
      </div>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-slate-700">评测范围</div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              默认顺序执行全部 30 题
            </div>
          </div>
          <div className="flex rounded-md bg-slate-100 p-0.5">
            {(["all", "custom"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => props.onSelectionMode(mode)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium",
                  props.selectionMode === mode
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-800",
                )}
              >
                {mode === "all" ? "全部" : "自定义"}
              </button>
            ))}
          </div>
        </div>

        {props.selectionMode === "custom" && (
          <div className="mt-3 max-h-72 space-y-1 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-1.5">
            {props.dataset?.cases.map((item) => (
              <label
                key={item.id}
                className="flex cursor-pointer items-start gap-2 rounded px-2 py-2 hover:bg-white"
              >
                <input
                  type="checkbox"
                  checked={props.selectedCaseIds.includes(item.id)}
                  onChange={() => props.onToggleCase(item.id)}
                  className="mt-0.5 size-3.5 rounded border-slate-300 accent-indigo-600"
                />
                <span className="min-w-0">
                  <span className="block text-[11px] font-semibold text-slate-500">
                    {item.id}
                  </span>
                  <span className="line-clamp-2 text-xs leading-5 text-slate-700">
                    {item.question}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 border-t border-slate-100 pt-4">
        {props.running ? (
          <Button
            variant="outline"
            className="w-full border-rose-200 text-rose-700 hover:bg-rose-50"
            onClick={props.onCancel}
          >
            取消当前评测
          </Button>
        ) : (
          <Button
            className="w-full bg-indigo-600 hover:bg-indigo-700"
            disabled={
              props.loading ||
              props.submitting ||
              !props.dataset?.compatible ||
              !selectedCount ||
              !props.fastModel ||
              !props.qualityModel ||
              !props.judgeModel
            }
            onClick={props.onStart}
          >
            {props.submitting && <Loader2 className="animate-spin" />}
            开始评测 · {selectedCount} 题
          </Button>
        )}
      </div>
    </div>
  );
}

function ModelField({
  label,
  value,
  models,
  onChange,
}: {
  label: string;
  value: string;
  models: ModelOption[];
  onChange(value: string): void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-700">
        {label}
      </span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full bg-white">
          <SelectValue placeholder="选择模型" />
        </SelectTrigger>
        <SelectContent position="popper">
          {models.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {modelOptionLabel(model)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function HistoryPanel({
  runs,
  activeRunId,
  deletingRunId,
  onRefresh,
  onOpen,
  onDelete,
}: {
  runs: AgentEvaluationRunSummary[];
  activeRunId: string;
  deletingRunId: string;
  onRefresh(): void;
  onOpen(runId: string): void;
  onDelete(run: AgentEvaluationRunSummary): void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <span className="text-xs text-slate-500">{runs.length} 条记录</span>
        <Button variant="ghost" size="xs" onClick={onRefresh}>
          <RefreshCw />
          刷新
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {runs.length === 0 ? (
          <div className="py-16 text-center text-xs text-slate-500">
            暂无评测记录
          </div>
        ) : (
          <div className="space-y-1.5">
            {runs.map((run) => (
              <div
                key={run.runId}
                className={cn(
                  "group flex items-center gap-2 rounded-md border px-2.5 py-2",
                  activeRunId === run.runId
                    ? "border-indigo-200 bg-indigo-50/70"
                    : "border-slate-200 bg-white hover:border-slate-300",
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onOpen(run.runId)}
                >
                  <div className="flex items-center gap-2">
                    <StatusTag status={run.status} labels={runLabels} />
                    <span className="truncate text-xs font-medium text-slate-800">
                      {formatDate(run.startedAt)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-500">
                    <span>{run.progress.total} 题</span>
                    <span>Rev {shortId(run.revisionId)}</span>
                    <span
                      className={cn(
                        "font-bold tabular-nums",
                        scoreTone(run.summary.overallScore).text,
                      )}
                    >
                      {run.summary.overallScore === null
                        ? "—"
                        : `${Math.round(run.summary.overallScore)} 分`}
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  title="删除"
                  disabled={
                    run.status === "running" || deletingRunId === run.runId
                  }
                  onClick={() => onDelete(run)}
                  className="rounded p-1.5 text-slate-400 opacity-0 hover:bg-rose-50 hover:text-rose-600 disabled:hidden group-hover:opacity-100"
                >
                  {deletingRunId === run.runId ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </button>
                <ChevronRight className="size-4 text-slate-300" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EvaluationResult({
  run,
  loading,
}: {
  run: AgentEvaluationRun | null;
  loading: boolean;
}) {
  const [filter, setFilter] = useState<ResultFilter>("issues");
  const rows = useMemo(
    () => (run?.cases || []).filter((item) => matchesFilter(item, filter)),
    [run, filter],
  );

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-24 animate-pulse rounded-lg bg-white" />
        <div className="h-40 animate-pulse rounded-lg bg-white" />
      </div>
    );
  }
  if (!run) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-center">
        <span className="flex size-10 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          <FileSearch className="size-5" />
        </span>
        <div className="mt-3 text-sm font-semibold text-slate-800">
          尚未打开评测结果
        </div>
        <div className="mt-1 text-xs text-slate-500">
          运行新评测，或从左侧历史记录打开。
        </div>
      </div>
    );
  }

  const summary = run.summary;
  const factTotal =
    summary.supportedFacts +
    summary.partialFacts +
    summary.missingFacts +
    summary.incorrectFacts;
  const progress = run.progress.total
    ? Math.round((run.progress.completed / run.progress.total) * 100)
    : 0;

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-slate-950">
                {run.datasetName}
              </span>
              <StatusTag status={run.status} labels={runLabels} />
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Revision {shortId(run.revisionId)} · {formatDate(run.startedAt)}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="size-3.5" />
              平均 {formatDuration(summary.averageDurationMs)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Activity className="size-3.5" />
              成功率 {Math.round(summary.executionSuccessRate * 100)}%
            </span>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 xl:grid-cols-[1.2fr_repeat(4,minmax(120px,1fr))]">
          <ScoreMetric
            score={summary.overallScore}
            passLevel={summary.passLevel}
          />
          <div className="border-t border-slate-100 px-4 py-4 sm:border-l sm:border-t-0">
            <SummaryMetric
              icon={<CheckCircle2 />}
              label="有效题"
              value={`${summary.validCases}/${summary.totalCases}`}
              tone="emerald"
            />
          </div>
          <div className="border-t border-slate-100 px-4 py-4 xl:border-l xl:border-t-0">
            <SummaryMetric
              icon={<Target />}
              label="事实覆盖"
              value={factTotal ? `${summary.supportedFacts}/${factTotal}` : "—"}
              tone="indigo"
            />
          </div>
          <div className="border-t border-slate-100 px-4 py-4 sm:border-l xl:border-t-0">
            <SummaryMetric
              icon={<ShieldCheck />}
              label="拒答准确率"
              value={
                summary.abstainAccuracy === null
                  ? "—"
                  : `${Math.round(summary.abstainAccuracy * 100)}%`
              }
              tone="sky"
            />
          </div>
          <div className="border-t border-slate-100 px-4 py-4 xl:border-l xl:border-t-0">
            <SummaryMetric
              icon={<AlertTriangle />}
              label="重要编造"
              value={String(summary.materialHallucinationCount)}
              tone={summary.materialHallucinationCount > 0 ? "rose" : "slate"}
            />
          </div>
        </div>

        <div className="grid border-t border-slate-100 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <FactDistributionChart summary={summary} />
          <ScoreDistributionChart cases={run.cases} />
        </div>

        {run.status === "running" && (
          <div className="border-t border-slate-100 px-4 py-3">
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1.5 text-indigo-700">
                <Loader2 className="size-3.5 animate-spin" />
                正在执行 {run.progress.currentCaseId || "下一题"}
              </span>
              <span className="tabular-nums text-slate-500">
                {run.progress.completed}/{run.progress.total}
              </span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-indigo-600"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 text-[11px] text-slate-600">
          <OperationalMetric
            icon={<CircleGauge />}
            label="Token"
            value={formatNumber(summary.totalTokens)}
          />
          <OperationalMetric
            icon={<Activity />}
            label="模型调用"
            value={summary.totalModelCalls}
          />
          <OperationalMetric
            icon={<SearchCheck />}
            label="页面读取"
            value={summary.totalReadPages}
          />
          <OperationalMetric
            icon={<FileSearch />}
            label="搜索"
            value={summary.totalSearches}
          />
          <OperationalMetric
            icon={<RefreshCw />}
            label="重试"
            value={summary.totalRetries}
          />
          <OperationalMetric
            icon={<AlertTriangle />}
            label="超时"
            value={summary.totalTimeouts}
          />
        </div>
      </section>

      {run.status === "invalidated" && (
        <StateNotice tone="danger">
          Published Revision 在评测期间发生变化，本次运行已失效且不生成总分。
        </StateNotice>
      )}
      {run.status === "cancelled" && (
        <StateNotice tone="neutral">
          评测已取消，未完成题目不计入质量分。
        </StateNotice>
      )}
      {run.errors.map((error) => (
        <StateNotice key={error} tone="danger">
          {error}
        </StateNotice>
      ))}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
          <div className="text-sm font-semibold text-slate-900">
            评测明细
            <span className="ml-1.5 font-normal text-slate-400">
              {rows.length}/{run.cases.length}
            </span>
          </div>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as ResultFilter)}
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-indigo-400"
          >
            <option value="issues">只看问题</option>
            <option value="all">全部</option>
            <option value="complete">完整</option>
            <option value="partial">部分</option>
            <option value="missing">缺失</option>
            <option value="incorrect">错误</option>
            <option value="failed">执行失败</option>
          </select>
        </div>
        {rows.length ? (
          <div className="divide-y divide-slate-100">
            {rows.map((item) => (
              <CaseRow key={item.caseId} item={item} />
            ))}
          </div>
        ) : (
          <div className="py-14 text-center text-xs text-slate-500">
            当前筛选条件下没有结果
          </div>
        )}
      </section>
    </div>
  );
}

function CaseRow({ item }: { item: AgentEvaluationCaseResult }) {
  const stages = [
    ...new Set(item.facts.map((fact) => fact.failureStage).filter(Boolean)),
  ];
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 hover:bg-slate-50">
        <ChevronRight className="mt-0.5 size-4 shrink-0 text-slate-400 transition-transform group-open:rotate-90" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">
              {item.caseId}
            </span>
            <StatusTag status={item.status} labels={runLabels} />
            {stages.map((stage) => (
              <span
                key={stage}
                className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
              >
                {failureStageLabel(stage!)}
              </span>
            ))}
          </div>
          <div className="mt-1 line-clamp-2 text-sm leading-5 text-slate-800">
            {item.question}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div
            className={cn(
              "text-xl font-bold leading-none tabular-nums",
              scoreTone(item.caseScore).text,
            )}
          >
            {item.caseScore === null ? "—" : Math.round(item.caseScore)}
          </div>
          {item.caseScore !== null && (
            <div className="mt-0.5 text-[9px] font-medium text-slate-400">
              / 100 分
            </div>
          )}
          <div className="mt-0.5 flex gap-2 text-[10px] text-slate-400">
            <span>{formatDuration(item.metrics.durationMs)}</span>
            <span>{formatNumber(item.metrics.totalTokens)} tok</span>
          </div>
        </div>
      </summary>

      <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-4 pl-11">
        {item.error && (
          <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {item.error}
          </div>
        )}
        <div className="grid gap-3 lg:grid-cols-2">
          <AnswerBlock title="标准答案">
            <p className="whitespace-pre-wrap text-xs leading-5 text-slate-700">
              {item.expectedAnswer}
            </p>
          </AnswerBlock>
          <AnswerBlock title="Agent 答案">
            <MarkdownRenderer
              content={item.answerMarkdown}
              className="text-xs leading-5 text-slate-700"
              emptyFallback={<span className="text-slate-400">无答案</span>}
            />
          </AnswerBlock>
        </div>

        {item.facts.length > 0 && (
          <div className="mt-3 space-y-2">
            {item.facts.map((fact) => (
              <div
                key={fact.id}
                className="rounded-md border border-slate-200 bg-white p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold text-slate-500">
                    {fact.id}
                  </span>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                      factMeta[fact.status].className,
                    )}
                  >
                    {factMeta[fact.status].label}
                  </span>
                  {fact.failureStage && (
                    <span className="text-[10px] text-slate-500">
                      {failureStageLabel(fact.failureStage)}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-xs leading-5 text-slate-800">
                  {fact.fact}
                </p>
                <p className="mt-1 text-[11px] leading-5 text-slate-500">
                  {fact.reason}
                </p>
                <div className="mt-2 rounded border border-slate-100 bg-slate-50 px-2.5 py-2 text-[11px] leading-5 text-slate-600">
                  <span className="font-medium text-slate-700">
                    Gold · {fact.evidence.pageKey}
                  </span>
                  <span className="ml-2">{fact.evidence.quote}</span>
                </div>
                {fact.evidenceIds.length > 0 && (
                  <div className="mt-1.5 text-[10px] text-indigo-700">
                    Agent 证据：{fact.evidenceIds.join(", ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {!item.answerable && item.abstainStatus !== "not_applicable" && (
          <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-xs">
            <span className="font-medium text-slate-700">
              拒答判定：{item.abstainStatus}
            </span>
            <span className="ml-2 text-slate-500">{item.abstainReason}</span>
          </div>
        )}

        {item.verifiedEvidence.length > 0 && (
          <details className="mt-3 rounded-md border border-slate-200 bg-white">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-700">
              已复核 Agent 证据 · {item.verifiedEvidence.length}
            </summary>
            <div className="space-y-2 border-t border-slate-100 p-3">
              {item.verifiedEvidence.map((evidence) => (
                <div
                  key={evidence.evidenceId}
                  className="text-[11px] leading-5"
                >
                  <div className="font-medium text-slate-700">
                    {evidence.evidenceId} · {evidence.pageKey}
                  </div>
                  <div className="text-slate-500">{evidence.quote}</div>
                </div>
              ))}
            </div>
          </details>
        )}

        {item.agentRunId && (
          <a
            href={`/agents?agentType=llmWiki&runId=${item.agentRunId}`}
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:text-indigo-900"
          >
            打开原始 Agent 执行记录
            <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </details>
  );
}

function AnswerBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="mb-2 text-xs font-semibold text-slate-800">{title}</div>
      {children}
    </div>
  );
}

function ScoreMetric({
  score,
  passLevel,
}: {
  score: number | null;
  passLevel: AgentEvaluationRun["summary"]["passLevel"];
}) {
  const tone = scoreTone(score);
  return (
    <div className="flex min-h-28 items-center gap-3 bg-indigo-50/55 px-5 py-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white text-indigo-600 ring-1 ring-indigo-100">
        <Award className="size-5" />
      </span>
      <div>
        <div className="text-xs font-medium text-indigo-700">综合质量分</div>
        <div className="mt-0.5 flex items-end gap-2">
          <span
            className={cn(
              "text-4xl font-bold leading-none tabular-nums",
              tone.text,
            )}
          >
            {score === null ? "—" : Math.round(score)}
          </span>
          {score !== null && (
            <span className="pb-0.5 text-xs text-slate-400">/ 100</span>
          )}
        </div>
        <div className={cn("mt-1 text-xs font-semibold", tone.text)}>
          {passLevelLabel(passLevel)}
        </div>
      </div>
    </div>
  );
}

function SummaryMetric({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "emerald" | "indigo" | "sky" | "rose" | "slate";
}) {
  const colors = {
    emerald: "bg-emerald-50 text-emerald-700",
    indigo: "bg-indigo-50 text-indigo-700",
    sky: "bg-sky-50 text-sky-700",
    rose: "bg-rose-50 text-rose-700",
    slate: "bg-slate-100 text-slate-600",
  }[tone];
  return (
    <div className="flex h-full items-center gap-3">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md [&_svg]:size-4",
          colors,
        )}
      >
        {icon}
      </span>
      <div>
        <div
          className={cn(
            "text-2xl font-semibold leading-none tabular-nums",
            tone === "rose" ? "text-rose-700" : "text-slate-950",
          )}
        >
          {value}
        </div>
        <div className="mt-1.5 text-[11px] font-medium text-slate-500">
          {label}
        </div>
      </div>
    </div>
  );
}

function FactDistributionChart({
  summary,
}: {
  summary: AgentEvaluationRun["summary"];
}) {
  const items = [
    { label: "完整", value: summary.supportedFacts, color: "#10b981" },
    { label: "部分", value: summary.partialFacts, color: "#f59e0b" },
    { label: "缺失", value: summary.missingFacts, color: "#94a3b8" },
    { label: "错误", value: summary.incorrectFacts, color: "#f43f5e" },
  ];
  const total = items.reduce((sum, item) => sum + item.value, 0);
  let cursor = 0;
  const stops = items.map((item) => {
    const start = cursor;
    cursor += total ? (item.value / total) * 360 : 0;
    return `${item.color} ${start}deg ${cursor}deg`;
  });
  const background = total ? `conic-gradient(${stops.join(", ")})` : "#e2e8f0";
  return (
    <div className="flex items-center gap-5 px-5 py-4">
      <div
        className="relative size-24 shrink-0 rounded-full"
        style={{ background }}
      >
        <div className="absolute inset-3.5 flex flex-col items-center justify-center rounded-full bg-white">
          <span className="text-xl font-semibold tabular-nums text-slate-900">
            {total}
          </span>
          <span className="text-[10px] text-slate-500">事实</span>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-800">
          <PieChart className="size-4 text-slate-500" />
          事实判定分布
        </div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-2">
          {items.map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="inline-flex items-center gap-2 text-slate-600">
                <span
                  className="size-2 rounded-sm"
                  style={{ backgroundColor: item.color }}
                />
                {item.label}
              </span>
              <span className="font-semibold tabular-nums text-slate-800">
                {item.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ScoreDistributionChart({
  cases,
}: {
  cases: AgentEvaluationCaseResult[];
}) {
  const buckets = [
    {
      label: "优秀",
      hint: "85–100",
      value: cases.filter(
        (item) => item.caseScore !== null && item.caseScore >= 85,
      ).length,
      color: "bg-emerald-500",
    },
    {
      label: "可接受",
      hint: "75–84",
      value: cases.filter(
        (item) =>
          item.caseScore !== null &&
          item.caseScore >= 75 &&
          item.caseScore < 85,
      ).length,
      color: "bg-indigo-500",
    },
    {
      label: "待优化",
      hint: "0–74",
      value: cases.filter(
        (item) => item.caseScore !== null && item.caseScore < 75,
      ).length,
      color: "bg-amber-500",
    },
    {
      label: "未判分",
      hint: "—",
      value: cases.filter((item) => item.caseScore === null).length,
      color: "bg-slate-300",
    },
  ];
  const max = Math.max(...buckets.map((item) => item.value), 1);
  return (
    <div className="border-t border-slate-100 px-5 py-4 lg:border-l lg:border-t-0">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
        <BarChart3 className="size-4 text-slate-500" />
        题目分数分布
      </div>
      <div className="mt-3 flex h-24 items-end gap-4">
        {buckets.map((item) => (
          <div
            key={item.label}
            className="flex h-full min-w-0 flex-1 flex-col justify-end"
          >
            <div className="mb-1 text-center text-xs font-semibold tabular-nums text-slate-700">
              {item.value}
            </div>
            <div className="flex h-14 items-end rounded-sm bg-slate-100">
              <div
                className={cn(
                  "w-full rounded-sm transition-[height] duration-200 motion-reduce:transition-none",
                  item.color,
                )}
                style={{
                  height: `${Math.max(item.value ? 14 : 4, (item.value / max) * 100)}%`,
                }}
              />
            </div>
            <div className="mt-1.5 truncate text-center text-[10px] font-medium text-slate-600">
              {item.label}
            </div>
            <div className="text-center text-[9px] text-slate-400">
              {item.hint}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OperationalMetric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-slate-400 [&_svg]:size-3.5">{icon}</span>
      <span>{label}</span>
      <span className="font-semibold tabular-nums text-slate-700">{value}</span>
    </span>
  );
}

function scoreTone(score: number | null) {
  if (score === null) return { text: "text-slate-500" };
  if (score >= 85) return { text: "text-emerald-700" };
  if (score >= 75) return { text: "text-indigo-700" };
  if (score >= 60) return { text: "text-amber-700" };
  return { text: "text-rose-700" };
}

function StateNotice({
  tone,
  children,
}: {
  tone: "danger" | "neutral";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-xs",
        tone === "danger"
          ? "border-rose-200 bg-rose-50 text-rose-800"
          : "border-slate-200 bg-white text-slate-600",
      )}
    >
      {children}
    </div>
  );
}

function TabButton({
  active,
  icon,
  children,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 [&_svg]:size-3.5",
        active
          ? "bg-indigo-600 text-white"
          : "text-slate-500 hover:bg-white hover:text-slate-800",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function matchesFilter(
  item: AgentEvaluationCaseResult,
  filter: ResultFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "failed") {
    return ["execution_failed", "judge_failed", "invalidated"].includes(
      item.status,
    );
  }
  if (filter === "complete") {
    return item.status === "judged" && item.caseScore === 100;
  }
  if (filter === "issues") {
    return item.status !== "judged" || item.caseScore !== 100;
  }
  return item.facts.some((fact) => fact.status === filter);
}

function passLevelLabel(
  value: AgentEvaluationRun["summary"]["passLevel"],
): string {
  return {
    excellent: "优秀",
    acceptable: "可接受",
    needs_improvement: "待优化",
    unavailable: "样本不足",
  }[value];
}

function failureStageLabel(value: string): string {
  return (
    {
      retrieval_miss: "检索未命中",
      evidence_extraction_miss: "证据未抽取",
      final_answer_miss: "答案遗漏",
      incorrect_answer: "答案冲突",
      execution_failure: "执行失败",
    }[value] || value
  );
}

function shortId(value: string): string {
  return value ? value.slice(0, 8) : "—";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN", { notation: "compact" }).format(
    value || 0,
  );
}

function formatDuration(value: number): string {
  if (!value) return "—";
  if (value < 1000) return `${value}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1000)}s`;
}
