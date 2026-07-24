import assert from "node:assert/strict";
import test from "node:test";
import type { LlmWikiNextToolsService } from "../../../llmWikiNext/llm-wiki-next-tools.service";
import type { SourceTraceModelRequest } from "./llm-wiki-agent.types";
import { LlmWikiAgentTools } from "./llm-wiki-agent.tools";
import { LlmWikiSourceTraceTool } from "./llm-wiki-source-trace.tool";

const sourceId = "a".repeat(16);

test("agent tools delegate Wiki reads and expose traceSource instead of raw readSource", async () => {
  const calls: string[] = [];
  const service = makeService(30, calls);
  const sourceTrace = new LlmWikiSourceTraceTool(
    service as unknown as LlmWikiNextToolsService,
  );
  const tools = new LlmWikiAgentTools(
    service as unknown as LlmWikiNextToolsService,
    sourceTrace,
  );

  tools.getCatalog();
  tools.searchWiki("agent");
  tools.readPage("A1b2C3d4");
  const trace = await tools.traceSource({
    taskId: "t1",
    question: "默认模型是什么？",
    source: sourceSummary(30),
    maxRounds: 5,
    signal: new AbortController().signal,
    callModel: async (request) =>
      request.parse({
        evidence: [{ quote: "line 12", claim: "定位到第 12 行" }],
        sufficient: true,
        conclusion: "已经找到答案",
        unresolved: [],
      }),
  });

  assert.deepEqual(calls, [
    "catalog",
    "search:agent",
    "page:A1b2C3d4",
    `source:${sourceId}:1-30`,
  ]);
  assert.equal("readSource" in tools, false);
  assert.equal(trace.status, "sufficient");
  assert.deepEqual(trace.evidence[0]?.range, { startLine: 12, endLine: 12 });
});

test("small Source is read once in full and never returns raw content", async () => {
  const calls: string[] = [];
  const service = makeService(1_000, calls);
  const tool = new LlmWikiSourceTraceTool(
    service as unknown as LlmWikiNextToolsService,
  );
  let modelCalls = 0;
  const result = await tool.run({
    taskId: "t1",
    question: "目标行是什么？",
    source: sourceSummary(1_000),
    maxRounds: 5,
    signal: new AbortController().signal,
    callModel: async (request) => {
      modelCalls += 1;
      const payload = request.payload as {
        currentChunk: { startLine: number; endLine: number; content: string };
      };
      assert.equal(payload.currentChunk.startLine, 1);
      assert.equal(payload.currentChunk.endLine, 1_000);
      return request.parse({
        evidence: [{ quote: "line 999", claim: "目标位于第 999 行" }],
        sufficient: true,
        conclusion: "找到目标行",
        unresolved: [],
      });
    },
  });

  assert.equal(modelCalls, 1);
  assert.deepEqual(calls, [`source:${sourceId}:1-1000`]);
  assert.equal(result.rounds, 1);
  assert.equal("content" in result, false);
  assert.equal(result.evidence[0]?.sourceLine, 999);
});

test("large Source advances by 1000 lines and only carries verified evidence", async () => {
  const calls: string[] = [];
  const service = makeService(2_500, calls);
  const tool = new LlmWikiSourceTraceTool(
    service as unknown as LlmWikiNextToolsService,
  );
  const requests: SourceTraceModelRequest[] = [];
  const result = await tool.run({
    taskId: "t1",
    question: "查找第二段信息",
    source: sourceSummary(2_500),
    maxRounds: 5,
    signal: new AbortController().signal,
    callModel: async (request) => {
      requests.push(request);
      if (requests.length === 1) {
        return request.parse({
          evidence: [{ quote: "line 1000", claim: "第一段边界" }],
          sufficient: false,
          conclusion: "",
          unresolved: ["需要继续查找"],
        });
      }
      return request.parse({
        evidence: [{ quote: "line 1500", claim: "找到目标" }],
        sufficient: true,
        conclusion: "第二段包含目标",
        unresolved: [],
      });
    },
  });

  assert.deepEqual(calls, [
    `source:${sourceId}:1-1000`,
    `source:${sourceId}:1001-2000`,
  ]);
  const second = requests[1]?.payload as {
    currentChunk: { content: string };
    previousEvidence: Array<{ quote: string }>;
  };
  assert.doesNotMatch(second.currentChunk.content, /line 999(?:\n|$)/);
  assert.deepEqual(second.previousEvidence, [
    { quote: "line 1000", claim: "第一段边界", startLine: 1000, endLine: 1000 },
  ]);
  assert.equal(result.status, "sufficient");
  assert.equal(result.rounds, 2);
});

test("large Source stops after five insufficient rounds", async () => {
  const calls: string[] = [];
  const service = makeService(6_000, calls);
  const tool = new LlmWikiSourceTraceTool(
    service as unknown as LlmWikiNextToolsService,
  );
  const result = await tool.run({
    taskId: "t1",
    question: "不存在的问题",
    source: sourceSummary(6_000),
    maxRounds: 5,
    signal: new AbortController().signal,
    callModel: async (request) =>
      request.parse({
        evidence: [],
        sufficient: false,
        conclusion: "",
        unresolved: ["尚未找到"],
      }),
  });

  assert.equal(result.status, "insufficient");
  assert.equal(result.reason, "source_round_limit");
  assert.equal(result.rounds, 5);
  assert.equal(calls.length, 5);
  assert.equal(calls[4], `source:${sourceId}:4001-5000`);
});

test("Source stops before another read when its model-call budget is exhausted", async () => {
  const calls: string[] = [];
  let modelCalls = 0;
  const tool = new LlmWikiSourceTraceTool(
    makeService(6_000, calls) as unknown as LlmWikiNextToolsService,
  );
  const result = await tool.run({
    taskId: "t1",
    question: "问题",
    source: sourceSummary(6_000),
    maxRounds: 5,
    signal: new AbortController().signal,
    canCallModel: () => modelCalls < 3,
    callModel: async (request) => {
      modelCalls += 1;
      return request.parse({
        evidence: [],
        sufficient: false,
        conclusion: "",
        unresolved: ["继续查找"],
      });
    },
  });

  assert.equal(result.status, "insufficient");
  assert.equal(result.reason, "source_model_call_limit");
  assert.equal(modelCalls, 3);
  assert.equal(calls.length, 3);
});

test("Source evidence quote must exist in the current chunk", async () => {
  const tool = new LlmWikiSourceTraceTool(
    makeService(30, []) as unknown as LlmWikiNextToolsService,
  );
  const result = await tool.run({
    taskId: "t1",
    question: "定位证据",
    source: sourceSummary(30),
    maxRounds: 5,
    signal: new AbortController().signal,
    callModel: async (request) => {
      assert.throws(
        () =>
          request.parse({
            evidence: [{ quote: "invented text", claim: "伪造证据" }],
            sufficient: true,
            conclusion: "错误结论",
            unresolved: [],
          }),
        /不在当前原文片段/,
      );
      return request.parse({
        evidence: [{ quote: "line 20", claim: "真实证据" }],
        sufficient: true,
        conclusion: "已找到真实证据",
        unresolved: [],
      });
    },
  });

  assert.equal(result.status, "sufficient");
  assert.equal(result.evidence[0]?.sourceLine, 20);
});

function makeService(lineCount: number, calls: string[]) {
  const lines = Array.from(
    { length: lineCount },
    (_, index) => `line ${index + 1}`,
  );
  return {
    getCatalog: () => {
      calls.push("catalog");
      return { stats: {}, pages: [], sources: [] };
    },
    searchWiki: (query: string) => {
      calls.push(`search:${query}`);
      return { query, items: [] };
    },
    readPage: (pageKey: string) => {
      calls.push(`page:${pageKey}`);
      return { page: { pageKey }, relations: {}, sources: [] };
    },
    readSource: (id: string, startLine = 1, endLine = lineCount) => {
      calls.push(`source:${id}:${startLine}-${endLine}`);
      return {
        source: sourceSummary(lineCount),
        range: {
          startLine,
          endLine,
          totalLines: lineCount,
          hasMore: endLine < lineCount,
          nextStartLine: endLine < lineCount ? endLine + 1 : null,
        },
        content: lines.slice(startLine - 1, endLine).join("\n"),
        pages: [],
        factRefs: [],
      };
    },
  };
}

function sourceSummary(lineCount: number) {
  return {
    sourceId,
    filename: "source.md",
    contentHash: "h1",
    charCount: lineCount * 10,
    lineCount,
    pageKeys: ["A1b2C3d4"],
  };
}
