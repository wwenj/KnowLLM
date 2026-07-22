import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { ModelService, RawChatOptions } from "../model/model.service";
import { calculateMaxPages, LlmWikiNextService, splitSource } from "./llm-wiki-next.service";
import { LlmWikiNextStore } from "./llm-wiki-next.store";
import { CompileJob, SourceSnapshot } from "./llm-wiki-next.types";

test("物理切片保留 offset 和原始全局行号", () => {
  const source: SourceSnapshot = {
    sourceId: "A123456789012345",
    filename: "source.md",
    content: "a\nbc\ndef",
    contentHash: "hash",
    charCount: 8,
    lineCount: 3,
    createdAt: new Date(0).toISOString(),
  };
  const units = splitSource(source, 3);
  assert.deepEqual(
    units.map((unit) => ({ content: unit.content, start: unit.startOffset, end: unit.endOffset, line: unit.startLine })),
    [
      { content: "a\nb", start: 0, end: 3, line: 1 },
      { content: "c\nd", start: 3, end: 6, line: 2 },
      { content: "ef", start: 6, end: 8, line: 3 },
    ],
  );
});

test("动态 maxPages 在所有阈值边界按预期切换", () => {
  assert.deepEqual(
    [
      1,
      4_000,
      4_001,
      10_000,
      10_001,
      19_000,
      19_001,
      31_000,
      31_001,
      46_000,
      46_001,
      64_000,
      64_001,
    ].map((charCount) => calculateMaxPages(charCount)),
    [2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8],
  );
});

test("estimate 返回 Unit 局部上限，统一 Writer 调用预算为 2U", () => {
  const harness = createHarness(new StubModel());
  try {
    const source = harness.service.uploadSource("estimate.md", Buffer.from("x".repeat(4_001), "utf8"));
    const request = { sourceIds: [source.sourceId], model: "test:model", chunkChars: 10_000 };
    const first = harness.service.estimateCompile(request);
    const second = harness.service.estimateCompile(request);
    assert.deepEqual(first.units, [
      {
        sourceId: source.sourceId,
        unitId: `${source.sourceId}-0001`,
        charCount: 4_001,
        maxPages: 3,
      },
    ]);
    assert.equal(first.maxPlannedPages, 3);
    assert.equal(first.maxPlannerCalls, 1);
    assert.equal(first.maxWriterCalls, 1);
    assert.equal(first.maxModelCalls, 2);
    assert.equal(first.maxOutputTokens, 10_000);
    assert.equal(first.confirmHash, second.confirmHash);
    assert.ok(!("maxPagesPerUnit" in first.options));
  } finally {
    harness.cleanup();
  }
});

test("顺序 Job 合并到同一 Staging，发布后整套切换", async () => {
  const harness = createHarness(new StubModel());
  try {
    const sourceA = harness.service.uploadSource("a.md", Buffer.from("Alpha content", "utf8"));
    const sourceB = harness.service.uploadSource("b.txt", Buffer.from("Beta content", "utf8"));

    const first = await compileSources(harness.service, [sourceA.sourceId]);
    assert.equal(first.status, "completed");
    const firstStaging = harness.service.getStaging();
    assert.equal(firstStaging?.pageCount, 1);
    const workspaceId = firstStaging?.state.workspaceId;
    assert.equal(harness.service.getPublishedManifest().pages.length, 0);

    const second = await compileSources(harness.service, [sourceB.sourceId]);
    assert.equal(second.status, "completed");
    const staging = harness.service.getStaging();
    assert.equal(staging?.state.workspaceId, workspaceId);
    assert.equal(staging?.pageCount, 2);
    assert.deepEqual(new Set(staging?.state.completedSourceIds), new Set([sourceA.sourceId, sourceB.sourceId]));

    for (const page of staging?.pages || []) {
      const detail = harness.service.getStagingPage(page.pageKey);
      assert.equal(detail.keyFacts.length, 5);
      assert.ok(detail.keyFacts.every((fact) => fact.sourceId === page.sourceIds[0]));
    }

    const published = await harness.service.publishStaging();
    assert.equal(published.pageCount, 2);
    assert.deepEqual(published.cleanupWarnings, []);
    assert.equal(harness.service.getStaging(), null);
    assert.equal(harness.service.getPublishedManifest().pages.length, 2);
    assert.equal(harness.service.searchPublished("Alpha").items.length, 1);
    const pointer = JSON.parse(
      readFileSync(path.join(harness.store.root, "published", "current.json"), "utf8"),
    ) as { revisionId: string };
    const revisionRoot = path.join(harness.store.root, "published", "revisions", pointer.revisionId);
    for (const file of ["facts.json", "source-map.json", "manifest.json", "search-index.json"]) {
      assert.ok(existsSync(path.join(revisionRoot, file)), `${file} 应随 revision 一起发布`);
    }
    assert.ok(existsSync(path.join(revisionRoot, "pages")));
  } finally {
    harness.cleanup();
  }
});

test("Source Writer 失败不会向已有 Staging 写入部分结果", async () => {
  const harness = createHarness(new StubModel());
  try {
    const good = harness.service.uploadSource("good.md", Buffer.from("Good source", "utf8"));
    const failed = harness.service.uploadSource("failed.md", Buffer.from("[FAIL] source", "utf8"));
    await compileSources(harness.service, [good.sourceId]);
    const before = harness.service.getStaging();

    const failedJob = await compileSources(harness.service, [failed.sourceId]);
    assert.equal(failedJob.status, "completed_with_errors");
    assert.equal(failedJob.sources[0].status, "failed");
    const after = harness.service.getStaging();
    assert.equal(after?.pageCount, before?.pageCount);
    assert.ok(!after?.state.completedSourceIds.includes(failed.sourceId));
    assert.deepEqual(after?.state.reservedPageKeys, []);
  } finally {
    harness.cleanup();
  }
});

test("确认 hash 失效和 Planner 越权 ID 都会阻止编译结果写入", async () => {
  const harness = createHarness(new InvalidPlannerModel());
  try {
    const source = harness.service.uploadSource("invalid.md", Buffer.from("Invalid plan", "utf8"));
    const estimate = harness.service.estimateCompile({ sourceIds: [source.sourceId], model: "test:model" });
    await assert.rejects(
      () => harness.service.compile({ ...estimate.options, confirmHash: "invalid" }),
      /编译确认已失效/,
    );
    const job = await harness.service.compile({ ...estimate.options, confirmHash: estimate.confirmHash });
    const finished = await waitForJob(harness.service, job.jobId);
    assert.equal(finished.status, "completed_with_errors");
    assert.match(finished.sources[0].error, /pageKey 未预留/);
    assert.equal(harness.service.getStaging()?.pageCount, 0);
    assert.deepEqual(harness.service.getStaging()?.state.reservedPageKeys, []);
  } finally {
    harness.cleanup();
  }
});

test("活动任务禁止发布，取消后晚到响应不能写入 Staging", async () => {
  const delayed = new DelayedWriterModel();
  const harness = createHarness(delayed);
  try {
    const source = harness.service.uploadSource("slow.md", Buffer.from("Slow source", "utf8"));
    const estimate = harness.service.estimateCompile({ sourceIds: [source.sourceId], model: "test:model" });
    const started = await harness.service.compile({ ...estimate.options, confirmHash: estimate.confirmHash });
    await delayed.writerStarted;
    await assert.rejects(() => harness.service.publishStaging(), /编译任务尚未结束/);
    await harness.service.cancelJob(started.jobId);
    delayed.finishWriter();
    await waitForJob(harness.service, started.jobId);
    assert.equal(harness.service.getJob(started.jobId).status, "cancelled");
    assert.equal(harness.service.getStaging()?.pageCount, 0);
  } finally {
    harness.cleanup();
  }
});

test("Source worker 并发受 sourceConcurrency 限制", async () => {
  const model = new StubModel(20);
  const harness = createHarness(model);
  try {
    const sources = ["one", "two", "three"].map((content, index) =>
      harness.service.uploadSource(`${index}.md`, Buffer.from(content, "utf8")),
    );
    const job = await compileSources(harness.service, sources.map((source) => source.sourceId), 2);
    assert.equal(job.status, "completed");
    assert.ok(model.maxActiveCalls >= 2);
    assert.ok(model.maxActiveCalls <= 2);
  } finally {
    harness.cleanup();
  }
});

test("Writer Facts 先规范化去重再截断，并由后端注入 sourceId", async () => {
  const model = new FactsModel();
  const harness = createHarness(model);
  try {
    const source = harness.service.uploadSource(
      "facts.md",
      Buffer.from("Restart requires allow-hotplug.\nAdditional constraints.", "utf8"),
    );
    const job = await compileSources(harness.service, [source.sourceId]);
    assert.equal(job.status, "completed");

    const pageKey = harness.service.getStaging()?.pages[0]?.pageKey || "";
    const page = harness.service.getStagingPage(pageKey);
    assert.deepEqual(
      page.keyFacts.map((fact) => fact.fact),
      [
        "Restart   requires allow-hotplug.",
        "Constraint B",
        "Constraint C",
        "Constraint D",
        "Constraint E",
      ],
    );
    assert.ok(page.keyFacts.every((fact) => fact.sourceId === source.sourceId));
    assert.match(model.writerSystemPrompt, /Key Facts 不是正文摘要/);
    assert.match(model.writerSystemPrompt, /可以返回 0 条/);
    assert.match(model.writerSystemPrompt, /sourceLine 必须返回.+格式为单个 JSON 整数，例如 17/);
    assert.match(model.writerSystemPrompt, /\{pages:\[\{pageKey,bodyMarkdown,keyFacts:\[\{fact,sourceLine:17\}\]\}\]\}/);
  } finally {
    harness.cleanup();
  }
});

test("Planner 结构、数组、ID 和关联边界均执行确定性校验", async () => {
  const cases: Array<{ variant: PlannerFailureVariant; error: RegExp }> = [
    { variant: "invalid_json", error: /不是合法 JSON/ },
    { variant: "empty_pages", error: /pages 必须是非空数组/ },
    { variant: "too_many_pages", error: /页面数超过确认上限/ },
    { variant: "empty_field", error: /scope 不能为空/ },
    { variant: "empty_outline", error: /outline 必须是非空数组/ },
    { variant: "empty_writing_points", error: /writingPoints 必须是非空/ },
    { variant: "empty_source_anchors", error: /sourceAnchors 必须是非空/ },
    { variant: "duplicate_page_key", error: /pageKey 不得重复/ },
    { variant: "self_relation", error: /不得关联自身/ },
    { variant: "missing_relation", error: /关联页面不存在/ },
  ];

  for (const item of cases) {
    const harness = createHarness(new PlannerFailureModel(item.variant));
    try {
      const source = harness.service.uploadSource(`${item.variant}.md`, Buffer.from("Planner input", "utf8"));
      const job = await compileSources(harness.service, [source.sourceId]);
      assert.equal(job.status, "completed_with_errors", item.variant);
      assert.match(job.sources[0].error, item.error, item.variant);
      assert.equal(harness.service.getStaging()?.pageCount, 0, item.variant);
      assert.deepEqual(harness.service.getStaging()?.state.reservedPageKeys, [], item.variant);
    } finally {
      harness.cleanup();
    }
  }
});

test("Writer 缺页、多页、重复页、空正文和空 Fact 使 Source 整体失败", async () => {
  const cases: Array<{ variant: WriterFailureVariant; error: RegExp }> = [
    { variant: "missing_page", error: /pageKey 集合必须与 Plan 完全一致/ },
    { variant: "extra_page", error: /pageKey 集合必须与 Plan 完全一致/ },
    { variant: "duplicate_page", error: /pageKey 不得重复/ },
    { variant: "empty_body", error: /bodyMarkdown 不能为空/ },
    { variant: "empty_fact", error: /fact 不能为空/ },
  ];

  for (const item of cases) {
    const harness = createHarness(new WriterFailureModel(item.variant));
    try {
      const source = harness.service.uploadSource(`${item.variant}.md`, Buffer.from("Writer input", "utf8"));
      const job = await compileSources(harness.service, [source.sourceId]);
      assert.equal(job.status, "completed_with_errors", item.variant);
      assert.match(job.sources[0].error, item.error, item.variant);
      assert.equal(harness.service.getStaging()?.pageCount, 0, item.variant);
    } finally {
      harness.cleanup();
    }
  }
});

test("Writer Fact 行号会兼容常见格式，无法定位时清空且不影响正文写入", async () => {
  const harness = createHarness(new FactLineCompatibilityModel());
  try {
    const content = Array.from({ length: 20 }, (_, index) => `Line ${index + 1}`).join("\n");
    const source = harness.service.uploadSource("fact-lines.md", Buffer.from(content, "utf8"));
    const job = await compileSources(harness.service, [source.sourceId]);
    assert.equal(job.status, "completed");

    const staging = harness.service.getStaging();
    assert.equal(staging?.pageCount, 1);
    const page = harness.service.getStagingPage(staging?.pages[0]?.pageKey || "");
    assert.deepEqual(page.keyFacts.map((fact) => fact.sourceLine), [13, 9, 7, null, null]);
    assert.match(page.bodyMarkdown, /Valid body/);
  } finally {
    harness.cleanup();
  }
});

test("统一 Writer 混合 create/update 时只接收涉及的 update 完整正文", async () => {
  const model = new MixedCreateUpdateModel();
  const harness = createHarness(model);
  try {
    const base = harness.service.uploadSource("base.md", Buffer.from("Base content", "utf8"));
    await compileSources(harness.service, [base.sourceId]);
    const existingPageKey = harness.service.getStaging()?.pages[0]?.pageKey || "";
    const existingBody = harness.service.getStagingPage(existingPageKey).bodyMarkdown;

    const next = harness.service.uploadSource("next.md", Buffer.from("Update and create", "utf8"));
    const job = await compileSources(harness.service, [next.sourceId]);
    assert.equal(job.status, "completed");
    assert.equal(job.sources[0].writerCalls, 1);

    const payload = model.writerPayloads.at(-1);
    assert.ok(payload);
    assert.equal(payload?.pagePlan.pages.length, 2);
    assert.deepEqual(Object.keys(payload?.existingPages || {}), [existingPageKey]);
    assert.equal(payload?.existingPages[existingPageKey]?.bodyMarkdown, existingBody);
    assert.equal(harness.service.getStaging()?.pageCount, 2);
  } finally {
    harness.cleanup();
  }
});

test("多 Unit 更新同页严格按 startOffset 串行，后一 Writer 读到前一结果", async () => {
  const model = new SequentialUpdateModel();
  const harness = createHarness(model);
  try {
    const base = harness.service.uploadSource("base.md", Buffer.from("Base page", "utf8"));
    await compileSources(harness.service, [base.sourceId]);

    const update = harness.service.uploadSource("update.md", Buffer.from("x\n".repeat(1_100), "utf8"));
    const job = await compileSources(harness.service, [update.sourceId], 1, { chunkChars: 1_000 });
    assert.equal(job.status, "completed");
    assert.equal(job.sources[0].compileUnitCount, 3);
    assert.equal(job.sources[0].writerCalls, 3);
    assert.deepEqual(model.updateUnitIds, [
      `${update.sourceId}-0001`,
      `${update.sourceId}-0002`,
      `${update.sourceId}-0003`,
    ]);
    assert.match(model.updateExistingBodies[1], /0001/);
    assert.match(model.updateExistingBodies[2], /0002/);

    const pageKey = harness.service.getStaging()?.pages[0]?.pageKey || "";
    const page = harness.service.getStagingPage(pageKey);
    assert.match(page.bodyMarkdown, /0001/);
    assert.match(page.bodyMarkdown, /0002/);
    assert.match(page.bodyMarkdown, /0003/);
    assert.equal(page.keyFacts.filter((fact) => /Repeated constraint/i.test(fact.fact)).length, 1);
  } finally {
    harness.cleanup();
  }
});

class StubModel {
  activeCalls = 0;
  maxActiveCalls = 0;

  constructor(private readonly delayMs = 0) {}

  findModel(model: string) {
    return model === "test:model" ? { id: model } : null;
  }

  async chat(options: RawChatOptions): Promise<unknown> {
    this.activeCalls += 1;
    this.maxActiveCalls = Math.max(this.maxActiveCalls, this.activeCalls);
    try {
      if (this.delayMs) await abortableDelay(this.delayMs, options.signal);
      const payload = JSON.parse(String(options.messages[1]?.content || "{}")) as Record<string, unknown>;
      if (Array.isArray(payload.availablePageKeys)) {
        const sourceId = String(payload.sourceId);
        return modelResponse({
          partitionIntent: "当前内容作为一个独立页面",
          pages: [
            {
              pageKey: payload.availablePageKeys[0],
              operation: "create",
              title: `Page ${sourceId}`,
              goal: `Document ${sourceId}`,
              scope: "覆盖当前 Compile Unit 的全部内容",
              outline: [
                {
                  heading: "核心内容",
                  writingPoints: ["完整说明当前原文"],
                  sourceAnchors: ["当前 Compile Unit"],
                },
              ],
              relatedPageKeys: [],
            },
          ],
        });
      }
      const content = String(payload.completeSource || "");
      if (content.includes("[FAIL]")) throw new Error("模拟 Writer 失败");
      const startLine = Number(content.match(/^(\d+):/)?.[1] || 1);
      const pagePlan = payload.pagePlan as { pages: Array<Record<string, unknown>> };
      return modelResponse({
        pages: pagePlan.pages.map((page) => ({
          pageKey: page.pageKey,
          bodyMarkdown: `# ${String(page.title)}\n\n${content}`,
          keyFacts: Array.from({ length: 7 }, (_, index) => ({
            fact: `Fact ${index + 1}`,
            sourceId: "WRONG_SOURCE",
            sourceLine: startLine,
          })),
        })),
      });
    } finally {
      this.activeCalls -= 1;
    }
  }
}

class FactsModel extends StubModel {
  writerSystemPrompt = "";

  override async chat(options: RawChatOptions): Promise<unknown> {
    const payload = JSON.parse(String(options.messages[1]?.content || "{}")) as Record<string, unknown>;
    if (Array.isArray(payload.availablePageKeys)) return super.chat(options);

    this.writerSystemPrompt = String(options.messages[0]?.content || "");
    const pagePlan = payload.pagePlan as { pages: Array<{ pageKey: string }> };
    return modelResponse({
      pages: pagePlan.pages.map((page) => ({
        pageKey: page.pageKey,
        bodyMarkdown: "# Facts\n\nBody",
        keyFacts: [
          { fact: " Restart   requires allow-hotplug. ", sourceLine: 1 },
          { fact: "restart requires allow-hotplug", sourceLine: 1 },
          { fact: "RESTART REQUIRES ALLOW-HOTPLUG。", sourceLine: 1 },
          { fact: "Constraint B", sourceLine: 2 },
          { fact: "Constraint C", sourceLine: 2 },
          { fact: "Constraint D", sourceLine: 2 },
          { fact: "Constraint E", sourceLine: 2 },
          { fact: "Constraint F", sourceLine: 2 },
        ],
      })),
    });
  }
}

class DelayedWriterModel extends StubModel {
  private resolveStarted: () => void = () => {};
  private resolveWriter: () => void = () => {};
  readonly writerStarted = new Promise<void>((resolve) => {
    this.resolveStarted = resolve;
  });
  private readonly writerGate = new Promise<void>((resolve) => {
    this.resolveWriter = resolve;
  });

  override async chat(options: RawChatOptions): Promise<unknown> {
    const payload = JSON.parse(String(options.messages[1]?.content || "{}")) as Record<string, unknown>;
    if (!Array.isArray(payload.availablePageKeys)) {
      this.resolveStarted();
      await Promise.race([
        this.writerGate,
        new Promise<never>((_, reject) => {
          options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
      ]);
    }
    return super.chat(options);
  }

  finishWriter(): void {
    this.resolveWriter();
  }
}

class InvalidPlannerModel extends StubModel {
  override async chat(options: RawChatOptions): Promise<unknown> {
    const payload = JSON.parse(String(options.messages[1]?.content || "{}")) as Record<string, unknown>;
    if (Array.isArray(payload.availablePageKeys)) {
      return modelResponse({
        partitionIntent: "测试越权 ID",
        pages: [
          {
            pageKey: "INVALID1",
            operation: "create",
            title: "Invalid",
            goal: "Invalid",
            scope: "Invalid",
            outline: [{ heading: "Invalid", writingPoints: ["Invalid"], sourceAnchors: ["Invalid"] }],
            relatedPageKeys: [],
          },
        ],
      });
    }
    return super.chat(options);
  }
}

type PlannerFailureVariant =
  | "invalid_json"
  | "empty_pages"
  | "too_many_pages"
  | "empty_field"
  | "empty_outline"
  | "empty_writing_points"
  | "empty_source_anchors"
  | "duplicate_page_key"
  | "self_relation"
  | "missing_relation";

class PlannerFailureModel extends StubModel {
  constructor(private readonly variant: PlannerFailureVariant) {
    super();
  }

  override async chat(options: RawChatOptions): Promise<unknown> {
    const payload = JSON.parse(String(options.messages[1]?.content || "{}")) as Record<string, unknown>;
    if (!Array.isArray(payload.availablePageKeys)) return super.chat(options);
    if (this.variant === "invalid_json") {
      return { choices: [{ message: { content: "not-json" } }] };
    }

    const pageKey = String(payload.availablePageKeys[0]);
    const page = validPlanPage(pageKey, "create");
    const plan = { partitionIntent: "测试规划边界", pages: [page] };
    if (this.variant === "empty_pages") plan.pages = [];
    if (this.variant === "too_many_pages") {
      plan.pages = [page, validPlanPage(String(payload.availablePageKeys[1]), "create"), { ...page }];
    }
    if (this.variant === "empty_field") page.scope = "";
    if (this.variant === "empty_outline") page.outline = [];
    if (this.variant === "empty_writing_points") page.outline[0].writingPoints = [];
    if (this.variant === "empty_source_anchors") page.outline[0].sourceAnchors = [];
    if (this.variant === "duplicate_page_key") plan.pages = [page, { ...page }];
    if (this.variant === "self_relation") page.relatedPageKeys = [pageKey];
    if (this.variant === "missing_relation") page.relatedPageKeys = ["MISSING1"];
    return modelResponse(plan);
  }
}

type WriterFailureVariant =
  | "missing_page"
  | "extra_page"
  | "duplicate_page"
  | "empty_body"
  | "empty_fact";

class WriterFailureModel extends StubModel {
  constructor(private readonly variant: WriterFailureVariant) {
    super();
  }

  override async chat(options: RawChatOptions): Promise<unknown> {
    const payload = JSON.parse(String(options.messages[1]?.content || "{}")) as Record<string, unknown>;
    if (Array.isArray(payload.availablePageKeys)) return super.chat(options);
    const plan = payload.pagePlan as { pages: Array<{ pageKey: string }> };
    const content = String(payload.completeSource || "");
    const sourceLine = Number(content.match(/^(\d+):/)?.[1] || 1);
    const page = {
      pageKey: plan.pages[0].pageKey,
      bodyMarkdown: "# Valid body",
      keyFacts: [{ fact: "Valid fact", sourceLine }],
    };
    let pages = [page];
    if (this.variant === "missing_page") pages = [];
    if (this.variant === "extra_page") {
      pages = [page, { ...page, pageKey: "EXTRA123" }];
    }
    if (this.variant === "duplicate_page") pages = [page, { ...page }];
    if (this.variant === "empty_body") page.bodyMarkdown = "";
    if (this.variant === "empty_fact") page.keyFacts[0].fact = "";
    return modelResponse({ pages });
  }
}

class FactLineCompatibilityModel extends StubModel {
  override async chat(options: RawChatOptions): Promise<unknown> {
    const payload = JSON.parse(String(options.messages[1]?.content || "{}")) as Record<string, unknown>;
    if (Array.isArray(payload.availablePageKeys)) return super.chat(options);
    const plan = payload.pagePlan as { pages: Array<{ pageKey: string }> };
    return modelResponse({
      pages: [{
        pageKey: plan.pages[0].pageKey,
        bodyMarkdown: "# Valid body",
        keyFacts: [
          { fact: "Range string", sourceLine: "13-19" },
          { fact: "Chinese range", sourceLine: "第9至10行" },
          { fact: "Numeric string", sourceLine: "7" },
          { fact: "Out of range", sourceLine: 100 },
          { fact: "Unknown line", sourceLine: "unknown" },
        ],
      }],
    });
  }
}

interface CapturedWriterPayload {
  pagePlan: { unitId: string; pages: Array<{ pageKey: string; operation: "create" | "update"; title: string }> };
  existingPages: Record<string, { title: string; goal: string; bodyMarkdown: string }>;
  completeSource: string;
}

class MixedCreateUpdateModel extends StubModel {
  readonly writerPayloads: CapturedWriterPayload[] = [];

  override async chat(options: RawChatOptions): Promise<unknown> {
    const payload = JSON.parse(String(options.messages[1]?.content || "{}")) as Record<string, unknown>;
    if (Array.isArray(payload.availablePageKeys)) {
      const existing = payload.existingPages as Array<{ pageKey: string }>;
      const pages = existing.length
        ? [
            validPlanPage(existing[0].pageKey, "update"),
            validPlanPage(String(payload.availablePageKeys[0]), "create"),
          ]
        : [validPlanPage(String(payload.availablePageKeys[0]), "create")];
      return modelResponse({ partitionIntent: "混合创建和更新", pages });
    }

    const writerPayload = payload as unknown as CapturedWriterPayload;
    this.writerPayloads.push(writerPayload);
    const sourceLine = Number(writerPayload.completeSource.match(/^(\d+):/)?.[1] || 1);
    return modelResponse({
      pages: writerPayload.pagePlan.pages.map((page) => ({
        pageKey: page.pageKey,
        bodyMarkdown: page.operation === "update"
          ? `${writerPayload.existingPages[page.pageKey].bodyMarkdown}\n\nUpdated`
          : `# ${page.title}\n\nCreated`,
        keyFacts: [{ fact: `${page.operation} fact`, sourceLine }],
      })),
    });
  }
}

class SequentialUpdateModel extends StubModel {
  readonly updateUnitIds: string[] = [];
  readonly updateExistingBodies: string[] = [];

  override async chat(options: RawChatOptions): Promise<unknown> {
    const payload = JSON.parse(String(options.messages[1]?.content || "{}")) as Record<string, unknown>;
    if (Array.isArray(payload.availablePageKeys)) {
      const existing = payload.existingPages as Array<{ pageKey: string }>;
      const page = existing.length
        ? validPlanPage(existing[0].pageKey, "update")
        : validPlanPage(String(payload.availablePageKeys[0]), "create");
      return modelResponse({ partitionIntent: "多切片顺序更新同页", pages: [page] });
    }

    const writerPayload = payload as unknown as CapturedWriterPayload;
    const page = writerPayload.pagePlan.pages[0];
    const sourceLine = Number(writerPayload.completeSource.match(/^(\d+):/)?.[1] || 1);
    if (page.operation === "update") {
      const previousBody = writerPayload.existingPages[page.pageKey].bodyMarkdown;
      this.updateUnitIds.push(writerPayload.pagePlan.unitId);
      this.updateExistingBodies.push(previousBody);
      return modelResponse({
        pages: [{
          pageKey: page.pageKey,
          bodyMarkdown: `${previousBody}\n\nUnit ${writerPayload.pagePlan.unitId}`,
          keyFacts: [{ fact: "Repeated constraint.", sourceLine }],
        }],
      });
    }
    return modelResponse({
      pages: [{
        pageKey: page.pageKey,
        bodyMarkdown: `# ${page.title}\n\nBase`,
        keyFacts: [{ fact: "Base fact", sourceLine }],
      }],
    });
  }
}

function validPlanPage(pageKey: string, operation: "create" | "update") {
  return {
    pageKey,
    operation,
    title: `Page ${pageKey}`,
    goal: `Goal ${pageKey}`,
    scope: `Scope ${pageKey}`,
    outline: [{
      heading: "Overview",
      writingPoints: ["Explain the source"],
      sourceAnchors: ["Source line"],
    }],
    relatedPageKeys: [] as string[],
  };
}

function createHarness(model: StubModel) {
  const root = mkdtempSync(path.join(tmpdir(), "knowllm-next-"));
  const previous = process.env.KNOWLLM_DATA_ROOT;
  process.env.KNOWLLM_DATA_ROOT = root;
  const store = new LlmWikiNextStore();
  const service = new LlmWikiNextService(store, model as unknown as ModelService);
  return {
    service,
    store,
    cleanup: () => {
      if (previous === undefined) delete process.env.KNOWLLM_DATA_ROOT;
      else process.env.KNOWLLM_DATA_ROOT = previous;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

async function compileSources(
  service: LlmWikiNextService,
  sourceIds: string[],
  sourceConcurrency = 1,
  overrides: { chunkChars?: number } = {},
): Promise<CompileJob> {
  const estimate = service.estimateCompile({
    sourceIds,
    model: "test:model",
    sourceConcurrency,
    ...overrides,
  });
  const started = await service.compile({ ...estimate.options, confirmHash: estimate.confirmHash });
  return waitForJob(service, started.jobId);
}

async function waitForJob(service: LlmWikiNextService, jobId: string): Promise<CompileJob> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const job = service.getJob(jobId);
    if (!["queued", "running"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`等待任务结束超时: ${jobId}`);
}

function modelResponse(value: unknown): unknown {
  return { choices: [{ message: { content: JSON.stringify(value) } }] };
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}
