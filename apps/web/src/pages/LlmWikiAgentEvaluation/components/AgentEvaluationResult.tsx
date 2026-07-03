import {
  CheckCircle2,
  CircleAlert,
  FileSearch,
  Loader2,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  AgentEvaluationCaseResult,
  AgentEvaluationFactStatus,
  AgentEvaluationMetricResult,
  AgentEvaluationPassLevel,
  AgentEvaluationRun,
} from "@/api/evaluation";
import { StatusTag } from "@/components/StatusTag";
import { formatDate } from "../../LlmWikiEvaluation/utils";
import { passLevelText, sourcePolicyLabels } from "../constants";

type CaseVerdict = "correct" | "missing" | "incorrect" | "failed";
type StatusFilter = "issues" | "all" | CaseVerdict;
type AnswerFilter = "all" | "answerable" | "abstain";

const verdictConfig: Record<
  CaseVerdict,
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
  failed: {
    label: "失败",
    cls: "border-rose-200 bg-rose-50 text-rose-700",
    Icon: XCircle,
  },
};

const factStatusConfig: Record<
  AgentEvaluationFactStatus,
  { label: string; cls: string; Icon: typeof CheckCircle2 }
> = {
  correct: verdictConfig.correct,
  missing: verdictConfig.missing,
  incorrect: verdictConfig.incorrect,
};

export function AgentEvaluationResult({ run }: { run: AgentEvaluationRun | null }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("issues");
  const [answerFilter, setAnswerFilter] = useState<AnswerFilter>("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const rows = useMemo(
    () => (run?.cases || []).map((item) => ({ item, verdict: caseVerdict(item) })),
    [run],
  );
  const types = useMemo(
    () => [...new Set(rows.map(({ item }) => item.evaluationType || "general"))].sort(),
    [rows],
  );
  const filteredRows = rows.filter(({ item, verdict }) => {
    const statusMatched = statusFilter === "all"
      ? true
      : statusFilter === "issues"
        ? verdict !== "correct"
        : verdict === statusFilter;
    const answerMatched = answerFilter === "all"
      ? true
      : answerFilter === "answerable"
        ? item.answerable
        : !item.answerable;
    const typeMatched = typeFilter === "all" || (item.evaluationType || "general") === typeFilter;
    return statusMatched && answerMatched && typeMatched;
  });

  if (!run) {
    return (
      <div className="flex h-full min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-6 text-center">
        <span className="inline-flex size-10 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          <FileSearch className="size-5" />
        </span>
        <div className="mt-3 text-sm font-semibold text-slate-800">未打开 Agent 评测结果</div>
        <div className="mt-1 text-xs text-slate-500">从右侧历史记录打开，或运行新评测。</div>
      </div>
    );
  }

  const progress = run.progress.total > 0
    ? Math.round((run.progress.completed / run.progress.total) * 100)
    : 0;
  const passLevel = run.summary.passLevel || passLevelFor(run.summary.overallScore || 0);

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-[160px] items-start gap-3">
            <div>
              <div className="text-4xl font-semibold leading-none tabular-nums text-slate-950">
                {Math.round(run.summary.overallScore || 0)}
              </div>
              <div className="mt-1 text-xs text-slate-500">综合分</div>
            </div>
            <div className="flex flex-col gap-1 pt-1">
              <span className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-xs ${passLevelClass(passLevel)}`}>
                {passLevelText[passLevel]}
              </span>
              <StatusTag status={run.status} />
            </div>
          </div>

          <div className="min-w-[280px] flex-1">
            <div className="truncate text-base font-semibold text-slate-950">{run.datasetName}</div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
              <span>Agent: {run.models.synthesizerModel}</span>
              <span>Judge: {run.judgeModel}</span>
              <span>{sourcePolicyLabels[run.sourcePolicy]}</span>
              <span>{run.progress.completed}/{run.progress.total} cases</span>
              <span>{formatDate(run.startedAt)}</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-slate-950 transition-[width] duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="grid min-w-[320px] grid-cols-4 gap-2">
            <SummaryStat label="任务" value={formatPercent(run.summary.taskCorrectnessRate)} />
            <SummaryStat label="事实" value={formatMetric(run.summary.factAccuracy, run.summary.totalFacts)} />
            <SummaryStat label="忠实" value={formatMetric(run.summary.faithfulnessRate, run.summary.faithfulnessTotal)} />
            <SummaryStat label="来源" value={formatMetric(run.summary.sourceHitRate, run.summary.sourceHitTotal)} />
          </div>
        </div>
      </section>

      {run.status === "running" && run.progress.currentCaseId && (
        <div className="inline-flex items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
          <Loader2 className="size-4 animate-spin" />
          {run.progress.currentCaseId}
        </div>
      )}
      {run.errors.map((error) => (
        <div key={error} className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ))}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
          <div className="text-sm font-semibold text-slate-950">
            评测明细 <span className="font-normal text-slate-500">{filteredRows.length}/{rows.length}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700"
            >
              <option value="issues">只看问题</option>
              <option value="all">全部结果</option>
              <option value="correct">正确</option>
              <option value="missing">缺失</option>
              <option value="incorrect">错误</option>
              <option value="failed">失败</option>
            </select>
            <select
              value={answerFilter}
              onChange={(event) => setAnswerFilter(event.target.value as AnswerFilter)}
              className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700"
            >
              <option value="all">全部题型</option>
              <option value="answerable">可回答</option>
              <option value="abstain">拒答</option>
            </select>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700"
            >
              <option value="all">全部类型</option>
              {types.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {filteredRows.map(({ item, verdict }) => (
            <AgentCaseDetail key={item.caseId} item={item} verdict={verdict} />
          ))}
          {!filteredRows.length && (
            <div className="px-4 py-10 text-center text-sm text-slate-500">暂无问题 Case</div>
          )}
        </div>
      </section>
    </div>
  );
}

function AgentCaseDetail({ item, verdict }: { item: AgentEvaluationCaseResult; verdict: CaseVerdict }) {
  const matchedSourceCount = item.matchedSources.filter((source) => source.sourceId).length;
  return (
    <details className="group" open={verdict !== "correct"}>
      <summary className="grid cursor-pointer list-none gap-2 px-4 py-3 md:grid-cols-[76px_minmax(0,1fr)_132px]">
        <VerdictBadge verdict={verdict} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-900">
            {item.caseId} · {item.question}
          </span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">
            {item.answerable ? "可回答" : "拒答"} · {item.evaluationType || "general"}
          </span>
        </span>
        <span className="whitespace-nowrap text-right text-xs text-slate-500">
          {matchedSourceCount}/{item.matchedSources.length} · {item.metrics.rounds}轮 · {item.metrics.totalTokens}t
        </span>
      </summary>

      <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
        <div className="flex flex-wrap gap-2">
          <MetricBadge label="回答" result={item.answerCorrectness} />
          <MetricBadge label="忠实" result={item.faithfulness} />
          <MetricBadge label="拒答" result={item.abstainCorrectness} />
          <span className="inline-flex h-6 items-center rounded-full border border-slate-200 bg-white px-2 text-xs text-slate-600">
            来源命中 {item.sourceHit === null ? "-" : item.sourceHit ? "是" : "否"}
          </span>
        </div>
        <MetricReasons item={item} />

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <AnswerText
            label="预期答案"
            value={item.answerable ? item.expectedAnswer || "旧结果未记录预期答案" : "应拒绝回答"}
          />
          <AnswerText label="Agent 答案" value={item.answerMarkdown || "未生成答案"} />
        </div>

        {item.facts.length > 0 && (
          <div className="mt-3 divide-y divide-slate-200 border-t border-slate-200">
            {item.facts.map((fact) => {
              const config = factStatusConfig[fact.status];
              return (
                <div key={fact.id} className="grid gap-2 py-3 md:grid-cols-[76px_minmax(0,1fr)]">
                  <span className={`inline-flex h-6 w-[64px] items-center justify-center gap-1 rounded-full border text-xs font-medium ${config.cls}`}>
                    <config.Icon className="size-3.5" />
                    {config.label}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium leading-5 text-slate-900">{fact.fact}</div>
                    {fact.evidence && <div className="mt-1 text-xs leading-5 text-slate-700">{fact.evidence}</div>}
                    {fact.evidencePath && <div className="mt-1 truncate font-mono text-xs text-indigo-700">{fact.evidencePath}</div>}
                    {fact.reason && <div className="mt-1 text-xs leading-5 text-slate-500">{fact.reason}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>读取 {item.metrics.readPages}p</span>
          <span>保留 {item.metrics.keptPages}p</span>
          <span>原文 {item.metrics.rawSources}</span>
          <span>模型调用 {item.metrics.modelCalls}</span>
          {item.metrics.stopReason && <span>{item.metrics.stopReason}</span>}
          {item.agentRunId && (
            <a href={`/agents?agentType=llmWiki&runId=${item.agentRunId}`} className="font-medium text-indigo-700 hover:text-indigo-900">
              执行记录
            </a>
          )}
        </div>
        {item.error && <div className="mt-2 text-sm text-rose-700">{item.error}</div>}
      </div>
    </details>
  );
}

function caseVerdict(item: AgentEvaluationCaseResult): CaseVerdict {
  if (item.status !== "success" && item.status !== "source_missing") return "failed";
  if (item.status === "source_missing") return "missing";
  if (item.sourceHit === false) return "incorrect";
  if (item.facts.some((fact) => fact.status === "incorrect")) return "incorrect";
  if ([item.faithfulness, item.answerCorrectness, item.abstainCorrectness].some((metric) => metric.status === "incorrect")) {
    return "incorrect";
  }
  if (item.facts.some((fact) => fact.status === "missing")) return "missing";
  return "correct";
}

function VerdictBadge({ verdict }: { verdict: CaseVerdict }) {
  const config = verdictConfig[verdict];
  return (
    <span className={`inline-flex h-6 w-[64px] shrink-0 items-center justify-center gap-1 rounded-full border text-xs font-medium ${config.cls}`}>
      <config.Icon className="size-3.5" />
      {config.label}
    </span>
  );
}

function MetricBadge({ label, result }: { label: string; result: AgentEvaluationMetricResult }) {
  const cls = result.status === "correct"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : result.status === "incorrect"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : "border-slate-200 bg-white text-slate-500";
  const text = result.status === "correct" ? "正确" : result.status === "incorrect" ? "错误" : "不适用";
  return (
    <span className={`inline-flex h-6 items-center rounded-full border px-2 text-xs ${cls}`} title={result.reason || undefined}>
      {label} {text}
    </span>
  );
}

function MetricReasons({ item }: { item: AgentEvaluationCaseResult }) {
  const reasons = [
    ["回答", item.answerCorrectness],
    ["忠实", item.faithfulness],
    ["拒答", item.abstainCorrectness],
  ].filter((entry): entry is [string, AgentEvaluationMetricResult] => {
    const result = entry[1] as AgentEvaluationMetricResult;
    return result.status !== "not_applicable" && Boolean(result.reason);
  });
  if (!reasons.length) return null;
  return (
    <div className="mt-2 space-y-1 text-xs leading-5 text-slate-600">
      {reasons.map(([label, result]) => (
        <div key={label}>{label}：{result.reason}</div>
      ))}
    </div>
  );
}

function AnswerText({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-sans text-xs leading-5 text-slate-800">{value}</pre>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[68px] rounded-md bg-slate-50 px-2.5 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-950">{value}</div>
    </div>
  );
}

function passLevelClass(level: AgentEvaluationPassLevel): string {
  if (level === "excellent") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (level === "pass") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  if (level === "needs_improvement") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function passLevelFor(score: number): AgentEvaluationPassLevel {
  if (score >= 90) return "excellent";
  if (score >= 80) return "pass";
  if (score >= 60) return "needs_improvement";
  return "failed";
}

function formatMetric(value: number, total: number): string {
  return total ? formatPercent(value) : "-";
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
