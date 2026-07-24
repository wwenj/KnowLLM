import assert from "node:assert/strict";
import test from "node:test";
import type { ModelService } from "../../../model/model.service";
import type { AgentRunEvent, AgentRunnerContext } from "../../agent.types";
import type { LlmWikiAgentTools } from "./llm-wiki-agent.tools";
import type { LlmWikiAgentInput } from "./llm-wiki-agent.types";
import { DEFAULT_FAST_MODEL, DEFAULT_QUALITY_MODEL } from "./llm-wiki-agent.types";
import { LlmWikiAgentWorkflow } from "./llm-wiki-agent.workflow";

const sourceId = "a".repeat(32);
const pageKey = "A1b2C3d4";

test("Planner + ReAct reads the source window, validates evidence, and finalizes with verified citations", async () => {
  const toolCalls: string[] = [];
  const tools = makeTools(toolCalls);
  let reactCount = 0;
  const model = makeModel(async (system) => {
    if (system.includes("Wiki 查询规划器")) {
      return {
        relevant: true,
        tasks: [{ id: "config", question: "Agent 配置是什么？", evidence: "source" }],
        actions: [{ tool: "readPage", value: pageKey }],
      };
    }
    if (system.includes("ReAct")) {
      reactCount += 1;
      if (reactCount === 1) {
        return {
          coverage: [{ taskId: "config", status: "partial", note: "需核验原文。" }],
          evidence: [],
          actions: [{ tool: "readSource", sourceId, reason: "核验配置行" }],
          conflicts: [], gaps: [], finish: false, finishReason: "", escalateToQuality: false,
        };
      }
      return {
        coverage: [{ taskId: "config", status: "covered", note: "原文已核验。" }],
        evidence: [{ taskId: "config", kind: "source", sourceId, quote: "fastModel: gpt-5.4-mini", claim: "默认快速模型为 gpt-5.4-mini", sourceLine: 12 }],
        actions: [{ tool: "finish", reason: "必答任务已有 Source 证据。" }],
        conflicts: [], gaps: [], finish: true, finishReason: "complete", escalateToQuality: false,
      };
    }
    return {
      answerable: true,
      answerMarkdown: "# 结果\n\n快速模型是 `gpt-5.4-mini`。",
      citations: ["E1", "not-real"],
      gaps: [],
    };
  });
  const workflow = new LlmWikiAgentWorkflow(tools as unknown as LlmWikiAgentTools, model as unknown as ModelService);
  const events: AgentRunEvent[] = [];
  const result = await workflow.start(context(workflow.validateInput(input()), events));

  assert.equal(result.status, "success");
  assert.deepEqual(toolCalls, ["catalog", `page:${pageKey}`, `source:${sourceId}:2-22`, "catalog"]);
  assert.deepEqual((result.resultJson?.citations as Array<{ evidenceId: string }>).map((item) => item.evidenceId), ["E1"]);
  assert.equal(result.resultJson?.stopReason, "complete");
  assert.equal(result.tokens?.modelCalls, 4);
  assert.equal(events.filter((event) => event.type === "model_request").length, 4);
  assert.equal(events.filter((event) => event.type === "model_response").length, 4);
  assert.deepEqual(
    events.filter((event) => event.type === "tool_request").map((event) => event.tool),
    ["readPage", "readSource", "finish"],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "tool_response").map((event) => event.status),
    ["success", "success", "success"],
  );
});

test("input is strict: dual models and limit are required, and legacy fields are rejected", () => {
  const workflow = new LlmWikiAgentWorkflow({} as LlmWikiAgentTools, makeModel(() => ({})) as unknown as ModelService);
  assert.deepEqual(workflow.getDefaults(), {
    limit: 8,
    fastModel: DEFAULT_FAST_MODEL,
    qualityModel: DEFAULT_QUALITY_MODEL,
    modelOptions: [],
  });
  assert.throws(() => workflow.validateInput({ query: "x", limit: 8, model: "old" }), /旧 Agent 输入字段/);
  assert.throws(() => workflow.validateInput({ ...input(), limit: 21 }), /limit/);
  assert.deepEqual(workflow.validateInput(input()), input());
});

test("Planner only uses the fast model and receives the minimal page tuple catalog", async () => {
  const models: string[] = [];
  let plannerPayload: unknown = null;
  let plannerSystem = "";
  const model = makeModel((system, _modelId, user) => {
    if (system.includes("Wiki 查询规划器")) {
      plannerSystem = system;
      plannerPayload = JSON.parse(user);
      return {
        relevant: true,
        tasks: [{ id: "page", question: "页面事实", evidence: "page" }],
        actions: [{ tool: "readPage", value: pageKey }],
      };
    }
    if (system.includes("ReAct")) return {
      coverage: [{ taskId: "page", status: "covered", note: "页面已读。" }],
      evidence: [{ taskId: "page", kind: "page", pageKey, quote: "fastModel: gpt-5.4-mini", claim: "页面事实" }],
      actions: [{ tool: "finish" }], conflicts: [], gaps: [], finish: true, finishReason: "complete", escalateToQuality: false,
    };
    return { answerable: true, answerMarkdown: "# 完成", citations: ["E1"], gaps: [] };
  }, models);
  const workflow = new LlmWikiAgentWorkflow(makeTools([]) as unknown as LlmWikiAgentTools, model as unknown as ModelService);
  const result = await workflow.start(context(workflow.validateInput(input())));
  assert.equal(result.status, "success");
  assert.deepEqual(plannerPayload, {
    query: input().query,
    pages: [[pageKey, "Agent", "Agent 配置"]],
  });
  assert.match(plannerSystem, /"tasks":\[\{"id":"t1","question"/);
  assert.match(plannerSystem, /不得使用 task、mustAnswer、priority、action/);
  assert.deepEqual(models, [DEFAULT_FAST_MODEL, DEFAULT_FAST_MODEL, DEFAULT_QUALITY_MODEL]);
  assert.equal((result.runnerMeta?.models as { qualityModel: string }).qualityModel, DEFAULT_QUALITY_MODEL);
});

test("Planner can end an unrelated query without Tool, ReAct, or Final calls", async () => {
  const toolCalls: string[] = [];
  const modelStages: string[] = [];
  let plannerSystem = "";
  const model = makeModel((system) => {
    modelStages.push(system);
    plannerSystem = system;
    return { relevant: false, tasks: [], actions: [] };
  });
  const workflow = new LlmWikiAgentWorkflow(makeTools(toolCalls) as unknown as LlmWikiAgentTools, model as unknown as ModelService);
  const events: AgentRunEvent[] = [];
  const result = await workflow.start(context(workflow.validateInput({
    ...input(),
    query: "今天北京天气怎么样？",
  }), events));

  assert.equal(result.status, "insufficient");
  assert.equal(result.content, "当前 Wiki 无相关信息。");
  assert.equal(result.resultJson?.stopReason, "no_relevant_wiki");
  assert.deepEqual(result.resultJson?.plan, { relevant: false, tasks: [], actions: [] });
  assert.deepEqual(toolCalls, ["catalog"]);
  assert.equal(modelStages.length, 1);
  assert.equal(result.tokens?.modelCalls, 1);
  assert.equal(events.filter((event) => event.type === "tool_request").length, 0);
  assert.equal(events.filter((event) => event.type === "planner_no_match").length, 1);
  assert.match(plannerSystem, /完全没有语义关联/);
  assert.match(plannerSystem, /"relevant":false,"tasks":\[\],"actions":\[\]/);
});

test("the observed invalid Planner field shape is rejected with corrective retry feedback", async () => {
  let plannerCalls = 0;
  let retryMessages: Array<{ role: string; content: unknown }> = [];
  const model = makeModel((system, _model, _user, messages) => {
    if (system.includes("Wiki 查询规划器")) {
      plannerCalls += 1;
      if (plannerCalls === 1) {
        return {
          relevant: true,
          tasks: [{
            task: "查找打印床调平流程",
            mustAnswer: ["打印床如何调平"],
            evidence: "page",
            priority: 1,
          }],
          actions: [{ action: "readPage", value: pageKey }],
        };
      }
      retryMessages = messages;
      return {
        relevant: true,
        tasks: [{ id: "page", question: "页面事实", evidence: "page" }],
        actions: [{ tool: "readPage", value: pageKey }],
      };
    }
    if (system.includes("ReAct")) return {
      coverage: [{ taskId: "page", status: "covered", note: "页面已读。" }],
      evidence: [{ taskId: "page", kind: "page", pageKey, quote: "fastModel: gpt-5.4-mini", claim: "页面事实" }],
      actions: [{ tool: "finish" }], conflicts: [], gaps: [], finish: true, finishReason: "complete", escalateToQuality: false,
    };
    return { answerable: true, answerMarkdown: "# 完成", citations: ["E1"], gaps: [] };
  });
  const workflow = new LlmWikiAgentWorkflow(makeTools([]) as unknown as LlmWikiAgentTools, model as unknown as ModelService);
  const result = await workflow.start(context(workflow.validateInput(input())));
  assert.equal(result.status, "success");
  assert.equal(plannerCalls, 2);
  assert.equal(result.tokens?.modelCalls, 4);
  assert.deepEqual(retryMessages.map((message) => message.role), ["system", "user", "assistant", "user"]);
  assert.match(String(retryMessages[3]?.content), /Planner task包含未知字段: task, mustAnswer, priority/);
});

test("ReAct rejects a direct Markdown answer and retries with an explicit JSON-only contract", async () => {
  let reactCalls = 0;
  let reactSystem = "";
  let retryMessages: Array<{ role: string; content: unknown }> = [];
  let finalSystem = "";
  const model = makeModel((system, _model, _user, messages) => {
    if (system.includes("Wiki 查询规划器")) return {
      relevant: true,
      tasks: [{ id: "page", question: "页面事实", evidence: "page" }],
      actions: [{ tool: "readPage", value: pageKey }],
    };
    if (system.includes("ReAct")) {
      reactCalls += 1;
      reactSystem = system;
      if (reactCalls === 1) return rawModelContent("# 直接回答\n\n这不是 JSON。");
      retryMessages = messages;
      return {
        coverage: [{ taskId: "page", status: "covered", note: "页面已读。" }],
        evidence: [{ taskId: "page", kind: "page", pageKey, quote: "fastModel: gpt-5.4-mini", claim: "页面事实" }],
        actions: [{ tool: "finish", reason: "证据已覆盖" }],
        conflicts: [], gaps: [], finish: true, finishReason: "complete", escalateToQuality: false,
      };
    }
    finalSystem = system;
    return { answerable: true, answerMarkdown: "# 完成", citations: ["E1"], gaps: [] };
  });
  const workflow = new LlmWikiAgentWorkflow(makeTools([]) as unknown as LlmWikiAgentTools, model as unknown as ModelService);
  const events: AgentRunEvent[] = [];
  const result = await workflow.start(context(workflow.validateInput(input()), events));

  assert.equal(result.status, "success");
  assert.equal(reactCalls, 2);
  assert.match(reactSystem, /只决定证据与下一步 Tool，不直接回答用户问题/);
  assert.match(reactSystem, /唯一顶层结构/);
  assert.match(finalSystem, /唯一结构/);
  assert.deepEqual(retryMessages.map((message) => message.role), ["system", "user", "assistant", "user"]);
  assert.match(String(retryMessages[3]?.content), /模型返回不是合法 JSON/);
  assert.equal(events.filter((event) => event.type === "model_validation_error").length, 1);
  assert.equal(events.filter((event) => event.type === "model_json_retry").length, 1);
});

test("a changed published catalog ends the run as wiki_changed without mixing evidence", async () => {
  let catalogs = 0;
  const tools = makeTools([], () => {
    catalogs += 1;
    return catalogs > 1 ? { stats: { pageCount: 2, factCount: 1, sourceCount: 1 }, pages: [catalogPage(), { ...catalogPage(), pageKey: "changed" }], sources: [sourceSummary()] } : catalog();
  });
  const model = makeModel((system) => {
    if (system.includes("Wiki 查询规划器")) return {
      relevant: true,
      tasks: [{ id: "x", question: "x", evidence: "page" }],
      actions: [{ tool: "readPage", value: pageKey }],
    };
    if (system.includes("ReAct")) return {
      coverage: [{ taskId: "x", status: "covered", note: "x" }],
      evidence: [{ taskId: "x", kind: "page", pageKey, quote: "fastModel: gpt-5.4-mini", claim: "x" }],
      actions: [{ tool: "finish" }], conflicts: [], gaps: [], finish: true, finishReason: "x", escalateToQuality: false,
    };
    return { answerable: true, answerMarkdown: "x", citations: ["E1"], gaps: [] };
  });
  const workflow = new LlmWikiAgentWorkflow(tools as unknown as LlmWikiAgentTools, model as unknown as ModelService);
  const result = await workflow.start(context(workflow.validateInput(input())));
  assert.equal(result.status, "insufficient");
  assert.equal(result.resultJson?.stopReason, "wiki_changed");
  assert.deepEqual(result.resultJson?.citations, []);
});

function input(): LlmWikiAgentInput {
  return { query: "默认快速模型是什么？", limit: 8, fastModel: DEFAULT_FAST_MODEL, qualityModel: DEFAULT_QUALITY_MODEL };
}

function context(value: LlmWikiAgentInput, events: AgentRunEvent[] = []): AgentRunnerContext<LlmWikiAgentInput> {
  return {
    runId: "b".repeat(32), agentType: "llmWiki", input: value, signal: new AbortController().signal,
    appendEvent: (event) => events.push(event), updateRunnerMeta: () => undefined,
  };
}

function makeModel(
  responder: (
    system: string,
    model: string,
    user: string,
    messages: Array<{ role: string; content: unknown }>,
  ) => unknown | Promise<unknown>,
  models: string[] = [],
) {
  return {
    listModels: () => [],
    findModel: (modelName: string) => ({ id: modelName }),
    chat: async ({
      messages,
      model,
      onRequest,
      onResponse,
    }: {
      messages: Array<{ role: string; content: unknown }>;
      model: string;
      onRequest?: (request: { url: string; body: Record<string, unknown> }) => void;
      onResponse?: (response: unknown) => void;
    }) => {
      models.push(model);
      onRequest?.({ url: "https://model.test/v1/chat/completions", body: { model, messages, stream: false } });
      const modelValue = await responder(
        String(messages[0]?.content || ""),
        model,
        String(messages[1]?.content || ""),
        messages,
      );
      const response = {
        choices: [{ message: { content: isRawModelContent(modelValue)
          ? modelValue.__rawModelContent
          : JSON.stringify(modelValue) } }],
      };
      onResponse?.(response);
      return response;
    },
  };
}

function rawModelContent(content: string): { __rawModelContent: string } {
  return { __rawModelContent: content };
}

function isRawModelContent(value: unknown): value is { __rawModelContent: string } {
  return Boolean(value) && typeof value === "object" && typeof (value as { __rawModelContent?: unknown }).__rawModelContent === "string";
}

function makeTools(calls: string[], getCatalog: () => unknown = catalog) {
  return {
    getCatalog: () => {
      calls.push("catalog");
      return getCatalog();
    },
    readPage: (key: string) => {
      calls.push(`page:${key}`);
      return page();
    },
    searchWiki: (query: string) => {
      calls.push(`search:${query}`);
      return { query, items: [] };
    },
    readSource: (id: string, startLine?: number, endLine?: number) => {
      calls.push(`source:${id}:${startLine}-${endLine}`);
      return {
        source: sourceSummary(),
        range: { startLine, endLine, totalLines: 30, hasMore: true, nextStartLine: (endLine || 0) + 1 },
        content: "line 12: fastModel: gpt-5.4-mini",
        pages: [], factRefs: [{ pageKey, fact: "fastModel: gpt-5.4-mini", sourceLine: 12 }],
      };
    },
  };
}

function catalog() {
  return { stats: { pageCount: 1, factCount: 1, sourceCount: 1 }, pages: [catalogPage()], sources: [sourceSummary()] };
}

function catalogPage() {
  return { pageKey, title: "Agent", goal: "Agent 配置", sourceIds: [sourceId], factCount: 1, relatedPageKeys: [] };
}

function sourceSummary() {
  return { sourceId, filename: "agent.yaml", contentHash: "h1", charCount: 100, lineCount: 30, pageKeys: [pageKey] };
}

function page() {
  return {
    page: { ...catalogPage(), bodyMarkdown: "# Agent\n\nfastModel: gpt-5.4-mini", keyFacts: [{ fact: "fastModel: gpt-5.4-mini", sourceId, sourceLine: 12 }] },
    relations: { outgoing: [], incoming: [], sameSource: [] },
    sources: [sourceSummary()],
  };
}
