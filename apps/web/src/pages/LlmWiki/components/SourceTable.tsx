import { AlertTriangle, Pencil, Trash2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { LlmWikiSource } from "@/api/llmWiki";
import { Button } from "@/components/ui/button";
import { ingestStageLabels, wikiStatusLabels } from "../constants";
import { formatPercent, formatTime, wikiStatusClass } from "../utils";
import { SourceSelectionCheckbox } from "./SourceSelectionCheckbox";

interface SourceTableProps {
  sources: LlmWikiSource[];
  selectionMode: boolean;
  selectedSourceIdSet: Set<string>;
  selectionDisabled: boolean;
  allPageSelected: boolean;
  somePageSelected: boolean;
  pageSelectableCount: number;
  activeSourceId: string;
  onTogglePageSelected: (selected: boolean) => void;
  onSelectChange: (source: LlmWikiSource, selected: boolean) => void;
  onSelectSource: (source: LlmWikiSource) => void;
  onIngest: (source: LlmWikiSource) => void;
  onStopIngest: (source: LlmWikiSource) => void;
  onOpenRaw: (source: LlmWikiSource) => void;
  onRename: (source: LlmWikiSource) => void;
  onDelete: (source: LlmWikiSource) => void;
}

export function SourceTable({
  sources,
  selectionMode,
  selectedSourceIdSet,
  selectionDisabled,
  allPageSelected,
  somePageSelected,
  pageSelectableCount,
  activeSourceId,
  onTogglePageSelected,
  onSelectChange,
  onSelectSource,
  onIngest,
  onStopIngest,
  onOpenRaw,
  onRename,
  onDelete,
}: SourceTableProps) {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-white">
      <table className="w-full min-w-[1080px] table-fixed text-sm">
        <colgroup>
          {selectionMode && <col className="w-[44px]" />}
          <col className="w-[30%]" />
          <col className="w-[104px]" />
          <col className="w-[210px]" />
          <col className="w-[160px]" />
          <col className="w-[150px]" />
          <col className="w-[224px]" />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-slate-100/95 text-xs text-slate-600 shadow-[0_1px_0_rgb(203_213_225)] backdrop-blur">
          <tr>
            {selectionMode && (
              <th className="px-2 py-2.5 text-center font-medium">
                <SourceSelectionCheckbox
                  checked={allPageSelected}
                  indeterminate={somePageSelected}
                  disabled={!pageSelectableCount || selectionDisabled}
                  ariaLabel="选择当前页文档"
                  onChange={onTogglePageSelected}
                />
              </th>
            )}
            <th className="px-3 py-2.5 text-center font-medium">文档</th>
            <th className="px-3 py-2.5 text-center font-medium">状态</th>
            <th className="px-3 py-2.5 text-center font-medium">编译</th>
            <th className="px-3 py-2.5 text-center font-medium">产物</th>
            <th className="px-3 py-2.5 text-center font-medium">更新时间</th>
            <th className="px-3 py-2.5 text-center font-medium">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sources.length ? (
            sources.map((source) => {
              const selected = selectedSourceIdSet.has(source.source_id);
              const ingesting = source.status === "ingesting";
              const uploadedTime = formatTime(source.uploaded_at);
              const ingestedTime = formatTime(source.ingested_at) || "-";
              const active = source.source_id === activeSourceId;
              const compile = source.compile;
              return (
                <tr
                  key={source.source_id}
                  className={[
                    "align-middle transition-colors hover:bg-slate-50/80",
                    selectionMode && selected ? "bg-indigo-50/50" : "",
                    active ? "bg-sky-50/70" : "",
                  ].join(" ")}
                >
                  {selectionMode && (
                    <td className="px-2 py-2.5 text-center">
                      <SourceSelectionCheckbox
                        checked={selected}
                        disabled={ingesting || selectionDisabled}
                        ariaLabel={`选择 ${source.filename}`}
                        onChange={(checked) => onSelectChange(source, checked)}
                      />
                    </td>
                  )}
                  <td className="px-3 py-2 text-center">
                    <div className="mx-auto flex max-w-[300px] items-center justify-center gap-1.5">
                      <button
                        className={[
                          "block min-w-0 max-w-full truncate whitespace-nowrap text-center font-medium underline-offset-4 hover:underline",
                          active
                            ? "text-sky-800"
                            : source.status === "ready"
                            ? "text-indigo-700 hover:text-indigo-800"
                            : "text-slate-900 hover:text-slate-700",
                        ].join(" ")}
                        onClick={() => onSelectSource(source)}
                        title={source.filename}
                      >
                        {source.filename}
                      </button>
                      {source.error && (
                        <span
                          className="shrink-0"
                          title={source.error}
                          aria-label={`解析错误：${source.error}`}
                          tabIndex={0}
                        >
                          <AlertTriangle
                            className="size-3.5 text-rose-500"
                            aria-hidden
                          />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className={`inline-flex min-w-[64px] items-center justify-center rounded-md border px-2 py-0.5 text-xs ${wikiStatusClass(source.status)}`}
                    >
                      {wikiStatusLabels[source.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <div className="mx-auto max-w-[190px] space-y-1">
                      <div className="truncate text-xs text-slate-700" title={compile?.model || ""}>
                        {compile?.model || "-"}
                      </div>
                      <div className="text-xs text-slate-400">
                        {compile?.latestStage
                          ? ingestStageLabels[compile.latestStage] || compile.latestStage
                          : "-"}
                        {compile?.mustCoverage !== null && compile?.mustCoverage !== undefined
                          ? ` · ${formatPercent(compile.mustCoverage)}`
                          : ""}
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-center">
                    <span className="text-slate-700">{compile?.pageCount || source.touched_pages.length || 0}</span>
                    <span className="ml-1 text-xs text-slate-400">pages</span>
                    <span className="mx-1 text-slate-300">/</span>
                    <span className="text-slate-700">{compile?.factCount || 0}</span>
                    <span className="ml-1 text-xs text-slate-400">facts</span>
                  </td>
                  <td
                    className="whitespace-nowrap px-3 py-2 text-center text-slate-500"
                    title={`上传：${uploadedTime || "-"}\n解析：${ingestedTime}`}
                  >
                    {ingestedTime !== "-" ? ingestedTime : uploadedTime}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <div className="inline-flex items-center justify-center gap-1 whitespace-nowrap">
                      <Button
                        size="xs"
                        variant="ghost"
                        className="min-w-[54px] bg-sky-50 text-sky-700 hover:bg-sky-100 hover:text-sky-800"
                        onClick={() => onSelectSource(source)}
                      >
                        详情
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        className={
                          ingesting
                            ? "min-w-[68px] bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800"
                            : "min-w-[68px] bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800"
                        }
                        onClick={() => (ingesting ? onStopIngest(source) : onIngest(source))}
                      >
                        {ingesting ? "停止" : source.status === "ready" ? "重新解析" : "解析"}
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        className="min-w-[54px] bg-teal-50 text-teal-700 hover:bg-teal-100 hover:text-teal-800"
                        onClick={() => onOpenRaw(source)}
                      >
                        源文
                      </Button>
                      <DropdownMenu.Root>
                        <DropdownMenu.Trigger asChild>
                          <Button
                            size="xs"
                            variant="ghost"
                            className="min-w-[54px] bg-violet-50 text-violet-700 hover:bg-violet-100 hover:text-violet-800"
                            aria-label={`${source.filename} 更多操作`}
                            title="更多操作"
                          >
                            更多
                          </Button>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content
                            align="end"
                            sideOffset={4}
                            className="z-50 min-w-[132px] rounded-lg bg-white p-1 text-sm text-slate-700 shadow-md ring-1 ring-slate-900/10 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
                          >
                            <DropdownMenu.Item
                              className="flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 outline-none focus:bg-slate-100"
                              onSelect={() => onRename(source)}
                            >
                              <Pencil className="size-3.5" />
                              重命名
                            </DropdownMenu.Item>
                            <DropdownMenu.Item
                              disabled={ingesting}
                              className="flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-rose-600 outline-none focus:bg-rose-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
                              onSelect={() => onDelete(source)}
                            >
                              <Trash2 className="size-3.5" />
                              删除
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
                    </div>
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td
                className="px-4 py-10 text-center text-slate-400"
                colSpan={selectionMode ? 7 : 6}
              >
                没有匹配文档
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
