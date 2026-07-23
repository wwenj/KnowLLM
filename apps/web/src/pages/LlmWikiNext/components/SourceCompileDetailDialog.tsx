import {
  AlertTriangle,
  Clock3,
  FileOutput,
  Loader2,
  RefreshCw,
} from "lucide-react";
import type {
  CompileDebugText,
  CompileReportCall,
  CompileReportStage,
  SourceCompileReport,
  SourceRecord,
  SourceStatus,
} from "@/api/llmWikiNext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface SourceCompileDetailDialogProps {
  open: boolean;
  source: SourceRecord | null;
  report: SourceCompileReport | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
  onOpenPage: (pageKey: string) => void;
}

const statusMeta: Record<
  SourceStatus,
  { label: string; className: string }
> = {
  pending: { label: "待编译", className: "border-amber-200 bg-amber-50 text-amber-800" },
  compiling: { label: "编译中", className: "border-indigo-200 bg-indigo-50 text-indigo-700" },
  staged: { label: "已暂存", className: "border-sky-200 bg-sky-50 text-sky-700" },
  published: { label: "已发布", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  failed: { label: "失败", className: "border-rose-200 bg-rose-50 text-rose-700" },
};

const stageLabel: Record<CompileReportStage, string> = {
  queued: "等待调度",
  planning: "规划中",
  writing: "写入中",
  committing: "合并中",
  finished: "已结束",
};

function formatTime(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", { hour12: false });
}

function formatDuration(value: number): string {
  if (!value) return "—";
  if (value < 1_000) return `${value} ms`;
  const seconds = value / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${Math.floor(seconds / 60)} 分 ${(seconds % 60).toFixed(1)} 秒`;
}

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

function DebugText({ title, value }: { title: string; value: CompileDebugText | null }) {
  if (!value) return null;
  return (
    <details className="border-t border-slate-100 py-2 text-xs">
      <summary className="cursor-pointer text-slate-600 hover:text-slate-950">
        {title} · {formatNumber(value.charCount)} 字符 · {value.truncated ? "已截断" : "完整"}
      </summary>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">
        {value.text}
      </pre>
      <p className="mt-1 font-mono text-[10px] text-slate-400">SHA-256: {value.contentHash}</p>
    </details>
  );
}

function CallDetail({ call }: { call: CompileReportCall }) {
  const failed = call.status === "failed" || call.validation.status === "failed";
  return (
    <details className="border-b border-slate-100 last:border-b-0">
      <summary className="grid cursor-pointer grid-cols-[84px_minmax(0,1fr)_80px_92px] items-center gap-3 px-3 py-2.5 text-xs hover:bg-slate-50">
        <span className="font-medium text-slate-700">{call.stage === "planner" ? "Planner" : "Writer"}</span>
        <span className="min-w-0 truncate font-mono text-slate-500" title={call.unitId}>{call.unitId}</span>
        <span className={cn("text-right", failed ? "text-rose-700" : call.status === "succeeded" ? "text-emerald-700" : "text-slate-600")}>
          {failed ? "失败" : call.status === "succeeded" ? "成功" : call.status === "cancelled" ? "取消" : "进行中"}
        </span>
        <span className="text-right tabular-nums text-slate-500">{formatDuration(call.durationMs)}</span>
      </summary>
      <div className="grid gap-2 border-t border-slate-100 bg-slate-50/70 px-3 py-3 text-xs text-slate-600 sm:grid-cols-2">
        <p>模型：<span className="font-mono text-slate-800">{call.model}</span></p>
        <p>输出上限：{formatNumber(call.maxOutputTokens)} tokens</p>
        <p>输入 / 输出：{formatNumber(call.usage.inputTokens)} / {formatNumber(call.usage.outputTokens)} tokens（{call.usage.usageSource === "provider" ? "Provider 实际值" : "估算"}）</p>
        <p>开始：{formatTime(call.startedAt)}</p>
        {call.responseId && <p>响应 ID：<span className="font-mono text-slate-800">{call.responseId}</span></p>}
        {call.finishReason && <p>结束原因：{call.finishReason}</p>}
        {(call.error || call.validation.error) && (
          <p className="sm:col-span-2 text-rose-700">
            {call.error?.message || call.validation.error?.message}
          </p>
        )}
        <div className="sm:col-span-2">
          <DebugText title="System Prompt" value={call.request.systemPrompt} />
          <DebugText title="请求 Payload" value={call.request.payload} />
          <DebugText title="模型原始响应" value={call.response} />
        </div>
      </div>
    </details>
  );
}

export function SourceCompileDetailDialog({
  open,
  source,
  report,
  loading,
  onOpenChange,
  onRefresh,
  onOpenPage,
}: SourceCompileDetailDialogProps) {
  const events = [...(report?.events || [])].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at) || a.sequence - b.sequence,
  );
  const calls = [...(report?.calls || [])].sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
  );
  const status = source ? statusMeta[source.status] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[min(92vw,1120px)] max-w-[1120px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1120px]">
        <DialogHeader className="flex-none border-b border-slate-200 bg-slate-50/80 px-5 py-4 text-left">
          <div className="flex min-w-0 items-start gap-3">
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-base">编译详情：{source?.filename || "Source"}</DialogTitle>
              <DialogDescription className="mt-1 font-mono text-[11px]">{source?.sourceId || ""}</DialogDescription>
            </div>
            {status && (
              <span
                className={cn(
                  "shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium",
                  status.className,
                )}
              >
                {status.label}
              </span>
            )}
            <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
              <RefreshCw className={loading ? "animate-spin" : ""} />
              刷新
            </Button>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto bg-white">
          {loading && !report ? (
            <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="size-4 animate-spin" /> 正在读取编译报告
            </div>
          ) : !report ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
              <Clock3 className="size-7 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-700">暂无编译记录</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">该 Source 尚未进入编译队列，或编译发生在详情报告功能启用之前。</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              <section className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("inline-flex rounded-md border px-2 py-0.5 text-xs font-medium", status?.className)}>{status?.label}</span>
                  {report.legacy && <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">旧任务汇总</span>}
                  <span className="text-xs text-slate-500">执行阶段：{stageLabel[report.stage]}</span>
                  <span className="font-mono text-[11px] text-slate-400">run {report.runId}</span>
                </div>
                {report.error && (
                  <div className="mt-3 flex items-start gap-2 border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span><strong>{report.error.stage}</strong> · {report.error.message}</span>
                  </div>
                )}
                <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-4">
                  <div><dt className="text-slate-500">模型</dt><dd className="mt-1 truncate font-medium text-slate-800" title={report.model.id}>{report.model.providerName} / {report.model.name}</dd></div>
                  <div><dt className="text-slate-500">执行耗时</dt><dd className="mt-1 font-medium tabular-nums text-slate-800">{formatDuration(report.durationMs)}</dd></div>
                  <div><dt className="text-slate-500">Compile Unit</dt><dd className="mt-1 font-medium tabular-nums text-slate-800">{report.summary.compileUnitCount}</dd></div>
                  <div><dt className="text-slate-500">模型调用</dt><dd className="mt-1 font-medium tabular-nums text-slate-800">{report.summary.modelCalls}（成功 {report.summary.succeededCalls} / 异常 {report.summary.failedCalls}）</dd></div>
                  <div><dt className="text-slate-500">Input / Output</dt><dd className="mt-1 font-medium tabular-nums text-slate-800">{formatNumber(report.summary.inputTokens)} / {formatNumber(report.summary.outputTokens)}</dd></div>
                  <div><dt className="text-slate-500">产出页面</dt><dd className="mt-1 font-medium tabular-nums text-slate-800">{report.summary.pageKeys.length}</dd></div>
                  <div><dt className="text-slate-500">Facts</dt><dd className="mt-1 font-medium tabular-nums text-slate-800">{report.summary.factCount}</dd></div>
                  <div><dt className="text-slate-500">更新于</dt><dd className="mt-1 text-slate-800">{formatTime(report.updatedAt)}</dd></div>
                </dl>
              </section>

              <section className="px-5 py-4">
                <h3 className="text-sm font-semibold text-slate-900">执行时间线</h3>
                <ol className="mt-3 space-y-2 border-l border-slate-200 pl-4 text-xs">
                  {events.map((event) => (
                    <li key={`${event.sequence}-${event.type}`} className="relative text-slate-600">
                      <span className="absolute -left-[21px] top-1.5 size-2 rounded-full border border-slate-300 bg-white" />
                      <span className="mr-2 tabular-nums text-slate-400">{formatTime(event.at)}</span>
                      <span>{event.message}</span>
                      {event.unitId && <span className="ml-2 font-mono text-[10px] text-slate-400">{event.unitId}</span>}
                    </li>
                  ))}
                </ol>
              </section>

              <section className="px-5 py-4">
                <h3 className="text-sm font-semibold text-slate-900">Compile Units 与产物</h3>
                <div className="mt-3 space-y-2">
                  {report.units.map((unit) => (
                    <details key={unit.unitId} className="rounded-md border border-slate-200 bg-white">
                      <summary className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-xs hover:bg-slate-50">
                        <span className="font-medium text-slate-800">Unit {unit.index}</span>
                        <span className="text-slate-500">第 {unit.startLine}–{unit.endLine} 行 · {formatNumber(unit.charCount)} 字符</span>
                        <span className="ml-auto text-slate-500">{unit.plan?.pages.length || 0} 个 Plan 页面 / {unit.writerPages.length} 个 Writer 页面</span>
                      </summary>
                      <div className="space-y-3 border-t border-slate-100 bg-slate-50/60 p-3 text-xs">
                        {unit.error && <p className="text-rose-700">{unit.error.stage} · {unit.error.message}</p>}
                        {unit.plan && (
                          <div>
                            <p className="font-medium text-slate-700">Planner：{unit.plan.partitionIntent}</p>
                            <ul className="mt-1 space-y-1 text-slate-600">
                              {unit.plan.pages.map((page) => <li key={page.pageKey}><button type="button" className="font-mono text-slate-500 hover:text-slate-950 hover:underline" onClick={() => onOpenPage(page.pageKey)}>{page.pageKey}</button> · {page.operation === "create" ? "新建" : "更新"} · {page.title}</li>)}
                            </ul>
                          </div>
                        )}
                        {unit.writerPages.length > 0 && (
                          <div>
                            <p className="font-medium text-slate-700">Writer 产物</p>
                            <ul className="mt-1 space-y-1 text-slate-600">
                              {unit.writerPages.map((page) => <li key={page.pageKey}><button type="button" className="font-mono text-slate-500 hover:text-slate-950 hover:underline" onClick={() => onOpenPage(page.pageKey)}>{page.pageKey}</button> · {formatNumber(page.bodyCharCount)} 字符 · {page.keyFacts.length} Facts</li>)}
                            </ul>
                          </div>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              </section>

              <section className="px-5 py-4">
                <h3 className="text-sm font-semibold text-slate-900">模型调用</h3>
                <div className="mt-3 overflow-hidden rounded-md border border-slate-200">
                  {calls.length ? calls.map((call) => <CallDetail key={call.callId} call={call} />) : <p className="px-3 py-8 text-center text-xs text-slate-400">暂无可用模型调用明细</p>}
                </div>
              </section>

              <section className="px-5 py-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><FileOutput className="size-4 text-slate-500" />最终产出</h3>
                {report.summary.pageKeys.length ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {report.summary.pageKeys.map((pageKey) => <button key={pageKey} type="button" className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700 hover:border-slate-400 hover:bg-white" onClick={() => onOpenPage(pageKey)}>{pageKey}</button>)}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-slate-500">本次没有可提交的页面产物。</p>
                )}
              </section>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
