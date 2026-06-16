import { AlertTriangle, Pencil, Trash2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { LlmWikiSource } from "@/api/llmWiki";
import { Button } from "@/components/ui/button";
import { wikiStatusLabels } from "../constants";
import { formatBytes, formatTime, wikiStatusClass } from "../utils";
import { SourceSelectionCheckbox } from "./SourceSelectionCheckbox";

interface SourceTableProps {
  sources: LlmWikiSource[];
  selectionMode: boolean;
  selectedSourceIdSet: Set<string>;
  selectionDisabled: boolean;
  allPageSelected: boolean;
  somePageSelected: boolean;
  pageSelectableCount: number;
  onTogglePageSelected: (selected: boolean) => void;
  onSelectChange: (source: LlmWikiSource, selected: boolean) => void;
  onIngest: (source: LlmWikiSource) => void;
  onOpenRaw: (source: LlmWikiSource) => void;
  onOpenWiki: (path?: string) => void;
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
  onTogglePageSelected,
  onSelectChange,
  onIngest,
  onOpenRaw,
  onOpenWiki,
  onRename,
  onDelete,
}: SourceTableProps) {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-white">
      <table className="w-full min-w-[1080px] table-fixed text-sm">
        <colgroup>
          {selectionMode && <col className="w-[44px]" />}
          <col className="w-[31%]" />
          <col className="w-[104px]" />
          <col className="w-[96px]" />
          <col className="w-[180px]" />
          <col className="w-[100px]" />
          <col className="w-[252px]" />
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
            <th className="px-3 py-2.5 text-center font-medium">大小</th>
            <th className="px-3 py-2.5 text-center font-medium">上传时间</th>
            <th className="px-3 py-2.5 text-center font-medium">页面数</th>
            <th className="px-3 py-2.5 text-center font-medium">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sources.length ? (
            sources.map((source) => {
              const selected = selectedSourceIdSet.has(source.source_id);
              const ingesting = source.status === "ingesting";
              const summaryPath = `summaries/${source.source_id}.md`;
              const uploadedTime = formatTime(source.uploaded_at);
              const ingestedTime = formatTime(source.ingested_at) || "-";
              return (
                <tr
                  key={source.source_id}
                  className={[
                    "align-middle transition-colors hover:bg-slate-50/80",
                    selectionMode && selected ? "bg-indigo-50/50" : "",
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
                          source.status === "ready"
                            ? "text-indigo-700 hover:text-indigo-800"
                            : "text-slate-900 hover:text-slate-700",
                        ].join(" ")}
                        onClick={() =>
                          onOpenWiki(
                            source.status === "ready" ? summaryPath : "index.md",
                          )
                        }
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
                  <td className="whitespace-nowrap px-3 py-2 text-center text-slate-600">
                    {formatBytes(source.size)}
                  </td>
                  <td
                    className="whitespace-nowrap px-3 py-2 text-center text-slate-500"
                    title={`上传时间：${uploadedTime || "-"}\n解析时间：${ingestedTime}`}
                  >
                    {uploadedTime}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-center">
                    {source.touched_pages.length || "-"}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <div className="inline-flex items-center justify-center gap-1 whitespace-nowrap">
                      <Button
                        size="xs"
                        variant="ghost"
                        className="min-w-[68px] bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800"
                        disabled={ingesting}
                        onClick={() => onIngest(source)}
                      >
                        {source.status === "ready" ? "重新解析" : "解析"}
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
