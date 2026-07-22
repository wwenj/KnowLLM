import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { ModelService } from "../model/model.service";
import { LlmWikiNextStore } from "./llm-wiki-next.store";
import {
  CompileEstimate,
  CompileExecutionOptions,
  CompilePool,
  CompilePoolCancelResult,
  CompilePoolItem,
  CompileRequest,
  CompileUnit,
  DeleteSourcesResult,
  KeyFact,
  ManifestPage,
  MultiPageWriterOutput,
  NormalizedCompileOptions,
  PublishResult,
  SourceOverlay,
  SourceOverlayPage,
  SourceRecord,
  SourceSnapshot,
  StagingSummary,
  WikiPagePlan,
  WikiPagePlanItem,
  WikiSnapshot,
} from "./llm-wiki-next.types";

const PROMPT_VERSION = "llm-wiki-next-v2";
const PAGE_LIMIT_POLICY_VERSION = "adaptive-pages-v1";
const PAGE_CHAR_THRESHOLDS = [
  4_000, 10_000, 19_000, 31_000, 46_000, 64_000,
] as const;
const MODEL_TIMEOUT_MS = 5 * 60_000;
const MAX_FACTS_PER_PLAN = 5;
@Injectable()
export class LlmWikiNextService implements OnModuleInit {
  private readonly logger = new Logger(LlmWikiNextService.name);
  private readonly stateMutex = new AsyncMutex();
  private pageMutex = new KeyedMutex();
  private readonly controllers = new Map<string, AbortController>();
  private readonly activeTokens = new Map<string, string>();
  private schedulerQueued = false;

  constructor(
    private readonly store: LlmWikiNextStore,
    private readonly model: ModelService,
  ) {}

  onModuleInit(): void {
    this.store.clearInterruptedCompileState();
  }

  uploadSource(filename: string, buffer: Buffer): SourceRecord {
    if (buffer.length > 10 * 1024 * 1024)
      throw new Error("Source 文件不能超过 10MB");
    return this.store.saveSource(filename, buffer);
  }

  listSources(): SourceRecord[] {
    return this.store.listSources();
  }

  getSource(sourceId: string): SourceSnapshot {
    return this.store.getSource(sourceId);
  }

  async deleteSources(sourceIds: string[]): Promise<DeleteSourcesResult> {
    const ids = [...new Set(sourceIds)];
    if (!ids.length) throw new Error("请选择至少一个 Source");
    const result = await this.stateMutex.runExclusive(async () => {
      // 先验证全部 Source 存在，保证批量删除不会出现部分成功。
      for (const sourceId of ids) this.store.getSource(sourceId);

      const conflicts = ids
        .map((sourceId) => ({
          sourceId,
          locations: this.store.sourceCompileArtifactLocations(sourceId),
        }))
        .filter((item) => item.locations.length > 0);
      if (conflicts.length) {
        const details = conflicts
          .map(({ sourceId, locations }) => {
            const labels = locations.map((location) =>
              location === "staging" ? "待发布" : "正式发布",
            );
            return `${sourceId}（${labels.join("、")}）`;
          })
          .join(", ");
        throw new ConflictException({
          message: `以下 Source 仍有关联编译产物，不能删除，请先清除编译产物: ${details}`,
          error: "SOURCE_HAS_COMPILE_ARTIFACTS",
        });
      }

      // 编译状态本身不阻止删除；删除前使对应任务失去写权限，防止晚到响应写回。
      this.removeSourcesFromCompilePoolLocked(new Set(ids));
      const staging = this.store.readStagingState();
      if (staging) {
        const completedSourceIds = staging.completedSourceIds.filter(
          (sourceId) => !ids.includes(sourceId),
        );
        if (completedSourceIds.length !== staging.completedSourceIds.length) {
          this.store.updateStagingState({ ...staging, completedSourceIds });
        }
      }
      this.store.deleteSources(ids);
      return { deletedSourceIds: ids };
    });
    this.schedulePool();
    return result;
  }

  estimateCompile(request: CompileRequest): CompileEstimate {
    const options = this.normalizeOptions(request);
    const sources = options.sourceIds.map((sourceId) =>
      this.store.getSource(sourceId),
    );
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
    const workspaceMarker = this.store.workspaceMarker();
    const estimateBase = {
      sourceIds: options.sourceIds,
      sourceHashes: sources.map((source) => ({
        sourceId: source.sourceId,
        contentHash: source.contentHash,
      })),
      compileUnitCount,
      units,
      options,
      workspaceMarker,
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
      workspaceMarker,
      options,
      confirmHash: sha256(stableJson(estimateBase)),
    };
  }

  async compile(request: CompileRequest): Promise<CompilePool> {
    const estimate = this.estimateCompile(request);
    if (!request.confirmHash || request.confirmHash !== estimate.confirmHash) {
      throw new Error("编译确认已失效，请重新执行 estimate");
    }

    const pool = await this.stateMutex.runExclusive(async () => {
      if (this.store.workspaceMarker() !== estimate.workspaceMarker) {
        throw new Error("编译确认已失效，请重新执行 estimate");
      }
      const currentStaging = this.store.readStagingState();
      if (currentStaging?.status === "publishing")
        throw new Error("Staging 正在发布");
      const staging = this.store.ensureStaging();
      const completed = new Set(staging.completedSourceIds);
      const existing = this.store.readCompilePool();
      const activeIds = new Set(
        (existing?.items || [])
          .filter((item) =>
            ["queued", "planning", "writing"].includes(item.status),
          )
          .map((item) => item.sourceId),
      );
      const duplicated = estimate.sourceIds.filter(
        (id) => completed.has(id) || activeIds.has(id),
      );
      if (duplicated.length) {
        throw new Error(
          `Source 已在当前 Staging 中排队或合并: ${duplicated.join(", ")}`,
        );
      }

      const now = new Date().toISOString();
      const pool: CompilePool = existing
        ? {
            ...existing,
            options: executionOptions(estimate.options),
            configVersion: existing.configVersion + 1,
            items: [...existing.items],
            updatedAt: now,
          }
        : {
            poolId: createBase62Id(16),
            workspaceId: staging.workspaceId,
            configVersion: 1,
            options: executionOptions(estimate.options),
            items: [],
            createdAt: now,
            updatedAt: now,
          };
      for (const sourceId of estimate.sourceIds) {
        const source = this.store.getSource(sourceId);
        const previous = pool.items.findIndex(
          (item) => item.sourceId === sourceId,
        );
        if (previous >= 0) pool.items.splice(previous, 1);
        pool.items.push(createPoolItem(source, estimate, now));
      }
      this.store.saveCompilePool(pool);
      return pool;
    });
    this.schedulePool();
    return pool;
  }

  getCompilePool(): CompilePool | null {
    return this.store.readCompilePool();
  }

  async cancelCompilePool(): Promise<CompilePoolCancelResult> {
    return this.stateMutex.runExclusive(async () =>
      this.clearCompilePoolLocked(),
    );
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
      compilePool: this.store.readCompilePool(),
    };
  }

  getStagingPage(pageKey: string) {
    const snapshot = this.store.readStagingSnapshot();
    return pageResult(snapshot, pageKey);
  }

  async publishStaging(): Promise<PublishResult> {
    return this.stateMutex.runExclusive(async () => {
      const state = this.store.readStagingState();
      if (!state) throw new Error("当前没有可发布的 Staging");
      if (state.status !== "open") throw new Error("Staging 当前不可发布");
      if (!state.completedSourceIds.length)
        throw new Error("需要至少一个已合并 Source 才能发布");
      const cancelled = this.clearCompilePoolLocked();
      const current = this.store.readStagingState();
      if (!current) throw new Error("当前没有可发布的 Staging");
      this.store.updateStagingState({ ...current, status: "publishing" });
      try {
        const result = this.store.publishStaging();
        this.pageMutex = new KeyedMutex();
        return {
          ...result,
          cancelledQueuedCount: cancelled.queuedCount,
          cancelledRunningCount: cancelled.runningCount,
        };
      } catch (error) {
        const current = this.store.readStagingState();
        if (current)
          this.store.updateStagingState({ ...current, status: "open" });
        throw error;
      }
    });
  }

  async discardStaging(): Promise<{ discarded: true }> {
    return this.stateMutex.runExclusive(async () => {
      this.clearCompilePoolLocked();
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
    const normalizedQuery = String(query || "")
      .trim()
      .toLocaleLowerCase();
    if (!normalizedQuery) return { query: "", items: [] };
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit) || 20));
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
    const documents = this.store.readPublishedSnapshot().searchIndex.documents;
    const items = documents
      .map((document) => ({
        document,
        score: searchScore(document, normalizedQuery, tokens),
      }))
      .filter((item) => item.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score || a.document.title.localeCompare(b.document.title),
      )
      .slice(0, safeLimit)
      .map(({ document, score }) => ({ ...document, score }));
    return { query: String(query || "").trim(), items };
  }

  private normalizeOptions(request: CompileRequest): NormalizedCompileOptions {
    const sourceIds = uniqueStrings(
      (request.sourceIds || []).map((id) => String(id || "").trim()),
    );
    if (!sourceIds.length) throw new Error("sourceIds 不能为空");
    if (sourceIds.length !== (request.sourceIds || []).length)
      throw new Error("sourceIds 包含空值或重复值");
    const model = String(request.model || "").trim();
    if (!model || !this.model.findModel(model))
      throw new Error(`解析模型不存在或不可用: ${model || "未指定"}`);
    return {
      sourceIds,
      model,
      sourceConcurrency: boundedInt(
        request.sourceConcurrency,
        1,
        1,
        16,
        "sourceConcurrency",
      ),
      chunkChars: boundedInt(
        request.chunkChars,
        12_000,
        1_000,
        60_000,
        "chunkChars",
      ),
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

  private async processSource(
    sourceId: string,
    token: string,
    signal: AbortSignal,
    options: CompileExecutionOptions,
  ): Promise<void> {
    const sourceController = new AbortController();
    const sourceSignal = AbortSignal.any([signal, sourceController.signal]);
    const allocatedPageKeys: string[] = [];
    let releasePages: (() => void) | null = null;
    try {
      this.assertWritable(sourceId, token);
      const source = this.store.getSource(sourceId);
      if (source.contentHash !== this.getPoolItem(sourceId)?.contentHash) {
        throw new Error("Source 内容已变化，请重新加入待编译池");
      }
      const units = splitSource(source, options.chunkChars);
      await this.patchPoolItem(sourceId, token, {
        status: "planning",
        compileUnitCount: units.length,
        error: "",
      });
      const catalog = this.store.readStagingSnapshot().manifest.pages;

      const planResults = await Promise.allSettled(
        units.map(async (unit) => {
          try {
            const maxPages = calculateMaxPages(unit.content.length);
            const availablePageKeys = await this.reservePageKeys(maxPages);
            allocatedPageKeys.push(...availablePageKeys);
            const plan = await this.runPlanner(
              sourceId,
              token,
              options,
              source,
              unit,
              catalog,
              availablePageKeys,
              maxPages,
              sourceSignal,
            );
            const usedCreateIds = new Set(
              plan.pages
                .filter((page) => page.operation === "create")
                .map((page) => page.pageKey),
            );
            await this.releasePageKeys(
              availablePageKeys.filter((id) => !usedCreateIds.has(id)),
            );
            return { unit, plan };
          } catch (error) {
            sourceController.abort();
            throw error;
          }
        }),
      );
      const rejectedPlan = planResults.find(
        (result) => result.status === "rejected",
      );
      if (rejectedPlan?.status === "rejected") throw rejectedPlan.reason;
      const plans = planResults.map((result) => {
        if (result.status !== "fulfilled") throw result.reason;
        return result.value;
      });
      this.assertWritable(sourceId, token);
      await this.patchPoolItem(sourceId, token, {
        status: "writing",
        plannerCalls: units.length,
      });

      const pageKeys = uniqueStrings(
        plans.flatMap(({ plan }) => plan.pages.map((page) => page.pageKey)),
      ).sort();
      releasePages = await this.pageMutex.acquireMany(pageKeys);
      this.assertWritable(sourceId, token);
      const overlay = await this.runWriters(
        sourceId,
        token,
        options,
        source,
        plans,
        sourceSignal,
      );
      this.assertWritable(sourceId, token);

      // Source 只有在全部 Writer 成功后才进入这个提交点，失败不会留下半成品。
      await this.stateMutex.runExclusive(async () => {
        this.assertWritable(sourceId, token);
        this.store.commitSourceOverlay(overlay);
      });
      await this.releasePageKeys(allocatedPageKeys);
      await this.patchPoolItem(sourceId, token, {
        status: "completed",
        writerCalls: plans.length,
        pageKeys,
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      sourceController.abort();
      await this.releasePageKeys(allocatedPageKeys).catch(() => undefined);
      if (this.isWritable(sourceId, token)) {
        await this.patchPoolItem(sourceId, token, {
          status: "failed",
          error: formatError(error),
          finishedAt: new Date().toISOString(),
        }).catch(() => undefined);
      }
    } finally {
      releasePages?.();
      if (this.activeTokens.get(sourceId) === token)
        this.activeTokens.delete(sourceId);
      this.controllers.delete(sourceId);
      this.schedulePool();
    }
  }

  private async runPlanner(
    sourceId: string,
    token: string,
    options: CompileExecutionOptions,
    source: SourceSnapshot,
    unit: CompileUnit,
    existingPages: ManifestPage[],
    availablePageKeys: string[],
    maxPages: number,
    signal: AbortSignal,
  ): Promise<WikiPagePlan> {
    await this.beforeModelCall(sourceId, token);
    const value = await this.callJson({
      model: options.model,
      maxTokens: options.plannerMaxOutputTokens,
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
    this.assertWritable(sourceId, token);
    return validatePlan(
      value,
      source.sourceId,
      unit.unitId,
      existingPages,
      availablePageKeys,
      maxPages,
    );
  }

  private async runWriters(
    sourceId: string,
    token: string,
    options: CompileExecutionOptions,
    source: SourceSnapshot,
    plans: Array<{ unit: CompileUnit; plan: WikiPagePlan }>,
    signal: AbortSignal,
  ): Promise<SourceOverlay> {
    const snapshot = this.store.readStagingSnapshot();
    const manifest = new Map(
      snapshot.manifest.pages.map((page) => [page.pageKey, page]),
    );
    const workingPages = new Map<string, SourceOverlayPage>();

    for (const { unit, plan } of [...plans].sort(
      (a, b) => a.unit.startOffset - b.unit.startOffset,
    )) {
      const existingPages: Record<
        string,
        { title: string; goal: string; bodyMarkdown: string }
      > = {};
      for (const page of plan.pages) {
        const working = workingPages.get(page.pageKey);
        const exists = Boolean(working) || page.pageKey in snapshot.pages;
        if (page.operation === "create" && exists)
          throw new Error(`create 页面已经存在: ${page.pageKey}`);
        if (page.operation === "update" && !exists)
          throw new Error(`update 页面不存在: ${page.pageKey}`);
        if (page.operation === "update") {
          const published = manifest.get(page.pageKey);
          existingPages[page.pageKey] = {
            title: working?.title || published?.title || page.title,
            goal: working?.goal || published?.goal || page.goal,
            bodyMarkdown: working?.bodyMarkdown || snapshot.pages[page.pageKey],
          };
        }
      }

      await this.beforeModelCall(sourceId, token);
      const raw = await this.callJson({
        model: options.model,
        maxTokens: options.writerMaxOutputTokens,
        signal,
        system: writerPrompt(),
        payload: {
          sourceId: source.sourceId,
          completeSource: numberSourceLines(unit.content, unit.startLine),
          pagePlan: plan,
          existingPages,
        },
      });
      this.assertWritable(sourceId, token);
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
      if (!state || state.status !== "open")
        throw new Error("Staging 当前不可预留页面 ID");
      const occupied = new Set([
        ...state.reservedPageKeys,
        ...this.store
          .readStagingSnapshot()
          .manifest.pages.map((page) => page.pageKey),
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
        reservedPageKeys: state.reservedPageKeys.filter(
          (id) => !released.has(id),
        ),
      });
    });
  }

  private schedulePool(): void {
    if (this.schedulerQueued) return;
    this.schedulerQueued = true;
    queueMicrotask(() => {
      this.schedulerQueued = false;
      void this.dispatchPool().catch((error) => {
        this.logger.error(`llmWikiNext 编译池调度异常: ${formatError(error)}`);
      });
    });
  }

  private async dispatchPool(): Promise<void> {
    const dispatched = await this.stateMutex.runExclusive(async () => {
      const state = this.store.readStagingState();
      const pool = this.store.readCompilePool();
      if (
        !state ||
        state.status !== "open" ||
        !pool ||
        pool.workspaceId !== state.workspaceId
      )
        return [];
      const running = pool.items.filter(
        (item) => item.status === "planning" || item.status === "writing",
      ).length;
      const capacity = Math.max(0, pool.options.sourceConcurrency - running);
      if (!capacity) return [];
      const now = new Date().toISOString();
      const sourceIds = pool.items
        .filter((item) => item.status === "queued")
        .slice(0, capacity)
        .map((item) => item.sourceId);
      if (!sourceIds.length) return [];
      const selected = new Set(sourceIds);
      const next: CompilePool = {
        ...pool,
        items: pool.items.map((item) =>
          selected.has(item.sourceId)
            ? {
                ...item,
                status: "planning",
                startedAt: now,
                error: "",
                startedOptions: { ...pool.options },
              }
            : item,
        ),
      };
      this.store.saveCompilePool(next);
      return sourceIds.map((sourceId) => {
        const token = createBase62Id(24);
        const controller = new AbortController();
        this.activeTokens.set(sourceId, token);
        this.controllers.set(sourceId, controller);
        return { sourceId, token, controller, options: { ...pool.options } };
      });
    });
    for (const item of dispatched) {
      void this.processSource(
        item.sourceId,
        item.token,
        item.controller.signal,
        item.options,
      ).catch((error) => {
        this.logger.error(
          `llmWikiNext Source 编译异常: ${item.sourceId}: ${formatError(error)}`,
        );
      });
    }
  }

  private async beforeModelCall(
    sourceId: string,
    token: string,
  ): Promise<void> {
    await this.stateMutex.runExclusive(async () => {
      this.assertWritable(sourceId, token);
      const pool = this.requireCompilePool();
      const item = this.requirePoolItem(pool, sourceId);
      if (item.modelCalls >= item.maxModelCalls)
        throw new Error("模型调用数超过确认上限");
      this.store.saveCompilePool({
        ...pool,
        items: pool.items.map((current) =>
          current.sourceId === sourceId
            ? { ...current, modelCalls: current.modelCalls + 1 }
            : current,
        ),
      });
    });
  }

  private async patchPoolItem(
    sourceId: string,
    token: string,
    patch: Partial<CompilePoolItem>,
  ): Promise<void> {
    await this.stateMutex.runExclusive(async () => {
      this.assertWritable(sourceId, token);
      const pool = this.requireCompilePool();
      this.requirePoolItem(pool, sourceId);
      this.store.saveCompilePool({
        ...pool,
        items: pool.items.map((item) =>
          item.sourceId === sourceId ? { ...item, ...patch } : item,
        ),
      });
    });
  }

  private getPoolItem(sourceId: string): CompilePoolItem | null {
    return (
      this.store
        .readCompilePool()
        ?.items.find((item) => item.sourceId === sourceId) || null
    );
  }

  private requireCompilePool(): CompilePool {
    const pool = this.store.readCompilePool();
    if (!pool) throw new Error("当前没有待编译池");
    return pool;
  }

  private requirePoolItem(
    pool: CompilePool,
    sourceId: string,
  ): CompilePoolItem {
    const item = pool.items.find((current) => current.sourceId === sourceId);
    if (!item) throw new Error("Source 不在待编译池中");
    return item;
  }

  private clearCompilePoolLocked(): CompilePoolCancelResult {
    const pool = this.store.readCompilePool();
    const queuedCount =
      pool?.items.filter((item) => item.status === "queued").length || 0;
    const runningItems =
      pool?.items.filter(
        (item) => item.status === "planning" || item.status === "writing",
      ) || [];
    for (const item of runningItems) {
      this.activeTokens.delete(item.sourceId);
      this.controllers.get(item.sourceId)?.abort();
      this.controllers.delete(item.sourceId);
    }
    this.store.deleteCompilePool();
    const state = this.store.readStagingState();
    if (state?.reservedPageKeys.length)
      this.store.updateStagingState({ ...state, reservedPageKeys: [] });
    this.pageMutex = new KeyedMutex();
    return { cancelled: true, queuedCount, runningCount: runningItems.length };
  }

  private removeSourcesFromCompilePoolLocked(sourceIds: Set<string>): void {
    const pool = this.store.readCompilePool();
    if (!pool) return;
    const removedItems = pool.items.filter((item) =>
      sourceIds.has(item.sourceId),
    );
    if (!removedItems.length) return;

    for (const item of removedItems) {
      this.activeTokens.delete(item.sourceId);
      this.controllers.get(item.sourceId)?.abort();
      this.controllers.delete(item.sourceId);
    }

    const items = pool.items.filter((item) => !sourceIds.has(item.sourceId));
    if (!items.length) {
      this.store.deleteCompilePool();
      return;
    }
    this.store.saveCompilePool({ ...pool, items });
  }

  private isWritable(sourceId: string, token: string): boolean {
    return (
      this.activeTokens.get(sourceId) === token &&
      !this.controllers.get(sourceId)?.signal.aborted
    );
  }

  private assertWritable(sourceId: string, token: string): void {
    if (!this.isWritable(sourceId, token)) throw new Error("任务写权限已失效");
  }
}

export function calculateMaxPages(charCount: number): number {
  const thresholdIndex = PAGE_CHAR_THRESHOLDS.findIndex(
    (threshold) => charCount <= threshold,
  );
  return thresholdIndex === -1 ? 8 : thresholdIndex + 2;
}

export function splitSource(
  source: SourceSnapshot,
  chunkChars: number,
): CompileUnit[] {
  const units: CompileUnit[] = [];
  let startLine = 1;
  for (
    let startOffset = 0;
    startOffset < source.content.length;
    startOffset += chunkChars
  ) {
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
  if (record.pages.length > maxPages)
    throw new Error("Planner 页面数超过确认上限");
  const existing = new Set(existingPages.map((page) => page.pageKey));
  const available = new Set(availablePageKeys);
  const pages = record.pages.map((raw): WikiPagePlanItem => {
    const page = objectValue(raw, "Planner page 必须是对象");
    const pageKey = stringValue(page.pageKey, "Planner pageKey 不能为空");
    const operation = page.operation;
    if (operation !== "create" && operation !== "update")
      throw new Error("Planner operation 非法");
    if (operation === "create" && !available.has(pageKey))
      throw new Error(`create pageKey 未预留: ${pageKey}`);
    if (operation === "update" && !existing.has(pageKey))
      throw new Error(`update pageKey 不存在: ${pageKey}`);
    return {
      pageKey,
      operation,
      title: stringValue(page.title, "Planner title 不能为空"),
      goal: stringValue(page.goal, "Planner goal 不能为空"),
      scope: stringValue(page.scope, "Planner scope 不能为空"),
      outline: nonEmptyArray(
        page.outline,
        "Planner outline 必须是非空数组",
      ).map((rawOutline) => {
        const outline = objectValue(rawOutline, "Planner outline 项必须是对象");
        return {
          heading: stringValue(
            outline.heading,
            "Planner outline heading 不能为空",
          ),
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
      relatedPageKeys: stringArray(
        page.relatedPageKeys,
        "Planner relatedPageKeys 必须是字符串数组",
      ),
    };
  });
  if (new Set(pages.map((page) => page.pageKey)).size !== pages.length) {
    throw new Error("同一 Plan 中 pageKey 不得重复");
  }
  const samePlanCreates = new Set(
    pages
      .filter((page) => page.operation === "create")
      .map((page) => page.pageKey),
  );
  for (const page of pages) {
    for (const related of page.relatedPageKeys) {
      if (related === page.pageKey)
        throw new Error(`页面不得关联自身: ${page.pageKey}`);
      if (!existing.has(related) && !samePlanCreates.has(related)) {
        throw new Error(`关联页面不存在: ${related}`);
      }
    }
  }
  return {
    sourceId,
    unitId,
    partitionIntent: stringValue(
      record.partitionIntent,
      "Planner partitionIntent 不能为空",
    ),
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
    const bodyMarkdown = stringValue(
      page.bodyMarkdown,
      "Writer bodyMarkdown 不能为空",
    );
    if (!Array.isArray(page.keyFacts))
      throw new Error("Writer keyFacts 必须是数组");
    const keyFacts = uniqueFacts(
      page.keyFacts.map((rawFact): KeyFact => {
        const fact = objectValue(rawFact, "Writer Fact 必须是对象");
        return {
          fact: stringValue(fact.fact, "Writer fact 不能为空"),
          sourceId: source.sourceId,
          // 行号只是辅助定位。兼容纯数字字符串和常见范围写法；无法可靠定位时保留 Fact、清空行号。
          sourceLine: normalizeSourceLine(
            fact.sourceLine,
            unit.startLine,
            unitEndLine,
            source.lineCount,
          ),
        };
      }),
    ).slice(0, MAX_FACTS_PER_PLAN);
    return { pageKey, bodyMarkdown, keyFacts };
  });
  const returnedKeys = pages.map((page) => page.pageKey);
  if (new Set(returnedKeys).size !== returnedKeys.length)
    throw new Error("Writer pageKey 不得重复");
  const expectedKeys = new Set(plan.pages.map((page) => page.pageKey));
  if (
    returnedKeys.length !== expectedKeys.size ||
    returnedKeys.some((pageKey) => !expectedKeys.has(pageKey))
  ) {
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
    const match = value
      .trim()
      .match(
        /^(?:(?:line|第)\s*)?(\d+)(?:\s*(?:-|–|—|~|～|至|,|，)\s*\d+)?\s*(?:行)?$/i,
      );
    if (match) line = Number(match[1]);
  }
  if (
    line === null ||
    line < unitStartLine ||
    line > unitEndLine ||
    line > sourceLineCount
  )
    return null;
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
  if (!first || typeof first !== "object")
    throw new Error("模型未返回 choices");
  const choice = first as Record<string, unknown>;
  const message =
    choice.message && typeof choice.message === "object"
      ? (choice.message as Record<string, unknown>)
      : {};
  const content =
    typeof message.content === "string"
      ? message.content
      : typeof choice.text === "string"
        ? choice.text
        : "";
  if (!content.trim()) throw new Error("模型未返回文本内容");
  return content;
}

function parseJson(content: string): unknown {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
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
  return Object.values(snapshot.facts.byPage).reduce(
    (sum, facts) => sum + facts.length,
    0,
  );
}

function executionOptions(
  options: NormalizedCompileOptions,
): CompileExecutionOptions {
  return {
    model: options.model,
    sourceConcurrency: options.sourceConcurrency,
    chunkChars: options.chunkChars,
    plannerMaxOutputTokens: options.plannerMaxOutputTokens,
    writerMaxOutputTokens: options.writerMaxOutputTokens,
  };
}

function createPoolItem(
  source: SourceSnapshot,
  estimate: CompileEstimate,
  now: string,
): CompilePoolItem {
  const unitCount = estimate.units.filter(
    (unit) => unit.sourceId === source.sourceId,
  ).length;
  return {
    sourceId: source.sourceId,
    contentHash: source.contentHash,
    status: "queued",
    compileUnitCount: unitCount,
    maxModelCalls: unitCount * 2,
    maxOutputTokens:
      unitCount * estimate.options.plannerMaxOutputTokens +
      unitCount * estimate.options.writerMaxOutputTokens,
    modelCalls: 0,
    plannerCalls: 0,
    writerCalls: 0,
    pageKeys: [],
    error: "",
    queuedAt: now,
    startedAt: "",
    finishedAt: "",
    startedOptions: null,
  };
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
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(message);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, message: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(message);
  return text;
}

function stringArray(value: unknown, message: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || !item.trim())
  ) {
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
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createBase62Id(length: number): string {
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  return Array.from(
    randomBytes(length),
    (byte) => alphabet[byte % alphabet.length],
  ).join("");
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
