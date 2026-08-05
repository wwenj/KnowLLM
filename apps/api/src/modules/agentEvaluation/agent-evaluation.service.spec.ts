import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import type { AgentRunDetail } from "../agent/agent.types";
import type { AgentRunExecutionService } from "../agent/services/agent-run-execution.service";
import type { LlmWikiNextToolsService } from "../llmWikiNext/llm-wiki-next-tools.service";
import type { ModelService } from "../model/model.service";
import type { AgentEvaluationDatasetService } from "./agent-evaluation-dataset.service";
import {
  AgentEvaluationService,
  classifyFailureStage,
} from "./agent-evaluation.service";
import { AgentEvaluationStoreService } from "./agent-evaluation-store.service";
import type { AgentEvaluationDataset } from "./agent-evaluation.types";

test("失败阶段可区分检索、证据抽取、最终答案和错误答案", () => {
  assert.equal(
    classifyFailureStage("missing", false, false, "PAGE0001", []),
    "retrieval_miss",
  );
  assert.equal(
    classifyFailureStage("missing", false, false, "PAGE0001", ["PAGE0001"]),
    "evidence_extraction_miss",
  );
  assert.equal(
    classifyFailureStage("missing", true, false, "PAGE0001", ["PAGE0001"]),
    "final_answer_miss",
  );
  assert.equal(
    classifyFailureStage("incorrect", true, true, "PAGE0001", ["PAGE0001"]),
    "incorrect_answer",
  );
  assert.equal(
    classifyFailureStage("supported", true, true, "PAGE0001", ["PAGE0001"]),
    null,
  );
});

test("全选时严格顺序执行，Judge 首次失败后只重试一次", async () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "knowllm-agent-eval-"));
  const previousRoot = process.env.KNOWLLM_DATA_ROOT;
  process.env.KNOWLLM_DATA_ROOT = tempRoot;
  try {
    const dataset = fixtureDataset();
    const order: string[] = [];
    let childId = 0;
    const agents = {
      start: (_agentType: string, input: { query: string }) => {
        order.push(input.query);
        childId += 1;
        return {
          runId: childId.toString(16).padStart(32, "0"),
          done: Promise.resolve(agentDetail(childId, input.query)),
        };
      },
      cancel: () => ({ ok: true }),
    } as unknown as AgentRunExecutionService;
    let judgeCalls = 0;
    const models = {
      findModel: (id: string) => ({ id }),
      respond: async (options: { messages: Array<{ content: unknown }> }) => {
        judgeCalls += 1;
        if (judgeCalls % 2 === 1)
          return { content: "not-json", usage: { total_tokens: 3 } };
        const input = JSON.parse(String(options.messages[1].content)) as {
          requiredFacts: Array<{ id: string }>;
        };
        return {
          content: JSON.stringify({
            facts: input.requiredFacts.map((fact) => ({
              factId: fact.id,
              status: "supported",
              evidenceIds: ["E1"],
              reason: "答案与已验证证据一致",
              answerCovered: true,
              evidenceSupported: true,
            })),
            abstainStatus: "not_applicable",
            abstainReason: "",
            hallucinationLevel: "none",
            hallucinationReason: "",
          }),
          usage: { total_tokens: 5 },
        };
      },
    } as unknown as ModelService;
    const wiki = {
      getPublishedIdentity: () => ({ revisionId: dataset.revisionId }),
      readPage: () => ({ page: { bodyMarkdown: "真实 quote" } }),
    } as unknown as LlmWikiNextToolsService;
    const datasets = {
      getRunnableDataset: () => dataset,
      getDataset: () => dataset,
    } as unknown as AgentEvaluationDatasetService;
    const store = new AgentEvaluationStoreService();
    store.onModuleInit();
    const service = new AgentEvaluationService(
      datasets,
      store,
      agents,
      wiki,
      models,
    );

    const created = service.createRun({
      fastModel: "fast",
      qualityModel: "quality",
      judgeModel: "judge",
    });
    const finished = await waitForRun(store, created.runId);

    assert.deepEqual(order, ["问题 A001", "问题 A002"]);
    assert.equal(finished.status, "completed");
    assert.equal(finished.summary.overallScore, 100);
    assert.equal(finished.summary.totalRetries, 2);
    assert.equal(judgeCalls, 4);
  } finally {
    if (previousRoot === undefined) delete process.env.KNOWLLM_DATA_ROOT;
    else process.env.KNOWLLM_DATA_ROOT = previousRoot;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("取消评测会同步取消子 Agent，且异步完成不会覆盖 cancelled", async () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "knowllm-agent-cancel-"));
  const previousRoot = process.env.KNOWLLM_DATA_ROOT;
  process.env.KNOWLLM_DATA_ROOT = tempRoot;
  try {
    const dataset = fixtureDataset();
    dataset.cases = dataset.cases.slice(0, 1);
    dataset.caseCount = 1;
    dataset.factCount = 2;
    dataset.answerableCount = 1;
    let resolveAgent!: (detail: AgentRunDetail) => void;
    let cancelledChild = "";
    const agents = {
      start: () => ({
        runId: "1".padStart(32, "0"),
        done: new Promise<AgentRunDetail>((resolve) => {
          resolveAgent = resolve;
        }),
      }),
      cancel: (_agentType: string, runId: string) => {
        cancelledChild = runId;
        resolveAgent({ ...agentDetail(1, "问题 A001"), status: "cancelled" });
        return { ok: true };
      },
    } as unknown as AgentRunExecutionService;
    const models = {
      findModel: (id: string) => ({ id }),
    } as unknown as ModelService;
    const wiki = {
      getPublishedIdentity: () => ({ revisionId: dataset.revisionId }),
      readPage: () => ({ page: { bodyMarkdown: "真实 quote" } }),
    } as unknown as LlmWikiNextToolsService;
    const datasets = {
      getRunnableDataset: () => dataset,
      getDataset: () => dataset,
    } as unknown as AgentEvaluationDatasetService;
    const store = new AgentEvaluationStoreService();
    store.onModuleInit();
    const service = new AgentEvaluationService(
      datasets,
      store,
      agents,
      wiki,
      models,
    );
    const created = service.createRun({
      fastModel: "fast",
      qualityModel: "quality",
      judgeModel: "judge",
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    service.cancel(created.runId);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(cancelledChild, "1".padStart(32, "0"));
    assert.equal(store.get(created.runId).status, "cancelled");
  } finally {
    if (previousRoot === undefined) delete process.env.KNOWLLM_DATA_ROOT;
    else process.env.KNOWLLM_DATA_ROOT = previousRoot;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

function fixtureDataset(): AgentEvaluationDataset {
  const makeCase = (id: string) => ({
    id,
    question: `问题 ${id}`,
    answerable: true,
    expectedAnswer: "标准答案",
    requiredFacts: [
      {
        id: `${id}-F1`,
        fact: "事实 1",
        evidence: { pageKey: "PAGE0001", quote: "真实 quote" },
      },
      {
        id: `${id}-F2`,
        fact: "事实 2",
        evidence: { pageKey: "PAGE0001", quote: "真实 quote" },
      },
    ],
    evaluationType: "general",
  });
  return {
    schemaVersion: 2,
    datasetId: "demo",
    name: "demo",
    revisionId: "revision-v2",
    generatedAt: "2026-01-01T00:00:00.000Z",
    source: "published_wiki",
    datasetHash: "hash",
    currentRevisionId: "revision-v2",
    compatible: true,
    caseCount: 2,
    factCount: 4,
    answerableCount: 2,
    abstainCount: 0,
    cases: [makeCase("A001"), makeCase("A002")],
  };
}

function agentDetail(index: number, query: string): AgentRunDetail {
  return {
    runId: index.toString(16).padStart(32, "0"),
    agentType: "llmWiki",
    title: query,
    status: "success",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:01.000Z",
    input: {},
    errors: [],
    contentFormat: "markdown",
    artifacts: [],
    runnerMeta: {},
    events: [],
    resultMd: "Agent 正确答案",
    resultJson: {
      answerMarkdown: "Agent 正确答案",
      stopReason: "complete",
      knowledgeSnippets: [{ pageKey: "PAGE0001" }],
      verifiedEvidence: [
        {
          evidenceId: "E1",
          kind: "page",
          pageKey: "PAGE0001",
          quote: "真实 quote",
          claim: "事实成立",
        },
      ],
    },
    tokens: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      rounds: 1,
      modelCalls: 1,
    },
    stats: { modelCalls: 1, toolRounds: 1, pages: 1, searches: 1 },
  };
}

async function waitForRun(store: AgentEvaluationStoreService, runId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = store.get(runId);
    if (run.status !== "running") return run;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("等待评测完成超时");
}
