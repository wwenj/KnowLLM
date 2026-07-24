import assert from "node:assert/strict";
import test from "node:test";
import type {
  ModelService,
  RawChatResponseFormat,
} from "../../../model/model.service";
import type { AgentRunEvent, AgentRunnerContext } from "../../agent.types";
import type { LlmWikiAgentTools } from "./llm-wiki-agent.tools";
import type { LlmWikiAgentInput } from "./llm-wiki-agent.types";
import {
  DEFAULT_FAST_MODEL,
  DEFAULT_QUALITY_MODEL,
} from "./llm-wiki-agent.types";
import { LlmWikiAgentWorkflow } from "./llm-wiki-agent.workflow";

const sourceId = "a".repeat(32);
const pageKey = "A1b2C3d4";

test("Planner + ReAct keeps key facts as page evidence and never executes readSource", async () => {
  const toolCalls: string[] = [];
  const tools = makeTools(toolCalls);
  let reactCount = 0;
  const reactInputs: Array<Record<string, unknown>> = [];
  let finalSystem = "";
  const model = makeModel(async (system, _modelId, user) => {
    if (system.includes("Wiki 查询规划器")) {
      return {
        relevant: true,
        tasks: [{ id: "config", question: "Agent 配置是什么？" }],
        actions: [{ tool: "readPage", value: pageKey }],
      };
    }
    if (system.includes("你负责从已读取的资料 (materials) 中")) {
      reactInputs.push(JSON.parse(user) as Record<string, unknown>);
      reactCount += 1;
      if (reactCount === 1) {
        return {
          evidence: [
            {
              taskId: "config",
              pageKey,
              quote: "fastModel: gpt-5.4-mini",
              claim: "页面记录了快速模型配置",
            },
          ],
          missing: ["缺少原始配置内容。"],
          actions: [{ tool: "readSource", sourceId, reason: "核验配置行" }],
          finish: false,
        };
      }
      return {
        evidence: [],
        missing: [],
        actions: [],
        finish: true,
      };
    }
    finalSystem = system;
    return {
      answerable: true,
      answerMarkdown: "# 结果\n\n快速模型是 `gpt-5.4-mini`。",
      citations: ["E1", "not-real"],
      gaps: [],
    };
  });
  const workflow = new LlmWikiAgentWorkflow(
    tools as unknown as LlmWikiAgentTools,
    model as unknown as ModelService,
  );
  const events: AgentRunEvent[] = [];
  const result = await workflow.start(
    context(workflow.validateInput(input()), events),
  );

  assert.equal(result.status, "success");
  assert.deepEqual(toolCalls, ["catalog", `page:${pageKey}`, "catalog"]);
  assert.deepEqual(
    (result.resultJson?.citations as Array<{ evidenceId: string }>).map(
      (item) => item.evidenceId,
    ),
    ["E1"],
  );
  assert.equal(
    (result.resultJson?.verifiedEvidence as Array<{ kind: string }>)[0]?.kind,
    "page",
  );
  assert.equal(
    (result.resultJson?.verifiedEvidence as Array<{ sourceId?: string }>)[0]
      ?.sourceId,
    undefined,
  );
  assert.equal(result.resultJson?.stopReason, "complete");
  assert.deepEqual(reactInputs[0]?.acceptedEvidence, []);
  assert.deepEqual(reactInputs[1]?.acceptedEvidence, [
    {
      evidenceId: "E1",
      taskId: "config",
      pageKey,
      quote: "fastModel: gpt-5.4-mini",
      claim: "页面记录了快速模型配置",
    },
  ]);
  assert.equal(result.tokens?.modelCalls, 4);
  assert.equal(result.stats?.sourceReads, 0);
  assert.equal(
    events.filter((event) => event.type === "model_request").length,
    4,
  );
  assert.equal(
    events.filter((event) => event.type === "model_response").length,
    4,
  );
  assert.deepEqual(
    events
      .filter((event) => event.type === "tool_request")
      .map((event) => event.tool),
    ["readPage"],
  );
  assert.deepEqual(
    events
      .filter((event) => event.type === "tool_response")
      .map((event) => event.status),
    ["success"],
  );
  assert.match(
    finalSystem,
    /关键数字、默认值、配置值、前置条件、适用范围、限制、例外和因果关系/,
  );
  assert.match(finalSystem, /不得为了缩短回答而删除会改变结论含义的条件/);
});

test("input is strict: dual models and limit are required, and legacy fields are rejected", () => {
  const workflow = new LlmWikiAgentWorkflow(
    {} as LlmWikiAgentTools,
    makeModel(() => ({})) as unknown as ModelService,
  );
  assert.deepEqual(workflow.getDefaults(), {
    limit: 8,
    fastModel: DEFAULT_FAST_MODEL,
    qualityModel: DEFAULT_QUALITY_MODEL,
    modelOptions: [],
  });
  assert.throws(
    () => workflow.validateInput({ query: "x", limit: 8, model: "old" }),
    /旧 Agent 输入字段/,
  );
  assert.throws(
    () => workflow.validateInput({ ...input(), limit: 21 }),
    /limit/,
  );
  assert.deepEqual(workflow.validateInput(input()), input());
});

test("Planner only uses the fast model and receives the minimal page tuple catalog", async () => {
  const models: string[] = [];
  let plannerPayload: unknown = null;
  let plannerSystem = "";
  let plannerFormat: RawChatResponseFormat | undefined;
  const model = makeModel(
    (system, _modelId, user, _messages, responseFormat) => {
      if (system.includes("Wiki 查询规划器")) {
        plannerSystem = system;
        plannerPayload = JSON.parse(user);
        plannerFormat = responseFormat;
        return {
          relevant: true,
          tasks: [{ id: "page", question: "页面事实" }],
          actions: [{ tool: "readPage", value: pageKey }],
        };
      }
      if (system.includes("你负责从已读取的资料 (materials) 中"))
        return {
          evidence: [
            {
              taskId: "page",
              pageKey,
              quote: "fastModel: gpt-5.4-mini",
              claim: "页面事实",
            },
          ],
          missing: [],
          actions: [],
          finish: true,
        };
      return {
        answerable: true,
        answerMarkdown: "# 完成",
        citations: ["E1"],
        gaps: [],
      };
    },
    models,
  );
  const workflow = new LlmWikiAgentWorkflow(
    makeTools([]) as unknown as LlmWikiAgentTools,
    model as unknown as ModelService,
  );
  const result = await workflow.start(context(workflow.validateInput(input())));
  assert.equal(result.status, "success");
  assert.deepEqual(plannerPayload, {
    query: input().query,
    pages: [[pageKey, "Agent", "Agent 配置"]],
  });
  assert.match(plannerSystem, /"tasks":\[\{"id":"t1","question"/);
  assert.match(
    plannerSystem,
    /任务字段限 id\/question，动作字段限 tool\/value/,
  );
  assert.doesNotMatch(plannerSystem, /预判答案类型|evidence/);
  assert.equal(plannerFormat?.type, "json_schema");
  if (plannerFormat?.type !== "json_schema")
    throw new Error("Planner 未使用 json_schema");
  const plannerTaskItems = (
    (plannerFormat.json_schema.schema.properties as Record<string, unknown>)
      .tasks as {
      items: { required: string[]; properties: Record<string, unknown> };
    }
  ).items;
  assert.deepEqual(plannerTaskItems.required, ["id", "question"]);
  assert.deepEqual(Object.keys(plannerTaskItems.properties).sort(), [
    "id",
    "question",
  ]);
  assert.deepEqual(models, [
    DEFAULT_FAST_MODEL,
    DEFAULT_FAST_MODEL,
    DEFAULT_QUALITY_MODEL,
  ]);
  assert.equal(
    (result.runnerMeta?.models as { qualityModel: string }).qualityModel,
    DEFAULT_QUALITY_MODEL,
  );
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
  const workflow = new LlmWikiAgentWorkflow(
    makeTools(toolCalls) as unknown as LlmWikiAgentTools,
    model as unknown as ModelService,
  );
  const events: AgentRunEvent[] = [];
  const result = await workflow.start(
    context(
      workflow.validateInput({
        ...input(),
        query: "今天北京天气怎么样？",
      }),
      events,
    ),
  );

  assert.equal(result.status, "insufficient");
  assert.equal(result.content, "当前 Wiki 无相关信息。");
  assert.equal(result.resultJson?.stopReason, "no_relevant_wiki");
  assert.deepEqual(result.resultJson?.plan, {
    relevant: false,
    tasks: [],
    actions: [],
  });
  assert.deepEqual(toolCalls, ["catalog"]);
  assert.equal(modelStages.length, 1);
  assert.equal(result.tokens?.modelCalls, 1);
  assert.equal(
    events.filter((event) => event.type === "tool_request").length,
    0,
  );
  assert.equal(
    events.filter((event) => event.type === "planner_no_match").length,
    1,
  );
  assert.match(plannerSystem, /完全无语义关联/);
  assert.match(
    plannerSystem,
    /"relevant":false,\s*"tasks":\[\],\s*"actions":\[\]/,
  );
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
          tasks: [
            {
              task: "查找打印床调平流程",
              mustAnswer: ["打印床如何调平"],
              evidence: "page",
              priority: 1,
            },
          ],
          actions: [{ action: "readPage", value: pageKey }],
        };
      }
      retryMessages = messages;
      return {
        relevant: true,
        tasks: [{ id: "page", question: "页面事实" }],
        actions: [{ tool: "readPage", value: pageKey }],
      };
    }
    if (system.includes("你负责从已读取的资料 (materials) 中"))
      return {
        evidence: [
          {
            taskId: "page",
            pageKey,
            quote: "fastModel: gpt-5.4-mini",
            claim: "页面事实",
          },
        ],
        missing: [],
        actions: [],
        finish: true,
      };
    return {
      answerable: true,
      answerMarkdown: "# 完成",
      citations: ["E1"],
      gaps: [],
    };
  });
  const workflow = new LlmWikiAgentWorkflow(
    makeTools([]) as unknown as LlmWikiAgentTools,
    model as unknown as ModelService,
  );
  const result = await workflow.start(context(workflow.validateInput(input())));
  assert.equal(result.status, "success");
  assert.equal(plannerCalls, 2);
  assert.equal(result.tokens?.modelCalls, 4);
  assert.deepEqual(
    retryMessages.map((message) => message.role),
    ["system", "user", "assistant", "user"],
  );
  assert.match(
    String(retryMessages[3]?.content),
    /Planner task包含未知字段: task, mustAnswer, evidence, priority/,
  );
});

test("ReAct rejects a direct Markdown answer and retries with an explicit JSON-only contract", async () => {
  let reactCalls = 0;
  let reactSystem = "";
  let retryMessages: Array<{ role: string; content: unknown }> = [];
  let finalSystem = "";
  const model = makeModel((system, _model, _user, messages) => {
    if (system.includes("Wiki 查询规划器"))
      return {
        relevant: true,
        tasks: [{ id: "page", question: "页面事实" }],
        actions: [{ tool: "readPage", value: pageKey }],
      };
    if (system.includes("你负责从已读取的资料 (materials) 中")) {
      reactCalls += 1;
      reactSystem = system;
      if (reactCalls === 1)
        return rawModelContent("# 直接回答\n\n这不是 JSON。");
      retryMessages = messages;
      return {
        evidence: [
          {
            taskId: "page",
            pageKey,
            quote: "fastModel: gpt-5.4-mini",
            claim: "页面事实",
          },
        ],
        missing: [],
        actions: [],
        finish: true,
      };
    }
    finalSystem = system;
    return {
      answerable: true,
      answerMarkdown: "# 完成",
      citations: ["E1"],
      gaps: [],
    };
  });
  const workflow = new LlmWikiAgentWorkflow(
    makeTools([]) as unknown as LlmWikiAgentTools,
    model as unknown as ModelService,
  );
  const events: AgentRunEvent[] = [];
  const result = await workflow.start(
    context(workflow.validateInput(input()), events),
  );

  assert.equal(result.status, "success");
  assert.equal(reactCalls, 2);
  assert.match(reactSystem, /【工作流程】/);
  assert.match(
    reactSystem,
    /acceptedEvidence 是已经通过校验的证据，不要重复提取/,
  );
  assert.match(reactSystem, /必要事实属于 page 证据，不单独标记为 fact/);
  assert.doesNotMatch(reactSystem, /readSource/);
  assert.match(finalSystem, /【输出结构】/);
  assert.deepEqual(
    retryMessages.map((message) => message.role),
    ["system", "user", "assistant", "user"],
  );
  assert.match(String(retryMessages[3]?.content), /模型返回不是合法 JSON/);
  assert.equal(
    events.filter((event) => event.type === "model_validation_error").length,
    1,
  );
  assert.equal(
    events.filter((event) => event.type === "model_json_retry").length,
    1,
  );
});

test("ReAct schema and runtime validation require locator fields for every evidence and Tool variant", async () => {
  let reactFormat: RawChatResponseFormat | undefined;
  let reactInput: Record<string, unknown> | undefined;
  let reactCalls = 0;
  let retryMessages: Array<{ role: string; content: unknown }> = [];
  const model = makeModel((system, _model, user, messages, responseFormat) => {
    if (system.includes("Wiki 查询规划器"))
      return {
        relevant: true,
        tasks: [{ id: "page", question: "页面事实" }],
        actions: [{ tool: "readPage", value: pageKey }],
      };
    if (system.includes("你负责从已读取的资料 (materials) 中")) {
      reactFormat = responseFormat;
      reactInput = JSON.parse(user) as Record<string, unknown>;
      reactCalls += 1;
      if (reactCalls === 1)
        return {
          evidence: [
            {
              taskId: "page",
              quote: "fastModel: gpt-5.4-mini",
              claim: "页面事实",
            },
          ],
          missing: [],
          actions: [],
          finish: true,
        };
      retryMessages = messages;
      return {
        evidence: [
          {
            taskId: "page",
            pageKey,
            quote: "fastModel: gpt-5.4-mini",
            claim: "页面事实",
          },
        ],
        missing: [],
        actions: [],
        finish: true,
      };
    }
    return {
      answerable: true,
      answerMarkdown: "# 完成",
      citations: ["E1"],
      gaps: [],
    };
  });
  const workflow = new LlmWikiAgentWorkflow(
    makeTools([]) as unknown as LlmWikiAgentTools,
    model as unknown as ModelService,
  );
  const result = await workflow.start(context(workflow.validateInput(input())));

  assert.equal(result.status, "success");
  assert.equal(reactCalls, 2);
  assert.deepEqual(Object.keys(reactInput || {}).sort(), [
    "acceptedEvidence",
    "materials",
    "question",
    "tasks",
  ]);
  assert.deepEqual((reactInput?.tasks as Array<Record<string, unknown>>)[0], {
    taskId: "page",
    question: "页面事实",
  });
  const materials = reactInput?.materials as {
    pages: Array<Record<string, unknown>>;
    sources: unknown[];
  };
  assert.deepEqual(Object.keys(materials.pages[0] || {}).sort(), [
    "content",
    "pageKey",
    "sourceIds",
    "title",
  ]);
  assert.deepEqual(materials.pages[0]?.sourceIds, [sourceId]);
  assert.equal("keyFacts" in (materials.pages[0] || {}), false);
  assert.deepEqual(materials.sources, []);
  assert.match(
    String(retryMessages[3]?.content),
    /缺少 pageKey 或 sourceId\/sourceLine/,
  );
  assert.equal(reactFormat?.type, "json_schema");
  if (reactFormat?.type !== "json_schema")
    throw new Error("ReAct 未使用 json_schema");
  const properties = reactFormat.json_schema.schema.properties as Record<
    string,
    unknown
  >;
  const evidenceItems = (
    properties.evidence as { items: { oneOf: Array<{ required: string[] }> } }
  ).items.oneOf;
  const actionItems = (
    properties.actions as {
      items: {
        oneOf: Array<{
          properties: Record<string, { const?: string }>;
          required: string[];
        }>;
      };
    }
  ).items.oneOf;
  assert.deepEqual(
    evidenceItems.map((item) => item.required),
    [
      ["taskId", "pageKey", "quote", "claim"],
      ["taskId", "sourceId", "sourceLine", "quote", "claim"],
    ],
  );
  assert.deepEqual(
    actionItems.find((item) => item.properties.tool.const === "searchWiki")
      ?.required,
    ["tool", "query"],
  );
  assert.deepEqual(
    actionItems.find((item) => item.properties.tool.const === "readPage")
      ?.required,
    ["tool", "pageKey"],
  );
  assert.equal(
    actionItems.find((item) => item.properties.tool.const === "readSource"),
    undefined,
  );
});

test("a changed published catalog ends the run as wiki_changed without mixing evidence", async () => {
  let catalogs = 0;
  const tools = makeTools([], () => {
    catalogs += 1;
    return catalogs > 1
      ? {
          stats: { pageCount: 2, factCount: 1, sourceCount: 1 },
          pages: [catalogPage(), { ...catalogPage(), pageKey: "changed" }],
          sources: [sourceSummary()],
        }
      : catalog();
  });
  const model = makeModel((system) => {
    if (system.includes("Wiki 查询规划器"))
      return {
        relevant: true,
        tasks: [{ id: "x", question: "x" }],
        actions: [{ tool: "readPage", value: pageKey }],
      };
    if (system.includes("你负责从已读取的资料 (materials) 中"))
      return {
        evidence: [
          {
            taskId: "x",
            pageKey,
            quote: "fastModel: gpt-5.4-mini",
            claim: "x",
          },
        ],
        missing: [],
        actions: [],
        finish: true,
      };
    return {
      answerable: true,
      answerMarkdown: "x",
      citations: ["E1"],
      gaps: [],
    };
  });
  const workflow = new LlmWikiAgentWorkflow(
    tools as unknown as LlmWikiAgentTools,
    model as unknown as ModelService,
  );
  const result = await workflow.start(context(workflow.validateInput(input())));
  assert.equal(result.status, "insufficient");
  assert.equal(result.resultJson?.stopReason, "wiki_changed");
  assert.deepEqual(result.resultJson?.citations, []);
});

function input(): LlmWikiAgentInput {
  return {
    query: "默认快速模型是什么？",
    limit: 8,
    fastModel: DEFAULT_FAST_MODEL,
    qualityModel: DEFAULT_QUALITY_MODEL,
  };
}

function context(
  value: LlmWikiAgentInput,
  events: AgentRunEvent[] = [],
): AgentRunnerContext<LlmWikiAgentInput> {
  return {
    runId: "b".repeat(32),
    agentType: "llmWiki",
    input: value,
    signal: new AbortController().signal,
    appendEvent: (event) => events.push(event),
    updateRunnerMeta: () => undefined,
  };
}

function makeModel(
  responder: (
    system: string,
    model: string,
    user: string,
    messages: Array<{ role: string; content: unknown }>,
    responseFormat?: RawChatResponseFormat,
  ) => unknown | Promise<unknown>,
  models: string[] = [],
) {
  return {
    listModels: () => [],
    findModel: (modelName: string) => ({ id: modelName }),
    chat: async ({
      messages,
      model,
      response_format,
      onRequest,
      onResponse,
    }: {
      messages: Array<{ role: string; content: unknown }>;
      model: string;
      response_format?: RawChatResponseFormat;
      onRequest?: (request: {
        url: string;
        body: Record<string, unknown>;
      }) => void;
      onResponse?: (response: unknown) => void;
    }) => {
      models.push(model);
      onRequest?.({
        url: "https://model.test/v1/chat/completions",
        body: { model, messages, stream: false },
      });
      const modelValue = await responder(
        String(messages[0]?.content || ""),
        model,
        String(messages[1]?.content || ""),
        messages,
        response_format,
      );
      const response = {
        choices: [
          {
            message: {
              content: isRawModelContent(modelValue)
                ? modelValue.__rawModelContent
                : JSON.stringify(modelValue),
            },
          },
        ],
      };
      onResponse?.(response);
      return response;
    },
  };
}

function rawModelContent(content: string): { __rawModelContent: string } {
  return { __rawModelContent: content };
}

function isRawModelContent(
  value: unknown,
): value is { __rawModelContent: string } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { __rawModelContent?: unknown }).__rawModelContent ===
      "string"
  );
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
        range: {
          startLine,
          endLine,
          totalLines: 30,
          hasMore: true,
          nextStartLine: (endLine || 0) + 1,
        },
        content: "line 12: fastModel: gpt-5.4-mini",
        pages: [],
        factRefs: [
          { pageKey, fact: "fastModel: gpt-5.4-mini", sourceLine: 12 },
        ],
      };
    },
  };
}

function catalog() {
  return {
    stats: { pageCount: 1, factCount: 1, sourceCount: 1 },
    pages: [catalogPage()],
    sources: [sourceSummary()],
  };
}

function catalogPage() {
  return {
    pageKey,
    title: "Agent",
    goal: "Agent 配置",
    sourceIds: [sourceId],
    factCount: 1,
    relatedPageKeys: [],
  };
}

function sourceSummary() {
  return {
    sourceId,
    filename: "agent.yaml",
    contentHash: "h1",
    charCount: 100,
    lineCount: 30,
    pageKeys: [pageKey],
  };
}

function page() {
  return {
    page: {
      ...catalogPage(),
      bodyMarkdown: "# Agent\n\nfastModel: gpt-5.4-mini",
      keyFacts: [{ fact: "fastModel: gpt-5.4-mini", sourceId, sourceLine: 12 }],
    },
    relations: { outgoing: [], incoming: [], sameSource: [] },
    sources: [sourceSummary()],
  };
}
