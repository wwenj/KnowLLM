import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Pagination } from "@/components/ui/pagination";
import {
  llmWikiApi,
  type LlmWikiIssue,
  type LlmWikiLintMode,
  type LlmWikiPage,
  type LlmWikiSearchHit,
  type LlmWikiSchema,
  type LlmWikiSource,
  type LlmWikiStats,
  type LlmWikiTree,
} from "@/api/llmWiki";
import { modelApi, type ModelOption } from "@/api/model";
import { DiagnosticsDialog } from "./components/DiagnosticsDialog";
import { LlmWikiDialogs } from "./components/LlmWikiDialogs";
import { LlmWikiHeader } from "./components/LlmWikiHeader";
import { SourceBulkActions } from "./components/SourceBulkActions";
import { SourceFilters } from "./components/SourceFilters";
import { SourceTable } from "./components/SourceTable";
import { defaultSourcePageSize, emptyStats } from "./constants";
import type { BulkAction, RawSource, StatusFilter } from "./types";
import { isWikiPageTarget } from "./utils";

const INGEST_MODEL_STORAGE_KEY = "knowllm.llmWiki.ingestModel";

export function LlmWiki() {
  const [sources, setSources] = useState<LlmWikiSource[]>([]);
  const [stats, setStats] = useState<LlmWikiStats>(emptyStats);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [modelLoading, setModelLoading] = useState(true);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [ingestModel, setIngestModel] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState<StatusFilter>("all");
  const [nameFilter, setNameFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [renameSource, setRenameSource] = useState<LlmWikiSource | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteSource, setDeleteSource] = useState<LlmWikiSource | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [sourcePage, setSourcePage] = useState(1);
  const [sourcePageSize, setSourcePageSize] = useState(defaultSourcePageSize);
  const [bulkAction, setBulkAction] = useState<BulkAction>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [rawSource, setRawSource] = useState<RawSource | null>(null);
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
      const nextSources = res.items || [];
      const selectableIds = new Set(
        nextSources
          .filter((source) => source.status !== "ingesting")
          .map((source) => source.source_id),
      );
      setSources(nextSources);
      setStats(res.stats || emptyStats);
      setSelectedSourceIds((ids) => ids.filter((id) => selectableIds.has(id)));
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
    let cancelled = false;
    const loadModels = async () => {
      setModelLoading(true);
      try {
        const res = await modelApi.list(true);
        if (cancelled) return;
        const options = res.items || [];
        const stored = window.localStorage.getItem(INGEST_MODEL_STORAGE_KEY) || "";
        const selected = options.some((option) => option.id === stored)
          ? stored
          : options[0]?.id || "";
        setModelOptions(options);
        setIngestModel(selected);
      } finally {
        if (!cancelled) setModelLoading(false);
      }
    };
    void loadModels();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const sourceTotalPages = Math.max(
    1,
    Math.ceil(filteredSources.length / sourcePageSize),
  );
  const currentSourcePage = Math.min(sourcePage, sourceTotalPages);
  const pagedSources = useMemo(() => {
    const start = (currentSourcePage - 1) * sourcePageSize;
    return filteredSources.slice(start, start + sourcePageSize);
  }, [currentSourcePage, filteredSources, sourcePageSize]);
  const selectedSourceIdSet = useMemo(
    () => new Set(selectedSourceIds),
    [selectedSourceIds],
  );
  const selectedSources = useMemo(
    () =>
      filteredSources.filter(
        (source) =>
          source.status !== "ingesting" &&
          selectedSourceIdSet.has(source.source_id),
      ),
    [filteredSources, selectedSourceIdSet],
  );
  const pageSelectableSources = useMemo(
    () => pagedSources.filter((source) => source.status !== "ingesting"),
    [pagedSources],
  );
  const pageSelectedCount = pageSelectableSources.filter((source) =>
    selectedSourceIdSet.has(source.source_id),
  ).length;
  const allPageSelected =
    pageSelectableSources.length > 0 &&
    pageSelectedCount === pageSelectableSources.length;
  const somePageSelected = pageSelectedCount > 0 && !allPageSelected;
  const bulkBusy = bulkAction !== null;

  const handleUpload = async (files?: FileList | null) => {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    setUploading(true);
    try {
      for (const file of selected) {
        await llmWikiApi.uploadSource(file);
      }
      toast.success(
        selected.length > 1 ? `已上传 ${selected.length} 个文档` : "上传完成",
      );
      await refresh(true);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleIngest = async (source: LlmWikiSource) => {
    if (!ingestModel) {
      toast.error("请先选择解析模型");
      return;
    }
    await llmWikiApi.ingestSource(source.source_id, ingestModel);
    toast.success(source.status === "ready" ? "已启动重新解析" : "已启动解析");
    await refresh(true);
  };

  const setSourceSelected = (source: LlmWikiSource, selected: boolean) => {
    if (source.status === "ingesting") return;
    setSelectedSourceIds((ids) => {
      if (selected) {
        return ids.includes(source.source_id)
          ? ids
          : [...ids, source.source_id];
      }
      return ids.filter((id) => id !== source.source_id);
    });
  };

  const togglePageSelected = (selected: boolean) => {
    const pageIds = pageSelectableSources.map((source) => source.source_id);
    setSelectedSourceIds((ids) => {
      if (selected) {
        const next = new Set(ids);
        pageIds.forEach((id) => next.add(id));
        return Array.from(next);
      }
      return ids.filter((id) => !pageIds.includes(id));
    });
  };

  const clearSelection = () => setSelectedSourceIds([]);

  const toggleSelectionMode = () => {
    if (selectionMode) clearSelection();
    setSelectionMode(!selectionMode);
  };

  const applySourceFilters = () => {
    setNameFilter(nameDraft);
    setStatusFilter(statusDraft);
    setSourcePage(1);
    clearSelection();
  };

  const handleBulkIngest = async () => {
    if (!ingestModel) {
      toast.error("请先选择解析模型");
      return;
    }
    const targets = selectedSources.filter(
      (source) => source.status !== "ingesting",
    );
    if (!targets.length) {
      toast.info("没有可解析的已选文档");
      return;
    }
    setBulkAction("ingest");
    try {
      for (const source of targets) {
        await llmWikiApi.ingestSource(source.source_id, ingestModel);
      }
      toast.success(`已启动 ${targets.length} 个文档解析`);
      clearSelection();
      await refresh(true);
    } finally {
      setBulkAction(null);
    }
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
    setSelectedSourceIds((ids) =>
      ids.filter((id) => id !== deleteSource.source_id),
    );
    setDeleteSource(null);
    await refresh(true);
    if (wikiOpen) await reloadTree();
  };

  const confirmBulkDelete = async () => {
    const targets = selectedSources.filter(
      (source) => source.status !== "ingesting",
    );
    if (!targets.length) {
      setBulkDeleteOpen(false);
      toast.info("没有可删除的已选文档");
      return;
    }
    setBulkAction("delete");
    try {
      for (const source of targets) {
        await llmWikiApi.deleteSource(source.source_id);
      }
      toast.success(`已删除 ${targets.length} 个文档`);
      clearSelection();
      setBulkDeleteOpen(false);
      await refresh(true);
      if (wikiOpen) await reloadTree();
    } finally {
      setBulkAction(null);
    }
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
    <div className="flex h-full min-h-0 flex-col bg-white">
      <LlmWikiHeader
        stats={stats}
        uploading={uploading}
        loading={loading}
        modelLoading={modelLoading}
        model={ingestModel}
        modelOptions={modelOptions}
        fileRef={fileRef}
        onUpload={(files) => void handleUpload(files)}
        onOpenWiki={() => void openWiki()}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenSchema={() => void openSchema()}
        onOpenDiagnostics={() => void openDiagnostics()}
        onModelChange={(model) => {
          setIngestModel(model);
          window.localStorage.setItem(INGEST_MODEL_STORAGE_KEY, model);
        }}
        onRefresh={() => void refresh()}
      />

      <section className="flex min-h-0 flex-1 flex-col">
        <SourceFilters
          stats={stats}
          nameDraft={nameDraft}
          statusDraft={statusDraft}
          sourcePageSize={sourcePageSize}
          loading={loading}
          selectionMode={selectionMode}
          onNameDraftChange={setNameDraft}
          onStatusDraftChange={setStatusDraft}
          onSourcePageSizeChange={(size) => {
            setSourcePageSize(size);
            setSourcePage(1);
          }}
          onApplyFilters={applySourceFilters}
          onToggleSelectionMode={toggleSelectionMode}
        />
        {selectionMode && (
          <SourceBulkActions
            selectedCount={selectedSources.length}
            bulkAction={bulkAction}
            bulkBusy={bulkBusy}
            onBulkIngest={() => void handleBulkIngest()}
            onOpenBulkDelete={() => setBulkDeleteOpen(true)}
            onClearSelection={clearSelection}
          />
        )}
        <SourceTable
          sources={pagedSources}
          selectionMode={selectionMode}
          selectedSourceIdSet={selectedSourceIdSet}
          selectionDisabled={bulkBusy}
          allPageSelected={allPageSelected}
          somePageSelected={somePageSelected}
          pageSelectableCount={pageSelectableSources.length}
          onTogglePageSelected={togglePageSelected}
          onSelectChange={setSourceSelected}
          onIngest={(source) => void handleIngest(source)}
          onOpenRaw={(source) => void openRaw(source)}
          onOpenWiki={(path) => void openWiki(path)}
          onRename={handleRename}
          onDelete={setDeleteSource}
        />
        {filteredSources.length > 0 && (
          <div className="flex-none border-t border-slate-200 bg-white px-3 py-2">
            <Pagination
              page={currentSourcePage}
              pageSize={sourcePageSize}
              total={filteredSources.length}
              onPageChange={setSourcePage}
              ariaLabel="Source 列表分页"
              className="w-full py-0"
            />
          </div>
        )}
      </section>

      <LlmWikiDialogs
        wikiOpen={wikiOpen}
        onWikiOpenChange={setWikiOpen}
        tree={tree}
        activePath={activePath}
        activePage={activePage}
        pageLoading={pageLoading}
        pageSaving={pageSaving}
        onSelectPage={(path) => void loadPage(path)}
        onContentChange={(content) =>
          setActivePage((page) => (page ? { ...page, content } : page))
        }
        onSavePage={() => void savePage()}
        onDeletePage={() => void deletePage()}
        rawSource={rawSource}
        onRawOpenChange={(open) => !open && setRawSource(null)}
        searchOpen={searchOpen}
        onSearchOpenChange={setSearchOpen}
        query={query}
        onQueryChange={setQuery}
        hits={hits}
        searching={searching}
        onSearch={() => void runSearch()}
        onOpenHit={(hit) => void openSearchHit(hit)}
        schemaOpen={schemaOpen}
        onSchemaOpenChange={setSchemaOpen}
        schema={schema}
        schemaDraft={schemaDraft}
        schemaLoading={schemaLoading}
        schemaSaving={schemaSaving}
        onSchemaDraftChange={setSchemaDraft}
        onSaveSchema={() => void saveSchema()}
        renameSource={renameSource}
        renameValue={renameValue}
        onRenameValueChange={setRenameValue}
        onRenameOpenChange={(open) => {
          if (!open) setRenameSource(null);
        }}
        onConfirmRename={() => void confirmRename()}
        deleteSource={deleteSource}
        onDeleteOpenChange={(open) => {
          if (!open) setDeleteSource(null);
        }}
        onConfirmDelete={() => void confirmDelete()}
        bulkDeleteOpen={bulkDeleteOpen}
        bulkDeleteSources={selectedSources}
        bulkDeleteBusy={bulkAction === "delete"}
        onBulkDeleteOpenChange={setBulkDeleteOpen}
        onConfirmBulkDelete={() => void confirmBulkDelete()}
      />

      <DiagnosticsDialog
        open={diagnosticsOpen}
        onOpenChange={setDiagnosticsOpen}
        issues={issues}
        issuesLoading={issuesLoading}
        lintLoading={lintLoading}
        lintMode={lintMode}
        onLintModeChange={setLintMode}
        onRunLint={() => void runLint()}
        onRefresh={() => void loadIssues()}
        onResolve={(issue) => void resolveIssue(issue)}
        onOpenTarget={(issue) => void openIssueTarget(issue)}
        onCopyTarget={(issue) => void copyIssueTarget(issue)}
      />
    </div>
  );
}
