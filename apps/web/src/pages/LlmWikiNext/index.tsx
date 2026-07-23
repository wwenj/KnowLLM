import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/api/http";
import { modelApi, type ModelOption } from "@/api/model";
import {
  llmWikiNextApi,
  type CompileEstimate,
  type CompilePool,
  type ManifestPage,
  type SourceCompileReport,
  type SourceRecord,
  type SourceSnapshot,
  type StagingSummary,
  type WikiManifest,
} from "@/api/llmWikiNext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CompileConfirmationDialog,
  CompilePoolDialog,
} from "./components/CompileDialogs";
import { SourcePreviewDialog } from "./components/SourcePreviewDialog";
import { SourceCompileDetailDialog } from "./components/SourceCompileDetailDialog";
import {
  SourceWorkspace,
  type CompileSettings,
} from "./components/SourceWorkspace";
import {
  WikiWorkspace,
  type WikiPageDeleteTarget,
} from "./components/WikiWorkspace";

const MODEL_STORAGE_KEY = "knowllm.llmWikiNext.model";
const CONCURRENCY_STORAGE_KEY = "knowllm.llmWikiNext.concurrency";
const CONCURRENCY_OPTIONS = [1, 2, 4, 8, 16] as const;
const DEFAULT_SETTINGS: CompileSettings = {
  chunkChars: 12_000,
  plannerMaxOutputTokens: 2_000,
  writerMaxOutputTokens: 8_000,
};

function isActivePool(pool: CompilePool | null): boolean {
  return Boolean(
    pool?.items.some(
      (item) =>
        item.phase === "queued" ||
        item.phase === "planning" ||
        item.phase === "writing" ||
        item.phase === "committing",
    ),
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", { hour12: false });
}

function validInteger(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function LlmWikiNext() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState(
    () => window.localStorage.getItem(MODEL_STORAGE_KEY) || "",
  );
  const [sourceConcurrency, setSourceConcurrency] = useState(() => {
    const value = Number(window.localStorage.getItem(CONCURRENCY_STORAGE_KEY));
    return CONCURRENCY_OPTIONS.includes(
      value as (typeof CONCURRENCY_OPTIONS)[number],
    )
      ? value
      : 1;
  });
  const [settings, setSettings] = useState<CompileSettings>(DEFAULT_SETTINGS);
  const [sources, setSources] = useState<
    Awaited<ReturnType<typeof llmWikiNextApi.listSources>>["items"]
  >([]);
  const [staging, setStaging] = useState<StagingSummary | null>(null);
  const [publishedManifest, setPublishedManifest] = useState<WikiManifest>({
    revisionId: "",
    generatedAt: "",
    pages: [],
  });
  const [pool, setPool] = useState<CompilePool | null>(null);
  const [estimate, setEstimate] = useState<CompileEstimate | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [startingCompile, setStartingCompile] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState("sources");
  const [compileDialogOpen, setCompileDialogOpen] = useState(false);
  const [compilePoolDialogOpen, setCompilePoolDialogOpen] = useState(false);
  const [deleteSourceIds, setDeleteSourceIds] = useState<string[]>([]);
  const [deletePageTarget, setDeletePageTarget] =
    useState<WikiPageDeleteTarget | null>(null);
  const [deletingPage, setDeletingPage] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewSource, setPreviewSource] = useState<SourceSnapshot | null>(
    null,
  );
  const [previewSourceLine, setPreviewSourceLine] = useState<number | null>(
    null,
  );
  const [compileDetailOpen, setCompileDetailOpen] = useState(false);
  const [compileDetailLoading, setCompileDetailLoading] = useState(false);
  const [compileDetailSource, setCompileDetailSource] =
    useState<SourceRecord | null>(null);
  const [compileDetailReport, setCompileDetailReport] =
    useState<SourceCompileReport | null>(null);
  const [wikiTarget, setWikiTarget] = useState<{
    mode: "staging" | "published";
    pageKey: string;
  } | null>(null);

  const refreshWorkspace = useCallback(async (clearEstimate = false) => {
    setLoading(true);
    try {
      const [sourceData, stagingData, manifest] = await Promise.all([
        llmWikiNextApi.listSources(),
        llmWikiNextApi.getStaging(),
        llmWikiNextApi.getPublishedManifest(),
      ]);
      setSources(sourceData.items);
      setStaging(stagingData);
      setPublishedManifest(manifest);
      setPool(stagingData?.compilePool ?? null);
      if (clearEstimate) setEstimate(null);
      return stagingData;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadModels = useCallback(async () => {
    try {
      const result = await modelApi.list(true);
      setModels(result.items);
      setModel((current) => {
        const remembered = window.localStorage.getItem(MODEL_STORAGE_KEY) || "";
        const selected = current || remembered;
        return selected && result.items.some((item) => item.id === selected)
          ? selected
          : result.items[0]?.id || "";
      });
    } catch {
      setModels([]);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void Promise.all([refreshWorkspace(), loadModels()]);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loadModels, refreshWorkspace]);

  const active = isActivePool(pool);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const [nextPool, nextStaging, sourceData] = await Promise.all([
          llmWikiNextApi.getCompilePool(),
          llmWikiNextApi.getStaging(),
          llmWikiNextApi.listSources(),
        ]);
        if (cancelled) return;
        setPool(nextPool);
        setStaging(nextStaging);
        setSources(sourceData.items);
        if (!isActivePool(nextPool)) setCompilePoolDialogOpen(false);
      } catch {
        // 轮询失败时保留最后一次状态；用户可手动刷新，不把未知状态伪装成已结束。
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1_500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active]);

  const sourceNames = useMemo(
    () =>
      Object.fromEntries(
        sources.map((source) => [source.sourceId, source.filename]),
      ),
    [sources],
  );
  const publishedPages: ManifestPage[] = publishedManifest.pages;
  const publishBlocked =
    !staging ||
    staging.state.status === "publishing" ||
    publishing ||
    discarding ||
    staging.state.completedSourceIds.length === 0;
  const discardBlocked =
    !staging ||
    staging.state.status === "publishing" ||
    publishing ||
    discarding;

  const changeModel = (nextModel: string) => {
    setModel(nextModel);
    window.localStorage.setItem(MODEL_STORAGE_KEY, nextModel);
    setEstimate(null);
  };

  const changeConcurrency = (value: string) => {
    const nextConcurrency = Number(value);
    setSourceConcurrency(nextConcurrency);
    window.localStorage.setItem(
      CONCURRENCY_STORAGE_KEY,
      String(nextConcurrency),
    );
    setEstimate(null);
  };

  const changeSettings = (next: Partial<CompileSettings>) => {
    setSettings((current) => ({ ...current, ...next }));
    setEstimate(null);
  };

  const uploadSources = async (files: FileList | null) => {
    const entries = Array.from(files || []);
    if (!entries.length) return;
    setUploading(true);
    let succeeded = 0;
    let failed = 0;
    try {
      for (const file of entries) {
        try {
          await llmWikiNextApi.uploadSource(file);
          succeeded += 1;
        } catch {
          failed += 1;
        }
      }
      if (succeeded)
        toast.success(
          failed
            ? `已上传 ${succeeded} 个文档，${failed} 个失败`
            : `已上传 ${succeeded} 个文档`,
        );
      await refreshWorkspace(true);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const estimateCompile = async (sourceIds: string[]) => {
    if (publishing || discarding) return;
    if (!sourceIds.length) return toast.error("请选择至少一个 Source");
    if (!model) return toast.error("请选择编译模型");
    if (!validInteger(settings.chunkChars, 1_000, 60_000))
      return toast.error("物理切片字符数必须是 1,000 到 60,000 的整数");
    if (!validInteger(settings.plannerMaxOutputTokens, 256, 16_000))
      return toast.error("Planner 输出上限必须是 256 到 16,000 的整数");
    if (!validInteger(settings.writerMaxOutputTokens, 256, 32_000))
      return toast.error("Writer 输出上限必须是 256 到 32,000 的整数");
    setEstimating(true);
    try {
      const nextEstimate = await llmWikiNextApi.estimateCompile({
        sourceIds,
        model,
        sourceConcurrency,
        ...settings,
      });
      setEstimate(nextEstimate);
      setCompileDialogOpen(true);
    } finally {
      setEstimating(false);
    }
  };

  const confirmCompile = async () => {
    if (!estimate || publishing || discarding) return;
    setStartingCompile(true);
    try {
      // 只提交 estimate 原样返回的 options + confirmHash，配置变更必须重新估算。
      const nextPool = await llmWikiNextApi.compile({
        ...estimate.options,
        confirmHash: estimate.confirmHash,
      });
      setPool(nextPool);
      setEstimate(null);
      setCompileDialogOpen(false);
      toast.success("已开始编译");
      await refreshWorkspace();
    } finally {
      setStartingCompile(false);
    }
  };

  const cancelCompile = async () => {
    if (!pool || cancelling) return;
    setCancelling(true);
    try {
      const result = await llmWikiNextApi.cancelCompilePool();
      setPool(null);
      setCompilePoolDialogOpen(false);
      toast.success(
        `已清空编译任务（${result.runningCount} 个运行中，${result.queuedCount} 个等待中）`,
      );
      await refreshWorkspace();
    } finally {
      setCancelling(false);
    }
  };

  const deleteSources = async () => {
    if (!deleteSourceIds.length || deleting) return;
    setDeleting(true);
    try {
      const result = await llmWikiNextApi.deleteSources(deleteSourceIds);
      setDeleteSourceIds([]);
      toast.success(`已删除 ${result.deletedSourceIds.length} 个文档`);
      await refreshWorkspace(true);
    } finally {
      setDeleting(false);
    }
  };

  const deletePublishedPage = async () => {
    if (
      !deletePageTarget ||
      deletingPage ||
      !deletePageTarget.revisionId
    ) {
      return;
    }
    setDeletingPage(true);
    try {
      const result = await llmWikiNextApi.deletePublishedPage(
        deletePageTarget.pageKey,
        deletePageTarget.revisionId,
      );
      setDeletePageTarget(null);
      toast.success(
        `已永久删除页面及 ${result.deletedFactCount} 条 Facts，清理 ${result.affectedPageKeys.length} 个页面关联`,
      );
      if (result.stagingRetainsPage) {
        toast.warning("待发布 Wiki 仍包含此页面，后续发布可能重新恢复");
      }
      if (result.cleanupWarnings.length) {
        toast.warning(result.cleanupWarnings.join("；"));
      }
      await refreshWorkspace();
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.code === 404 || error.code === 409)
      ) {
        setDeletePageTarget(null);
        await refreshWorkspace();
      }
    } finally {
      setDeletingPage(false);
    }
  };

  const publish = async () => {
    if (publishBlocked) return;
    setPublishing(true);
    try {
      const result = await llmWikiNextApi.publishStaging();
      setPublishDialogOpen(false);
      setEstimate(null);
      toast.success(`已发布 ${result.pageCount} 个页面`);
      if (result.cancelledQueuedCount || result.cancelledRunningCount) {
        toast.warning(
          `已清空 ${result.cancelledQueuedCount} 个待编译项并中断 ${result.cancelledRunningCount} 个运行项`,
        );
      }
      if (result.cleanupWarnings.length)
        toast.warning(result.cleanupWarnings.join("；"));
      await refreshWorkspace();
    } finally {
      setPublishing(false);
    }
  };

  const discard = async () => {
    if (discardBlocked) return;
    setDiscarding(true);
    try {
      await llmWikiNextApi.discardStaging();
      setPool(null);
      setDiscardDialogOpen(false);
      setEstimate(null);
      toast.success(
        active
          ? "已取消编译并撤销全部暂存结果，正式 Wiki 未受影响"
          : "已撤销暂存 Wiki，正式 Wiki 未受影响",
      );
      await refreshWorkspace();
    } finally {
      setDiscarding(false);
    }
  };

  const openSourcePreview = async (
    sourceId: string,
    sourceLine: number | null = null,
  ) => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewSource(null);
    setPreviewSourceLine(sourceLine);
    try {
      setPreviewSource(await llmWikiNextApi.getSource(sourceId));
    } finally {
      setPreviewLoading(false);
    }
  };

  const loadCompileDetail = useCallback(async (sourceId: string) => {
    setCompileDetailLoading(true);
    try {
      const result = await llmWikiNextApi.getSourceCompileDetail(sourceId);
      setCompileDetailSource(result.source);
      setCompileDetailReport(result.report);
      setSources((current) =>
        current.map((source) =>
          source.sourceId === result.source.sourceId ? result.source : source,
        ),
      );
    } catch {
      setCompileDetailReport(null);
      toast.error("读取编译详情失败");
    } finally {
      setCompileDetailLoading(false);
    }
  }, []);

  const openCompileDetail = (sourceId: string) => {
    setCompileDetailSource(
      sources.find((source) => source.sourceId === sourceId) || null,
    );
    setCompileDetailReport(null);
    setCompileDetailOpen(true);
    void loadCompileDetail(sourceId);
  };

  const openCompiledPage = (pageKey: string) => {
    const mode = staging?.pages.some((page) => page.pageKey === pageKey)
      ? "staging"
      : publishedPages.some((page) => page.pageKey === pageKey)
        ? "published"
        : null;
    if (!mode) {
      toast.info("该产物页面当前不在 Staging 或正式 Wiki 中");
      return;
    }
    setWikiTarget({ mode, pageKey });
    setActiveTab(mode);
    setCompileDetailOpen(false);
  };

  const detailCompiling = Boolean(
    compileDetailReport && compileDetailReport.stage !== "finished",
  );
  useEffect(() => {
    if (!compileDetailOpen || !compileDetailSource || !detailCompiling) return;
    const timer = window.setInterval(
      () => void loadCompileDetail(compileDetailSource.sourceId),
      1_500,
    );
    return () => window.clearInterval(timer);
  }, [compileDetailOpen, compileDetailSource, detailCompiling, loadCompileDetail]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        className="hidden"
        onChange={(event) => void uploadSources(event.target.files)}
      />

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="flex flex-none items-center border-b border-slate-200 bg-slate-50/70 px-3">
          <TabsList variant="line" className="h-10 gap-2 p-0">
            <TabsTrigger
              value="sources"
              className="h-10 px-3 text-xs after:bottom-0"
            >
              原文档
            </TabsTrigger>
            <TabsTrigger
              value="staging"
              className="h-10 px-3 text-xs after:bottom-0"
            >
              待发布 Wiki
            </TabsTrigger>
            <TabsTrigger
              value="published"
              className="h-10 px-3 text-xs after:bottom-0"
            >
              正式 Wiki
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="sources"
          className="min-h-0 flex-1 overflow-y-auto data-[state=active]:flex data-[state=inactive]:hidden"
        >
          <SourceWorkspace
            sources={sources}
            staging={staging}
            publishedPages={publishedPages}
            pool={pool}
            models={models}
            model={model}
            sourceConcurrency={sourceConcurrency}
            settings={settings}
            estimating={estimating}
            startingCompile={startingCompile}
            uploading={uploading}
            loading={loading}
            deleting={deleting}
            operationsLocked={
              publishing || discarding || staging?.state.status === "publishing"
            }
            onModelChange={changeModel}
            onSourceConcurrencyChange={changeConcurrency}
            onSettingsChange={changeSettings}
            onUpload={() => fileInputRef.current?.click()}
            onRefresh={() => void refreshWorkspace(true)}
            onEstimate={(sourceIds) => void estimateCompile(sourceIds)}
            onDeleteSelected={setDeleteSourceIds}
            onOpenCompilePool={() => setCompilePoolDialogOpen(true)}
            onOpenSource={(sourceId) => void openSourcePreview(sourceId)}
            onOpenCompileDetail={openCompileDetail}
          />
        </TabsContent>

        <TabsContent
          value="staging"
          className="min-h-0 flex-1 data-[state=active]:flex data-[state=inactive]:hidden"
        >
          {!staging ? (
            <div className="flex flex-1 items-center justify-center bg-slate-50/50 p-6 text-center">
              <div className="max-w-sm">
                <Archive className="mx-auto mb-3 size-7 text-slate-300" />
                <p className="font-medium text-slate-700">还没有待发布 Wiki</p>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  在“原文档”中选择 Source
                  并确认编译，成功结果会合并到这里统一审阅和发布。
                </p>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-none flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-slate-50/70 px-3 py-2.5 text-xs text-slate-600">
                <span>
                  已编译 Source{" "}
                  <strong className="ml-1 tabular-nums text-slate-950">
                    {staging.state.completedSourceIds.length}
                  </strong>
                </span>
                <span>
                  页面{" "}
                  <strong className="ml-1 tabular-nums text-slate-950">
                    {staging.pageCount}
                  </strong>
                </span>
                <span>
                  Facts{" "}
                  <strong className="ml-1 tabular-nums text-slate-950">
                    {staging.factCount}
                  </strong>
                </span>
                <span>更新于 {formatTime(staging.state.updatedAt)}</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={discardBlocked}
                    onClick={() => setDiscardDialogOpen(true)}
                  >
                    <Archive />
                    撤销待发布
                  </Button>
                  <Button
                    size="sm"
                    disabled={publishBlocked}
                    title={
                      staging.state.completedSourceIds.length
                        ? undefined
                        : "需要至少一个已合并 Source 才能发布"
                    }
                    onClick={() => setPublishDialogOpen(true)}
                  >
                    <Send />
                    发布
                  </Button>
                </div>
              </div>
              <WikiWorkspace
                mode="staging"
                pages={staging.pages}
                loadPage={llmWikiNextApi.getStagingPage}
                revisionId={staging.state.generation}
                generatedAt={staging.state.updatedAt}
                completedSourceIds={staging.state.completedSourceIds}
                sourceNames={sourceNames}
                onOpenSource={(sourceId, sourceLine) =>
                  void openSourcePreview(sourceId, sourceLine)
                }
                openPageKey={
                  wikiTarget?.mode === "staging" ? wikiTarget.pageKey : null
                }
                onPageOpened={() => setWikiTarget(null)}
              />
            </div>
          )}
        </TabsContent>

        <TabsContent
          value="published"
          className="min-h-0 flex-1 data-[state=active]:flex data-[state=inactive]:hidden"
        >
          <WikiWorkspace
            key={publishedManifest.revisionId || "published-empty"}
            mode="published"
            pages={publishedPages}
            loadPage={llmWikiNextApi.getPublishedPage}
            search={(query) => llmWikiNextApi.searchPublished(query)}
            revisionId={publishedManifest.revisionId}
            generatedAt={publishedManifest.generatedAt}
            sourceNames={sourceNames}
            stagingPageKeys={staging?.pages.map((page) => page.pageKey) || []}
            onRequestDelete={setDeletePageTarget}
            onOpenSource={(sourceId, sourceLine) =>
              void openSourcePreview(sourceId, sourceLine)
            }
            openPageKey={
              wikiTarget?.mode === "published" ? wikiTarget.pageKey : null
            }
            onPageOpened={() => setWikiTarget(null)}
          />
        </TabsContent>
      </Tabs>

      <CompileConfirmationDialog
        open={compileDialogOpen}
        estimate={estimate}
        sourceNames={sourceNames}
        starting={startingCompile}
        onOpenChange={(open) => {
          if (startingCompile) return;
          setCompileDialogOpen(open);
          if (!open) setEstimate(null);
        }}
        onConfirm={() => void confirmCompile()}
      />

      <CompilePoolDialog
        open={compilePoolDialogOpen}
        pool={pool}
        sourceNames={sourceNames}
        cancelling={cancelling}
        onOpenChange={setCompilePoolDialogOpen}
        onClear={() => void cancelCompile()}
      />

      <SourcePreviewDialog
        open={previewOpen}
        source={previewSource}
        sourceLine={previewSourceLine}
        loading={previewLoading}
        onOpenChange={setPreviewOpen}
      />

      <SourceCompileDetailDialog
        open={compileDetailOpen}
        source={compileDetailSource}
        report={compileDetailReport}
        loading={compileDetailLoading}
        onOpenChange={(open) => {
          setCompileDetailOpen(open);
          if (!open) {
            setCompileDetailReport(null);
            setCompileDetailSource(null);
          }
        }}
        onRefresh={() => {
          if (compileDetailSource)
            void loadCompileDetail(compileDetailSource.sourceId);
        }}
        onOpenPage={openCompiledPage}
      />

      <Dialog
        open={Boolean(deletePageTarget)}
        onOpenChange={(open) => {
          if (!open && !deletingPage) setDeletePageTarget(null);
        }}
      >
        <DialogContent
          className="sm:max-w-[440px]"
          showCloseButton={!deletingPage}
        >
          <DialogHeader>
            <DialogTitle className="text-rose-700">永久删除页面？</DialogTitle>
            <DialogDescription className="text-rose-700">
              将从当前正式 Wiki 删除页面、其中的 Facts、搜索索引和其他页面的关联记录。
            </DialogDescription>
          </DialogHeader>
          {deletePageTarget && (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <p className="truncate text-sm font-medium text-slate-900">
                  {deletePageTarget.title}
                </p>
                <p className="mt-1 text-xs font-medium text-rose-700">
                  删除 {deletePageTarget.factCount} 条 Facts · 清理 {" "}
                  {deletePageTarget.affectedPageCount} 个页面关联
                </p>
              </div>
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm leading-6 text-rose-800">
                原始 Source 不会删除。此操作无法撤回。
              </div>
              {deletePageTarget.stagingRetainsPage && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium leading-6 text-amber-900">
                  待发布 Wiki 仍包含此页面，后续发布可能重新恢复。
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deletingPage}
              onClick={() => setDeletePageTarget(null)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={deletingPage}
              onClick={() => void deletePublishedPage()}
            >
              {deletingPage && <Loader2 className="animate-spin" />}
              永久删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteSourceIds.length > 0}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteSourceIds([]);
        }}
      >
        <DialogContent className="sm:max-w-[420px]" showCloseButton={!deleting}>
          <DialogHeader>
            <DialogTitle>删除原文档？</DialogTitle>
            <DialogDescription>
              接口会再次检查实际的待发布和正式发布产物；任一 Source
              仍有关联产物时，本次删除将被拒绝。无产物的排队或运行任务会同步停止。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
            将删除 {deleteSourceIds.length} 个文档。
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleting}
              onClick={() => setDeleteSourceIds([])}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => void deleteSources()}
            >
              {deleting && <Loader2 className="animate-spin" />}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认发布 Wiki？</DialogTitle>
            <DialogDescription>
              {pool
                ? `将整套 Staging 原子替换正式 Wiki，并中断 ${pool.items.filter((item) => item.phase === "planning" || item.phase === "writing" || item.phase === "committing").length} 个运行项、清空 ${pool.items.filter((item) => item.phase === "queued").length} 个待编译项。`
                : "将整套 Staging 原子替换正式 Wiki。"}{" "}
              这里审阅的是完整快照，不表示页面 diff；发布后不支持撤回。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {staging?.state.completedSourceIds.length || 0} 个已合并 Source ·{" "}
            {staging?.pageCount || 0} 个页面 · {staging?.factCount || 0} 条
            Facts
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPublishDialogOpen(false)}
              disabled={publishing}
            >
              取消
            </Button>
            <Button onClick={() => void publish()} disabled={publishBlocked}>
              {publishing && <Loader2 className="animate-spin" />}确认发布
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={discardDialogOpen} onOpenChange={setDiscardDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {active ? "取消编译并撤销待发布 Wiki？" : "撤销当前待发布 Wiki？"}
            </DialogTitle>
            <DialogDescription>
              {active
                ? "会取消正在运行的编译，并删除当前 Staging 中所有未发布的累积结果。正式 Wiki 不受影响。"
                : "会删除当前 Staging 中所有未发布的累积结果，正式 Wiki 不受影响。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDiscardDialogOpen(false)}
              disabled={discarding}
            >
              保留暂存
            </Button>
            <Button
              variant="destructive"
              onClick={() => void discard()}
              disabled={discarding}
            >
              {discarding && <Loader2 className="animate-spin" />}
              {active ? "取消并撤销" : "确认撤销"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
