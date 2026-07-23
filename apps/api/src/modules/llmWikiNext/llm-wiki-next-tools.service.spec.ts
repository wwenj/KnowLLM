import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { LlmWikiNextStore } from "./llm-wiki-next.store";
import { LlmWikiNextToolsService } from "./llm-wiki-next-tools.service";
import { SourceOverlay } from "./llm-wiki-next.types";

test("Tools Catalog 只返回当前 Published 页面和原文", () => {
  const harness = createHarness();
  try {
    const fixture = publishFixture(harness.store);
    const catalog = harness.tools.getCatalog();

    assert.deepEqual(catalog.stats, {
      pageCount: 4,
      factCount: 3,
      sourceCount: 2,
    });
    assert.deepEqual(
      new Set(catalog.pages.map((page) => page.pageKey)),
      new Set([fixture.pageA, fixture.pageB, fixture.pageC, fixture.pageD]),
    );
    assert.deepEqual(
      new Set(catalog.sources.map((source) => source.sourceId)),
      new Set([fixture.sourceA, fixture.sourceB]),
    );
    assert.equal(
      catalog.sources.some(
        (source) => source.sourceId === fixture.unpublishedSource,
      ),
      false,
    );

    stageUnpublishedPage(harness.store, fixture.unpublishedSource);
    const whileStaged = harness.tools.getCatalog();
    assert.equal(
      whileStaged.pages.some((page) => page.pageKey === "ZZZZZZZZ"),
      false,
    );
    assert.equal(
      whileStaged.sources.some(
        (source) => source.sourceId === fixture.unpublishedSource,
      ),
      false,
    );
  } finally {
    harness.cleanup();
  }
});

test("readPage 分离显式、反向和同源页面关系", () => {
  const harness = createHarness();
  try {
    const fixture = publishFixture(harness.store);
    const result = harness.tools.readPage(fixture.pageA);

    assert.equal(result.page.bodyMarkdown.includes("body-only-marker"), true);
    assert.deepEqual(
      result.relations.outgoing.map((page) => page.pageKey),
      [fixture.pageB],
    );
    assert.deepEqual(
      result.relations.incoming.map((page) => page.pageKey),
      [fixture.pageD],
    );
    assert.deepEqual(
      result.relations.sameSource.map((page) => page.pageKey),
      [fixture.pageC],
    );
    assert.equal(
      [
        ...result.relations.outgoing,
        ...result.relations.incoming,
        ...result.relations.sameSource,
      ].some((page) => page.pageKey === fixture.pageA),
      false,
    );
  } finally {
    harness.cleanup();
  }
});

test("readSource 默认返回完整原文，并支持可选闭区间", () => {
  const harness = createHarness();
  try {
    const fixture = publishFixture(harness.store);
    const full = harness.tools.readSource(fixture.sourceA);
    assert.deepEqual(full.range, {
      startLine: 1,
      endLine: 230,
      totalLines: 230,
      hasMore: false,
      nextStartLine: null,
    });
    assert.equal(full.content.split("\n").length, 230);
    assert.deepEqual(
      full.factRefs.map((fact) => fact.sourceLine),
      [5, 205],
    );

    const first = harness.tools.readSource(fixture.sourceA, 1, 200);
    assert.deepEqual(first.range, {
      startLine: 1,
      endLine: 200,
      totalLines: 230,
      hasMore: true,
      nextStartLine: 201,
    });
    assert.equal(first.content.split("\n").length, 200);
    assert.deepEqual(
      first.factRefs.map((fact) => fact.sourceLine),
      [5],
    );
    assert.deepEqual(
      first.pages.map((page) => page.pageKey),
      [fixture.pageA, fixture.pageC],
    );

    const second = harness.tools.readSource(fixture.sourceA, 201, 230);
    assert.deepEqual(second.range, {
      startLine: 201,
      endLine: 230,
      totalLines: 230,
      hasMore: false,
      nextStartLine: null,
    });
    assert.equal(second.content.split("\n").length, 30);
    assert.deepEqual(
      second.factRefs.map((fact) => fact.sourceLine),
      [205],
    );

    assert.equal(
      harness.tools.readSource(fixture.sourceA, 228).content.split("\n").length,
      3,
    );
    assert.equal(
      harness.tools
        .readSource(fixture.sourceA, undefined, 3)
        .content.split("\n").length,
      3,
    );
  } finally {
    harness.cleanup();
  }
});

test("searchWiki 匹配正式索引字段并返回精简稳定结果", () => {
  const harness = createHarness();
  try {
    const fixture = publishFixture(harness.store);
    const titleResult = harness.tools.searchWiki("Alpha");
    assert.equal(titleResult.items[0].pageKey, fixture.pageA);
    assert.equal(titleResult.items[0].matchedFields.includes("title"), true);
    assert.equal("bodyMarkdown" in titleResult.items[0], false);

    const factResult = harness.tools.searchWiki("resonance fact token");
    assert.equal(factResult.items[0].pageKey, fixture.pageA);
    assert.equal(factResult.items[0].matchedFacts[0], "resonance fact token");
    assert.ok(factResult.items[0].matchedFacts.length <= 3);
    assert.equal(factResult.items[0].matchedFields.includes("fact"), true);
    assert.ok(factResult.items[0].snippet.length <= 240);

    const bodyResult = harness.tools.searchWiki("body-only-marker");
    assert.equal(bodyResult.items[0].pageKey, fixture.pageA);
    assert.equal(bodyResult.items[0].matchedFields.includes("body"), true);
    assert.ok(bodyResult.items[0].snippet.includes("body-only-marker"));
  } finally {
    harness.cleanup();
  }
});

test("Tools 始终读取最新 Published，且拒绝非法或未发布查询", () => {
  const emptyHarness = createHarness();
  try {
    assert.equal(
      errorCode(() => emptyHarness.tools.getCatalog()),
      "PUBLISHED_WIKI_NOT_FOUND",
    );
  } finally {
    emptyHarness.cleanup();
  }

  const harness = createHarness();
  try {
    const fixture = publishFixture(harness.store);
    assert.equal(
      errorCode(() => harness.tools.readPage("bad")),
      "INVALID_PAGE_KEY",
    );
    assert.equal(
      errorCode(() => harness.tools.readSource(fixture.unpublishedSource)),
      "PUBLISHED_SOURCE_NOT_FOUND",
    );
    assert.equal(
      errorCode(() => harness.tools.readSource(fixture.sourceA, 0)),
      "INVALID_START_LINE",
    );
    assert.equal(
      errorCode(() => harness.tools.readSource(fixture.sourceA, 1, 231)),
      "INVALID_END_LINE",
    );
    assert.equal(
      errorCode(() => harness.tools.readSource(fixture.sourceA, 20, 10)),
      "INVALID_LINE_RANGE",
    );
    assert.equal(
      errorCode(() => harness.tools.searchWiki("   ")),
      "EMPTY_QUERY",
    );

    stageUnpublishedPage(harness.store, fixture.unpublishedSource);
    harness.store.publishStaging();
    const latest = harness.tools.getCatalog();
    assert.equal(
      latest.pages.some((page) => page.pageKey === "ZZZZZZZZ"),
      true,
    );
    assert.equal(
      latest.sources.some(
        (source) => source.sourceId === fixture.unpublishedSource,
      ),
      true,
    );
  } finally {
    harness.cleanup();
  }
});

function createHarness() {
  const root = mkdtempSync(path.join(tmpdir(), "knowllm-next-tools-"));
  const previous = process.env.KNOWLLM_DATA_ROOT;
  process.env.KNOWLLM_DATA_ROOT = root;
  const store = new LlmWikiNextStore();
  return {
    store,
    tools: new LlmWikiNextToolsService(store),
    cleanup: () => {
      if (previous === undefined) delete process.env.KNOWLLM_DATA_ROOT;
      else process.env.KNOWLLM_DATA_ROOT = previous;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function publishFixture(store: LlmWikiNextStore) {
  const sourceA = store.saveSource(
    "alpha.md",
    Buffer.from(
      Array.from(
        { length: 230 },
        (_, index) => `alpha source line ${index + 1}`,
      ).join("\n"),
    ),
  );
  const sourceB = store.saveSource(
    "beta.md",
    Buffer.from("beta source line 1\nbeta source line 2"),
  );
  const unpublishedSource = store.saveSource(
    "unpublished.md",
    Buffer.from("unpublished source"),
  );
  const pageA = "AAAAAAAA";
  const pageB = "BBBBBBBB";
  const pageC = "CCCCCCCC";
  const pageD = "DDDDDDDD";

  store.ensureStaging();
  store.commitSourceOverlay({
    sourceId: sourceA.sourceId,
    pages: [
      {
        pageKey: pageA,
        title: "Alpha 页面",
        goal: "说明 Alpha 配置方法",
        relatedPageKeys: [pageB, pageB, pageA],
        bodyMarkdown: "# Alpha\n\n正文包含 body-only-marker。",
        facts: [
          {
            fact: "resonance fact token",
            sourceId: sourceA.sourceId,
            sourceLine: 5,
          },
          {
            fact: "late source fact",
            sourceId: sourceA.sourceId,
            sourceLine: 205,
          },
        ],
      },
      {
        pageKey: pageC,
        title: "同源页面",
        goal: "Alpha 同源补充",
        relatedPageKeys: [],
        bodyMarkdown: "# 同源页面",
        facts: [],
      },
    ],
  });
  store.commitSourceOverlay({
    sourceId: sourceB.sourceId,
    pages: [
      {
        pageKey: pageB,
        title: "Beta 页面",
        goal: "独立的 Beta 页面",
        relatedPageKeys: [],
        bodyMarkdown: "# Beta",
        facts: [
          {
            fact: "beta fact",
            sourceId: sourceB.sourceId,
            sourceLine: 1,
          },
        ],
      },
      {
        pageKey: pageD,
        title: "反向页面",
        goal: "指向 Alpha",
        relatedPageKeys: [pageA],
        bodyMarkdown: "# 反向页面",
        facts: [],
      },
    ],
  });
  store.publishStaging();

  return {
    sourceA: sourceA.sourceId,
    sourceB: sourceB.sourceId,
    unpublishedSource: unpublishedSource.sourceId,
    pageA,
    pageB,
    pageC,
    pageD,
  };
}

function stageUnpublishedPage(store: LlmWikiNextStore, sourceId: string): void {
  store.ensureStaging();
  const overlay: SourceOverlay = {
    sourceId,
    pages: [
      {
        pageKey: "ZZZZZZZZ",
        title: "未发布页面",
        goal: "仅存在于 Staging",
        relatedPageKeys: [],
        bodyMarkdown: "# 未发布",
        facts: [
          {
            fact: "unpublished fact",
            sourceId,
            sourceLine: 1,
          },
        ],
      },
    ],
  };
  store.commitSourceOverlay(overlay);
}

function errorCode(run: () => unknown): string {
  try {
    run();
    assert.fail("应抛出 HttpException");
  } catch (error) {
    assert.ok(error instanceof HttpException);
    const response = error.getResponse();
    assert.equal(typeof response, "object");
    return String((response as { error?: string }).error || "");
  }
}
