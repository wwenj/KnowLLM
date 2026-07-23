import { Fragment, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Eye,
  FileText,
  Info,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { modelOptionLabel, type ModelOption } from "@/api/model";
import type {
  CompilePool,
  CompilePoolItem,
  ManifestPage,
  SourceRecord,
  SourceStatus,
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

type SourceVisualStatus = SourceStatus;

export interface CompileSettings {
  chunkChars: number;
  plannerMaxOutputTokens: number;
  writerMaxOutputTokens: number;
}

interface SourceWorkspaceProps {
  sources: SourceRecord[];
  staging: StagingSummary | null;
  publishedPages: ManifestPage[];
  pool: CompilePool | null;
  models: ModelOption[];
  model: string;
  sourceConcurrency: number;
  settings: CompileSettings;
  estimating: boolean;
  startingCompile: boolean;
  uploading: boolean;
  loading: boolean;
  deleting: boolean;
  operationsLocked: boolean;
  onModelChange: (model: string) => void;
  onSourceConcurrencyChange: (value: string) => void;
  onSettingsChange: (next: Partial<CompileSettings>) => void;
  onUpload: () => void;
  onRefresh: () => void;
  onEstimate: (sourceIds: string[]) => void;
  onDeleteSelected: (sourceIds: string[]) => void;
  onOpenCompilePool: () => void;
  onOpenSource: (sourceId: string) => void;
  onOpenCompileDetail: (sourceId: string) => void;
}

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = PAGE_SIZE_OPTIONS[0];
const CONCURRENCY_OPTIONS = [1, 2, 4, 8, 16] as const;

const statusMeta: Record<
  SourceVisualStatus,
  { label: string; className: string }
> = {
  pending: {
    label: "待编译",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  compiling: {
    label: "编译中",
    className: "border-indigo-200 bg-indigo-50 text-indigo-700",
  },
  staged: {
    label: "已暂存",
    className: "border-sky-200 bg-sky-50 text-sky-700",
  },
  failed: {
    label: "失败",
    className: "border-rose-200 bg-rose-50 text-rose-700",
  },
  published: {
    label: "已发布",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
};

const statusSummaryMeta = [
  {
    key: "pending",
    label: "待编译",
    statuses: ["pending"],
    dotClassName: "bg-amber-500",
    alwaysVisible: true,
  },
  {
    key: "running",
    label: "编译中",
    statuses: ["compiling"],
    dotClassName: "bg-indigo-500",
    alwaysVisible: true,
  },
  {
    key: "staged",
    label: "已暂存",
    statuses: ["staged"],
    dotClassName: "bg-sky-500",
    alwaysVisible: true,
  },
  {
    key: "published",
    label: "已发布",
    statuses: ["published"],
    dotClassName: "bg-emerald-500",
    alwaysVisible: true,
  },
  {
    key: "failed",
    label: "失败",
    statuses: ["failed"],
    dotClassName: "bg-rose-500",
    alwaysVisible: false,
  },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  statuses: readonly SourceVisualStatus[];
  dotClassName: string;
  alwaysVisible: boolean;
}>;

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", { hour12: false });
}

function sourceState(
  source: SourceRecord,
  pool: CompilePool | null,
): { status: SourceVisualStatus; poolItem?: CompilePoolItem } {
  const poolItem = pool?.items.find(
    (item) => item.sourceId === source.sourceId,
  );
  return { status: source.status, poolItem };
}

function pageCountFor(
  sourceId: string,
  staging: StagingSummary | null,
  publishedPages: ManifestPage[],
): number {
  const pages = staging?.pages ?? publishedPages;
  return pages.filter((page) => page.sourceIds.includes(sourceId)).length;
}

function isCompileSelectable(status: SourceVisualStatus): boolean {
  return ["pending", "published", "failed"].includes(status);
}

export function SourceWorkspace({
  sources,
  staging,
  publishedPages,
  pool,
  models,
  model,
  sourceConcurrency,
  settings,
  estimating,
  startingCompile,
  uploading,
  loading,
  deleting,
  operationsLocked,
  onModelChange,
  onSourceConcurrencyChange,
  onSettingsChange,
  onUpload,
  onRefresh,
  onEstimate,
  onDeleteSelected,
  onOpenCompilePool,
  onOpenSource,
  onOpenCompileDetail,
}: SourceWorkspaceProps) {
  const [searchText, setSearchText] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<
    "all" | SourceVisualStatus
  >("all");
  const [filters, setFilters] = useState<{
    query: string;
    status: "all" | SourceVisualStatus;
  }>({ query: "", status: "all" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(
    new Set(),
  );

  const sourceRows = useMemo(
    () =>
      sources.map((source) => ({
        source,
        ...sourceState(source, pool),
      })),
    [pool, sources],
  );
  const statusSummary = useMemo(() => {
    const statusCounts = new Map<SourceVisualStatus, number>();
    sourceRows.forEach(({ status }) => {
      statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
    });
    return statusSummaryMeta.map((item) => ({
      ...item,
      count: item.statuses.reduce(
        (total, status) => total + (statusCounts.get(status) || 0),
        0,
      ),
    }));
  }, [sourceRows]);
  const filteredRows = useMemo(() => {
    const normalizedQuery = filters.query.trim().toLocaleLowerCase();
    return sourceRows.filter((row) => {
      const queryMatched =
        !normalizedQuery ||
        row.source.filename.toLocaleLowerCase().includes(normalizedQuery);
      return (
        queryMatched &&
        (filters.status === "all" || row.status === filters.status)
      );
    });
  }, [filters, sourceRows]);
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(filteredRows.length / pageSize)),
  );
  const pageRows = filteredRows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const selectableRows = pageRows.filter(() => !operationsLocked);
  const selectedIds = useMemo(() => {
    const knownSourceIds = new Set(sources.map((source) => source.sourceId));
    return new Set(
      [...selectedSourceIds].filter((sourceId) => knownSourceIds.has(sourceId)),
    );
  }, [selectedSourceIds, sources]);
  const compileSelectableSourceIds = useMemo(
    () =>
      new Set(
        sourceRows
          .filter((row) => isCompileSelectable(row.status))
          .filter((row) => !row.poolItem)
          .map((row) => row.source.sourceId),
      ),
    [sourceRows],
  );
  const selectedContainsNonCompilable = [...selectedIds].some(
    (sourceId) => !compileSelectableSourceIds.has(sourceId),
  );
  const allPageSelected =
    selectableRows.length > 0 &&
    selectableRows.every((row) => selectedIds.has(row.source.sourceId));
  const somePageSelected = selectableRows.some((row) =>
    selectedIds.has(row.source.sourceId),
  );
  const runningCount =
    pool?.items.filter(
      (item) =>
        item.phase === "planning" ||
        item.phase === "writing" ||
        item.phase === "committing",
    ).length || 0;
  const queuedCount =
    pool?.items.filter((item) => item.phase === "queued").length || 0;
  const compiling = runningCount + queuedCount > 0;

  const toggleSource = (sourceId: string, checked: boolean) => {
    setSelectedSourceIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(sourceId);
      else next.delete(sourceId);
      return next;
    });
  };

  const togglePage = (checked: boolean) => {
    setSelectedSourceIds((previous) => {
      const next = new Set(previous);
      selectableRows.forEach((row) => {
        if (checked) next.add(row.source.sourceId);
        else next.delete(row.source.sourceId);
      });
      return next;
    });
  };

  const toggleSelectionMode = () => {
    setSelectionMode((value) => !value);
    if (selectionMode) setSelectedSourceIds(new Set());
  };

  const runSearch = () => {
    setFilters({ query: searchText, status: selectedStatus });
    setPage(1);
  };

  return (
    <section className="min-w-0 flex-1 bg-white">
      <div className="flex flex-none flex-col gap-2 border-b border-slate-200 bg-slate-50/70 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex h-8 min-w-[300px] items-center gap-2 text-xs font-medium whitespace-nowrap text-slate-600">
            <span>编译模型</span>
            <Select
              value={model}
              onValueChange={onModelChange}
              disabled={!models.length || operationsLocked}
            >
              <SelectTrigger className="h-8 min-w-[220px] flex-1 bg-white text-xs">
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

          <label className="flex h-8 items-center gap-2 text-xs font-medium whitespace-nowrap text-slate-600">
            <span>Source 并发</span>
            <Select
              value={String(sourceConcurrency)}
              onValueChange={onSourceConcurrencyChange}
              disabled={operationsLocked}
            >
              <SelectTrigger
                size="sm"
                className="min-w-[92px] bg-white text-xs"
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

          <details className="relative text-xs">
            <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 font-medium text-slate-600 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
              <Settings2 className="size-3.5" />
              高级设置
            </summary>
            <div className="absolute right-0 z-20 mt-1 grid w-[min(92vw,520px)] grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-lg sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-slate-600">
                切片字符数
                <Input
                  type="number"
                  min={1_000}
                  max={60_000}
                  value={settings.chunkChars}
                  disabled={operationsLocked}
                  onChange={(event) =>
                    onSettingsChange({ chunkChars: Number(event.target.value) })
                  }
                  className="h-8 bg-white text-xs"
                />
              </label>
              <label className="flex flex-col gap-1 text-slate-600">
                Planner tokens
                <Input
                  type="number"
                  min={256}
                  max={16_000}
                  value={settings.plannerMaxOutputTokens}
                  disabled={operationsLocked}
                  onChange={(event) =>
                    onSettingsChange({
                      plannerMaxOutputTokens: Number(event.target.value),
                    })
                  }
                  className="h-8 bg-white text-xs"
                />
              </label>
              <label className="flex flex-col gap-1 text-slate-600">
                Writer tokens
                <Input
                  type="number"
                  min={256}
                  max={32_000}
                  value={settings.writerMaxOutputTokens}
                  disabled={operationsLocked}
                  onChange={(event) =>
                    onSettingsChange({
                      writerMaxOutputTokens: Number(event.target.value),
                    })
                  }
                  className="h-8 bg-white text-xs"
                />
              </label>
            </div>
          </details>

          <div className="ml-auto flex items-center gap-2">
            <Button
              size="icon-sm"
              variant="outline"
              disabled={loading || operationsLocked}
              title="刷新列表"
              aria-label="刷新列表"
              onClick={onRefresh}
            >
              <RefreshCw className={loading ? "animate-spin" : ""} />
            </Button>
            <Button
              size="sm"
              disabled={uploading || operationsLocked}
              onClick={onUpload}
            >
              {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
              上传文档
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={selectionMode ? "secondary" : "outline"}
            onClick={toggleSelectionMode}
            disabled={operationsLocked}
          >
            {selectionMode ? <X /> : <Check />}
            {selectionMode ? "退出多选" : "多选"}
          </Button>
          <Select
            value={selectedStatus}
            onValueChange={(value) =>
              setSelectedStatus(value as typeof selectedStatus)
            }
          >
            <SelectTrigger size="sm" className="min-w-[104px] bg-white text-xs">
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
          <form
            className="flex w-[320px] shrink-0 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              runSearch();
            }}
          >
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="搜索文档名"
                className="h-8 bg-white pl-8 text-sm"
              />
            </div>
            <Button size="sm" type="submit">
              <Search />
              搜索
            </Button>
          </form>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
            <span className="tabular-nums text-slate-500">
              {filteredRows.length} 个文档
            </span>
            <span className="h-3.5 w-px bg-slate-200" aria-hidden="true" />
            <div
              className="flex flex-wrap items-center gap-x-3 gap-y-1"
              aria-label="文档状态统计"
            >
              {statusSummary
                .filter((item) => item.alwaysVisible || item.count > 0)
                .map((item) => (
                  <span key={item.key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <span className={cn("size-1.5 rounded-full", item.dotClassName)} />
                    {item.label}
                    <strong className="font-semibold tabular-nums text-slate-900">
                      {item.count}
                    </strong>
                  </span>
                ))}
            </div>
          </div>
          {selectionMode && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={!selectedIds.size}
                onClick={() => setSelectedSourceIds(new Set())}
              >
                清空选择
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={!selectedIds.size || operationsLocked || deleting}
                onClick={() => onDeleteSelected([...selectedIds])}
              >
                {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                删除 {selectedIds.size ? `(${selectedIds.size})` : ""}
              </Button>
              <Button
                size="sm"
                disabled={
                  !selectedIds.size ||
                  selectedContainsNonCompilable ||
                  operationsLocked ||
                  estimating ||
                  startingCompile
                }
                title={
                  selectedContainsNonCompilable
                    ? "所选 Source 中包含正在编译或已暂存的项目"
                    : undefined
                }
                onClick={() => onEstimate([...selectedIds])}
              >
                <Play />
                编译 {selectedIds.size ? `(${selectedIds.size})` : ""}
              </Button>
            </div>
          )}
        </div>

        {compiling && (
          <button
            type="button"
            className="flex min-h-16 w-full items-center gap-3 border border-indigo-200 bg-indigo-50 px-4 text-left text-indigo-950 transition-colors hover:bg-indigo-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            onClick={onOpenCompilePool}
          >
            <Loader2 className="size-6 shrink-0 animate-spin text-indigo-700" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">编译进行中</span>
              <span className="mt-0.5 block text-xs text-indigo-800">
                {runningCount} 个正在编译
                {queuedCount ? `，${queuedCount} 个等待` : ""}
              </span>
            </span>
            <span className="text-xs font-medium text-indigo-700">
              查看任务
            </span>
          </button>
        )}
      </div>

      <div className="overflow-x-auto bg-white">
        <table className="w-full table-auto text-sm">
          <colgroup>
            {selectionMode && <col className="w-[56px] min-w-[56px]" />}
            <col className="w-[36%] min-w-[320px]" />
            <col className="w-[13%] min-w-[120px]" />
            <col className="w-[10%] min-w-[100px]" />
            <col className="w-[18%] min-w-[180px]" />
            <col className="w-[22%] min-w-[260px]" />
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
                    disabled={!selectableRows.length || operationsLocked}
                    aria-label="选择当前页文档"
                    onChange={(event) => togglePage(event.target.checked)}
                    className="size-4 rounded border-slate-300 accent-indigo-600"
                  />
                </th>
              )}
              <th className="min-w-[320px] px-3 py-2.5 text-center font-medium">
                文档
              </th>
              <th className="min-w-[120px] px-3 py-2.5 text-center font-medium">
                编译状态
              </th>
              <th className="min-w-[100px] px-3 py-2.5 text-center font-medium">
                页面数
              </th>
              <th className="min-w-[180px] px-3 py-2.5 text-center font-medium">
                上传时间
              </th>
              <th className="min-w-[260px] px-3 py-2.5 text-center font-medium">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pageRows.map(({ source, status, poolItem }) => {
              const sourceCompletedInStaging = status === "staged";
              const sourceBusy =
                status === "compiling" || Boolean(poolItem);
              const selectable = !operationsLocked;
              return (
                <Fragment key={source.sourceId}>
                  <tr
                    className={cn(
                      "align-middle transition-colors hover:bg-slate-50/80",
                      selectedIds.has(source.sourceId) && "bg-indigo-50/40",
                    )}
                  >
                    {selectionMode && (
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(source.sourceId)}
                          disabled={!selectable}
                          aria-label={`选择 ${source.filename}`}
                          onChange={(event) =>
                            toggleSource(source.sourceId, event.target.checked)
                          }
                          className="size-4 rounded border-slate-300 accent-indigo-600 disabled:opacity-40"
                        />
                      </td>
                    )}
                    <td className="min-w-[320px] px-3 py-2.5 text-center">
                      <div className="flex min-w-0 items-center justify-center gap-2">
                        <FileText className="size-4 shrink-0 text-slate-400" />
                        <div className="min-w-0 text-center">
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
                    <td className="min-w-[120px] px-3 py-2 text-center">
                      <span
                        className={cn(
                          "inline-flex min-w-[64px] items-center justify-center rounded-md border px-2 py-0.5 text-xs",
                          statusMeta[status].className,
                        )}
                      >
                        {statusMeta[status].label}
                      </span>
                    </td>
                    <td className="min-w-[100px] px-3 py-2 text-center tabular-nums text-slate-700">
                      {pageCountFor(source.sourceId, staging, publishedPages)}
                    </td>
                    <td
                      className="min-w-[180px] px-3 py-2 text-center text-xs text-slate-500"
                      title={source.createdAt}
                    >
                      {formatTime(source.createdAt)}
                    </td>
                    <td className="min-w-[260px] px-3 py-2 text-center">
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
                          className="bg-slate-100 text-slate-700 hover:bg-slate-200"
                          onClick={() => onOpenCompileDetail(source.sourceId)}
                        >
                          <Info />
                          详情
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                          disabled={
                            operationsLocked ||
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
                              ? "编译中"
                              : "编译"}
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          className="bg-rose-50 text-rose-700 hover:bg-rose-100"
                          disabled={operationsLocked || deleting}
                          onClick={() => onDeleteSelected([source.sourceId])}
                        >
                          {deleting ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <Trash2 />
                          )}
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {poolItem?.error && (
                    <tr className="bg-rose-50/50">
                      <td
                        colSpan={selectionMode ? 7 : 6}
                        className="px-3 py-2 text-center text-xs text-rose-700"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <AlertTriangle className="size-3.5" />
                          本次编译失败：{poolItem.error}
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
        pageSize={pageSize}
        total={filteredRows.length}
        onPageChange={setPage}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(nextPageSize) => {
          setPageSize(nextPageSize);
          setPage(1);
        }}
        className="border-t border-slate-100 bg-slate-50/50"
      />
    </section>
  );
}
