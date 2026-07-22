import { Fragment, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Eye,
  FileText,
  Loader2,
  Play,
  Search,
  Settings2,
  Square,
  X,
} from "lucide-react";
import { modelOptionLabel, type ModelOption } from "@/api/model";
import type {
  CompileEstimate,
  CompileJob,
  CompileSourceState,
  ManifestPage,
  SourceRecord,
  StagingSummary,
} from "@/api/llmWikiNext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type SourceVisualStatus =
  | "pending"
  | "planning"
  | "writing"
  | "completed"
  | "failed"
  | "cancelled"
  | "published"
  | "uploaded";

export interface CompileSettings {
  chunkChars: number;
  plannerMaxOutputTokens: number;
  writerMaxOutputTokens: number;
}

interface SourceWorkspaceProps {
  sources: SourceRecord[];
  staging: StagingSummary | null;
  publishedPages: ManifestPage[];
  job: CompileJob | null;
  estimate: CompileEstimate | null;
  models: ModelOption[];
  model: string;
  sourceConcurrency: number;
  settings: CompileSettings;
  estimating: boolean;
  startingCompile: boolean;
  operationsLocked: boolean;
  cancelling: boolean;
  onModelChange: (model: string) => void;
  onSourceConcurrencyChange: (value: string) => void;
  onSettingsChange: (next: Partial<CompileSettings>) => void;
  onEstimate: (sourceIds: string[]) => void;
  onConfirmCompile: () => void;
  onClearEstimate: () => void;
  onCancelJob: () => void;
  onOpenSource: (sourceId: string) => void;
}

const PAGE_SIZE = 12;
const CONCURRENCY_OPTIONS = [1, 2, 4, 8, 16] as const;

const statusMeta: Record<
  SourceVisualStatus,
  { label: string; className: string }
> = {
  pending: {
    label: "等待",
    className: "border-slate-200 bg-slate-50 text-slate-600",
  },
  planning: {
    label: "规划中",
    className: "border-violet-200 bg-violet-50 text-violet-700",
  },
  writing: {
    label: "写入中",
    className: "border-indigo-200 bg-indigo-50 text-indigo-700",
  },
  completed: {
    label: "已暂存",
    className: "border-sky-200 bg-sky-50 text-sky-700",
  },
  failed: {
    label: "失败",
    className: "border-rose-200 bg-rose-50 text-rose-700",
  },
  cancelled: {
    label: "已取消",
    className: "border-slate-200 bg-slate-100 text-slate-600",
  },
  published: {
    label: "已发布",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  uploaded: {
    label: "待编译",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
};

function isActiveJob(job: CompileJob | null): boolean {
  return job?.status === "queued" || job?.status === "running";
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", { hour12: false });
}

function formatChars(value: number): string {
  return value >= 10_000
    ? `${(value / 10_000).toFixed(value % 10_000 ? 1 : 0)} 万字`
    : `${value.toLocaleString()} 字`;
}

function sourceState(
  source: SourceRecord,
  job: CompileJob | null,
  staging: StagingSummary | null,
  publishedPages: ManifestPage[],
): { status: SourceVisualStatus; jobState?: CompileSourceState } {
  const jobState = job?.sources.find(
    (item) => item.sourceId === source.sourceId,
  );
  // 运行中优先展示真实进度；完成 Source 的最终状态始终由共享 Staging / Published 派生。
  if (
    jobState &&
    (isActiveJob(job) ||
      jobState.status === "failed" ||
      jobState.status === "cancelled")
  ) {
    return { status: jobState.status, jobState };
  }
  if (staging?.state.completedSourceIds.includes(source.sourceId))
    return { status: "completed" };
  if (publishedPages.some((page) => page.sourceIds.includes(source.sourceId)))
    return { status: "published" };
  return { status: "uploaded" };
}

function pageCountFor(
  sourceId: string,
  staging: StagingSummary | null,
  publishedPages: ManifestPage[],
): number {
  const pages = staging?.pages ?? publishedPages;
  return pages.filter((page) => page.sourceIds.includes(sourceId)).length;
}

export function SourceWorkspace({
  sources,
  staging,
  publishedPages,
  job,
  estimate,
  models,
  model,
  sourceConcurrency,
  settings,
  estimating,
  startingCompile,
  operationsLocked,
  cancelling,
  onModelChange,
  onSourceConcurrencyChange,
  onSettingsChange,
  onEstimate,
  onConfirmCompile,
  onClearEstimate,
  onCancelJob,
  onOpenSource,
}: SourceWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SourceVisualStatus>(
    "all",
  );
  const [page, setPage] = useState(1);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(
    new Set(),
  );

  const running = isActiveJob(job);
  const controlsLocked = running || operationsLocked;
  const sourceRows = useMemo(
    () =>
      sources.map((source) => ({
        source,
        ...sourceState(source, job, staging, publishedPages),
      })),
    [job, publishedPages, sources, staging],
  );
  const sourceNames = useMemo(
    () => new Map(sources.map((source) => [source.sourceId, source.filename])),
    [sources],
  );
  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return sourceRows.filter((row) => {
      const queryMatched =
        !normalizedQuery ||
        row.source.filename.toLocaleLowerCase().includes(normalizedQuery);
      return (
        queryMatched && (statusFilter === "all" || row.status === statusFilter)
      );
    });
  }, [query, sourceRows, statusFilter]);
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE)),
  );
  const pageRows = filteredRows.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const selectableRows = pageRows.filter(
    (row) => row.status !== "completed" && !controlsLocked,
  );
  const allPageSelected =
    selectableRows.length > 0 &&
    selectableRows.every((row) => selectedSourceIds.has(row.source.sourceId));
  const somePageSelected = selectableRows.some((row) =>
    selectedSourceIds.has(row.source.sourceId),
  );
  const unitGroups = useMemo(() => {
    if (!estimate) return [];
    return estimate.sourceIds.map((sourceId) => ({
      sourceId,
      filename: sourceNames.get(sourceId) || sourceId,
      units: estimate.units.filter((unit) => unit.sourceId === sourceId),
    }));
  }, [estimate, sourceNames]);

  const toggleSource = (sourceId: string, checked: boolean) => {
    onClearEstimate();
    setSelectedSourceIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(sourceId);
      else next.delete(sourceId);
      return next;
    });
  };

  const togglePage = (checked: boolean) => {
    onClearEstimate();
    setSelectedSourceIds((previous) => {
      const next = new Set(previous);
      selectableRows.forEach((row) => {
        if (checked) next.add(row.source.sourceId);
        else next.delete(row.source.sourceId);
      });
      return next;
    });
  };

  const enableSelection = () => {
    onClearEstimate();
    setSelectionMode((value) => !value);
    if (selectionMode) setSelectedSourceIds(new Set());
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="flex flex-none flex-col gap-2 border-b border-slate-200 bg-slate-50/70 px-3 py-2.5">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-medium text-slate-600 sm:max-w-md">
            编译模型
            <Select
              value={model}
              onValueChange={onModelChange}
              disabled={!models.length || controlsLocked}
            >
              <SelectTrigger className="h-8 bg-white text-xs">
                <SelectValue
                  placeholder={models.length ? "选择模型" : "无可用模型"}
                />
              </SelectTrigger>
              <SelectContent>
                {models.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {modelOptionLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Source 并发
            <Select
              value={String(sourceConcurrency)}
              onValueChange={onSourceConcurrencyChange}
              disabled={controlsLocked}
            >
              <SelectTrigger
                size="sm"
                className="min-w-[90px] bg-white text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONCURRENCY_OPTIONS.map((item) => (
                  <SelectItem key={item} value={String(item)}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <details className="relative min-w-[220px] self-end text-xs">
            <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-slate-200 px-2.5 font-medium text-slate-600 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
              <Settings2 className="size-3.5" />
              高级编译设置
            </summary>
            <div className="absolute z-20 mt-1 grid w-[min(92vw,520px)] grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-lg sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-slate-600">
                物理切片字符数
                <Input
                  type="number"
                  min={1_000}
                  max={60_000}
                  value={settings.chunkChars}
                  disabled={controlsLocked}
                  onChange={(event) =>
                    onSettingsChange({ chunkChars: Number(event.target.value) })
                  }
                  className="h-8 bg-white text-xs"
                />
              </label>
              <label className="flex flex-col gap-1 text-slate-600">
                Planner 输出 tokens
                <Input
                  type="number"
                  min={256}
                  max={16_000}
                  value={settings.plannerMaxOutputTokens}
                  disabled={controlsLocked}
                  onChange={(event) =>
                    onSettingsChange({
                      plannerMaxOutputTokens: Number(event.target.value),
                    })
                  }
                  className="h-8 bg-white text-xs"
                />
              </label>
              <label className="flex flex-col gap-1 text-slate-600">
                Writer 输出 tokens
                <Input
                  type="number"
                  min={256}
                  max={32_000}
                  value={settings.writerMaxOutputTokens}
                  disabled={controlsLocked}
                  onChange={(event) =>
                    onSettingsChange({
                      writerMaxOutputTokens: Number(event.target.value),
                    })
                  }
                  className="h-8 bg-white text-xs"
                />
              </label>
              <p className="col-span-full text-[11px] leading-4 text-slate-500">
                页面预算由服务端按每个 Unit 内容动态计算；一个 Unit
                只会执行一次统一 Writer。
              </p>
            </div>
          </details>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <div className="relative w-full min-w-[190px] max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="搜索文档名"
                className="h-8 bg-white pl-8 text-sm"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value as typeof statusFilter);
                setPage(1);
              }}
            >
              <SelectTrigger
                size="sm"
                className="min-w-[104px] bg-white text-xs"
              >
                <SelectValue placeholder="状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                {Object.entries(statusMeta).map(([value, meta]) => (
                  <SelectItem key={value} value={value}>
                    {meta.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs tabular-nums text-slate-500">
              {filteredRows.length} 个文档
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant={selectionMode ? "secondary" : "outline"}
              onClick={enableSelection}
              disabled={controlsLocked}
            >
              {selectionMode ? <X /> : <Check />}
              {selectionMode ? "退出多选" : "多选"}
            </Button>
            {selectionMode && (
              <Button
                size="sm"
                variant="ghost"
                disabled={!selectedSourceIds.size}
                onClick={() => {
                  onClearEstimate();
                  setSelectedSourceIds(new Set());
                }}
              >
                清空选择
              </Button>
            )}
            {selectionMode && (
              <Button
                size="sm"
                disabled={
                  !selectedSourceIds.size ||
                  controlsLocked ||
                  estimating ||
                  startingCompile
                }
                onClick={() => onEstimate([...selectedSourceIds])}
              >
                <Play />
                编译选中项{" "}
                {selectedSourceIds.size ? `(${selectedSourceIds.size})` : ""}
              </Button>
            )}
          </div>
        </div>

        {estimate && (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50/70 px-3 py-2 text-xs text-indigo-950">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <span className="font-semibold">确认本次编译</span>
              <span>
                {estimate.sourceCount} 个 Source · {estimate.compileUnitCount}{" "}
                个 Unit
              </span>
              <span>动态页面预算 {estimate.maxPlannedPages}</span>
              <span>Planner {estimate.maxPlannerCalls} 次</span>
              <span>统一 Writer {estimate.maxWriterCalls} 次</span>
              <span>模型调用最多 {estimate.maxModelCalls} 次</span>
              <span>
                输出上限 {estimate.maxOutputTokens.toLocaleString()} tokens
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={onClearEstimate}
                  disabled={startingCompile}
                >
                  取消
                </Button>
                <Button
                  size="xs"
                  onClick={onConfirmCompile}
                  disabled={startingCompile}
                >
                  {startingCompile && <Loader2 className="animate-spin" />}
                  确认编译
                </Button>
              </div>
            </div>
            <details className="mt-2 border-t border-indigo-200/80 pt-2">
              <summary className="cursor-pointer font-medium text-indigo-800">
                查看 Unit 与页面预算
              </summary>
              <div className="mt-2 space-y-2 text-indigo-950">
                {unitGroups.map((group) => (
                  <div
                    key={group.sourceId}
                    className="rounded-md border border-indigo-100 bg-white/65 px-2.5 py-2"
                  >
                    <p className="truncate font-medium" title={group.filename}>
                      {group.filename} · {group.units.length} 个 Unit
                    </p>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-indigo-800">
                      {group.units.map((unit, index) => (
                        <span key={unit.unitId}>
                          #{index + 1} · {formatChars(unit.charCount)} ·
                          页面预算 {unit.maxPages}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}

        {running && job && (
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-semibold">编译进行中</span>
              <span>
                模型调用 {job.modelCalls} / {job.estimate.maxModelCalls}
              </span>
              <span>
                {
                  job.sources.filter((source) => source.status === "completed")
                    .length
                }{" "}
                / {job.sources.length} 个 Source 已完成
              </span>
              <Button
                size="xs"
                variant="destructive"
                className="ml-auto"
                onClick={onCancelJob}
                disabled={cancelling}
              >
                {cancelling ? <Loader2 className="animate-spin" /> : <Square />}
                {cancelling ? "正在取消" : "取消编译"}
              </Button>
            </div>
            <details className="mt-2 border-t border-sky-200 pt-2">
              <summary className="cursor-pointer font-medium text-sky-800">
                查看每个 Source 的执行状态
              </summary>
              <div className="mt-2 divide-y divide-sky-100 rounded-md border border-sky-100 bg-white/70">
                {job.sources.map((source) => (
                  <div
                    key={source.sourceId}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-2"
                  >
                    <span
                      className="min-w-[120px] flex-1 truncate font-medium"
                      title={sourceNames.get(source.sourceId)}
                    >
                      {sourceNames.get(source.sourceId) || source.sourceId}
                    </span>
                    <span
                      className={cn(
                        "rounded border px-1.5 py-0.5",
                        statusMeta[source.status].className,
                      )}
                    >
                      {statusMeta[source.status].label}
                    </span>
                    <span>
                      {source.compileUnitCount} Unit · Planner{" "}
                      {source.plannerCalls} · Writer {source.writerCalls}
                    </span>
                    <span>页面 {source.pageKeys.length}</span>
                    {source.error && (
                      <span className="basis-full text-rose-700">
                        失败信息：{source.error}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
        {!running && job?.status === "completed_with_errors" && (
          <div className="flex items-center gap-2 text-xs text-amber-700">
            <AlertTriangle className="size-3.5" />
            本次编译部分完成：
            {
              job.sources.filter((source) => source.status === "completed")
                .length
            }{" "}
            个成功，
            {
              job.sources.filter((source) => source.status === "failed").length
            }{" "}
            个失败；失败 Source 可重新选择编译。
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-white">
        <table className="w-full min-w-[860px] table-fixed text-sm">
          <colgroup>
            {selectionMode && <col className="w-[42px]" />}
            <col className="w-[32%]" />
            <col className="w-[118px]" />
            <col className="w-[88px]" />
            <col className="w-[168px]" />
            <col className="w-[168px]" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-slate-100/95 text-xs text-slate-600 shadow-[0_1px_0_rgb(203_213_225)] backdrop-blur">
            <tr>
              {selectionMode && (
                <th className="px-2 py-2.5 text-center font-medium">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    ref={(node) => {
                      if (node)
                        node.indeterminate =
                          somePageSelected && !allPageSelected;
                    }}
                    disabled={!selectableRows.length || controlsLocked}
                    aria-label="选择当前页文档"
                    onChange={(event) => togglePage(event.target.checked)}
                    className="size-4 rounded border-slate-300 accent-indigo-600"
                  />
                </th>
              )}
              <th className="px-3 py-2.5 text-left font-medium">文档</th>
              <th className="px-3 py-2.5 text-center font-medium">知识状态</th>
              <th className="px-3 py-2.5 text-center font-medium">页面数</th>
              <th className="px-3 py-2.5 text-center font-medium">上传时间</th>
              <th className="px-3 py-2.5 text-center font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pageRows.map(({ source, status, jobState }) => {
              const sourceCompletedInStaging =
                staging?.state.completedSourceIds.includes(source.sourceId) ??
                false;
              const sourceBusy =
                status === "pending" ||
                status === "planning" ||
                status === "writing";
              const selectable = !sourceCompletedInStaging && !controlsLocked;
              return (
                <Fragment key={source.sourceId}>
                  <tr
                    className={cn(
                      "align-middle transition-colors hover:bg-slate-50/80",
                      selectedSourceIds.has(source.sourceId) &&
                        "bg-indigo-50/40",
                    )}
                  >
                    {selectionMode && (
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={selectedSourceIds.has(source.sourceId)}
                          disabled={!selectable}
                          aria-label={`选择 ${source.filename}`}
                          onChange={(event) =>
                            toggleSource(source.sourceId, event.target.checked)
                          }
                          className="size-4 rounded border-slate-300 accent-indigo-600 disabled:opacity-40"
                        />
                      </td>
                    )}
                    <td className="px-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <FileText className="size-4 shrink-0 text-slate-400" />
                        <div className="min-w-0">
                          <p
                            className="truncate font-medium text-slate-900"
                            title={source.filename}
                          >
                            {source.filename}
                          </p>
                          <p
                            className="mt-0.5 truncate font-mono text-[11px] text-slate-400"
                            title={source.sourceId}
                          >
                            {source.sourceId}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={cn(
                          "inline-flex min-w-[64px] items-center justify-center rounded-md border px-2 py-0.5 text-xs",
                          statusMeta[status].className,
                        )}
                      >
                        {statusMeta[status].label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums text-slate-700">
                      {pageCountFor(source.sourceId, staging, publishedPages)}
                    </td>
                    <td
                      className="px-3 py-2 text-center text-xs text-slate-500"
                      title={source.createdAt}
                    >
                      {formatTime(source.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          size="xs"
                          variant="ghost"
                          className="bg-sky-50 text-sky-700 hover:bg-sky-100"
                          onClick={() => onOpenSource(source.sourceId)}
                        >
                          <Eye />
                          原文
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                          disabled={
                            controlsLocked ||
                            sourceBusy ||
                            sourceCompletedInStaging ||
                            estimating ||
                            startingCompile
                          }
                          onClick={() => onEstimate([source.sourceId])}
                        >
                          {sourceBusy ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <Play />
                          )}
                          {sourceCompletedInStaging
                            ? "已暂存"
                            : sourceBusy
                              ? "进行中"
                              : "编译"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {jobState?.error && (
                    <tr className="bg-rose-50/50">
                      <td
                        colSpan={selectionMode ? 7 : 6}
                        className="px-3 py-2 text-xs text-rose-700"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <AlertTriangle className="size-3.5" />
                          本次编译失败：{jobState.error}
                        </span>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!pageRows.length && (
              <tr>
                <td
                  colSpan={selectionMode ? 7 : 6}
                  className="px-4 py-14 text-center text-slate-400"
                >
                  {sources.length
                    ? "没有匹配文档"
                    : "还没有文档，上传 Markdown 或 Text 后开始编译。"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination
        page={currentPage}
        pageSize={PAGE_SIZE}
        total={filteredRows.length}
        onPageChange={setPage}
        className="border-t border-slate-100 bg-slate-50/50"
      />
    </section>
  );
}
