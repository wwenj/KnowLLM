import assert from "node:assert/strict";
import test from "node:test";
import type {
  ModelService,
  ResponseTextFormat,
} from "../../../model/model.service";
import type { AgentRunEvent, AgentRunnerContext } from "../../agent.types";
import type { LlmWikiAgentTools } from "./llm-wiki-agent.tools";
import {
  DEFAULT_FAST_MODEL,
  DEFAULT_QUALITY_MODEL,
  type LlmWikiAgentInput,
  type SourceTraceInput,
} from "./llm-wiki-agent.types";
import { LlmWikiAgentWorkflow } from "./llm-wiki-agent.workflow";

const pageKey1 = "A1b2C3d4";
const pageKey2 = "E5f6G7h8";
const pageKey3 = "I9j0K1l2";
const sourceId1 = "a".repeat(16);
const sourceId2 = "b".repeat(16);
const sourceId3 = "d".repeat(16);

test("Planner binds one initial action to each task and completes with Page evidence", async () => {
  const toolCalls: string[] = [];
  const models: string[] = [];
  let plannerFormat: ResponseTextFormat | undefined;
  const model = makeModel((system, _model, _user, _messages, format) => {
    if (isPlanner(system)) {
      plannerFormat = format;
      return {
        relevant: true,
        tasks: [{ id: "t1", question: "默认模型是什么？" }],
        actions: [{ taskId: "t1", tool: "readPage", value: pageKey1 }],
      };
    }
    if (isReact(system)) {
      return {
        evidence: [pageEvidence("t1", pageKey1, "fastModel: gpt-5.4-mini")],
        taskStates: [completed("t1", "默认模型是 gpt-5.4-mini")],
        actions: [],
        conflicts: [],
      };
    }
    return final("complete", "默认模型是 `gpt-5.4-mini`。[E1]", ["E1"]);
  }, models);
  const workflow = new LlmWikiAgentWorkflow(
    makeTools(toolCalls) as unknown as LlmWikiAgentTools,
    model as unknown as ModelService,
  );
  const result = await workflow.start(context(workflow.validateInput(input())));

  assert.equal(result.status, "success");
  assert.deepEqual(toolCalls, ["catalog", `page:${pageKey1}`, "catalog"]);
  assert.deepEqual(models, [
    DEFAULT_FAST_MODEL,
    DEFAULT_FAST_MODEL,
    DEFAULT_QUALITY_MODEL,
  ]);
  assert.equal(plannerFormat?.type, "json_schema");
  assert.equal(result.resultJson?.answerStatus, "complete");
  assert.deepEqual(result.resultJson?.taskResults, [
    {
      taskId: "t1",
      question: "默认模型是什么？",
      status: "completed",
      conclusion: "默认模型是 gpt-5.4-mini",
      evidenceIds: ["E1"],
      insufficientReason: undefined,
      gaps: [],
    },
  ]);
  assert.deepEqual(
    (result.resultJson?.verifiedEvidence as Array<{ kind: string }>).map(
      (item) => item.kind,
    ),
    ["page"],
  );
});

test("Planner rejects missing taskId and corrects it once", async () => {
  let plannerCalls = 0;
  let retryMessages: Array<{ role: string; content: unknown }> = [];
  const model = makeModel((system, _model, _user, messages) => {
    if (isPlanner(system)) {
      plannerCalls += 1;
      if (plannerCalls === 1) {
        return {
          relevant: true,
          tasks: [{ id: "t1", question: "问题" }],
          actions: [{ tool: "readPage", value: pageKey1 }],
        };
      }
      retryMessages = messages;
      return {
        relevant: true,
        tasks: [{ id: "t1", question: "问题" }],
        actions: [{ taskId: "t1", tool: "readPage", value: pageKey1 }],
      };
    }
    if (isReact(system)) {
      return {
        evidence: [pageEvidence("t1", pageKey1, "fastModel: gpt-5.4-mini")],
        taskStates: [completed("t1", "完成")],
        actions: [],
        conflicts: [],
      };
    }
    return final("complete", "完成。[E1]", ["E1"]);
  });
  const workflow = new LlmWikiAgentWorkflow(
    makeTools([]) as unknown as LlmWikiAgentTools,
    model as unknown as ModelService,
  );
  const result = await workflow.start(context(workflow.validateInput(input())));

  assert.equal(result.status, "success");
  assert.equal(plannerCalls, 2);
  assert.deepEqual(
    retryMessages.map((message) => message.role),
    ["system", "user", "assistant", "user"],
  );
  assert.match(String(retryMessages[3]?.content), /taskId/);
});

test("completed task is frozen and later ReAct only receives its compact summary", async () => {
  const reactPayloads: Array<Record<string, unknown>> = [];
  let reactRound = 0;
  const model = makeModel((system, _model, user) => {
    if (isPlanner(system)) {
      return {
        relevant: true,
        tasks: [
          { id: "t1", question: "任务一" },
          { id: "t2", question: "任务二" },
        ],
        actions: [
          { taskId: "t1", tool: "readPage", value: pageKey1 },
          { taskId: "t2", tool: "readPage", value: pageKey2 },
        ],
      };
    }
    if (isReact(system)) {
      reactRound += 1;
      reactPayloads.push(JSON.parse(user) as Record<string, unknown>);
      if (reactRound === 1) {
        return {
          evidence: [pageEvidence("t1", pageKey1, "PAGE_ONE_SECRET")],
          taskStates: [
            completed("t1", "任务一完成"),
            active("t2", ["继续检索任务二"]),
          ],
          actions: [{ tool: "searchWiki", taskId: "t2", query: "任务二" }],
          conflicts: [],
        };
      }
      return {
        evidence: [pageEvidence("t2", pageKey2, "PAGE_TWO_SECRET")],
        taskStates: [completed("t2", "任务二完成")],
        actions: [],
        conflicts: [],
      };
    }
    return final("complete", "两个任务均完成。[E1][E2]", ["E1", "E2"]);
  });
  const workflow = new LlmWikiAgentWorkflow(
    makeTools([]) as unknown as LlmWikiAgentTools,
    model as unknown as ModelService,
  );
  const result = await workflow.start(context(workflow.validateInput(input())));

  assert.equal(result.status, "success");
  const second = reactPayloads[1] as {
    activeTasks: Array<{ taskId: string }>;
    completedTasks: unknown[];
  };
  assert.deepEqual(
    second.activeTasks.map((task) => task.taskId),
    ["t2"],
  );
  assert.deepEqual(second.completedTasks, [
    { taskId: "t1", conclusion: "任务一完成", evidenceIds: ["E1"] },
  ]);
  assert.doesNotMatch(JSON.stringify(second), /PAGE_ONE_SECRET/);
});

test("traceSource uses the fixed task question, fast model and compact result", async () => {
  const models: string[] = [];
  let reactRound = 0;
  let sourceAttempts = 0;
  let traceInput: SourceTraceInput | undefined;
  let secondPayload: Record<string, unknown> | undefined;
  const tools = makeTools([], undefined, async (value) => {
    traceInput = value;
    const decision = await value.callModel({
      stage: "source_trace_t1_1",
      system: "Source 证据查询器",
      payload: { currentChunk: { content: "raw source must stay internal" } },
      format: jsonFormat(),
      maxTokens: 500,
      parse: (raw) => {
        if (typeof raw.sufficient !== "boolean") {
          throw new Error("sufficient 必须是 boolean");
        }
        return {
          evidence: raw.evidence as Array<{ quote: string; claim: string }>,
          sufficient: raw.sufficient,
          conclusion: String(raw.conclusion || ""),
          unresolved: [],
        };
      },
    });
    assert.equal(decision?.sufficient, true);
    return {
      taskId: value.taskId,
      sourceId: value.source.sourceId,
      status: "sufficient" as const,
      conclusion: "原文确认默认模型",
      evidence: [
        {
          taskId: value.taskId,
          kind: "source" as const,
          sourceId: value.source.sourceId,
          sourceFilename: value.source.filename,
          quote: "fastModel: gpt-5.4-mini",
          claim: "原文配置",
          sourceLine: 12,
          range: { startLine: 12, endLine: 12 },
        },
      ],
      unresolved: [],
      rounds: 1,
      reads: [],
    };
  });
  const model = makeModel((system, _model, user) => {
    if (isPlanner(system)) {
      return {
        relevant: true,
        tasks: [{ id: "t1", question: "默认模型是什么？" }],
        actions: [{ taskId: "t1", tool: "readPage", value: pageKey1 }],
      };
    }
    if (system.includes("Source 证据查询器")) {
      sourceAttempts += 1;
      if (sourceAttempts === 1) return { invalid: true };
      return {
        evidence: [{ quote: "x", claim: "x" }],
        sufficient: true,
        conclusion: "找到",
        unresolved: [],
      };
    }
    if (isReact(system)) {
      reactRound += 1;
      if (reactRound === 1) {
        return {
          evidence: [],
          taskStates: [active("t1", ["Wiki 页面证据不完整"])],
          actions: [{ tool: "traceSource", taskId: "t1", sourceId: sourceId1 }],
          conflicts: [],
        };
      }
      secondPayload = JSON.parse(user) as Record<string, unknown>;
      return {
        evidence: [],
        taskStates: [completed("t1", "默认模型已由原文确认")],
        actions: [],
        conflicts: [],
      };
    }
    return final("complete", "默认模型已确认。[E1]", ["E1"]);
  }, models);
  const workflow = new LlmWikiAgentWorkflow(
    tools as unknown as LlmWikiAgentTools,
    model as unknown as ModelService,
  );
  const result = await workflow.start(context(workflow.validateInput(input())));

  assert.equal(result.status, "success");
  assert.equal(traceInput?.question, "默认模型是什么？");
  assert.deepEqual(models, [
    DEFAULT_FAST_MODEL,
    DEFAULT_FAST_MODEL,
    DEFAULT_FAST_MODEL,
    DEFAULT_FAST_MODEL,
    DEFAULT_FAST_MODEL,
    DEFAULT_QUALITY_MODEL,
  ]);
  assert.doesNotMatch(
    JSON.stringify(secondPayload),
    /raw source must stay internal/,
  );
  assert.match(JSON.stringify(secondPayload), /原文确认默认模型/);
  assert.equal(result.stats?.sourceModelCalls, 2);
  assert.equal(result.resultJson?.answerStatus, "complete");
  const traces = result.resultJson?.sourceTraces as Array<
    Record<string, unknown>
  >;
  assert.equal("content" in traces[0], false);
});

test("traceSource rejects a Source not exposed by the task Page", async () => {
  let reactRound = 0;
  let traceCalls = 0;
  const tools = makeTools([], undefined, async () => {
    traceCalls += 1;
    throw new Error("should not run");
  });
  const model = makeModel((system) => {
    if (isPlanner(system)) {
      return {
        relevant: true,
        tasks: [{ id: "t1", question: "问题" }],
        actions: [{ taskId: "t1", tool: "readPage", value: pageKey1 }],
      };
    }
    if (isReact(system)) {
      reactRound += 1;
      if (reactRound === 1) {
        return {
          evidence: [],
          taskStates: [active("t1", ["尝试错误 Source"])],
          actions: [{ tool: "traceSource", taskId: "t1", sourceId: sourceId2 }],
          conflicts: [],
        };
      }
      return {
        evidence: [],
        taskStates: [
          {
            taskId: "t1",
            status: "insufficient",
            conclusion: "",
            reason: "没有可用 Source",
            gaps: [],
          },
        ],
        actions: [],
        conflicts: [],
      };
    }
    return final("insufficient", "证据不足：没有可用 Source。", []);
  });
  const workflow = new LlmWikiAgentWorkflow(
    tools as unknown as LlmWikiAgentTools,
    model as unknown as ModelService,
  );
  const result = await workflow.start(context(workflow.validateInput(input())));

  assert.equal(traceCalls, 0);
  assert.equal(result.status, "insufficient");
  assert.equal(result.resultJson?.answerStatus, "insufficient");
});

test("Source insufficient does not stop the task from reading another Page", async () => {
  const toolCalls: string[] = [];
  let reactRound = 0;
  const tools = makeTools(toolCalls, undefined, async (value) => ({
    taskId: value.taskId,
    sourceId: value.source.sourceId,
    status: "insufficient" as const,
    conclusion: "",
    evidence: [],
    unresolved: ["原文没有回答固定问题"],
    rounds: 1,
    reason: "source_exhausted",
    reads: [],
  }));
  const model = makeModel((system) => {
    if (isPlanner(system)) {
      return {
        relevant: true,
        tasks: [{ id: "t1", question: "问题" }],
        actions: [{ taskId: "t1", tool: "readPage", value: pageKey1 }],
      };
    }
    if (isReact(system)) {
      reactRound += 1;
      if (reactRound === 1) {
        return {
          evidence: [],
          taskStates: [active("t1", ["需要回溯原文"])],
          actions: [
            { tool: "traceSource", taskId: "t1", sourceId: sourceId1 },
          ],
          conflicts: [],
        };
      }
      if (reactRound === 2) {
        return {
          evidence: [],
          taskStates: [active("t1", ["改读另一个 Wiki 页面"])],
          actions: [
            { tool: "readPage", taskId: "t1", pageKey: pageKey2 },
          ],
          conflicts: [],
        };
      }
      return {
        evidence: [pageEvidence("t1", pageKey2, "PAGE_TWO_SECRET")],
        taskStates: [completed("t1", "第二个页面提供了答案")],
        actions: [],
        conflicts: [],
      };
    }
    return final("complete", "第二个页面提供了答案。[E1]", ["E1"]);
  });
  const workflow = new LlmWikiAgentWorkflow(
    tools as unknown as LlmWikiAgentTools,
    model as unknown as ModelService,
  );
  const result = await workflow.start(context(workflow.validateInput(input())));

  assert.equal(result.status, "success");
  assert.equal(result.resultJson?.answerStatus, "complete");
  assert.equal(toolCalls.includes(`page:${pageKey2}`), true);
});

test("all Source traces share a total budget of ten fast model calls", async () => {
  let reactRound = 0;
  const grantedRounds: number[] = [];
  const tools = makeTools([], undefined, async (value) => {
    grantedRounds.push(value.maxRounds);
    for (let round = 0; round < value.maxRounds; round += 1) {
      await value.callModel({
        stage: `source_budget_${value.taskId}_${round + 1}`,
        system: "Source budget probe",
        payload: {},
        format: jsonFormat(),
        maxTokens: 100,
        parse: () => ({
          evidence: [],
          sufficient: false,
          conclusion: "",
          unresolved: ["继续查找"],
        }),
      });
    }
    return {
      taskId: value.taskId,
      sourceId: value.source.sourceId,
      status: "insufficient" as const,
      conclusion: "",
      evidence: [],
      unresolved: ["预算内未找到"],
      rounds: value.maxRounds,
      reason:
        value.maxRounds > 0 ? "source_round_limit" : "source_budget_exhausted",
      reads: [],
    };
  });
  const model = makeModel((system) => {
    if (isPlanner(system)) {
      return {
        relevant: true,
        tasks: [
          { id: "t1", question: "任务一" },
          { id: "t2", question: "任务二" },
          { id: "t3", question: "任务三" },
        ],
        actions: [
          { taskId: "t1", tool: "readPage", value: pageKey1 },
          { taskId: "t2", tool: "readPage", value: pageKey2 },
          { taskId: "t3", tool: "readPage", value: pageKey3 },
        ],
      };
    }
    if (system.includes("Source budget probe")) return {};
    if (isReact(system)) {
      reactRound += 1;
      if (reactRound === 1) {
        return {
          evidence: [],
          taskStates: [
            active("t1", ["需要原文"]),
            active("t2", ["需要原文"]),
            active("t3", ["需要原文"]),
          ],
          actions: [
            { tool: "traceSource", taskId: "t1", sourceId: sourceId1 },
            { tool: "traceSource", taskId: "t2", sourceId: sourceId2 },
            { tool: "traceSource", taskId: "t3", sourceId: sourceId3 },
          ],
          conflicts: [],
        };
      }
      return {
        evidence: [],
        taskStates: [
          insufficient("t1", "Source 未找到"),
          insufficient("t2", "Source 未找到"),
          insufficient("t3", "Source 预算已耗尽"),
        ],
        actions: [],
        conflicts: [],
      };
    }
    return final("insufficient", "所有任务证据不足。", []);
  });
  const workflow = new LlmWikiAgentWorkflow(
    tools as unknown as LlmWikiAgentTools,
    model as unknown as ModelService,
  );
  const result = await workflow.start(context(workflow.validateInput(input())));

  assert.deepEqual(grantedRounds, [5, 5, 0]);
  assert.equal(result.stats?.sourceModelCalls, 10);
  assert.equal(result.status, "insufficient");
});

test("Final returns a partial answer when tasks end with mixed states", async () => {
  let finalPayload: Record<string, unknown> | undefined;
  const model = makeModel((system, _model, user) => {
    if (isPlanner(system)) {
      return {
        relevant: true,
        tasks: [
          { id: "t1", question: "可回答任务" },
          { id: "t2", question: "不可回答任务" },
        ],
        actions: [
          { taskId: "t1", tool: "readPage", value: pageKey1 },
          { taskId: "t2", tool: "readPage", value: pageKey2 },
        ],
      };
    }
    if (isReact(system)) {
      return {
        evidence: [pageEvidence("t1", pageKey1, "PAGE_ONE_SECRET")],
        taskStates: [
          completed("t1", "任务一有答案"),
          {
            taskId: "t2",
            status: "insufficient",
            conclusion: "",
            reason: "页面没有相关证据",
            gaps: [],
          },
        ],
        actions: [],
        conflicts: [],
      };
    }
    finalPayload = JSON.parse(user) as Record<string, unknown>;
    return final("partial", "任务一有答案。[E1]\n\n任务二证据不足。", ["E1"]);
  });
  const workflow = new LlmWikiAgentWorkflow(
    makeTools([]) as unknown as LlmWikiAgentTools,
    model as unknown as ModelService,
  );
  const result = await workflow.start(context(workflow.validateInput(input())));

  assert.equal(result.status, "insufficient");
  assert.equal(result.resultJson?.answerStatus, "partial");
  assert.equal((finalPayload?.completedTasks as unknown[]).length, 1);
  assert.equal((finalPayload?.insufficientTasks as unknown[]).length, 1);
  assert.equal((finalPayload?.verifiedEvidence as unknown[]).length, 1);
});

test("changed Published catalog discards evidence before Final", async () => {
  let catalogReads = 0;
  let finalCalls = 0;
  const tools = makeTools([], () => {
    catalogReads += 1;
    const value = catalog();
    return catalogReads > 1
      ? {
          ...value,
          stats: { ...value.stats, pageCount: value.stats.pageCount + 1 },
        }
      : value;
  });
  const model = makeModel((system) => {
    if (isPlanner(system)) {
      return {
        relevant: true,
        tasks: [{ id: "t1", question: "问题" }],
        actions: [{ taskId: "t1", tool: "readPage", value: pageKey1 }],
      };
    }
    if (isReact(system)) {
      return {
        evidence: [pageEvidence("t1", pageKey1, "fastModel: gpt-5.4-mini")],
        taskStates: [completed("t1", "完成")],
        actions: [],
        conflicts: [],
      };
    }
    finalCalls += 1;
    return final("complete", "不应执行", ["E1"]);
  });
  const workflow = new LlmWikiAgentWorkflow(
    tools as unknown as LlmWikiAgentTools,
    model as unknown as ModelService,
  );
  const result = await workflow.start(context(workflow.validateInput(input())));

  assert.equal(finalCalls, 0);
  assert.equal(result.status, "insufficient");
  assert.equal(result.resultJson?.stopReason, "wiki_changed");
  assert.deepEqual(result.resultJson?.verifiedEvidence, []);
});

test("invalid ReAct JSON fails the run after one correction", async () => {
  let reactCalls = 0;
  const model = makeModel((system) => {
    if (isPlanner(system)) {
      return {
        relevant: true,
        tasks: [{ id: "t1", question: "问题" }],
        actions: [{ taskId: "t1", tool: "readPage", value: pageKey1 }],
      };
    }
    if (isReact(system)) {
      reactCalls += 1;
      return { invalid: true };
    }
    throw new Error("Final 不应执行");
  });
  const workflow = new LlmWikiAgentWorkflow(
    makeTools([]) as unknown as LlmWikiAgentTools,
    model as unknown as ModelService,
  );

  await assert.rejects(
    () => workflow.start(context(workflow.validateInput(input()))),
    /主 ReAct 第 1 轮未返回有效 JSON/,
  );
  assert.equal(reactCalls, 2);
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
    runId: "c".repeat(32),
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
    responseFormat?: ResponseTextFormat,
  ) => unknown | Promise<unknown>,
  models: string[] = [],
) {
  return {
    listModels: () => [],
    findModel: (modelName: string) => ({ id: modelName }),
    respond: async ({
      messages,
      model,
      textFormat,
      onRequest,
      onResponse,
    }: {
      messages: Array<{ role: string; content: unknown }>;
      model: string;
      textFormat?: ResponseTextFormat;
      onRequest?: (request: {
        url: string;
        body: Record<string, unknown>;
      }) => void;
      onResponse?: (response: unknown) => void;
    }) => {
      models.push(model);
      onRequest?.({
        url: "https://model.test/v1/responses",
        body: { model, input: messages, store: false, text: { format: textFormat } },
      });
      const value = await responder(
        String(messages[0]?.content || ""),
        model,
        String(messages[1]?.content || ""),
        messages,
        textFormat,
      );
      const content = JSON.stringify(value);
      const response = {
        id: "resp_test",
        model,
        status: "completed",
        content,
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: content }],
          },
        ],
      };
      onResponse?.(response);
      return response;
    },
  };
}

function makeTools(
  calls: string[],
  getCatalog: () => ReturnType<typeof catalog> = catalog,
  traceSource: (input: SourceTraceInput) => Promise<unknown> = async () => {
    throw new Error("unexpected traceSource");
  },
) {
  return {
    getCatalog: () => {
      calls.push("catalog");
      return getCatalog();
    },
    readPage: (key: string) => {
      calls.push(`page:${key}`);
      return page(key);
    },
    searchWiki: (query: string) => {
      calls.push(`search:${query}`);
      return { query, items: [] };
    },
    traceSource,
  };
}

function catalog() {
  return {
    stats: { pageCount: 3, factCount: 3, sourceCount: 3 },
    pages: [
      catalogPage(pageKey1, sourceId1),
      catalogPage(pageKey2, sourceId2),
      catalogPage(pageKey3, sourceId3),
    ],
    sources: [
      sourceSummary(sourceId1, pageKey1),
      sourceSummary(sourceId2, pageKey2),
      sourceSummary(sourceId3, pageKey3),
    ],
  };
}

function catalogPage(pageKey: string, sourceId: string) {
  return {
    pageKey,
    title: `Page ${pageKey}`,
    goal: `Goal ${pageKey}`,
    sourceIds: [sourceId],
    factCount: 1,
    relatedPageKeys: [],
  };
}

function sourceSummary(sourceId: string, pageKey: string) {
  return {
    sourceId,
    filename: `${sourceId}.md`,
    contentHash: `hash-${sourceId}`,
    charCount: 100,
    lineCount: 30,
    pageKeys: [pageKey],
  };
}

function page(key: string) {
  const sourceId =
    key === pageKey1 ? sourceId1 : key === pageKey2 ? sourceId2 : sourceId3;
  const marker =
    key === pageKey1
      ? "PAGE_ONE_SECRET"
      : key === pageKey2
        ? "PAGE_TWO_SECRET"
        : "PAGE_THREE_SECRET";
  return {
    page: {
      ...catalogPage(key, sourceId),
      bodyMarkdown: `# Page\n\n${marker}\n\nfastModel: gpt-5.4-mini`,
      keyFacts: [{ fact: marker, sourceId, sourceLine: 12 }],
    },
    relations: { outgoing: [], incoming: [], sameSource: [] },
    sources: [sourceSummary(sourceId, key)],
  };
}

function pageEvidence(taskId: string, pageKey: string, quote: string) {
  return { taskId, pageKey, quote, claim: `${quote} 的结论` };
}

function completed(taskId: string, conclusion: string) {
  return {
    taskId,
    status: "completed",
    conclusion,
    reason: "",
    gaps: [],
  };
}

function active(taskId: string, gaps: string[]) {
  return {
    taskId,
    status: "active",
    conclusion: "",
    reason: "",
    gaps,
  };
}

function insufficient(taskId: string, reason: string) {
  return {
    taskId,
    status: "insufficient",
    conclusion: "",
    reason,
    gaps: [],
  };
}

function final(
  answerStatus: "complete" | "partial" | "insufficient",
  answerMarkdown: string,
  citations: string[],
) {
  return {
    answerable: answerStatus !== "insufficient",
    answerMarkdown,
    citations,
    gaps: [],
  };
}

function isPlanner(system: string): boolean {
  return system.includes("Wiki 查询规划器");
}

function isReact(system: string): boolean {
  return system.includes("Wiki 主 ReAct");
}

function jsonFormat(): ResponseTextFormat {
  return {
    type: "json_schema",
    name: "test",
    strict: true,
    schema: { type: "object" },
  };
}
