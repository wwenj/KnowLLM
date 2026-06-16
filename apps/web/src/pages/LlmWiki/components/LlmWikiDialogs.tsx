import { FileText, Loader2, Save, Search, Trash2 } from "lucide-react";
import type {
  LlmWikiPage,
  LlmWikiSchema,
  LlmWikiSearchHit,
  LlmWikiSource,
  LlmWikiTree,
} from "@/api/llmWiki";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { RawSource } from "../types";

interface LlmWikiDialogsProps {
  wikiOpen: boolean;
  onWikiOpenChange: (open: boolean) => void;
  tree: LlmWikiTree | null;
  activePath: string;
  activePage: LlmWikiPage | null;
  pageLoading: boolean;
  pageSaving: boolean;
  onSelectPage: (path: string) => void;
  onContentChange: (content: string) => void;
  onSavePage: () => void;
  onDeletePage: () => void;
  rawSource: RawSource | null;
  onRawOpenChange: (open: boolean) => void;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  hits: LlmWikiSearchHit[];
  searching: boolean;
  onSearch: () => void;
  onOpenHit: (hit: LlmWikiSearchHit) => void;
  schemaOpen: boolean;
  onSchemaOpenChange: (open: boolean) => void;
  schema: LlmWikiSchema | null;
  schemaDraft: string;
  schemaLoading: boolean;
  schemaSaving: boolean;
  onSchemaDraftChange: (value: string) => void;
  onSaveSchema: () => void;
  renameSource: LlmWikiSource | null;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onRenameOpenChange: (open: boolean) => void;
  onConfirmRename: () => void;
  deleteSource: LlmWikiSource | null;
  onDeleteOpenChange: (open: boolean) => void;
  onConfirmDelete: () => void;
  bulkDeleteOpen: boolean;
  bulkDeleteSources: LlmWikiSource[];
  bulkDeleteBusy: boolean;
  onBulkDeleteOpenChange: (open: boolean) => void;
  onConfirmBulkDelete: () => void;
}

export function LlmWikiDialogs({
  wikiOpen,
  onWikiOpenChange,
  tree,
  activePath,
  activePage,
  pageLoading,
  pageSaving,
  onSelectPage,
  onContentChange,
  onSavePage,
  onDeletePage,
  rawSource,
  onRawOpenChange,
  searchOpen,
  onSearchOpenChange,
  query,
  onQueryChange,
  hits,
  searching,
  onSearch,
  onOpenHit,
  schemaOpen,
  onSchemaOpenChange,
  schema,
  schemaDraft,
  schemaLoading,
  schemaSaving,
  onSchemaDraftChange,
  onSaveSchema,
  renameSource,
  renameValue,
  onRenameValueChange,
  onRenameOpenChange,
  onConfirmRename,
  deleteSource,
  onDeleteOpenChange,
  onConfirmDelete,
  bulkDeleteOpen,
  bulkDeleteSources,
  bulkDeleteBusy,
  onBulkDeleteOpenChange,
  onConfirmBulkDelete,
}: LlmWikiDialogsProps) {
  return (
    <>
      <Dialog open={wikiOpen} onOpenChange={onWikiOpenChange}>
        <DialogContent className="flex max-h-[88vh] min-h-[620px] flex-col overflow-hidden sm:max-w-[1180px]">
          <DialogHeader>
            <DialogTitle>LLM Wiki</DialogTitle>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[280px_1fr]">
            <div className="min-h-0 overflow-auto rounded-lg border border-slate-200 bg-slate-50/70 p-2">
              {(tree?.groups || []).map((group) => (
                <div key={group.group} className="mb-3">
                  <div className="px-2 py-1 text-xs font-semibold uppercase text-slate-500">
                    {group.group}
                  </div>
                  <div className="space-y-1">
                    {group.pages.map((item) => (
                      <button
                        key={item.path}
                        className={[
                          "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition",
                          item.path === activePath
                            ? "bg-indigo-50 text-indigo-700"
                            : "text-slate-600 hover:bg-white hover:text-slate-900",
                        ].join(" ")}
                        onClick={() => onSelectPage(item.path)}
                      >
                        <FileText className="size-3 shrink-0" />
                        <span className="truncate">{item.title || item.path}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900">
                    {activePage?.title || activePath}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-xs text-slate-400">
                    {activePath}
                  </div>
                </div>
                {pageLoading && (
                  <Loader2 className="size-4 animate-spin text-slate-400" />
                )}
              </div>
              <Textarea
                value={activePage?.content || ""}
                onChange={(event) => onContentChange(event.target.value)}
                className="min-h-0 flex-1 resize-none rounded-none border-0 font-mono text-sm leading-6 focus-visible:ring-0"
                placeholder="选择左侧 wiki 页面"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onWikiOpenChange(false)}>
              关闭
            </Button>
            <Button
              variant="destructive"
              disabled={!activePage || activePage.path === "index.md"}
              onClick={onDeletePage}
            >
              <Trash2 className="size-4" />
              删除页面
            </Button>
            <Button disabled={!activePage || pageSaving} onClick={onSavePage}>
              {pageSaving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rawSource} onOpenChange={onRawOpenChange}>
        <DialogContent className="max-h-[86vh] overflow-hidden sm:max-w-[900px]">
          <DialogHeader>
            <DialogTitle>{rawSource?.filename || "源文"}</DialogTitle>
          </DialogHeader>
          <Textarea
            readOnly
            value={rawSource?.content || ""}
            className="h-[62vh] resize-none font-mono text-sm leading-6"
          />
        </DialogContent>
      </Dialog>

      <Dialog open={searchOpen} onOpenChange={onSearchOpenChange}>
        <DialogContent className="max-h-[86vh] overflow-hidden sm:max-w-[900px]">
          <DialogHeader>
            <DialogTitle>Wiki 搜索</DialogTitle>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSearch();
              }}
              placeholder="搜索标题、正文或标签"
              autoFocus
            />
            <Button disabled={searching} onClick={onSearch}>
              {searching ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
              搜索
            </Button>
          </div>
          <div className="mt-3 max-h-[60vh] space-y-2 overflow-auto">
            {hits.length ? (
              hits.map((hit) => (
                <button
                  key={hit.path}
                  className="block w-full rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-indigo-200 hover:bg-indigo-50/40"
                  onClick={() => onOpenHit(hit)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-slate-900">
                      {hit.title}
                    </span>
                    <span className="font-mono text-xs text-slate-400">
                      {hit.path}
                    </span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                    {hit.snippet || "无片段"}
                  </div>
                </button>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
                暂无搜索结果
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={schemaOpen} onOpenChange={onSchemaOpenChange}>
        <DialogContent className="max-h-[86vh] overflow-hidden sm:max-w-[900px]">
          <DialogHeader>
            <DialogTitle>LLM Wiki Schema</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <span className="font-mono">sha256: {schema?.sha256 || "-"}</span>
            {schemaLoading && <Loader2 className="size-4 animate-spin" />}
          </div>
          <Textarea
            value={schemaDraft}
            onChange={(event) => onSchemaDraftChange(event.target.value)}
            className="h-[58vh] resize-none font-mono text-sm leading-6"
            placeholder="加载 schema 中"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => onSchemaOpenChange(false)}>
              关闭
            </Button>
            <Button
              disabled={schemaLoading || schemaSaving || !schemaDraft.trim()}
              onClick={onSaveSchema}
            >
              {schemaSaving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renameSource} onOpenChange={onRenameOpenChange}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>重命名文档</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => onRenameValueChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onConfirmRename();
            }}
            placeholder="请输入文档名"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => onRenameOpenChange(false)}>
              取消
            </Button>
            <Button onClick={onConfirmRename}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteSource} onOpenChange={onDeleteOpenChange}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>删除文档</DialogTitle>
          </DialogHeader>
          <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            确认删除 {deleteSource?.filename || "该文档"}？对应 summary 和只引用该
            source 的页面会一起删除。
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onDeleteOpenChange(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={onConfirmDelete}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDeleteOpen} onOpenChange={onBulkDeleteOpenChange}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>批量删除文档</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              确认删除已选 {bulkDeleteSources.length} 个文档？对应 summary 和只引用这些
              source 的页面会一起删除。
            </div>
            <div className="max-h-[180px] overflow-auto rounded-lg border border-slate-200 bg-white p-2">
              {bulkDeleteSources.map((source) => (
                <div
                  key={source.source_id}
                  className="truncate px-2 py-1 text-xs text-slate-600"
                  title={source.filename}
                >
                  {source.filename}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={bulkDeleteBusy}
              onClick={() => onBulkDeleteOpenChange(false)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={bulkDeleteBusy || !bulkDeleteSources.length}
              onClick={onConfirmBulkDelete}
            >
              {bulkDeleteBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
