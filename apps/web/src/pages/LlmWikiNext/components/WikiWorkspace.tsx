import { useEffect, useMemo, useState } from "react";
import {
  FileText,
  Link2,
  Loader2,
  MapPin,
  Search,
  SearchX,
  Trash2,
  X,
} from "lucide-react";
import type {
  ManifestPage,
  SearchDocument,
  WikiPageDetail,
} from "@/api/llmWikiNext";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PageListItem = ManifestPage;

export interface WikiPageDeleteTarget {
  pageKey: string;
  revisionId: string;
  title: string;
  factCount: number;
  affectedPageCount: number;
  stagingRetainsPage: boolean;
}

interface WikiWorkspaceProps {
  mode: "staging" | "published";
  pages: ManifestPage[];
  loadPage: (pageKey: string) => Promise<WikiPageDetail>;
  search?: (query: string) => Promise<{ items: SearchDocument[] }>;
  revisionId?: string;
  generatedAt?: string;
  completedSourceIds?: string[];
  sourceNames?: Record<string, string>;
  onOpenSource: (sourceId: string, sourceLine?: number | null) => void;
  openPageKey?: string | null;
  onPageOpened?: () => void;
  stagingPageKeys?: string[];
  onRequestDelete?: (target: WikiPageDeleteTarget) => void;
}

function formatTime(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", { hour12: false });
}

export function WikiWorkspace({
  mode,
  pages,
  loadPage,
  search,
  revisionId,
  generatedAt,
  completedSourceIds = [],
  sourceNames = {},
  onOpenSource,
  openPageKey,
  onPageOpened,
  stagingPageKeys = [],
  onRequestDelete,
}: WikiWorkspaceProps) {
  const [selectedPageKey, setSelectedPageKey] = useState("");
  const [detail, setDetail] = useState<WikiPageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PageListItem[] | null>(
    null,
  );
  const [searchLoading, setSearchLoading] = useState(false);
  const [stagingFilter, setStagingFilter] = useState("");
  const [onlyCurrentSources, setOnlyCurrentSources] = useState(false);
  const stagingPageKeySet = useMemo(
    () => new Set(stagingPageKeys),
    [stagingPageKeys],
  );

  const stagingPages = useMemo(() => {
    const normalized = stagingFilter.trim().toLocaleLowerCase();
    return pages.filter((page) => {
      const text =
        `${page.title}\n${page.goal}\n${page.pageKey}\n${page.sourceIds.join("\n")}`.toLocaleLowerCase();
      const queryMatched = !normalized || text.includes(normalized);
      const sourceMatched =
        !onlyCurrentSources ||
        !completedSourceIds.length ||
        page.sourceIds.some((sourceId) =>
          completedSourceIds.includes(sourceId),
        );
      return queryMatched && sourceMatched;
    });
  }, [completedSourceIds, onlyCurrentSources, pages, stagingFilter]);
  const listItems = useMemo<PageListItem[]>(() => {
    if (mode === "staging") return stagingPages;
    return searchResults ?? pages;
  }, [mode, pages, searchResults, stagingPages]);
  const listLabel = searchResults
    ? `搜索结果 ${searchResults.length}`
    : mode === "staging"
      ? `页面 ${listItems.length} / ${pages.length}`
      : `页面 ${pages.length}`;
  const selectedPageExists = listItems.some(
    (page) => page.pageKey === selectedPageKey,
  );

  const selectPage = async (pageKey: string) => {
    setSelectedPageKey(pageKey);
    setDetail(null);
    setDetailLoading(true);
    setDetailError("");
    try {
      setDetail(await loadPage(pageKey));
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "页面加载失败");
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (!openPageKey || !pages.some((page) => page.pageKey === openPageKey)) {
      return;
    }
    if (mode === "staging") {
      setStagingFilter("");
      setOnlyCurrentSources(false);
    } else {
      setSearchResults(null);
    }
    void selectPage(openPageKey);
    onPageOpened?.();
  }, [mode, onPageOpened, openPageKey, pages, selectPage]);

  const runSearch = async () => {
    const normalized = query.trim();
    if (!normalized || !search) {
      setSearchResults(null);
      return;
    }
    setSearchLoading(true);
    try {
      const result = await search(normalized);
      setSearchResults(
        result.items.map((item) => ({
          pageKey: item.pageKey,
          title: item.title,
          goal: item.goal,
          relatedPageKeys: [],
          sourceIds: item.sourceIds,
          factCount: item.facts.length,
        })),
      );
    } finally {
      setSearchLoading(false);
    }
  };

  if (!pages.length) {
    return (
      <div className="flex flex-1 items-center justify-center bg-slate-50/50 p-6 text-center">
        <div className="max-w-sm">
          <FileText className="mx-auto mb-3 size-7 text-slate-300" />
          <p className="font-medium text-slate-700">
            {mode === "staging"
              ? "待发布 Wiki 还没有页面"
              : "正式 Wiki 还没有页面"}
          </p>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            {mode === "staging"
              ? "页面列表是完整待发布快照；后续编译结果会继续合并到这里。"
              : "发布待发布 Wiki 后，正式页面会出现在这里。"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(15rem,0.72fr)_minmax(0,1fr)] overflow-hidden lg:grid-cols-[minmax(260px,0.62fr)_minmax(0,1.38fr)] lg:grid-rows-1">
      <aside className="flex min-h-0 flex-col border-b border-slate-200 bg-slate-50/70 lg:border-r lg:border-b-0">
        <div className="flex flex-none flex-col gap-2 border-b border-slate-200 px-3 py-2.5">
          {mode === "published" && search ? (
            <form
              className="flex gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                void runSearch();
              }}
            >
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索正式 Wiki"
                  className={cn(
                    "bg-white pl-8 text-sm",
                    searchResults && "pr-8",
                  )}
                />
                {searchResults && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setSearchResults(null);
                    }}
                    className="absolute top-1/2 right-1.5 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    aria-label="清除搜索"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              <Button size="sm" type="submit" disabled={searchLoading}>
                {searchLoading ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Search />
                )}
                搜索
              </Button>
            </form>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  value={stagingFilter}
                  onChange={(event) => setStagingFilter(event.target.value)}
                  placeholder="筛选标题、目标或 Source"
                  className="bg-white pl-8 text-sm"
                />
              </div>
              {completedSourceIds.length > 0 && (
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={onlyCurrentSources}
                    onChange={(event) =>
                      setOnlyCurrentSources(event.target.checked)
                    }
                    className="size-3.5 rounded border-slate-300 accent-indigo-600"
                  />
                  仅显示已合并 Source 涉及的页面
                </label>
              )}
            </div>
          )}
          {mode === "published" ? (
            <p className="truncate text-xs text-slate-500">
              共 {pages.length} 个 Wiki 页面
              {generatedAt && ` · 发布于 ${formatTime(generatedAt)}`}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-slate-500">
                <span>{listLabel}</span>
                {revisionId && (
                  <span
                    className="font-mono text-[10px] text-slate-400"
                    title={revisionId}
                  >
                    staging {revisionId}
                  </span>
                )}
              </div>
              {generatedAt && (
                <p className="text-[11px] text-slate-400">
                  更新于 {formatTime(generatedAt)}
                </p>
              )}
            </>
          )}
        </div>
        <div className="min-h-0 overflow-auto p-2">
          {!listItems.length ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-slate-500">
              <SearchX className="size-5 text-slate-300" />
              没有匹配页面
            </div>
          ) : (
            <div className="space-y-1">
              {listItems.map((page) => (
                <button
                  key={page.pageKey}
                  type="button"
                  onClick={() => void selectPage(page.pageKey)}
                  className={cn(
                    "block w-full rounded-lg border px-2.5 py-2 text-left transition-colors",
                    selectedPageKey === page.pageKey
                      ? "border-indigo-200 bg-indigo-50 text-indigo-950"
                      : "border-transparent hover:border-slate-200 hover:bg-white",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {page.title}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-4 text-slate-500">
                    {page.goal}
                  </p>
                  {mode === "published" ? (
                    <p className="mt-1.5 text-[11px] font-medium tabular-nums text-slate-400">
                      {page.factCount || 0} Facts
                    </p>
                  ) : (
                    <p className="mt-1.5 truncate font-mono text-[10px] text-slate-400">
                      {page.pageKey}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      <section className="min-h-0 overflow-auto bg-white">
        {!selectedPageKey || !selectedPageExists ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-500">
            从左侧选择一个页面查看正文。
          </div>
        ) : detailLoading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" />
            加载页面中
          </div>
        ) : detailError ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-rose-600">
            {detailError}
          </div>
        ) : detail ? (
          <div className="mx-auto max-w-4xl px-5 py-5 lg:px-7">
            <header className="border-b border-slate-200 pb-4">
              <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[11px] text-slate-400">
                    {detail.pageKey}
                  </p>
                  <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
                    {detail.title}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {detail.goal}
                  </p>
                </div>
                {mode === "published" && onRequestDelete && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="shrink-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                    onClick={() =>
                      onRequestDelete({
                        pageKey: detail.pageKey,
                        revisionId: revisionId || "",
                        title: detail.title,
                        factCount: detail.keyFacts.length,
                        affectedPageCount: pages.filter(
                          (page) =>
                            page.pageKey !== detail.pageKey &&
                            page.relatedPageKeys.includes(detail.pageKey),
                        ).length,
                        stagingRetainsPage: stagingPageKeySet.has(
                          detail.pageKey,
                        ),
                      })
                    }
                  >
                    <Trash2 />
                    删除页面
                  </Button>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                {detail.sourceIds.map((sourceId) => (
                  <button
                    key={sourceId}
                    type="button"
                    onClick={() => onOpenSource(sourceId)}
                    title={sourceId}
                    className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-slate-600 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-800"
                  >
                    {sourceNames[sourceId] || sourceId}
                  </button>
                ))}
                {detail.relatedPageKeys.map((pageKey) => (
                  <button
                    key={pageKey}
                    type="button"
                    onClick={() => void selectPage(pageKey)}
                    className="inline-flex items-center gap-1 rounded-md border border-indigo-100 bg-indigo-50 px-2 py-1 font-mono text-indigo-700 hover:bg-indigo-100"
                  >
                    <Link2 className="size-3" />
                    {pageKey}
                  </button>
                ))}
              </div>
            </header>
            <MarkdownRenderer content={detail.bodyMarkdown} className="py-5" />
            {detail.keyFacts.length > 0 && (
              <section className="border-t border-slate-200 pt-4">
                <h3 className="text-sm font-semibold text-slate-900">
                  Key Facts
                </h3>
                <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50/50">
                  {detail.keyFacts.map((fact, index) => (
                    <li
                      key={`${fact.sourceId}-${fact.sourceLine}-${index}`}
                      className="px-3 py-2 text-sm text-slate-700"
                    >
                      <p>{fact.fact}</p>
                      <div className="mt-1 text-[11px]">
                        <button
                          type="button"
                          onClick={() =>
                            onOpenSource(fact.sourceId, fact.sourceLine)
                          }
                          className="inline-flex items-center gap-1 font-mono text-slate-400 hover:text-sky-700"
                        >
                          <MapPin className="size-3" />
                          {sourceNames[fact.sourceId] || fact.sourceId}
                          {fact.sourceLine === null
                            ? " · 未定位行号"
                            : ` · 第 ${fact.sourceLine} 行附近`}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
