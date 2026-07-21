import { Injectable } from "@nestjs/common";
import { createHash } from "crypto";
import { ModelService } from "../../model/model.service";
import type {
  LlmWikiCompilePlan,
  LlmWikiCompileUsage,
  LlmWikiIngestJobReport,
  LlmWikiSourceStatus,
} from "../contracts/llm-wiki.types";
import { llmWikiConfig } from "../llm-wiki.config";
import {
  compilerPromptHash,
  LLM_WIKI_INGEST_STOPPED,
  LlmWikiCompilerService,
} from "./llm-wiki-compiler.service";
import { LlmWikiSchemaService } from "./llm-wiki-schema.service";
import { LlmWikiSearchService } from "./llm-wiki-search.service";
import { LlmWikiStoreService } from "./llm-wiki-store.service";

@Injectable()
export class LlmWikiIngestService {
  private readonly jobs = new Map<string, {
    controller: AbortController;
    jobId: string;
    model: string;
    planHash: string;
    plan: LlmWikiCompilePlan;
    previousStatus: LlmWikiSourceStatus;
    started: boolean;
    promise?: Promise<void>;
  }>();
  private readonly queue: string[] = [];
  private readonly stoppedJobs = new Set<string>();
  private activeCount = 0;

  constructor(
    private readonly store: LlmWikiStoreService,
    private readonly compiler: LlmWikiCompilerService,
    private readonly search: LlmWikiSearchService,
    private readonly schema: LlmWikiSchemaService,
    private readonly model: ModelService,
  ) {}

  estimateCompile(sourceIds: string[], requestedModel = "", requestedPhase = "", forceAnalyze = false) {
    const ids = uniqueSourceIds(sourceIds);
    if (!ids.length) throw new Error("sourceIds 不能为空");
    if (requestedPhase && requestedPhase !== "analyze" && requestedPhase !== "compose") {
      throw new Error(`compile phase 非法: ${requestedPhase}`);
    }
    const model = this.resolveIngestModel(requestedModel);
    const schema = this.schema.read();
    const existingPages = this.store.listPageRefs();
    const analyses = ids.map((sourceId) => forceAnalyze ? null : this.validAnalysis(sourceId, model, schema.sha256));
    const sourcePlans = ids.map((sourceId, index) => {
      const meta = this.store.getSource(sourceId);
      const source = this.store.readSource(meta.source_id);
      const analysis = requestedPhase === "analyze" ? null : analyses[index];
      if (requestedPhase === "compose" && !analysis) {
        throw new Error(`source 缺少有效 analysis，不能执行 compose: ${sourceId}`);
      }
      const cachedChunkKeys = !analysis
        ? this.cachedChunkKeys({ sourceId: meta.source_id, filename: meta.filename, source, schema, model })
        : undefined;
      return analysis
        ? this.compiler.estimateComposePlan({ sourceId: meta.source_id, filename: meta.filename, source, existingPages, schema, model, analysis })
        : this.compiler.estimateAnalyzePlan({ sourceId: meta.source_id, filename: meta.filename, source, existingPages, schema, model, cachedChunkKeys });
    });
    const plan = aggregateCompilePlans(sourcePlans);
    return {
      plan,
      sourcePlans,
      requiresConfirmation: true,
    };
  }

  compileSources(sourceIds: string[], requestedModel = "", confirmHash = "", requestedPhase = "", forceAnalyze = false) {
    const estimate = this.estimateCompile(sourceIds, requestedModel, requestedPhase, forceAnalyze);
    if (!confirmHash || confirmHash !== estimate.plan.hash) {
      return estimate;
    }
    if (estimate.plan.blocked) throw new Error(estimate.plan.reason || "compile plan 被阻止");
    const model = estimate.plan.model;
    const jobs: Array<{ jobId: string; sourceId: string; status: string }> = [];
    const skipped: Array<{ sourceId: string; candidateId: string; status: string }> = [];
    for (const plan of estimate.sourcePlans) {
      const current = this.store.getSource(plan.sourceIds[0]);
      const reusable = plan.phase === "compose" ? this.findReusableCandidate(current.source_id, plan.hash) : null;
      if (reusable) {
        if (reusable.status === "candidate_ready") {
          this.store.publishCandidate(reusable.candidateId);
        }
        this.store.updateSource(current.source_id, {
          status: "published",
          latest_candidate_id: reusable.candidateId,
          latest_compile_hash: plan.hash,
          error: "",
        });
        skipped.push({ sourceId: current.source_id, candidateId: reusable.candidateId, status: "published" });
        continue;
      }
      jobs.push(this.enqueueCompileSource(current.source_id, model, plan));
    }
    return {
      ...estimate,
      requiresConfirmation: false,
      jobs,
      skipped,
    };
  }

  ingestSource(sourceId: string, requestedModel = "", confirmHash = "", requestedPhase = "", forceAnalyze = false) {
    return this.compileSources([sourceId], requestedModel, confirmHash, requestedPhase, forceAnalyze);
  }

  private enqueueCompileSource(sourceId: string, model: string, plan: LlmWikiCompilePlan) {
    const current = this.store.getSource(sourceId);
    if (this.jobs.has(current.source_id) || current.status === "compile_planned" || current.status === "ingesting") {
      throw new Error("source 正在编译");
    }
    const report = this.store.createIngestJob(current.source_id, model);
    this.store.saveIngestJob({
      ...report,
      planHash: plan.hash,
      estimatedCostUsd: plan.estimatedCostUsd,
      modelCalls: 0,
      actualTokens: 0,
      maxModelCalls: plan.maxModelCalls,
      maxTokens: plan.maxTokens,
    });
    this.store.prepareIngest(current.source_id);
    const controller = new AbortController();
    this.jobs.set(current.source_id, {
      controller,
      jobId: report.jobId,
      model,
      planHash: plan.hash,
      plan,
      previousStatus: current.status,
      started: false,
    });
    this.queue.push(current.source_id);
    this.schedule();
    return { jobId: report.jobId, sourceId: current.source_id, status: report.status };
  }

  stopIngest(sourceId: string) {
    const current = this.store.getSource(sourceId);
    const running = this.jobs.get(current.source_id);
    if (!running && current.status !== "compile_planned" && current.status !== "ingesting") {
      return { ok: true, sourceId: current.source_id, status: current.status, stopped: false };
    }
    running?.controller.abort();
    this.removeFromQueue(current.source_id);
    this.jobs.delete(current.source_id);
    if (running?.started && running.jobId) this.stoppedJobs.add(running.jobId);
    this.store.resetIngestToUploaded(current.source_id, running?.jobId || "");
    this.search.invalidate();
    return { ok: true, sourceId: current.source_id, status: "raw_uploaded" as const, stopped: true };
  }

  reingestSources(sourceIds: string[], requestedModel = "") {
    return this.compileSources(sourceIds, requestedModel);
  }

  rebuildAll(_requestedModel = "") {
    if (this.jobs.size > 0) throw new Error("source 正在编译，不能重建索引");
    this.store.rebuildWikiIndex();
    return [];
  }

  private schedule(): void {
    while (this.activeCount < llmWikiConfig.ingestConcurrency && this.queue.length) {
      const sourceId = this.queue.shift();
      if (!sourceId) continue;
      const job = this.jobs.get(sourceId);
      if (!job || job.controller.signal.aborted) continue;
      job.started = true;
      this.activeCount += 1;
      const promise = this.runIngest(sourceId, job.model, job.jobId, job.plan, job.previousStatus, job.controller.signal).finally(() => {
        this.activeCount = Math.max(0, this.activeCount - 1);
        this.jobs.delete(sourceId);
        this.schedule();
      });
      job.promise = promise;
    }
  }

  private removeFromQueue(sourceId: string): void {
    const index = this.queue.indexOf(sourceId);
    if (index >= 0) this.queue.splice(index, 1);
  }

  private async runIngest(
    sourceId: string,
    model: string,
    jobId: string,
    confirmedPlan: LlmWikiCompilePlan,
    previousStatus: LlmWikiSourceStatus,
    signal: AbortSignal,
  ): Promise<void> {
    let report = this.store.getIngestJob(jobId);
    let liveUsage: LlmWikiCompileUsage | undefined;
    const trackUsage = (usage: LlmWikiCompileUsage) => {
      liveUsage = usage;
      report = this.store.saveIngestJob({
        ...report,
        modelCalls: usage.modelCalls,
        actualTokens: usage.inputTokens + usage.outputTokens,
        maxModelCalls: confirmedPlan.maxModelCalls,
        maxTokens: confirmedPlan.maxTokens,
        usage,
      });
    };
    try {
      assertNotStopped(signal);
      report = this.saveJobEvent(report, {
        stage: confirmedPlan.phase,
        message: confirmedPlan.phase === "analyze"
          ? "开始 analyze：Token 分块提取、遗漏审计与确定性页面规划"
          : "开始 compose：逐页生成、逐页覆盖验证与一次集中修复",
      });
      const meta = this.store.getSource(sourceId);
      const source = this.store.readSource(sourceId);
      const schema = this.schema.read();
      const existingPages = this.store.listPageRefs();
      const analysis = confirmedPlan.phase === "compose" ? this.validAnalysis(sourceId, model, schema.sha256) : null;
      const cachedChunkKeys = !analysis
        ? this.cachedChunkKeys({ sourceId, filename: meta.filename, source, schema, model })
        : undefined;
      const plan = analysis
        ? this.compiler.estimateComposePlan({ sourceId, filename: meta.filename, source, existingPages, schema, model, analysis })
        : this.compiler.estimateAnalyzePlan({ sourceId, filename: meta.filename, source, existingPages, schema, model, cachedChunkKeys });
      if (plan.hash !== confirmedPlan.hash) throw new Error("compile plan 已过期，请重新预估并确认");

      if (plan.phase === "analyze") {
        const artifact = await this.compiler.analyzeSource({
          sourceId,
          filename: meta.filename,
          source,
          existingPages,
          schema,
          model,
          plan,
          signal,
          onUsage: trackUsage,
          chunkCache: {
            read: (cacheKey) => this.store.readChunkAnalysisCache(cacheKey),
            write: (entry) => this.store.saveChunkAnalysisCache(entry),
          },
        });
        assertNotStopped(signal);
        this.store.saveSourceMap(artifact.sourceMap);
        this.store.saveFactLedger(artifact.factLedger);
        this.store.saveAnalysisArtifact(artifact);
        this.store.updateSource(sourceId, {
          status: "analysis_ready",
          schema_hash: schema.sha256,
          latest_compile_hash: artifact.analysisHash,
          error: "",
        });
        this.saveJobEvent(
          {
            ...report,
            status: "success",
            stage: "analysis_ready",
            endedAt: new Date().toISOString(),
            factCount: artifact.factLedger.facts.length,
            planHash: plan.hash,
            estimatedCostUsd: plan.estimatedCostUsd,
            modelCalls: artifact.usage.modelCalls,
            actualTokens: artifact.usage.inputTokens + artifact.usage.outputTokens,
            maxModelCalls: plan.maxModelCalls,
            maxTokens: plan.maxTokens,
            usage: artifact.usage,
            error: "",
          },
          {
            stage: "analysis_ready",
            status: "success",
            message: `analyze 完成：${artifact.factLedger.facts.length} facts，${artifact.pagePlan.length} pages plan，模型调用 ${artifact.usage.modelCalls} 次；请确认 compose 计划`,
          },
        );
        this.search.invalidate();
        return;
      }

      if (!analysis) throw new Error("compose 缺少有效 analysis artifact");
      const reusable = this.findReusableCandidate(sourceId, plan.hash);
      if (reusable) {
        if (reusable.status === "candidate_ready") {
          this.store.publishCandidate(reusable.candidateId);
        }
        this.store.updateSource(sourceId, {
          status: "published",
          latest_candidate_id: reusable.candidateId,
          latest_compile_hash: plan.hash,
          error: "",
        });
        this.saveJobEvent(
          {
            ...report,
            status: "success",
            stage: "skipped",
            endedAt: new Date().toISOString(),
            pages: reusable.pages.map((page) => page.path),
            factCount: reusable.claims.length,
            coverage: {
              mustTotal: 0,
              mustCovered: 0,
              mustCoverage: 0,
              missingMustFactIds: [],
            },
            candidateId: reusable.candidateId,
            planHash: plan.hash,
            estimatedCostUsd: plan.estimatedCostUsd,
            modelCalls: 0,
            actualTokens: 0,
            maxModelCalls: plan.maxModelCalls,
            maxTokens: plan.maxTokens,
            error: "",
          },
          {
            stage: "published",
            status: "success",
            message: "source/schema/prompt/compiler hash 未变化，复用已有编译结果，0 次模型调用",
          },
        );
        this.search.invalidate();
        return;
      }
      const candidate = await this.compiler.composeSource({
        sourceId,
        filename: meta.filename,
        source,
        existingPages,
        schema,
        model,
        analysis,
        plan,
        signal,
        onUsage: trackUsage,
      });
      assertNotStopped(signal);
      const savedCandidate = this.store.saveCompileCandidate(candidate);
      const composeUsage = savedCandidate.phaseUsage?.compose || liveUsage;
      report = this.saveJobEvent(
        {
          ...report,
          pages: savedCandidate.pages.map((page) => page.path),
          factCount: analysis.factLedger.facts.length,
          coverage: savedCandidate.coverageReport || {
            mustTotal: 0,
            mustCovered: 0,
            mustCoverage: 0,
            missingMustFactIds: [],
          },
          issues: savedCandidate.issues,
          candidateId: savedCandidate.candidateId,
          planHash: savedCandidate.plan.hash,
          estimatedCostUsd: savedCandidate.plan.estimatedCostUsd,
          modelCalls: composeUsage?.modelCalls || 0,
          actualTokens: (composeUsage?.inputTokens || 0) + (composeUsage?.outputTokens || 0),
          maxModelCalls: plan.maxModelCalls,
          maxTokens: plan.maxTokens,
          usage: composeUsage,
        },
        {
          stage: savedCandidate.status,
          message: `compose 结果已生成：${savedCandidate.pages.length} pages，must coverage ${Math.round((savedCandidate.coverageReport?.mustCoverage || 0) * 100)}%，本阶段模型调用 ${composeUsage?.modelCalls || 0} 次`,
        },
      );
      if (savedCandidate.status !== "candidate_ready") {
        this.store.updateSource(sourceId, {
          status: "failed",
          latest_candidate_id: savedCandidate.candidateId,
          latest_compile_hash: savedCandidate.plan.hash,
          schema_hash: schema.sha256,
          error: "编译结果未通过本地检查，需要人工检查",
          touched_pages: savedCandidate.affectedPages,
        });
        this.search.invalidate();
        this.saveJobEvent(
          {
            ...report,
            status: "failed",
            endedAt: new Date().toISOString(),
            pages: savedCandidate.pages.map((page) => page.path),
            error: "编译结果未通过本地检查，需要人工检查",
          },
          {
            stage: "needs_review",
            status: "failed",
            message: "编译结果已保存，但未发布",
          },
        );
        this.store.appendLog(`编译 source ${sourceId} 需要人工检查，结果 ${savedCandidate.candidateId}`);
        return;
      }
      const receipt = this.store.publishCandidate(savedCandidate.candidateId);
      this.search.invalidate();
      this.saveJobEvent(
        {
          ...report,
          status: "success",
          endedAt: new Date().toISOString(),
          pages: receipt.publishedPages,
          error: "",
        },
        {
          stage: "published",
          status: "success",
          message: `编译完成并发布，写入 ${receipt.publishedPages.length} 个页面`,
        },
      );
      this.store.appendLog(`编译 source ${sourceId} 完成并发布，结果 ${savedCandidate.candidateId}`);
    } catch (err) {
      if (signal.aborted || isStoppedError(err)) {
        if (this.stoppedJobs.has(jobId)) {
          this.stoppedJobs.delete(jobId);
        } else {
          this.store.resetIngestToUploaded(sourceId, jobId);
          this.search.invalidate();
        }
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.store.restoreIngestAfterFailure(sourceId, previousStatus, message);
      this.saveJobEvent(
        {
          ...report,
          status: "failed",
          endedAt: new Date().toISOString(),
          modelCalls: liveUsage?.modelCalls || report.modelCalls || 0,
          actualTokens: liveUsage
            ? liveUsage.inputTokens + liveUsage.outputTokens
            : report.actualTokens || 0,
          maxModelCalls: confirmedPlan.maxModelCalls,
          maxTokens: confirmedPlan.maxTokens,
          usage: liveUsage || report.usage,
          error: message,
        },
        {
          stage: report.stage || "failed",
          status: "failed",
          message,
        },
      );
      if (isProviderBackoffError(message)) this.stopQueuedJobsAfterProviderFailure(sourceId, message);
      this.store.appendLog(`编译 source ${sourceId} 失败：${message}`);
    }
  }

  private findReusableCandidate(sourceId: string, planHash: string) {
    const current = this.store.getSource(sourceId);
    const byMeta =
      current.latest_candidate_id && current.latest_compile_hash === planHash
        ? safeReadCandidate(this.store, current.latest_candidate_id)
        : null;
    const latest = byMeta || this.store.getLatestCompileCandidateForSource(current.source_id);
    if (!latest) return null;
    if (latest.plan.hash !== planHash) return null;
    if (latest.status !== "candidate_ready" && latest.status !== "published") return null;
    return latest;
  }

  private stopQueuedJobsAfterProviderFailure(currentSourceId: string, message: string): void {
    const queued = [...this.queue];
    this.queue.length = 0;
    for (const sourceId of queued) {
      if (sourceId === currentSourceId) continue;
      const job = this.jobs.get(sourceId);
      if (!job) continue;
      job.controller.abort();
      this.jobs.delete(sourceId);
      this.store.markIngestFailed(sourceId, `上游模型失败，队列已停止：${message}`);
      if (job.jobId) {
        const report = safeReadJob(this.store, job.jobId);
        if (report) {
          this.saveJobEvent(
            {
              ...report,
              status: "failed",
              endedAt: new Date().toISOString(),
              error: `上游模型失败，队列已停止：${message}`,
            },
            {
              stage: "stopped",
              status: "failed",
              message: "provider 429/限额错误后停止未开始的编译队列",
            },
          );
        }
      }
    }
  }

  private saveJobEvent(
    report: LlmWikiIngestJobReport,
    event: { stage: string; status?: "running" | "success" | "failed"; message: string },
  ): LlmWikiIngestJobReport {
    const at = new Date().toISOString();
    return this.store.saveIngestJob({
      ...report,
      stage: event.stage,
      status: event.status || report.status,
      events: [
        ...(report.events || []),
        {
          stage: event.stage,
          status: event.status || "running",
          message: event.message,
          at,
        },
      ],
    });
  }

  private validAnalysis(sourceId: string, model: string, schemaHash: string) {
    const analysis = this.store.readAnalysisArtifact(sourceId);
    if (!analysis) return null;
    const source = this.store.readSource(sourceId);
    if (analysis.sourceHash !== createHash("sha256").update(source).digest("hex")) return null;
    if (analysis.schemaHash !== schemaHash || analysis.model !== model) return null;
    if (analysis.modelHash !== createHash("sha256").update(model).digest("hex")) return null;
    if (analysis.promptHash !== compilerPromptHash()) return null;
    if (
      analysis.compilerVersion !== llmWikiConfig.compilerVersion ||
      analysis.promptVersion !== llmWikiConfig.promptVersion
    ) return null;
    return analysis;
  }

  private cachedChunkKeys(args: { sourceId: string; filename: string; source: string; schema: ReturnType<LlmWikiSchemaService["read"]>; model: string }): Set<string> {
    const compiler = this.compiler as LlmWikiCompilerService & { chunkCacheKeys?: (input: typeof args) => string[] };
    const readCache = (this.store as LlmWikiStoreService & { readChunkAnalysisCache?: (cacheKey: string) => unknown }).readChunkAnalysisCache;
    if (!compiler.chunkCacheKeys || !readCache) return new Set<string>();
    return new Set(compiler.chunkCacheKeys(args).filter((cacheKey) => {
      const cached = readCache.call(this.store, cacheKey) as { auditComplete?: boolean } | null;
      return cached?.auditComplete === true;
    }));
  }

  private resolveIngestModel(requestedModel: string): string {
    const requested = String(requestedModel || "").trim();
    const configured = requested || llmWikiConfig.model;
    const resolved = this.model.resolveModel(configured);
    if (resolved) return resolved;
    if (requested) throw new Error(`解析模型不存在或不可用：${requested}`);
    throw new Error("未配置可用的解析模型");
  }
}

function assertNotStopped(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw new Error(LLM_WIKI_INGEST_STOPPED);
}

function isStoppedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message === LLM_WIKI_INGEST_STOPPED || err.name === "AbortError";
}

function isProviderBackoffError(message: string): boolean {
  return /(?:429|rate.?limit|quota|insufficient_quota|too many requests)/i.test(message);
}

function uniqueSourceIds(sourceIds: string[]): string[] {
  const seen = new Set<string>();
  for (const sourceId of sourceIds || []) {
    const item = String(sourceId || "").trim();
    if (/^[a-f0-9]{32}$/.test(item)) seen.add(item);
  }
  return [...seen];
}

function aggregateCompilePlans(sourcePlans: LlmWikiCompilePlan[]): LlmWikiCompilePlan {
  const sourceIds = sourcePlans.flatMap((plan) => plan.sourceIds);
  const hash = createHash("sha256")
    .update(JSON.stringify(sourcePlans.map((plan) => plan.hash)))
    .digest("hex");
  const blockedPlans = sourcePlans.filter((plan) => plan.blocked);
  const phases = new Set(sourcePlans.map((plan) => plan.phase));
  const mixedPhase = phases.size > 1;
  return {
    phase: sourcePlans[0]?.phase || "analyze",
    planId: hash.slice(0, 32),
    planHash: hash,
    sourceIds,
    hash,
    schemaHash: sourcePlans[0]?.schemaHash || "",
    compilerVersion: sourcePlans[0]?.compilerVersion || llmWikiConfig.compilerVersion,
    promptVersion: sourcePlans[0]?.promptVersion || llmWikiConfig.promptVersion,
    sourceHash: createHash("sha256").update(JSON.stringify(sourcePlans.map((plan) => plan.sourceHash))).digest("hex"),
    model: sourcePlans[0]?.model || "",
    modelHash: sourcePlans[0]?.modelHash,
    promptHash: sourcePlans[0]?.promptHash,
    wikiStateHash: createHash("sha256")
      .update(JSON.stringify(sourcePlans.map((plan) => plan.wikiStateHash || "")))
      .digest("hex"),
    analysisHash: sourcePlans[0]?.analysisHash,
    estimatedCalls: sum(sourcePlans.map((plan) => plan.estimatedCalls)),
    estimatedTokens: sum(sourcePlans.map((plan) => plan.estimatedTokens)),
    maxTokens: sum(sourcePlans.map((plan) => plan.maxTokens)),
    callPlan: aggregateCallPlan(sourcePlans),
    estimatedInputTokens: sum(sourcePlans.map((plan) => plan.estimatedInputTokens)),
    estimatedOutputTokens: sum(sourcePlans.map((plan) => plan.estimatedOutputTokens)),
    estimatedCostUsd: Number(sum(sourcePlans.map((plan) => plan.estimatedCostUsd)).toFixed(6)),
    maxModelCalls: sum(sourcePlans.map((plan) => plan.maxModelCalls)),
    affectedPageCandidates: uniqueStrings(sourcePlans.flatMap((plan) => plan.affectedPageCandidates)),
    requiresDigest: sourcePlans.some((plan) => plan.requiresDigest),
    blocked: blockedPlans.length > 0 || mixedPhase,
    reason: [
      ...blockedPlans.map((plan) => plan.reason).filter(Boolean),
      ...(mixedPhase ? ["选中的 sources 同时包含 analyze 与 compose 阶段，请按阶段分批执行"] : []),
    ].join("; "),
    createdAt: new Date().toISOString(),
  };
}

function aggregateCallPlan(sourcePlans: LlmWikiCompilePlan[]): LlmWikiCompilePlan["callPlan"] {
  const stages = new Map<string, LlmWikiCompilePlan["callPlan"][number]>();
  for (const item of sourcePlans.flatMap((plan) => plan.callPlan)) {
    const current = stages.get(item.stage) || {
      stage: item.stage,
      expectedCalls: 0,
      maxCalls: 0,
      expectedInputTokens: 0,
      hardInputTokens: 0,
      expectedOutputTokens: 0,
      hardOutputTokens: 0,
      expectedTokens: 0,
      hardTokens: 0,
      cacheHits: 0,
    };
    current.expectedCalls += item.expectedCalls;
    current.maxCalls += item.maxCalls;
    current.expectedInputTokens = (current.expectedInputTokens || 0) + (item.expectedInputTokens || 0);
    current.hardInputTokens = (current.hardInputTokens || 0) + (item.hardInputTokens || 0);
    current.expectedOutputTokens = (current.expectedOutputTokens || 0) + (item.expectedOutputTokens || 0);
    current.hardOutputTokens = (current.hardOutputTokens || 0) + (item.hardOutputTokens || 0);
    current.expectedTokens = (current.expectedTokens || 0) + (item.expectedTokens || 0);
    current.hardTokens = (current.hardTokens || 0) + (item.hardTokens || 0);
    current.cacheHits = (current.cacheHits || 0) + (item.cacheHits || 0);
    stages.set(item.stage, current);
  }
  return [...stages.values()];
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function safeReadCandidate(store: LlmWikiStoreService, candidateId: string) {
  try {
    return store.readCompileCandidate(candidateId);
  } catch {
    return null;
  }
}

function safeReadJob(store: LlmWikiStoreService, jobId: string): LlmWikiIngestJobReport | null {
  try {
    return store.getIngestJob(jobId);
  } catch {
    return null;
  }
}
