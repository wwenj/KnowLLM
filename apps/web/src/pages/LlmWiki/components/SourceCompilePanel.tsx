import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  FileText,
  Loader2,
  Play,
  RefreshCw,
} from "lucide-react";
import type {
  LlmWikiIngestJobEvent,
  LlmWikiIngestJobReport,
  LlmWikiPageRef,
  LlmWikiPublishGateIssue,
  LlmWikiSource,
  LlmWikiSourceArtifacts,
} from "@/api/llmWiki";
import { Button } from "@/components/ui/button";
import { ingestStageLabels, pageTypeLabels, wikiStatusLabels } from "../constants";
import { formatBytes, formatPercent, formatTime, jobStatusClass, wikiStatusClass } from "../utils";

interface SourceCompilePanelProps {
  source: LlmWikiSource | null;
  artifacts: LlmWikiSourceArtifacts | null;
  loading: boolean;
  onIngest: (source: LlmWikiSource) => void;
  onReanalyze: (source: LlmWikiSource) => void;
  onStopIngest: (source: LlmWikiSource) => void;
  onOpenRaw: (source: LlmWikiSource) => void;
  onOpenPage: (path: string) => void;
  onRefresh: () => void;
}

const pipelineStages = ["queued", "analyze", "analysis_ready", "compose", "published"];

export function SourceCompilePanel({
  source,
  artifacts,
  loading,
  onIngest,
  onReanalyze,
  onStopIngest,
  onOpenRaw,
  onOpenPage,
  onRefresh,
}: SourceCompilePanelProps) {
  if (!source) {
    return (
      <div className="flex min-h-0 flex-col bg-slate-50/70 p-4">
        <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white text-sm text-slate-400">
          选择文档
        </div>
      </div>
    );
  }

  const effectiveArtifacts = artifacts?.source.source_id === source.source_id ? artifacts : null;
  const current = effectiveArtifacts?.source || source;
  const compile = current.compile || source.compile;
  const pages = effectiveArtifacts?.pages || [];
  const groupedPages = groupPages(pages);
  const issueCount = (compile?.blockedIssues || 0) + (compile?.humanReviewIssues || 0);
  const latestJob = effectiveArtifacts?.latestJob || null;
  const compiling = current.status === "compile_planned" || current.status === "ingesting";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50/70">
      <div className="flex flex-none items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-950" title={current.filename}>
            {current.filename}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className={`inline-flex items-center rounded-md border px-2 py-0.5 ${wikiStatusClass(current.status)}`}>
              {wikiStatusLabels[current.status]}
            </span>
            <span className="text-slate-400">{formatBytes(current.size)}</span>
          </div>
        </div>
        <Button size="icon" variant="outline" title="刷新详情" aria-label="刷新详情" onClick={onRefresh}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        <section className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase text-slate-500">Compile</div>
            {compile?.latestJobStatus && (
              <span className={`rounded-md border px-2 py-0.5 text-xs ${jobStatusClass(compile.latestJobStatus)}`}>
                {compile.latestJobStatus}
              </span>
            )}
          </div>
          <div className="space-y-2 text-xs text-slate-600">
            <InfoRow label="model" value={compile?.model || "-"} mono />
            <InfoRow
              label="stage"
              value={
                compile?.latestStage
                  ? ingestStageLabels[compile.latestStage] || compile.latestStage
                  : "-"
              }
            />
            <InfoRow label="started" value={formatTime(compile?.startedAt) || "-"} />
            <InfoRow label="ended" value={formatTime(compile?.endedAt) || "-"} />
          </div>
          <div className="mt-3 grid grid-cols-5 gap-1">
            {pipelineStages.map((stage) => (
              <div
                key={stage}
                className={[
                  "h-1.5 rounded-full",
                  stageReached(compile?.latestStage, stage, compile?.latestJobStatus)
                    ? "bg-indigo-500"
                    : "bg-slate-200",
                ].join(" ")}
                title={ingestStageLabels[stage] || stage}
              />
            ))}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-2">
          <Metric label="pages" value={compile?.pageCount ?? pages.length} />
          <Metric label="key claims" value={effectiveArtifacts?.latestCandidate?.claims.length ?? compile?.factCount ?? 0} />
          <Metric label="linked pages" value={compile?.pageClaimCount ?? effectiveArtifacts?.pageClaims.length ?? 0} />
          <Metric label="must" value={formatPercent(compile?.mustCoverage)} />
        </section>

        {effectiveArtifacts?.analysis && (
          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Analysis</div>
            <div className="space-y-2 text-xs text-slate-600">
              <InfoRow label="hash" value={effectiveArtifacts.analysis.analysisHash} mono />
              <InfoRow label="facts/pages" value={`${effectiveArtifacts.analysis.factCount} / ${effectiveArtifacts.analysis.pageCount}`} />
              <InfoRow label="calls" value={`${effectiveArtifacts.analysis.usage.modelCalls}（retry ${effectiveArtifacts.analysis.usage.retries}）`} />
              <InfoRow
                label="tokens"
                value={String(effectiveArtifacts.analysis.usage.inputTokens + effectiveArtifacts.analysis.usage.outputTokens)}
              />
            </div>
          </section>
        )}

        {!!issueCount && (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="size-4" />
              {issueCount} issue
            </div>
            <div className="mt-1 text-amber-700">
              blocked {compile?.blockedIssues || 0} / review {compile?.humanReviewIssues || 0}
            </div>
          </section>
        )}

        <section className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase text-slate-500">Pages</div>
            <span className="text-xs text-slate-400">{pages.length}</span>
          </div>
          {Object.entries(groupedPages).length ? (
            <div className="space-y-3">
              {Object.entries(groupedPages).map(([type, items]) => (
                <div key={type}>
                  <div className="mb-1 text-xs font-medium text-slate-500">
                    {pageTypeLabels[type as keyof typeof pageTypeLabels] || type}
                  </div>
                  <div className="space-y-1">
                    {items.map((page) => {
                      const claim = effectiveArtifacts?.pageClaims.find((item) => item.path === page.path);
                      return (
                        <button
                          key={page.path}
                          className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-50"
                          onClick={() => onOpenPage(page.path)}
                        >
                          <FileText className="mt-0.5 size-3.5 shrink-0 text-slate-400" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium text-slate-700">
                              {page.title || page.path}
                            </span>
                            <span className="block truncate font-mono text-[11px] text-slate-400">
                              {page.path}
                            </span>
                          </span>
                          {claim && (
                            <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                              {claim.factCount}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyLine text="暂无页面" />
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
            <Database className="size-3.5" />
            编译结果
          </div>
          {effectiveArtifacts?.latestCandidate ? (
            <div className="space-y-2">
              <InfoRow label="id" value={effectiveArtifacts.latestCandidate.candidateId} mono />
              <InfoRow
                label="status"
                value={ingestStageLabels[effectiveArtifacts.latestCandidate.status] || effectiveArtifacts.latestCandidate.status}
              />
              <InfoRow label="model calls" value={String(effectiveArtifacts.latestCandidate.modelUsage.modelCalls)} />
              <InfoRow label="cost" value={`$${effectiveArtifacts.latestCandidate.modelUsage.estimatedCostUsd.toFixed(4)}`} />
            </div>
          ) : (
            <EmptyLine text="暂无编译结果" />
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Source Map</div>
          {effectiveArtifacts?.sourceMap ? (
            <div className="space-y-2 text-xs text-slate-600">
              <InfoRow label="title" value={effectiveArtifacts.sourceMap.title || "-"} />
              <InfoRow label="sections" value={String(effectiveArtifacts.sourceMap.sectionCount)} />
              <div className="max-h-[132px] space-y-1 overflow-auto">
                {effectiveArtifacts.sourceMap.sections.slice(0, 20).map((section) => (
                  <div key={section.sectionId} className="truncate rounded bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-500">
                    {section.sectionId} · {section.headingPath.join(" / ") || section.title}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyLine text="暂无 source map" />
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
            <Clock3 className="size-3.5" />
            最新编译
          </div>
          {latestJob ? (
            <JobDetails job={latestJob} />
          ) : (
            <EmptyLine text="暂无编译记录" />
          )}
        </section>
      </div>

      <div className="flex flex-none items-center gap-2 border-t border-slate-200 bg-white p-3">
        <Button
          className="flex-1"
          variant={compiling ? "destructive" : "default"}
          onClick={() => (compiling ? onStopIngest(current) : onIngest(current))}
        >
          {compiling ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          {compiling
            ? "停止编译"
            : current.status === "analysis_ready"
              ? "生成页面"
              : current.status === "published" || current.status === "ready"
                ? "重编译"
                : "编译"}
        </Button>
        {!compiling && current.status !== "raw_uploaded" && (
          <Button variant="outline" onClick={() => onReanalyze(current)}>
            <RefreshCw className="size-4" />
            重新分析
          </Button>
        )}
        <Button variant="outline" onClick={() => onOpenRaw(current)}>
          源文
        </Button>
        {pages[0] && (
          <Button variant="outline" onClick={() => onOpenPage(pages[0].path)}>
            <CheckCircle2 className="size-4" />
            Wiki
          </Button>
        )}
      </div>
    </div>
  );
}

function JobDetails({ job }: { job: LlmWikiIngestJobReport }) {
  const issues = job.issues || [];
  const missingMust = job.coverage?.missingMustFactIds || [];
  return (
    <div className="space-y-3 text-xs">
      <div className="rounded-md bg-slate-50 px-2 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className={`rounded border px-1.5 py-0.5 ${jobStatusClass(job.status)}`}>
            {job.status}
          </span>
          <span className="truncate font-mono text-slate-500">{job.model || "-"}</span>
        </div>
        <div className="mt-2 space-y-1 text-slate-600">
          <InfoRow label="job" value={job.jobId} mono />
          <InfoRow label="stage" value={ingestStageLabels[job.stage] || job.stage || "-"} />
          <InfoRow label="started" value={formatTime(job.startedAt) || "-"} />
          <InfoRow label="ended" value={formatTime(job.endedAt) || "-"} />
          <InfoRow label="calls" value={`${job.modelCalls || 0} / ${job.maxModelCalls || "-"}`} />
          <InfoRow label="tokens" value={`${job.actualTokens || 0} / ${job.maxTokens || "-"}`} />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <MiniMetric label="key claims" value={job.factCount || 0} />
        <MiniMetric label="pages" value={job.pages?.length || 0} />
        <MiniMetric label="must" value={job.coverage?.mustTotal ? formatPercent(job.coverage.mustCoverage) : "-"} />
        <MiniMetric label="issues" value={issues.length} />
      </div>

      <JobTimeline job={job} />

      {!!job.usage?.calls.length && (
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase text-slate-400">Model calls</div>
          <div className="max-h-36 space-y-1 overflow-auto rounded-md bg-slate-50 p-2 font-mono text-[11px] text-slate-600">
            {job.usage.calls.map((call, index) => (
              <div key={`${call.stage}-${call.attempt}-${index}`} className="break-words">
                {index + 1}. {call.stage}#{call.attempt} · {call.status || "success"} · {call.inputTokens + call.outputTokens} tokens
                {call.error ? ` · ${call.error}` : ""}
              </div>
            ))}
          </div>
        </div>
      )}

      {job.error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-rose-800">
          <div className="mb-1 font-medium">失败原因</div>
          <div className="whitespace-pre-wrap break-words leading-relaxed">{job.error}</div>
        </div>
      )}

      {!!missingMust.length && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-800">
          <div className="mb-1 font-medium">未覆盖 must fact</div>
          <div className="max-h-24 space-y-1 overflow-auto font-mono text-[11px]">
            {missingMust.slice(0, 8).map((factId) => (
              <div key={factId} className="break-all">{factId}</div>
            ))}
          </div>
        </div>
      )}

      {!!issues.length && <JobIssues issues={issues} />}

      {!!job.pages?.length && (
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase text-slate-400">输出页面</div>
          <div className="max-h-28 space-y-1 overflow-auto rounded-md bg-slate-50 p-2 font-mono text-[11px] text-slate-500">
            {job.pages.slice(0, 20).map((path) => (
              <div key={path} className="truncate" title={path}>{path}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function JobTimeline({ job }: { job: LlmWikiIngestJobReport }) {
  const events = normalizeJobEvents(job);
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase text-slate-400">编译过程</div>
      <div className="space-y-1.5">
        {events.map((event, index) => (
          <div key={`${event.stage}-${event.at}-${index}`} className="flex gap-2 rounded-md bg-slate-50 px-2 py-1.5">
            <span className={`mt-0.5 size-2 rounded-full ${eventDotClass(event.status)}`} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-700">{ingestStageLabels[event.stage] || event.stage}</span>
                <span className="shrink-0 text-[11px] text-slate-400">{formatTime(event.at)}</span>
              </span>
              <span className="mt-0.5 block whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-500">
                {event.message}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function JobIssues({ issues }: { issues: LlmWikiPublishGateIssue[] }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase text-slate-400">Gate Issues</div>
      <div className="max-h-44 space-y-1.5 overflow-auto">
        {issues.slice(0, 12).map((issue, index) => (
          <div key={`${issue.target}-${issue.message}-${index}`} className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-800">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{issue.message}</span>
              <span className="shrink-0 rounded border border-amber-300 px-1.5 py-0.5 text-[11px]">{issue.kind}</span>
            </div>
            {issue.target && <div className="mt-1 break-all font-mono text-[11px] text-amber-700">{issue.target}</div>}
            {issue.details && <div className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed">{issue.details}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[74px_1fr] gap-2">
      <span className="text-slate-400">{label}</span>
      <span className={["min-w-0 truncate text-slate-700", mono ? "font-mono" : ""].join(" ")} title={value}>
        {value}
      </span>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
      <div className="text-[10px] uppercase text-slate-400">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold tabular-nums text-slate-800">{value}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] uppercase text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{value}</div>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed border-slate-200 py-4 text-center text-xs text-slate-400">{text}</div>;
}

function groupPages(pages: LlmWikiPageRef[]): Partial<Record<LlmWikiPageRef["type"], LlmWikiPageRef[]>> {
  return pages.reduce<Partial<Record<LlmWikiPageRef["type"], LlmWikiPageRef[]>>>((groups, page) => {
    const current = groups[page.type] || [];
    groups[page.type] = [...current, page];
    return groups;
  }, {});
}

function stageReached(current = "", stage: string, status?: string): boolean {
  if (status === "success" && current === "published") return true;
  const normalizedCurrent = current === "candidate_ready" || current === "needs_review"
    ? "compose"
    : current === "compiling"
      ? "analyze"
      : current;
  const currentIndex = pipelineStages.indexOf(normalizedCurrent);
  const stageIndex = pipelineStages.indexOf(stage);
  return currentIndex >= 0 && stageIndex >= 0 && stageIndex <= currentIndex;
}

function normalizeJobEvents(job: LlmWikiIngestJobReport): LlmWikiIngestJobEvent[] {
  if (job.events?.length) return job.events;
  const status = job.status === "failed" ? "failed" : job.status === "success" ? "success" : "running";
  return [
    {
      stage: job.stage || "queued",
      status,
      message: job.error || `当前阶段：${ingestStageLabels[job.stage] || job.stage || "排队"}`,
      at: job.endedAt || job.startedAt,
    },
  ];
}

function eventDotClass(status: LlmWikiIngestJobEvent["status"]): string {
  if (status === "success") return "bg-emerald-500";
  if (status === "failed") return "bg-rose-500";
  if (status === "running") return "bg-indigo-500";
  return "bg-slate-300";
}
