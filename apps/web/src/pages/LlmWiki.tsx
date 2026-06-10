import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Trash2,
  Upload,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { PageHead } from "@/components/PageHead";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  LlmWikiIssue,
  LlmWikiLintMode,
  LlmWikiPage,
  LlmWikiSearchHit,
  LlmWikiSchema,
  LlmWikiSource,
  LlmWikiStats,
  LlmWikiTree,
  llmWikiApi,
} from "@/api/llmWiki";

const emptyStats: LlmWikiStats = {
  total: 0,
  uploaded: 0,
  ingesting: 0,
  ready: 0,
  failed: 0,
  page_count: 0,
};

const statCards = [
  {
    key: "uploaded",
    label: "待解析",
    className: "border-amber-200/80 bg-amber-50/80 text-amber-700",
  },
  {
    key: "ingesting",
    label: "解析中",
    className: "border-indigo-200/80 bg-indigo-50/80 text-indigo-700",
  },
  {
    key: "ready",
    label: "已解析",
    className: "border-emerald-200/80 bg-emerald-50/80 text-emerald-700",
  },
  {
    key: "failed",
    label: "失败",
    className: "border-rose-200/80 bg-rose-50/80 text-rose-700",
  },
] as const;

const wikiStatusLabels = {
  uploaded: "待解析",
  ingesting: "解析中",
  ready: "已解析",
  failed: "失败",
};

type StatusFilter = "all" | LlmWikiSource["status"];

export function LlmWiki() {
  const [sources, setSources] = useState<LlmWikiSource[]>([]);
  const [stats, setStats] = useState<LlmWikiStats>(emptyStats);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState<StatusFilter>("all");
  const [nameFilter, setNameFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [renameSource, setRenameSource] = useState<LlmWikiSource | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteSource, setDeleteSource] = useState<LlmWikiSource | null>(null);
  const [rawSource, setRawSource] = useState<{
    source_id: string;
    filename: string;
    content: string;
  } | null>(null);
  const [tree, setTree] = useState<LlmWikiTree | null>(null);
  const [wikiOpen, setWikiOpen] = useState(false);
  const [activePath, setActivePath] = useState("index.md");
  const [activePage, setActivePage] = useState<LlmWikiPage | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageSaving, setPageSaving] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LlmWikiSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [lintMode, setLintMode] = useState<LlmWikiLintMode>("all");
  const [lintLoading, setLintLoading] = useState(false);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [schema, setSchema] = useState<LlmWikiSchema | null>(null);
  const [schemaDraft, setSchemaDraft] = useState("");
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaSaving, setSchemaSaving] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [issues, setIssues] = useState<LlmWikiIssue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await llmWikiApi.listSources(silent);
      setSources(res.items || []);
      setStats(res.stats || emptyStats);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (!sources.some((source) => source.status === "ingesting")) return;
    const timer = window.setInterval(() => {
      void refresh(true);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [refresh, sources]);

  const filteredSources = useMemo(() => {
    const keyword = nameFilter.trim().toLowerCase();
    return sources.filter((source) => {
      const nameMatched = keyword
        ? source.filename.toLowerCase().includes(keyword)
        : true;
      const statusMatched =
        statusFilter === "all" ? true : source.status === statusFilter;
      return nameMatched && statusMatched;
    });
  }, [nameFilter, sources, statusFilter]);

  const handleUpload = async (files?: FileList | null) => {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    setUploading(true);
    try {
      for (const file of selected) {
        await llmWikiApi.uploadSource(file);
      }
      toast.success(selected.length > 1 ? `已上传 ${selected.length} 个文档` : "上传完成");
      await refresh(true);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleIngest = async (source: LlmWikiSource) => {
    await llmWikiApi.ingestSource(source.source_id);
    toast.success(source.status === "ready" ? "已启动重新解析" : "已启动解析");
    await refresh(true);
  };

  const handleRename = (source: LlmWikiSource) => {
    setRenameSource(source);
    setRenameValue(source.filename);
  };

  const confirmRename = async () => {
    if (!renameSource) return;
    const filename = renameValue.trim();
    if (!filename) {
      toast.error("文档名不能为空");
      return;
    }
    await llmWikiApi.renameSource(renameSource.source_id, filename);
    toast.success("重命名完成");
    setRenameSource(null);
    setRenameValue("");
    await refresh(true);
  };

  const confirmDelete = async () => {
    if (!deleteSource) return;
    await llmWikiApi.deleteSource(deleteSource.source_id);
    toast.success("删除完成");
    setDeleteSource(null);
    await refresh(true);
    if (wikiOpen) await reloadTree();
  };

  const openRaw = async (source: LlmWikiSource) => {
    const res = await llmWikiApi.rawSource(source.source_id);
    setRawSource(res);
  };

  const reloadTree = async () => {
    const res = await llmWikiApi.tree();
    setTree(res);
  };

  const openWiki = async (path = "index.md") => {
    await reloadTree();
    await loadPage(path);
    setWikiOpen(true);
  };

  const loadPage = async (path: string) => {
    setPageLoading(true);
    try {
      const page = await llmWikiApi.page(path);
      setActivePath(page.path);
      setActivePage(page);
    } finally {
      setPageLoading(false);
    }
  };

  const savePage = async () => {
    if (!activePage) return;
    setPageSaving(true);
    try {
      const page = await llmWikiApi.savePage(activePath, activePage.content);
      setActivePage(page);
      await reloadTree();
      toast.success("wiki 页面已保存");
    } finally {
      setPageSaving(false);
    }
  };

  const deletePage = async () => {
    if (!activePage || activePage.path === "index.md") return;
    await llmWikiApi.deletePage(activePage.path);
    toast.success("wiki 页面已删除");
    await reloadTree();
    await loadPage("index.md");
    await refresh(true);
  };

  const runSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const res = await llmWikiApi.search(q, 20);
      setHits(res.hits || []);
      if (!res.hits?.length) toast.info("没有匹配结果");
    } finally {
      setSearching(false);
    }
  };

  const openSearchHit = async (hit: LlmWikiSearchHit) => {
    setSearchOpen(false);
    await openWiki(hit.path);
  };

  const loadIssues = async (silent = false) => {
    if (!silent) setIssuesLoading(true);
    try {
      const res = await llmWikiApi.issues("open");
      const next = res.items || [];
      setIssues(next);
      return next;
    } finally {
      if (!silent) setIssuesLoading(false);
    }
  };

  const openSchema = async () => {
    setSchemaOpen(true);
    setSchemaLoading(true);
    try {
      const res = await llmWikiApi.schema();
      setSchema(res);
      setSchemaDraft(res.content || "");
    } finally {
      setSchemaLoading(false);
    }
  };

  const saveSchema = async () => {
    setSchemaSaving(true);
    try {
      const res = await llmWikiApi.saveSchema(schemaDraft);
      setSchema(res);
      setSchemaDraft(res.content || "");
      toast.success("Schema 已保存");
    } finally {
      setSchemaSaving(false);
    }
  };

  const openDiagnostics = async () => {
    setDiagnosticsOpen(true);
    await loadIssues();
  };

  const runLint = async () => {
    setDiagnosticsOpen(true);
    setLintLoading(true);
    try {
      await llmWikiApi.lint(lintMode);
      const next = await loadIssues(true);
      if (!next.length) {
        toast.success("诊断未发现 open issue");
      } else {
        toast.info(`检查完成，当前 ${next.length} 个 open issue`);
      }
    } finally {
      setLintLoading(false);
    }
  };

  const resolveIssue = async (issue: LlmWikiIssue) => {
    await llmWikiApi.resolveIssue(issue.id);
    setIssues((items) => items.filter((item) => item.id !== issue.id));
    toast.success("Issue 已解决");
  };

  const openIssueTarget = async (issue: LlmWikiIssue) => {
    if (!isWikiPageTarget(issue.target)) return;
    try {
      await openWiki(issue.target);
      setDiagnosticsOpen(false);
    } catch {
      toast.error("目标页面不存在，可能已被删除或 issue 已过期");
    }
  };

  const copyIssueTarget = async (issue: LlmWikiIssue) => {
    try {
      await navigator.clipboard.writeText(issue.target);
      toast.success("Target 已复制");
    } catch {
      toast.error("复制失败");
    }
  };

  return (
    <div className="space-y-5 p-4 sm:p-5">
      <PageHead title="LLM Wiki" />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => (
          <div
            key={card.key}
            className={`rounded-lg border p-4 shadow-sm backdrop-blur ${card.className}`}
          >
            <div className="text-2xl font-semibold">{stats[card.key]}</div>
            <div className="mt-1 text-xs opacity-80">{card.label}</div>
          </div>
        ))}
      </section>

      <Card className="border-slate-200/70 bg-white/85 backdrop-blur">
        <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100">
          <CardTitle className="text-sm font-semibold">Source 列表</CardTitle>
          <span className="text-xs text-slate-500">
            显示 {filteredSources.length} 个，共 {stats.total} 个，wiki 页面 {stats.page_count} 个
          </span>
        </CardHeader>
        <CardContent className="px-0 py-0">
          <div className="flex flex-col gap-2 border-b border-slate-100 p-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    setNameFilter(nameDraft);
                    setStatusFilter(statusDraft);
                  }
                }}
                placeholder="按文档名搜索"
                className="h-8 sm:max-w-[320px]"
              />
              <Select
                value={statusDraft}
                onValueChange={(value) => setStatusDraft(value as StatusFilter)}
              >
                <SelectTrigger className="h-8 w-full bg-white sm:w-[140px]">
                  <SelectValue placeholder="全部状态" />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="uploaded">待解析</SelectItem>
                  <SelectItem value="ingesting">解析中</SelectItem>
                  <SelectItem value="ready">已解析</SelectItem>
                  <SelectItem value="failed">失败</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                disabled={loading}
                onClick={() => {
                  setNameFilter(nameDraft);
                  setStatusFilter(statusDraft);
                }}
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Search className="size-4" />
                )}
                搜索
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".md,.txt,text/markdown,text/plain"
                className="hidden"
                onChange={(event) => handleUpload(event.target.files)}
              />
              <Button
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload size={14} />
                )}
                上传文档
              </Button>
              <Button variant="outline" onClick={() => openWiki()}>
                <FolderOpen className="size-4" />
                查看 Wiki
              </Button>
              <Button variant="outline" onClick={() => setSearchOpen(true)}>
                <Search className="size-4" />
                Wiki 搜索
              </Button>
              <Button variant="outline" onClick={openSchema}>
                <Settings2 className="size-4" />
                Schema
              </Button>
              <Button variant="outline" onClick={openDiagnostics}>
                <AlertTriangle className="size-4" />
                诊断
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="w-[260px] px-4 py-2 text-center font-medium">文档</th>
                  <th className="min-w-[96px] px-4 py-2 text-center font-medium">状态</th>
                  <th className="min-w-[96px] px-4 py-2 text-center font-medium">大小</th>
                  <th className="min-w-[180px] px-4 py-2 text-center font-medium">上传时间</th>
                  <th className="min-w-[96px] px-4 py-2 text-center font-medium">生成页面</th>
                  <th className="min-w-[320px] px-4 py-2 text-center font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredSources.length ? (
                  filteredSources.map((source) => (
                    <SourceRow
                      key={source.source_id}
                      source={source}
                      onIngest={handleIngest}
                      onOpenRaw={openRaw}
                      onOpenWiki={openWiki}
                      onRename={handleRename}
                      onDelete={setDeleteSource}
                    />
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-10 text-center text-slate-400" colSpan={6}>
                      没有匹配文档
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <WikiDialog
        open={wikiOpen}
        onOpenChange={setWikiOpen}
        tree={tree}
        activePath={activePath}
        page={activePage}
        loading={pageLoading}
        saving={pageSaving}
        onSelectPage={loadPage}
        onContentChange={(content) =>
          setActivePage((page) => (page ? { ...page, content } : page))
        }
        onSave={savePage}
        onDelete={deletePage}
      />

      <RawDialog source={rawSource} onOpenChange={(open) => !open && setRawSource(null)} />

      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        query={query}
        onQueryChange={setQuery}
        hits={hits}
        searching={searching}
        onSearch={runSearch}
        onOpenHit={openSearchHit}
      />

      <SchemaDialog
        open={schemaOpen}
        onOpenChange={setSchemaOpen}
        schema={schema}
        draft={schemaDraft}
        loading={schemaLoading}
        saving={schemaSaving}
        onDraftChange={setSchemaDraft}
        onSave={saveSchema}
      />

      <DiagnosticsDialog
        open={diagnosticsOpen}
        onOpenChange={setDiagnosticsOpen}
        issues={issues}
        issuesLoading={issuesLoading}
        lintLoading={lintLoading}
        lintMode={lintMode}
        onLintModeChange={setLintMode}
        onRunLint={runLint}
        onRefresh={() => loadIssues()}
        onResolve={resolveIssue}
        onOpenTarget={openIssueTarget}
        onCopyTarget={copyIssueTarget}
      />

      <RenameDialog
        source={renameSource}
        value={renameValue}
        onValueChange={setRenameValue}
        onOpenChange={(open) => {
          if (!open) setRenameSource(null);
        }}
        onConfirm={confirmRename}
      />

      <DeleteDialog
        source={deleteSource}
        onOpenChange={(open) => {
          if (!open) setDeleteSource(null);
        }}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function SourceRow({
  source,
  onIngest,
  onOpenRaw,
  onOpenWiki,
  onRename,
  onDelete,
}: {
  source: LlmWikiSource;
  onIngest: (source: LlmWikiSource) => void;
  onOpenRaw: (source: LlmWikiSource) => void;
  onOpenWiki: (path?: string) => void;
  onRename: (source: LlmWikiSource) => void;
  onDelete: (source: LlmWikiSource) => void;
}) {
  const ingesting = source.status === "ingesting";
  const summaryPath = `summaries/${source.source_id}.md`;
  const uploadedTime = formatTime(source.uploaded_at);
  const ingestedTime = formatTime(source.ingested_at) || "-";
  return (
    <tr className="border-t border-slate-100 align-middle">
      <td className="w-[260px] max-w-[260px] px-4 py-3 text-center">
        <button
          className={[
            "mx-auto block max-w-[220px] truncate whitespace-nowrap text-center font-medium hover:underline",
            source.status === "ready"
              ? "text-indigo-600 hover:text-indigo-700"
              : "text-slate-900 hover:text-slate-700",
          ].join(" ")}
          onClick={() => onOpenWiki(source.status === "ready" ? summaryPath : "index.md")}
          title={source.filename}
        >
          {source.filename}
        </button>
        <div className="mx-auto mt-0.5 max-w-[220px] truncate whitespace-nowrap font-mono text-xs text-slate-400" title={source.source_id}>
          {source.source_id}
        </div>
        {source.error && (
          <div className="mx-auto mt-1 max-w-[220px] truncate rounded bg-rose-50 px-2 py-1 text-xs text-rose-600" title={source.error}>
            {source.error}
          </div>
        )}
      </td>
      <td className="min-w-[96px] px-4 py-3 text-center">
        <WikiStatusTag status={source.status} />
      </td>
      <td className="min-w-[96px] whitespace-nowrap px-4 py-3 text-center text-slate-600">{formatBytes(source.size)}</td>
      <td
        className="min-w-[180px] whitespace-nowrap px-4 py-3 text-center text-slate-500"
        title={`上传时间：${uploadedTime || "-"}\n解析时间：${ingestedTime}`}
      >
        {uploadedTime}
      </td>
      <td className="min-w-[96px] whitespace-nowrap px-4 py-3 text-center">{source.touched_pages.length || "-"}</td>
      <td className="min-w-[320px] px-4 py-3 text-center">
        <div className="inline-flex items-center justify-center gap-3 whitespace-nowrap text-xs">
          <button
            className="whitespace-nowrap text-indigo-600 disabled:text-slate-300"
            disabled={ingesting}
            onClick={() => onIngest(source)}
          >
            {source.status === "ready" ? "重新解析" : "解析"}
          </button>
          <button className="whitespace-nowrap text-slate-600" onClick={() => onOpenRaw(source)}>
            源文
          </button>
          <button
            className="whitespace-nowrap text-emerald-600 disabled:text-slate-300"
            disabled={source.status !== "ready"}
            onClick={() => onOpenWiki(summaryPath)}
          >
            Wiki
          </button>
          <button className="whitespace-nowrap text-slate-600" onClick={() => onRename(source)}>
            重命名
          </button>
          <button
            className="whitespace-nowrap text-rose-600 disabled:text-slate-300"
            disabled={ingesting}
            onClick={() => onDelete(source)}
          >
            删除
          </button>
        </div>
      </td>
    </tr>
  );
}

function WikiStatusTag({ status }: { status: LlmWikiSource["status"] }) {
  const statusClasses: Record<LlmWikiSource["status"], string> = {
    uploaded: "border-amber-200 bg-amber-50 text-amber-700",
    ingesting: "border-indigo-200 bg-indigo-50 text-indigo-700",
    ready: "border-emerald-200 bg-emerald-50 text-emerald-700",
    failed: "border-rose-200 bg-rose-50 text-rose-700",
  };
  return (
    <span className={`inline-flex min-w-[68px] items-center justify-center rounded-md border px-2 py-0.5 text-xs ${statusClasses[status]}`}>
      {wikiStatusLabels[status]}
    </span>
  );
}

function WikiDialog({
  open,
  onOpenChange,
  tree,
  activePath,
  page,
  loading,
  saving,
  onSelectPage,
  onContentChange,
  onSave,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tree: LlmWikiTree | null;
  activePath: string;
  page: LlmWikiPage | null;
  loading: boolean;
  saving: boolean;
  onSelectPage: (path: string) => void;
  onContentChange: (content: string) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                  {page?.title || activePath}
                </div>
                <div className="mt-0.5 truncate font-mono text-xs text-slate-400">
                  {activePath}
                </div>
              </div>
              {loading && <Loader2 className="size-4 animate-spin text-slate-400" />}
            </div>
            <Textarea
              value={page?.content || ""}
              onChange={(event) => onContentChange(event.target.value)}
              className="min-h-0 flex-1 resize-none rounded-none border-0 font-mono text-sm leading-6 focus-visible:ring-0"
              placeholder="选择左侧 wiki 页面"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button
            variant="destructive"
            disabled={!page || page.path === "index.md"}
            onClick={onDelete}
          >
            <Trash2 className="size-4" />
            删除页面
          </Button>
          <Button disabled={!page || saving} onClick={onSave}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RawDialog({
  source,
  onOpenChange,
}: {
  source: { source_id: string; filename: string; content: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!source} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] overflow-hidden sm:max-w-[900px]">
        <DialogHeader>
          <DialogTitle>{source?.filename || "源文"}</DialogTitle>
        </DialogHeader>
        <Textarea
          readOnly
          value={source?.content || ""}
          className="h-[62vh] resize-none font-mono text-sm leading-6"
        />
      </DialogContent>
    </Dialog>
  );
}

function SearchDialog({
  open,
  onOpenChange,
  query,
  onQueryChange,
  hits,
  searching,
  onSearch,
  onOpenHit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  hits: LlmWikiSearchHit[];
  searching: boolean;
  onSearch: () => void;
  onOpenHit: (hit: LlmWikiSearchHit) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
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
                  <span className="font-medium text-slate-900">{hit.title}</span>
                  <span className="font-mono text-xs text-slate-400">{hit.path}</span>
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
  );
}

function DiagnosticsDialog({
  open,
  onOpenChange,
  issues,
  issuesLoading,
  lintLoading,
  lintMode,
  onLintModeChange,
  onRunLint,
  onRefresh,
  onResolve,
  onOpenTarget,
  onCopyTarget,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issues: LlmWikiIssue[];
  issuesLoading: boolean;
  lintLoading: boolean;
  lintMode: LlmWikiLintMode;
  onLintModeChange: (mode: LlmWikiLintMode) => void;
  onRunLint: () => void;
  onRefresh: () => void;
  onResolve: (issue: LlmWikiIssue) => void;
  onOpenTarget: (issue: LlmWikiIssue) => void;
  onCopyTarget: (issue: LlmWikiIssue) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const counts = countIssues(issues);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] flex-col overflow-hidden sm:max-w-[1080px]">
        <DialogHeader>
          <DialogTitle>Wiki 诊断</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <IssueCountBadge label="Open" value={issues.length} className="border-slate-200 bg-white text-slate-700" />
            <IssueCountBadge label="Error" value={counts.error} className="border-rose-200 bg-rose-50 text-rose-700" />
            <IssueCountBadge label="Warning" value={counts.warning} className="border-amber-200 bg-amber-50 text-amber-700" />
            <IssueCountBadge label="Info" value={counts.info} className="border-sky-200 bg-sky-50 text-sky-700" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={lintMode} onValueChange={(value) => onLintModeChange(value as LlmWikiLintMode)}>
              <SelectTrigger className="h-9 w-[130px] bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end">
                <SelectItem value="all">全部检查</SelectItem>
                <SelectItem value="structural">结构检查</SelectItem>
                <SelectItem value="evidence">证据检查</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" disabled={issuesLoading || lintLoading} onClick={onRefresh}>
              {issuesLoading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              刷新
            </Button>
            <Button disabled={lintLoading} onClick={onRunLint}>
              {lintLoading ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}
              立即检查
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">级别</th>
                <th className="px-3 py-2 text-left font-medium">类型</th>
                <th className="px-3 py-2 text-left font-medium">目标</th>
                <th className="px-3 py-2 text-left font-medium">说明</th>
                <th className="px-3 py-2 text-left font-medium">建议</th>
                <th className="px-3 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {issuesLoading && !issues.length ? (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-slate-400">
                    <Loader2 className="mx-auto mb-2 size-4 animate-spin" />
                    加载中
                  </td>
                </tr>
              ) : issues.length ? (
                issues.map((issue) => {
                  const targetIsPage = isWikiPageTarget(issue.target);
                  const expanded = expandedId === issue.id;
                  return (
                    <Fragment key={issue.id}>
                      <tr className="border-t border-slate-100 align-top">
                        <td className="px-3 py-2">
                          <IssueSeverityBadge severity={issue.severity} />
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-600">{issue.kind}</td>
                        <td className="max-w-[220px] px-3 py-2 font-mono text-xs text-slate-500">
                          <span className="line-clamp-2 break-all">{issue.target}</span>
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          <div>{issue.message}</div>
                          {issue.details && (
                            <button
                              className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700"
                              onClick={() => setExpandedId(expanded ? null : issue.id)}
                            >
                              <ChevronRight className={`size-3 transition ${expanded ? "rotate-90" : ""}`} />
                              详情
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs leading-5 text-slate-500">
                          {issueAdvice(issue.kind)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!targetIsPage}
                              onClick={() => onOpenTarget(issue)}
                            >
                              <ExternalLink className="size-3" />
                              {targetIsPage ? "打开页面" : "不可定位"}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => onCopyTarget(issue)}>
                              <Copy className="size-3" />
                              复制
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => onResolve(issue)}>
                              标记解决
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr key={`${issue.id}-details`} className="border-t border-slate-100 bg-slate-50/60">
                          <td colSpan={6} className="px-3 py-3 text-xs leading-5 text-slate-500">
                            <div className="grid gap-2 md:grid-cols-[1fr_260px]">
                              <pre className="whitespace-pre-wrap break-words rounded-md bg-white p-3 font-mono text-xs text-slate-600">
                                {issue.details || "无详情"}
                              </pre>
                              <div className="space-y-1 rounded-md bg-white p-3">
                                <div>source_ids: {issue.source_ids.length ? issue.source_ids.join(", ") : "-"}</div>
                                <div>created_at: {formatTime(issue.created_at) || "-"}</div>
                                <div>updated_at: {formatTime(issue.updated_at) || "-"}</div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-slate-400">
                    暂无 open issue
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function IssueCountBadge({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${className}`}>
      <span>{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}

function IssueSeverityBadge({ severity }: { severity: LlmWikiIssue["severity"] }) {
  const className =
    severity === "error"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : severity === "info"
        ? "border-sky-200 bg-sky-50 text-sky-700"
        : "border-amber-200 bg-amber-50 text-amber-700";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${className}`}>
      {severity}
    </span>
  );
}

function countIssues(issues: LlmWikiIssue[]) {
  return issues.reduce(
    (counts, issue) => {
      counts[issue.severity] += 1;
      return counts;
    },
    { error: 0, warning: 0, info: 0 },
  );
}

function issueAdvice(kind: string): string {
  const advice: Record<string, string> = {
    dead_link: "打开页面，修正或删除对应 wikilink。",
    orphan_page: "从相关页面增加链接，或确认该页可独立存在后标记解决。",
    index_missing: "打开页面核对后手动维护 index，或重新 ingest/rebuild index。",
    missing_claim_source: "在正文关键结论旁补充 source id 标注。",
    schema_drift: "按当前 schema 重新 ingest，或人工确认后标记解决。",
    conflict: "人工回读 source，对冲突结论做保留、改写或标注未确认。",
    weak_evidence: "补充证据 source，或在页面中标注证据不足。",
    needs_reconcile: "删除或变更 source 后需要人工核对页面剩余结论。",
  };
  return advice[kind] || "打开目标页面核对，完成处理后标记解决。";
}

function SchemaDialog({
  open,
  onOpenChange,
  schema,
  draft,
  loading,
  saving,
  onDraftChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schema: LlmWikiSchema | null;
  draft: string;
  loading: boolean;
  saving: boolean;
  onDraftChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] overflow-hidden sm:max-w-[900px]">
        <DialogHeader>
          <DialogTitle>LLM Wiki Schema</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          <span className="font-mono">sha256: {schema?.sha256 || "-"}</span>
          {loading && <Loader2 className="size-4 animate-spin" />}
        </div>
        <Textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          className="h-[58vh] resize-none font-mono text-sm leading-6"
          placeholder="加载 schema 中"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button disabled={loading || saving || !draft.trim()} onClick={onSave}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({
  source,
  value,
  onValueChange,
  onOpenChange,
  onConfirm,
}: {
  source: LlmWikiSource | null;
  value: string;
  onValueChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={!!source} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>重命名文档</DialogTitle>
        </DialogHeader>
        <Input
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onConfirm();
          }}
          placeholder="请输入文档名"
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onConfirm}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  source,
  onOpenChange,
  onConfirm,
}: {
  source: LlmWikiSource | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={!!source} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>删除文档</DialogTitle>
        </DialogHeader>
        <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          确认删除 {source?.filename || "该文档"}？对应 summary 和只引用该 source 的页面会一起删除。
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function isWikiPageTarget(target?: string): boolean {
  const value = String(target || "").trim();
  if (!value || /^[a-f0-9]{32}$/i.test(value)) return false;
  return value.endsWith(".md") || value.includes("/");
}
