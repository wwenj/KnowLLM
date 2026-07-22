import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, Loader2, RefreshCw, Send, Upload } from "lucide-react";
import { toast } from "sonner";
import { modelApi, type ModelOption } from "@/api/model";
import {
  llmWikiNextApi,
  type CompileEstimate,
  type CompileJob,
  type ManifestPage,
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
import { SourcePreviewDialog } from "./components/SourcePreviewDialog";
import {
  SourceWorkspace,
  type CompileSettings,
} from "./components/SourceWorkspace";
import { WikiWorkspace } from "./components/WikiWorkspace";

const MODEL_STORAGE_KEY = "knowllm.llmWikiNext.model";
const CONCURRENCY_STORAGE_KEY = "knowllm.llmWikiNext.concurrency";
const RECENT_JOB_STORAGE_KEY = "knowllm.llmWikiNext.jobId";
const CONCURRENCY_OPTIONS = [1, 2, 4, 8, 16] as const;
const DEFAULT_SETTINGS: CompileSettings = {
  chunkChars: 12_000,
  plannerMaxOutputTokens: 2_000,
  writerMaxOutputTokens: 8_000,
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
  const [job, setJob] = useState<CompileJob | null>(null);
  const [estimate, setEstimate] = useState<CompileEstimate | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [startingCompile, setStartingCompile] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
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
      setJob(
        (current) =>
          stagingData?.activeJob ?? (isActiveJob(current) ? null : current),
      );
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
    let alive = true;
    const timer = window.setTimeout(() => {
      void Promise.all([refreshWorkspace(), loadModels()]).then(
        async ([currentStaging]) => {
          if (!alive || currentStaging?.activeJob) return;
          const recentJobId = window.localStorage.getItem(
            RECENT_JOB_STORAGE_KEY,
          );
          if (!recentJobId) return;
          try {
            const recentJob = await llmWikiNextApi.getJob(recentJobId);
            if (alive) setJob(recentJob);
          } catch {
            window.localStorage.removeItem(RECENT_JOB_STORAGE_KEY);
          }
        },
      );
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [loadModels, refreshWorkspace]);

  const active = isActiveJob(job);
  useEffect(() => {
    if (!active || !job) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await llmWikiNextApi.getJob(job.jobId);
        if (cancelled) return;
        setJob(next);
        if (!isActiveJob(next)) {
          await refreshWorkspace();
          if (cancelled) return;
          // refresh 可能先读取到 activeJob 已清空的 Staging；保留本次终态，方便查看失败 Source。
          setJob(next);
          if (next.status === "completed")
            toast.success("编译完成，结果已合并到暂存 Wiki");
          if (next.status === "completed_with_errors")
            toast.warning("编译部分完成，请查看失败 Source");
        }
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
  }, [active, job, refreshWorkspace]);

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
    active ||
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
    if (active || publishing || discarding) return;
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
      setEstimate(
        await llmWikiNextApi.estimateCompile({
          sourceIds,
          model,
          sourceConcurrency,
          ...settings,
        }),
      );
    } finally {
      setEstimating(false);
    }
  };

  const confirmCompile = async () => {
    if (!estimate || active || publishing || discarding) return;
    setStartingCompile(true);
    try {
      // 只提交 estimate 原样返回的 options + confirmHash，配置变更必须重新估算。
      const nextJob = await llmWikiNextApi.compile({
        ...estimate.options,
        confirmHash: estimate.confirmHash,
      });
      setJob(nextJob);
      window.localStorage.setItem(RECENT_JOB_STORAGE_KEY, nextJob.jobId);
      setEstimate(null);
      toast.success("编译任务已开始");
      await refreshWorkspace();
    } finally {
      setStartingCompile(false);
    }
  };

  const cancelCompile = async () => {
    if (!job || !active || cancelling) return;
    setCancelling(true);
    try {
      const nextJob = await llmWikiNextApi.cancelJob(job.jobId);
      setJob(nextJob);
      toast.success("已取消当前编译，之前已合并的暂存结果会保留");
      await refreshWorkspace();
      setJob(nextJob);
    } finally {
      setCancelling(false);
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
      setJob(null);
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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-none flex-col gap-2 border-b border-slate-200 bg-white/95 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-slate-600">
            文档{" "}
            <strong className="font-semibold tabular-nums text-slate-950">
              {sources.length}
            </strong>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-slate-600">
            暂存页面{" "}
            <strong className="font-semibold tabular-nums text-slate-950">
              {staging?.pageCount || 0}
            </strong>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-slate-600">
            正式页面{" "}
            <strong className="font-semibold tabular-nums text-slate-950">
              {publishedPages.length}
            </strong>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            className="hidden"
            onChange={(event) => void uploadSources(event.target.files)}
          />
          <Button
            disabled={
              uploading ||
              staging?.state.status === "publishing" ||
              publishing ||
              discarding
            }
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Loader2 className="animate-spin" /> : <Upload />}上传
          </Button>
          <Button
            size="icon"
            variant="outline"
            disabled={loading || publishing || discarding}
            title="刷新"
            aria-label="刷新"
            onClick={() => void refreshWorkspace(true)}
          >
            <RefreshCw className={loading ? "animate-spin" : ""} />
          </Button>
        </div>
      </header>

      <Tabs defaultValue="sources" className="min-h-0 flex-1 gap-0">
        <div className="flex flex-none items-center border-b border-slate-200 bg-slate-50/70 px-3">
          <TabsList variant="line" className="h-10 gap-2 p-0">
            <TabsTrigger
              value="sources"
              className="h-10 px-3 text-xs after:bottom-0"
            >
              文档
            </TabsTrigger>
            <TabsTrigger
              value="staging"
              className="h-10 px-3 text-xs after:bottom-0"
            >
              暂存 Wiki
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
          className="min-h-0 flex-1 data-[state=active]:flex data-[state=inactive]:hidden"
        >
          <SourceWorkspace
            sources={sources}
            staging={staging}
            publishedPages={publishedPages}
            job={job}
            estimate={estimate}
            models={models}
            model={model}
            sourceConcurrency={sourceConcurrency}
            settings={settings}
            estimating={estimating}
            startingCompile={startingCompile}
            operationsLocked={
              publishing || discarding || staging?.state.status === "publishing"
            }
            cancelling={cancelling}
            onModelChange={changeModel}
            onSourceConcurrencyChange={changeConcurrency}
            onSettingsChange={changeSettings}
            onEstimate={(sourceIds) => void estimateCompile(sourceIds)}
            onConfirmCompile={() => void confirmCompile()}
            onClearEstimate={() => setEstimate(null)}
            onCancelJob={() => void cancelCompile()}
            onOpenSource={(sourceId) => void openSourcePreview(sourceId)}
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
                <p className="font-medium text-slate-700">还没有暂存编译结果</p>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  在“文档”中选择 Source
                  并确认编译，成功结果会合并到这里统一审阅和发布。
                </p>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-none flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-slate-50/70 px-3 py-2.5 text-xs text-slate-600">
                <span>
                  已合并 Source{" "}
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
                    撤销暂存
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
              />
            </div>
          )}
        </TabsContent>

        <TabsContent
          value="published"
          className="min-h-0 flex-1 data-[state=active]:flex data-[state=inactive]:hidden"
        >
          <WikiWorkspace
            mode="published"
            pages={publishedPages}
            loadPage={llmWikiNextApi.getPublishedPage}
            search={(query) => llmWikiNextApi.searchPublished(query)}
            revisionId={publishedManifest.revisionId}
            generatedAt={publishedManifest.generatedAt}
            sourceNames={sourceNames}
            onOpenSource={(sourceId, sourceLine) =>
              void openSourcePreview(sourceId, sourceLine)
            }
          />
        </TabsContent>
      </Tabs>

      <SourcePreviewDialog
        open={previewOpen}
        source={previewSource}
        sourceLine={previewSourceLine}
        loading={previewLoading}
        onOpenChange={setPreviewOpen}
      />

      <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>发布暂存 Wiki？</DialogTitle>
            <DialogDescription>
              将整套 Staging 原子替换正式 Wiki。这里审阅的是完整快照，不表示页面
              diff；发布后不支持撤回。
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
              {active ? "取消编译并撤销暂存 Wiki？" : "撤销当前暂存 Wiki？"}
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
