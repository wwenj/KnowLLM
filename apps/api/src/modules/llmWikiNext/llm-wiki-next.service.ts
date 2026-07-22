import { Injectable, Logger } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { ModelService } from "../model/model.service";
import { LlmWikiNextStore } from "./llm-wiki-next.store";
import {
  CompileEstimate,
  CompileJob,
  CompileRequest,
  CompileSourceState,
  CompileUnit,
  KeyFact,
  ManifestPage,
  MultiPageWriterOutput,
  NormalizedCompileOptions,
  PublishResult,
  SourceOverlay,
  SourceOverlayPage,
  SourceRecord,
  SourceSnapshot,
  StagingState,
  StagingSummary,
  WikiPagePlan,
  WikiPagePlanItem,
  WikiSnapshot,
} from "./llm-wiki-next.types";

const PROMPT_VERSION = "llm-wiki-next-v2";
const PAGE_LIMIT_POLICY_VERSION = "adaptive-pages-v1";
const PAGE_CHAR_THRESHOLDS = [4_000, 10_000, 19_000, 31_000, 46_000, 64_000] as const;
const MODEL_TIMEOUT_MS = 5 * 60_000;
const MAX_FACTS_PER_PLAN = 5;
const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);

@Injectable()
export class LlmWikiNextService {
  private readonly logger = new Logger(LlmWikiNextService.name);
  private readonly stateMutex = new AsyncMutex();
  private pageMutex = new KeyedMutex();
  private readonly controllers = new Map<string, AbortController>();
  private readonly activeTokens = new Map<string, string>();

  constructor(
    private readonly store: LlmWikiNextStore,
    private readonly model: ModelService,
  ) {}

  uploadSource(filename: string, buffer: Buffer): SourceRecord {
    if (buffer.length > 10 * 1024 * 1024) throw new Error("Source 文件不能超过 10MB");
    return this.store.saveSource(filename, buffer);
  }

  listSources(): SourceRecord[] {
    return this.store.listSources();
  }

  getSource(sourceId: string): SourceSnapshot {
    return this.store.getSource(sourceId);
  }

  estimateCompile(request: CompileRequest): CompileEstimate {
    const options = this.normalizeOptions(request);
    const sources = options.sourceIds.map((sourceId) => this.store.getSource(sourceId));
    const units = sources.flatMap((source) =>
      splitSource(source, options.chunkChars).map((unit) => ({
        sourceId: source.sourceId,
        unitId: unit.unitId,
        charCount: unit.content.length,
        maxPages: calculateMaxPages(unit.content.length),
      })),
    );
    const compileUnitCount = units.length;
    const maxPlannedPages = units.reduce((sum, unit) => sum + unit.maxPages, 0);
    const maxPlannerCalls = compileUnitCount;
    const maxWriterCalls = compileUnitCount;
    const stagingGeneration = this.store.stagingMarker();
    const estimateBase = {
      sourceIds: options.sourceIds,
      sourceHashes: sources.map((source) => ({
        sourceId: source.sourceId,
        contentHash: source.contentHash,
      })),
      compileUnitCount,
      units,
      options,
      stagingGeneration,
      promptVersion: PROMPT_VERSION,
      pageLimitPolicyVersion: PAGE_LIMIT_POLICY_VERSION,
    };
    return {
      sourceIds: options.sourceIds,
      sourceCount: options.sourceIds.length,
      compileUnitCount,
      units,
      maxPlannedPages,
      maxPlannerCalls,
      maxWriterCalls,
      maxModelCalls: maxPlannerCalls + maxWriterCalls,
      maxOutputTokens:
        maxPlannerCalls * options.plannerMaxOutputTokens +
        maxWriterCalls * options.writerMaxOutputTokens,
      stagingGeneration,
      options,
      confirmHash: sha256(stableJson(estimateBase)),
    };
  }

  async compile(request: CompileRequest): Promise<CompileJob> {
    return this.stateMutex.runExclusive(async () => {
      const estimate = this.estimateCompile(request);
      if (!request.confirmHash || request.confirmHash !== estimate.confirmHash) {
        throw new Error("编译确认已失效，请重新执行 estimate");
      }
      const active = this.findActiveJob();
      if (active) throw new Error(`已有编译任务正在执行: ${active.jobId}`);
      const currentStaging = this.store.readStagingState();
      if (currentStaging?.status === "publishing") throw new Error("Staging 正在发布");
      const staging = this.store.ensureStaging();
      const duplicated = estimate.sourceIds.filter((id) => staging.completedSourceIds.includes(id));
      if (duplicated.length) {
        throw new Error(`Source 已合并到当前 Staging: ${duplicated.join(", ")}`);
      }

      const now = new Date().toISOString();
      const jobId = createBase62Id(16);
      const writeToken = createBase62Id(24);
      const job: CompileJob = {
        jobId,
        status: "queued",
        options: estimate.options,
        estimate,
        sources: estimate.sourceIds.map((sourceId) => emptySourceState(sourceId)),
        modelCalls: 0,
        writeToken,
        error: "",
        createdAt: now,
        startedAt: "",
        finishedAt: "",
      };
      this.store.saveJob(job);
      const controller = new AbortController();
      this.controllers.set(jobId, controller);
      this.activeTokens.set(jobId, writeToken);
      void this.runJob(jobId, writeToken, controller).catch((error) => {
        this.logger.error(`llmWikiNext 编译任务异常: ${jobId}: ${formatError(error)}`);
      });
      return job;
    });
  }

  getJob(jobId: string): CompileJob {
    return this.store.getJob(jobId);
  }

  async cancelJob(jobId: string): Promise<CompileJob> {
    return this.stateMutex.runExclusive(async () => {
      const job = this.store.getJob(jobId);
      if (!ACTIVE_JOB_STATUSES.has(job.status)) throw new Error("任务当前不可取消");
      this.activeTokens.delete(jobId);
      this.controllers.get(jobId)?.abort();
      this.controllers.delete(jobId);
      const now = new Date().toISOString();
      const next: CompileJob = {
        ...job,
        status: "cancelled",
        error: "任务已取消",
        finishedAt: now,
        sources: job.sources.map((source) =>
          source.status === "completed" || source.status === "failed"
            ? source
            : { ...source, status: "cancelled", error: "任务已取消", finishedAt: now },
        ),
      };
      return this.store.saveJob(next);
    });
  }

  getStaging(): StagingSummary | null {
    const state = this.store.readStagingState();
    if (!state) return null;
    const snapshot = this.store.readStagingSnapshot();
    return {
      state,
      pageCount: snapshot.manifest.pages.length,
      factCount: countFacts(snapshot),
      pages: snapshot.manifest.pages,
      activeJob: this.findActiveJob(),
    };
  }

  getStagingPage(pageKey: string) {
    const snapshot = this.store.readStagingSnapshot();
    return pageResult(snapshot, pageKey);
  }

  async publishStaging(): Promise<PublishResult> {
    return this.stateMutex.runExclusive(async () => {
      const active = this.findActiveJob();
      if (active) throw new Error(`编译任务尚未结束: ${active.jobId}`);
      const state = this.store.readStagingState();
      if (!state) throw new Error("当前没有可发布的 Staging");
      if (state.status !== "open") throw new Error("Staging 当前不可发布");
      this.store.updateStagingState({ ...state, status: "publishing" });
      try {
        const result = this.store.publishStaging();
        this.pageMutex = new KeyedMutex();
        return result;
      } catch (error) {
        const current = this.store.readStagingState();
        if (current) this.store.updateStagingState({ ...current, status: "open" });
        throw error;
      }
    });
  }

  async discardStaging(): Promise<{ discarded: true }> {
    for (const [jobId, controller] of this.controllers) {
      this.activeTokens.delete(jobId);
      controller.abort();
    }
    this.controllers.clear();
    return this.stateMutex.runExclusive(async () => {
      const now = new Date().toISOString();
      for (const job of this.store.listJobs().filter((item) => ACTIVE_JOB_STATUSES.has(item.status))) {
        this.store.saveJob({
          ...job,
          status: "cancelled",
          error: "Staging 已撤销",
          finishedAt: now,
          sources: job.sources.map((source) =>
            source.status === "completed" || source.status === "failed"
              ? source
              : { ...source, status: "cancelled", error: "Staging 已撤销", finishedAt: now },
          ),
        });
      }
      this.store.discardStaging();
      this.pageMutex = new KeyedMutex();
      return { discarded: true };
    });
  }

  getPublishedManifest() {
    return this.store.readPublishedSnapshot().manifest;
  }

  getPublishedPage(pageKey: string) {
    return pageResult(this.store.readPublishedSnapshot(), pageKey);
  }

  searchPublished(query: string, limit = 20) {
    const normalizedQuery = String(query || "").trim().toLocaleLowerCase();
    if (!normalizedQuery) return { query: "", items: [] };
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit) || 20));
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
    const documents = this.store.readPublishedSnapshot().searchIndex.documents;
    const items = documents
      .map((document) => ({ document, score: searchScore(document, normalizedQuery, tokens) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.document.title.localeCompare(b.document.title))
      .slice(0, safeLimit)
      .map(({ document, score }) => ({ ...document, score }));
    return { query: String(query || "").trim(), items };
  }

  private normalizeOptions(request: CompileRequest): NormalizedCompileOptions {
    const sourceIds = uniqueStrings((request.sourceIds || []).map((id) => String(id || "").trim()));
    if (!sourceIds.length) throw new Error("sourceIds 不能为空");
    if (sourceIds.length !== (request.sourceIds || []).length) throw new Error("sourceIds 包含空值或重复值");
    const model = String(request.model || "").trim();
    if (!model || !this.model.findModel(model)) throw new Error(`解析模型不存在或不可用: ${model || "未指定"}`);
    return {
      sourceIds,
      model,
      sourceConcurrency: boundedInt(request.sourceConcurrency, 1, 1, 16, "sourceConcurrency"),
      chunkChars: boundedInt(request.chunkChars, 12_000, 1_000, 60_000, "chunkChars"),
      plannerMaxOutputTokens: boundedInt(
        request.plannerMaxOutputTokens,
        2_000,
        256,
        16_000,
        "plannerMaxOutputTokens",
      ),
      writerMaxOutputTokens: boundedInt(
        request.writerMaxOutputTokens,
        8_000,
        256,
        32_000,
        "writerMaxOutputTokens",
      ),
    };
  }

  private async runJob(jobId: string, token: string, controller: AbortController): Promise<void> {
    try {
      await this.patchJob(jobId, (job) => ({
        ...job,
        status: "running",
        startedAt: new Date().toISOString(),
      }));
      const job = this.store.getJob(jobId);
      await runWorkers(job.options.sourceIds, job.options.sourceConcurrency, async (sourceId) => {
        await this.processSource(jobId, token, sourceId, controller.signal);
      });
      if (!this.isWritable(jobId, token)) return;
      await this.patchJob(jobId, (current) => {
        if (isTerminalJob(current.status)) return current;
        const hasErrors = current.sources.some((source) => source.status === "failed");
        return {
          ...current,
          status: hasErrors ? "completed_with_errors" : "completed",
          finishedAt: new Date().toISOString(),
        };
      });
    } catch (error) {
      if (this.isWritable(jobId, token)) {
        await this.patchJob(jobId, (job) => ({
          ...job,
          status: controller.signal.aborted ? "cancelled" : "failed",
          error: formatError(error),
          finishedAt: new Date().toISOString(),
        }));
      }
    } finally {
      if (this.activeTokens.get(jobId) === token) this.activeTokens.delete(jobId);
      this.controllers.delete(jobId);
    }
  }

  private async processSource(
    jobId: string,
    token: string,
    sourceId: string,
    jobSignal: AbortSignal,
  ): Promise<void> {
    const sourceController = new AbortController();
    const signal = AbortSignal.any([jobSignal, sourceController.signal]);
    const allocatedPageKeys: string[] = [];
    let releasePages: (() => void) | null = null;
    try {
      this.assertWritable(jobId, token);
      await this.patchSource(jobId, sourceId, {
        status: "planning",
        startedAt: new Date().toISOString(),
        error: "",
      });
      const source = this.store.getSource(sourceId);
      const job = this.store.getJob(jobId);
      const units = splitSource(source, job.options.chunkChars);
      await this.patchSource(jobId, sourceId, { compileUnitCount: units.length });
      const catalog = this.store.readStagingSnapshot().manifest.pages;

      const planResults = await Promise.allSettled(
        units.map(async (unit) => {
          try {
            const maxPages = calculateMaxPages(unit.content.length);
            const availablePageKeys = await this.reservePageKeys(maxPages);
            allocatedPageKeys.push(...availablePageKeys);
            const plan = await this.runPlanner(
              jobId,
              token,
              source,
              unit,
              catalog,
              availablePageKeys,
              maxPages,
              signal,
            );
            const usedCreateIds = new Set(
              plan.pages.filter((page) => page.operation === "create").map((page) => page.pageKey),
            );
            await this.releasePageKeys(availablePageKeys.filter((id) => !usedCreateIds.has(id)));
            return { unit, plan };
          } catch (error) {
            sourceController.abort();
            throw error;
          }
        }),
      );
      const rejectedPlan = planResults.find((result) => result.status === "rejected");
      if (rejectedPlan?.status === "rejected") throw rejectedPlan.reason;
      const plans = planResults.map((result) => {
        if (result.status !== "fulfilled") throw result.reason;
        return result.value;
      });
      this.assertWritable(jobId, token);
      await this.patchSource(jobId, sourceId, {
        status: "writing",
        plannerCalls: units.length,
      });

      const pageKeys = uniqueStrings(plans.flatMap(({ plan }) => plan.pages.map((page) => page.pageKey))).sort();
      releasePages = await this.pageMutex.acquireMany(pageKeys);
      this.assertWritable(jobId, token);
      const overlay = await this.runWriters(jobId, token, source, plans, signal);
      this.assertWritable(jobId, token);

      // Source 只有在全部 Writer 成功后才进入这个提交点，失败不会留下半成品。
      await this.stateMutex.runExclusive(async () => {
        this.assertWritable(jobId, token);
        this.store.commitSourceOverlay(overlay);
      });
      await this.releasePageKeys(allocatedPageKeys);
      await this.patchSource(jobId, sourceId, {
        status: "completed",
        writerCalls: plans.length,
        pageKeys,
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      sourceController.abort();
      await this.releasePageKeys(allocatedPageKeys).catch(() => undefined);
      const cancelled = jobSignal.aborted || !this.isWritable(jobId, token);
      await this.patchSource(jobId, sourceId, {
        status: cancelled ? "cancelled" : "failed",
        error: cancelled ? "任务已取消" : formatError(error),
        finishedAt: new Date().toISOString(),
      }).catch(() => undefined);
    } finally {
      releasePages?.();
    }
  }

  private async runPlanner(
    jobId: string,
    token: string,
    source: SourceSnapshot,
    unit: CompileUnit,
    existingPages: ManifestPage[],
    availablePageKeys: string[],
    maxPages: number,
    signal: AbortSignal,
  ): Promise<WikiPagePlan> {
    const job = await this.beforeModelCall(jobId, token);
    const value = await this.callJson({
      model: job.options.model,
      maxTokens: job.options.plannerMaxOutputTokens,
      signal,
      system: plannerPrompt(),
      payload: {
        existingPages,
        availablePageKeys,
        sourceId: source.sourceId,
        unitId: unit.unitId,
        compileUnitContent: numberSourceLines(unit.content, unit.startLine),
        maxPages,
      },
    });
    this.assertWritable(jobId, token);
    return validatePlan(value, source.sourceId, unit.unitId, existingPages, availablePageKeys, maxPages);
  }

  private async runWriters(
    jobId: string,
    token: string,
    source: SourceSnapshot,
    plans: Array<{ unit: CompileUnit; plan: WikiPagePlan }>,
    signal: AbortSignal,
  ): Promise<SourceOverlay> {
    const snapshot = this.store.readStagingSnapshot();
    const manifest = new Map(snapshot.manifest.pages.map((page) => [page.pageKey, page]));
    const workingPages = new Map<string, SourceOverlayPage>();

    for (const { unit, plan } of [...plans].sort((a, b) => a.unit.startOffset - b.unit.startOffset)) {
      const existingPages: Record<string, { title: string; goal: string; bodyMarkdown: string }> = {};
      for (const page of plan.pages) {
        const working = workingPages.get(page.pageKey);
        const exists = Boolean(working) || page.pageKey in snapshot.pages;
        if (page.operation === "create" && exists) throw new Error(`create 页面已经存在: ${page.pageKey}`);
        if (page.operation === "update" && !exists) throw new Error(`update 页面不存在: ${page.pageKey}`);
        if (page.operation === "update") {
          const published = manifest.get(page.pageKey);
          existingPages[page.pageKey] = {
            title: working?.title || published?.title || page.title,
            goal: working?.goal || published?.goal || page.goal,
            bodyMarkdown: working?.bodyMarkdown || snapshot.pages[page.pageKey],
          };
        }
      }

      const job = await this.beforeModelCall(jobId, token);
      const raw = await this.callJson({
        model: job.options.model,
        maxTokens: job.options.writerMaxOutputTokens,
        signal,
        system: writerPrompt(),
        payload: {
          sourceId: source.sourceId,
          completeSource: numberSourceLines(unit.content, unit.startLine),
          pagePlan: plan,
          existingPages,
        },
      });
      this.assertWritable(jobId, token);
      const output = validateWriterOutput(raw, source, unit, plan);
      const planByKey = new Map(plan.pages.map((page) => [page.pageKey, page]));

      for (const written of output.pages) {
        const page = planByKey.get(written.pageKey);
        if (!page) throw new Error(`Writer 返回未规划页面: ${written.pageKey}`);
        const previous = workingPages.get(page.pageKey);
        const existing = manifest.get(page.pageKey);
        workingPages.set(page.pageKey, {
          pageKey: page.pageKey,
          title: page.title,
          goal: page.goal,
          relatedPageKeys: uniqueStrings([
            ...(existing?.relatedPageKeys || []),
            ...(previous?.relatedPageKeys || []),
            ...page.relatedPageKeys,
          ]),
          bodyMarkdown: written.bodyMarkdown,
          facts: uniqueFacts([...(previous?.facts || []), ...written.keyFacts]),
        });
      }
    }

    return { sourceId: source.sourceId, pages: [...workingPages.values()] };
  }

  private async callJson(args: {
    model: string;
    maxTokens: number;
    signal: AbortSignal;
    system: string;
    payload: unknown;
  }): Promise<unknown> {
    const timeoutSignal = AbortSignal.timeout(MODEL_TIMEOUT_MS);
    const response = await this.model.chat({
      model: args.model,
      temperature: 0,
      response_format: { type: "json_object" },
      maxTokens: args.maxTokens,
      signal: AbortSignal.any([args.signal, timeoutSignal]),
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: JSON.stringify(args.payload) },
      ],
    });
    return parseJson(extractModelContent(response));
  }

  private async reservePageKeys(count: number): Promise<string[]> {
    return this.stateMutex.runExclusive(async () => {
      const state = this.store.readStagingState();
      if (!state || state.status !== "open") throw new Error("Staging 当前不可预留页面 ID");
      const occupied = new Set([
        ...state.reservedPageKeys,
        ...this.store.readStagingSnapshot().manifest.pages.map((page) => page.pageKey),
      ]);
      const ids: string[] = [];
      while (ids.length < count) {
        const id = createBase62Id(8);
        if (occupied.has(id)) continue;
        occupied.add(id);
        ids.push(id);
      }
      this.store.updateStagingState({
        ...state,
        reservedPageKeys: [...state.reservedPageKeys, ...ids],
      });
      return ids;
    });
  }

  private async releasePageKeys(pageKeys: string[]): Promise<void> {
    if (!pageKeys.length) return;
    await this.stateMutex.runExclusive(async () => {
      const state = this.store.readStagingState();
      if (!state) return;
      const released = new Set(pageKeys);
      this.store.updateStagingState({
        ...state,
        reservedPageKeys: state.reservedPageKeys.filter((id) => !released.has(id)),
      });
    });
  }

  private async beforeModelCall(jobId: string, token: string): Promise<CompileJob> {
    return this.stateMutex.runExclusive(async () => {
      this.assertWritable(jobId, token);
      const job = this.store.getJob(jobId);
      if (job.modelCalls >= job.estimate.maxModelCalls) throw new Error("模型调用数超过确认上限");
      const next = { ...job, modelCalls: job.modelCalls + 1 };
      this.store.saveJob(next);
      return next;
    });
  }

  private async patchJob(jobId: string, patch: (job: CompileJob) => CompileJob): Promise<CompileJob> {
    return this.stateMutex.runExclusive(async () => {
      const current = this.store.getJob(jobId);
      if (isTerminalJob(current.status)) return current;
      return this.store.saveJob(patch(current));
    });
  }

  private async patchSource(
    jobId: string,
    sourceId: string,
    patch: Partial<CompileSourceState>,
  ): Promise<void> {
    await this.stateMutex.runExclusive(async () => {
      const job = this.store.getJob(jobId);
      const sources = job.sources.map((source) =>
        source.sourceId === sourceId ? { ...source, ...patch } : source,
      );
      this.store.saveJob({ ...job, sources });
    });
  }

  private findActiveJob(): CompileJob | null {
    return this.store.listJobs().find((job) => ACTIVE_JOB_STATUSES.has(job.status)) || null;
  }

  private isWritable(jobId: string, token: string): boolean {
    return this.activeTokens.get(jobId) === token && !this.controllers.get(jobId)?.signal.aborted;
  }

  private assertWritable(jobId: string, token: string): void {
    if (!this.isWritable(jobId, token)) throw new Error("任务写权限已失效");
  }
}

export function calculateMaxPages(charCount: number): number {
  const thresholdIndex = PAGE_CHAR_THRESHOLDS.findIndex((threshold) => charCount <= threshold);
  return thresholdIndex === -1 ? 8 : thresholdIndex + 2;
}

export function splitSource(source: SourceSnapshot, chunkChars: number): CompileUnit[] {
  const units: CompileUnit[] = [];
  let startLine = 1;
  for (let startOffset = 0; startOffset < source.content.length; startOffset += chunkChars) {
    const endOffset = Math.min(source.content.length, startOffset + chunkChars);
    const content = source.content.slice(startOffset, endOffset);
    units.push({
      unitId: `${source.sourceId}-${String(units.length + 1).padStart(4, "0")}`,
      sourceId: source.sourceId,
      content,
      startOffset,
      endOffset,
      startLine,
      contentHash: sha256(content),
    });
    startLine += content.match(/\n/g)?.length || 0;
  }
  return units;
}

function validatePlan(
  value: unknown,
  sourceId: string,
  unitId: string,
  existingPages: ManifestPage[],
  availablePageKeys: string[],
  maxPages: number,
): WikiPagePlan {
  const record = objectValue(value, "Planner 输出必须是对象");
  if (!Array.isArray(record.pages) || !record.pages.length) {
    throw new Error("Planner pages 必须是非空数组");
  }
  if (record.pages.length > maxPages) throw new Error("Planner 页面数超过确认上限");
  const existing = new Set(existingPages.map((page) => page.pageKey));
  const available = new Set(availablePageKeys);
  const pages = record.pages.map((raw): WikiPagePlanItem => {
    const page = objectValue(raw, "Planner page 必须是对象");
    const pageKey = stringValue(page.pageKey, "Planner pageKey 不能为空");
    const operation = page.operation;
    if (operation !== "create" && operation !== "update") throw new Error("Planner operation 非法");
    if (operation === "create" && !available.has(pageKey)) throw new Error(`create pageKey 未预留: ${pageKey}`);
    if (operation === "update" && !existing.has(pageKey)) throw new Error(`update pageKey 不存在: ${pageKey}`);
    return {
      pageKey,
      operation,
      title: stringValue(page.title, "Planner title 不能为空"),
      goal: stringValue(page.goal, "Planner goal 不能为空"),
      scope: stringValue(page.scope, "Planner scope 不能为空"),
      outline: nonEmptyArray(page.outline, "Planner outline 必须是非空数组").map((rawOutline) => {
        const outline = objectValue(rawOutline, "Planner outline 项必须是对象");
        return {
          heading: stringValue(outline.heading, "Planner outline heading 不能为空"),
          writingPoints: nonEmptyStringArray(
            outline.writingPoints,
            "Planner writingPoints 必须是非空字符串数组",
          ),
          sourceAnchors: nonEmptyStringArray(
            outline.sourceAnchors,
            "Planner sourceAnchors 必须是非空字符串数组",
          ),
        };
      }),
      relatedPageKeys: stringArray(page.relatedPageKeys, "Planner relatedPageKeys 必须是字符串数组"),
    };
  });
  if (new Set(pages.map((page) => page.pageKey)).size !== pages.length) {
    throw new Error("同一 Plan 中 pageKey 不得重复");
  }
  const samePlanCreates = new Set(pages.filter((page) => page.operation === "create").map((page) => page.pageKey));
  for (const page of pages) {
    for (const related of page.relatedPageKeys) {
      if (related === page.pageKey) throw new Error(`页面不得关联自身: ${page.pageKey}`);
      if (!existing.has(related) && !samePlanCreates.has(related)) {
        throw new Error(`关联页面不存在: ${related}`);
      }
    }
  }
  return {
    sourceId,
    unitId,
    partitionIntent: stringValue(record.partitionIntent, "Planner partitionIntent 不能为空"),
    pages,
  };
}

function validateWriterOutput(
  value: unknown,
  source: SourceSnapshot,
  unit: CompileUnit,
  plan: WikiPagePlan,
): MultiPageWriterOutput {
  const record = objectValue(value, "Writer 输出必须是对象");
  if (!Array.isArray(record.pages)) throw new Error("Writer pages 必须是数组");
  const unitEndLine = unit.startLine + (unit.content.match(/\n/g)?.length || 0);
  const pages = record.pages.map((raw) => {
    const page = objectValue(raw, "Writer page 必须是对象");
    const pageKey = stringValue(page.pageKey, "Writer pageKey 不能为空");
    const bodyMarkdown = stringValue(page.bodyMarkdown, "Writer bodyMarkdown 不能为空");
    if (!Array.isArray(page.keyFacts)) throw new Error("Writer keyFacts 必须是数组");
    const keyFacts = uniqueFacts(page.keyFacts.map((rawFact): KeyFact => {
      const fact = objectValue(rawFact, "Writer Fact 必须是对象");
      return {
        fact: stringValue(fact.fact, "Writer fact 不能为空"),
        sourceId: source.sourceId,
        // 行号只是辅助定位。兼容纯数字字符串和常见范围写法；无法可靠定位时保留 Fact、清空行号。
        sourceLine: normalizeSourceLine(fact.sourceLine, unit.startLine, unitEndLine, source.lineCount),
      };
    })).slice(0, MAX_FACTS_PER_PLAN);
    return { pageKey, bodyMarkdown, keyFacts };
  });
  const returnedKeys = pages.map((page) => page.pageKey);
  if (new Set(returnedKeys).size !== returnedKeys.length) throw new Error("Writer pageKey 不得重复");
  const expectedKeys = new Set(plan.pages.map((page) => page.pageKey));
  if (returnedKeys.length !== expectedKeys.size || returnedKeys.some((pageKey) => !expectedKeys.has(pageKey))) {
    throw new Error("Writer pageKey 集合必须与 Plan 完全一致");
  }
  return { pages };
}


function plannerPrompt(): string {
  return [
    "你是 llmWiki 的 Wiki 页面规划器。",
    "你会收到带原始全局行号的完整当前 Compile Unit、已有页面目录、可用新页面 ID 和动态 maxPages。",
    "原则：",
    "1. 只输出写作计划，不生成最终正文或 Key Facts。",
    "2. 当前 Compile Unit 是事实边界；不使用外部知识补齐原文。",
    "3. partitionIntent 要说明整体拆分思路；scope + outline 必须明确每页负责的内容和与其他页面的边界。",
    "4. outline 中每个章节都要给出具体 writingPoints 和 sourceAnchors；sourceAnchors 只用于定位原文，不是正文。",
    "5. 按用户阅读目的组织页面；同一内容不得同时分配给多页重复展开。",
    "6. 外部链接、目录项或‘参见某文档’不能被视为已有正文。",
    "7. pages 可以少于 maxPages，但至少返回 1 页；不得为凑数量拆页。",
    "8. 已有页面与当前目标一致时优先 update，否则 create。",
    "9. create 只能使用 availablePageKeys；update 只能使用 existingPages 中的 pageKey。",
    "10. Plan 内 pageKey 不得重复，页面不得关联自身，relatedPageKeys 只能引用已有页面或同 Plan create 的页面。",
    "只返回 JSON：",
    "{partitionIntent,pages:[{pageKey,operation,title,goal,scope,outline:[{heading,writingPoints:[string],sourceAnchors:[string]}],relatedPageKeys:[string]}]}。",
  ].join("\n");
}

function writerPrompt(): string {
  return [
    "你是 llmWiki 的统一多页面 Writer。",
    "你会同时收到带原始全局行号的完整当前 Compile Unit、完整 WikiPagePlan，以及本 Plan 中 update 页面的最新完整正文。",
    "请一次生成 Plan 中全部页面，bodyMarkdown 是核心产物。",
    "正文规则：",
    "1. completeSource 是当前写入的唯一事实来源；不使用外部知识补充或纠正原文。",
    "2. 严格按 partitionIntent、scope 和 outline 决定内容归属，每页只完整展开自己负责的内容。",
    "3. 分配给其他页面的知识不得重复展开；必要的共享前置条件或安全警告可以保持一致地重复。",
    "4. 必须返回 Plan 中每个 pageKey 且只返回一次，不得缺页或增加未规划页面。",
    "5. create 时生成完整页面，并以与 Plan title 一致的一级标题开始。",
    "6. update 时以 existingPages 中对应正文为基线合并新知识，返回合并后的完整正文。",
    "7. update 不得删除仍然成立的旧事实、命令、参数、条件、限制和警告；内容冲突时保留双方并明确各自条件。",
    "8. 保留命令、参数、路径、数值、限制和警告的准确含义。",
    "完成正文后，再单独从当前 Source 中选择 Key Facts。",
    "Key Facts 不是正文摘要，也不是页面知识点列表。",
    "只有当用户忽略该事实可能导致错误操作、错误判断、安全风险、设备损坏、版本不兼容或难以发现的异常时，才可以记录为 Key Fact。",
    "Key Facts 优先级从高到低：",
    "1. 安全风险、损坏风险和必须满足的前置条件。",
    "2. ‘仅限、必须、禁止、不会、失效、忽略、除非’等非直觉限制。",
    "3. 会导致操作结果错误的精确参数、默认值、版本和兼容性条件。",
    "4. 容易被误解的异常行为、无结果原因和配置失效条件。",
    "不要记录页面标题、章节主题、正文概要、普通背景知识、支持列表、一般操作步骤、仅用于举例的值、低影响事实、重复事实或 Source 没有明确表达的推断。",
    "Key Facts 选择规则：",
    "1. 可以返回 0 条，不得为了凑数量返回 Fact；最多返回 5 条，宁缺毋滥。",
    "2. 按风险和影响程度从高到低排列，每条 Fact 必须独立、具体并保留必要条件。",
    "3. sourceLine 必须返回最直接支持该 Fact 的原始 Source 全局行号，格式为单个 JSON 整数，例如 17。",
    "4. 一个 Fact 如果需要多个相距较远的段落才能成立，应拆分或不记录。",
    "5. 只选择当前 completeSource 本次新增的事实，不总结 existingPages。",
    "6. 每个页面可以返回 0 到 5 条 Key Facts；不返回 sourceId。",
    "只返回 JSON：{pages:[{pageKey,bodyMarkdown,keyFacts:[{fact,sourceLine:17}]}]}。",
  ].join("\n");
}

function normalizeSourceLine(
  value: unknown,
  unitStartLine: number,
  unitEndLine: number,
  sourceLineCount: number,
): number | null {
  let line: number | null = null;
  if (typeof value === "number" && Number.isInteger(value)) {
    line = value;
  } else if (typeof value === "string") {
    const match = value.trim().match(/^(?:(?:line|第)\s*)?(\d+)(?:\s*(?:-|–|—|~|～|至|,|，)\s*\d+)?\s*(?:行)?$/i);
    if (match) line = Number(match[1]);
  }
  if (line === null || line < unitStartLine || line > unitEndLine || line > sourceLineCount) return null;
  return line;
}

function uniqueFacts(facts: KeyFact[]): KeyFact[] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = normalizeFactKey(fact.fact);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeFactKey(fact: string): string {
  return fact
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[。.!！?？;；,，:：]+$/g, "");
}

function numberSourceLines(content: string, startLine: number): string {
  return content
    .split("\n")
    .map((line, index) => `${startLine + index}: ${line}`)
    .join("\n");
}

function extractModelContent(response: unknown): string {
  const record = objectValue(response, "模型响应为空");
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = choices[0];
  if (!first || typeof first !== "object") throw new Error("模型未返回 choices");
  const choice = first as Record<string, unknown>;
  const message = choice.message && typeof choice.message === "object"
    ? choice.message as Record<string, unknown>
    : {};
  const content = typeof message.content === "string"
    ? message.content
    : typeof choice.text === "string"
      ? choice.text
      : "";
  if (!content.trim()) throw new Error("模型未返回文本内容");
  return content;
}

function parseJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error("模型输出不是合法 JSON");
  }
}

function pageResult(snapshot: WikiSnapshot, pageKey: string) {
  const page = snapshot.manifest.pages.find((item) => item.pageKey === pageKey);
  if (!page || !(pageKey in snapshot.pages)) throw new Error("Wiki 页面不存在");
  return {
    ...page,
    bodyMarkdown: snapshot.pages[pageKey],
    keyFacts: snapshot.facts.byPage[pageKey] || [],
  };
}

function searchScore(
  document: WikiSnapshot["searchIndex"]["documents"][number],
  query: string,
  tokens: string[],
): number {
  const title = document.title.toLocaleLowerCase();
  const goal = document.goal.toLocaleLowerCase();
  const facts = document.facts.join("\n").toLocaleLowerCase();
  const body = document.bodyMarkdown.toLocaleLowerCase();
  let score = title.includes(query) ? 20 : goal.includes(query) ? 12 : 0;
  for (const token of tokens) {
    if (title.includes(token)) score += 8;
    if (goal.includes(token)) score += 5;
    if (facts.includes(token)) score += 3;
    if (body.includes(token)) score += 1;
  }
  return score;
}

function countFacts(snapshot: WikiSnapshot): number {
  return Object.values(snapshot.facts.byPage).reduce((sum, facts) => sum + facts.length, 0);
}

function emptySourceState(sourceId: string): CompileSourceState {
  return {
    sourceId,
    status: "pending",
    compileUnitCount: 0,
    plannerCalls: 0,
    writerCalls: 0,
    pageKeys: [],
    error: "",
    startedAt: "",
    finishedAt: "",
  };
}

async function runWorkers<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const count = Math.min(items.length, concurrency);
  await Promise.all(
    Array.from({ length: count }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await worker(items[index]);
      }
    }),
  );
}

function boundedInt(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  field: string,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${field} 必须是 ${min} 到 ${max} 之间的整数`);
  }
  return parsed;
}

function objectValue(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, message: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(message);
  return text;
}

function stringArray(value: unknown, message: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(message);
  }
  return uniqueStrings(value.map((item) => item.trim()));
}

function nonEmptyArray(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value) || !value.length) throw new Error(message);
  return value;
}

function nonEmptyStringArray(value: unknown, message: string): string[] {
  const values = stringArray(value, message);
  if (!values.length) throw new Error(message);
  return values;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createBase62Id(length: number): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  return Array.from(randomBytes(length), (byte) => alphabet[byte % alphabet.length]).join("");
}

function isTerminalJob(status: CompileJob["status"]): boolean {
  return !ACTIVE_JOB_STATUSES.has(status);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = previous.then(() => gate);
    await previous;
    return release;
  }

  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

class KeyedMutex {
  private readonly locks = new Map<string, AsyncMutex>();

  async acquireMany(keys: string[]): Promise<() => void> {
    const releases: Array<() => void> = [];
    for (const key of uniqueStrings(keys).sort()) {
      const mutex = this.locks.get(key) || new AsyncMutex();
      this.locks.set(key, mutex);
      releases.push(await mutex.acquire());
    }
    return () => {
      for (const release of releases.reverse()) release();
    };
  }
}
