import { Injectable, Logger } from "@nestjs/common";
import { nowIso } from "../../../common/fs-json";
import type { AgentRunDetail, AgentRunEvent } from "../../agent/agent.types";
import { AgentRunExecutionService } from "../../agent/services/agent-run-execution.service";
import { LlmWikiRetrievalService } from "../../llmWiki/services/llm-wiki-retrieval.service";
import { ModelService } from "../../model/model.service";
import type {
  AgentEvaluationBudget,
  AgentEvaluationCaseMetrics,
  AgentEvaluationCaseResult,
  AgentEvaluationDataset,
  AgentEvaluationDatasetCase,
  AgentEvaluationFactResult,
  AgentEvaluationFactStatus,
  AgentEvaluationMatchedSource,
  AgentEvaluationMetricResult,
  AgentEvaluationMetricStatus,
  AgentEvaluationModels,
  AgentEvaluationRun,
  AgentEvaluationSourcePolicy,
} from "../evaluation.types";
import {
  AgentEvaluationStoreService,
  summarizeAgentCases,
} from "./agent-evaluation-store.service";

interface AgentJudgeOutput {
  facts?: Array<{
    factId?: unknown;
    status?: unknown;
    evidencePath?: unknown;
    evidence?: unknown;
    reason?: unknown;
  }>;
  faithfulness?: { status?: unknown; reason?: unknown };
  answerCorrectness?: { status?: unknown; reason?: unknown };
  abstainCorrectness?: { status?: unknown; reason?: unknown };
}

@Injectable()
export class AgentEvaluationService {
  private readonly logger = new Logger(AgentEvaluationService.name);

  constructor(
    private readonly store: AgentEvaluationStoreService,
    private readonly retrieval: LlmWikiRetrievalService,
    private readonly execution: AgentRunExecutionService,
    private readonly model: ModelService,
  ) {}

  createRun(input: unknown) {
    const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const dataset = this.store.getDataset(stringField(raw.datasetId));
    const requested = Array.isArray(raw.caseIds) ? raw.caseIds.map(stringField).filter(Boolean) : [];
    const available = new Set(dataset.cases.map((item) => item.id));
    const caseIds = requested.length ? [...new Set(requested)] : dataset.cases.map((item) => item.id);
    if (!caseIds.length) throw new Error("请选择至少一个 Agent 评测 case");
    for (const caseId of caseIds) {
      if (!available.has(caseId)) throw new Error(`case 不存在: ${caseId}`);
    }

    const judgeModel = this.model.resolveModel(stringField(raw.judgeModel));
    if (!judgeModel) throw new Error("未配置 Judge 模型");
    const agentModelInput = stringField(raw.agentModel) || stringField(raw.model);
    const agentModel = agentModelInput ? this.model.resolveModel(agentModelInput) : judgeModel;
    if (!agentModel) throw new Error("未配置 Agent 模型");
    const sourcePolicy = normalizeSourcePolicy(raw.sourcePolicy);
    const budget = normalizeBudget(raw.budget);
    const models = normalizeModels(raw.models, agentModel);

    const run = this.store.createRun({ dataset, caseIds, judgeModel, sourcePolicy, budget, models });
    void this.execute(run.runId, dataset).catch((error) => {
      this.logger.error(`agent evaluation ${run.runId} failed: ${formatError(error)}`);
    });
    return run;
  }

  listRuns(limit?: number) {
    return { items: this.store.listRuns(limit) };
  }

  getRun(runId: string) {
    return this.store.getRun(runId);
  }

  deleteRun(runId: string) {
    return this.store.deleteRun(runId);
  }

  private async execute(runId: string, dataset: AgentEvaluationDataset): Promise<void> {
    let run = this.store.getRun(runId);
    try {
      for (const caseId of run.caseIds) {
        const testCase = dataset.cases.find((item) => item.id === caseId);
        if (!testCase) continue;
        run = this.store.saveRun({
          ...run,
          progress: { ...run.progress, currentCaseId: caseId },
        });
        const result = await this.evaluateCase(dataset, testCase, run);
        const cases = [...run.cases.filter((item) => item.caseId !== caseId), result];
        run = this.store.saveRun({
          ...run,
          cases,
          progress: {
            completed: run.progress.completed + 1,
            total: run.progress.total,
            currentCaseId: caseId,
          },
          summary: summarizeAgentEvaluation(cases),
        });
      }
      this.store.saveRun({
        ...run,
        status: "success",
        endedAt: nowIso(),
        progress: { ...run.progress, currentCaseId: "" },
        summary: summarizeAgentEvaluation(run.cases),
      });
    } catch (error) {
      this.store.saveRun({
        ...run,
        status: "failed",
        endedAt: nowIso(),
        progress: { ...run.progress, currentCaseId: "" },
        errors: [...run.errors, formatError(error)],
      });
    }
  }

  private async evaluateCase(
    dataset: AgentEvaluationDataset,
    testCase: AgentEvaluationDatasetCase,
    run: AgentEvaluationRun,
  ): Promise<AgentEvaluationCaseResult> {
    const matchedSources = this.matchRelevantSources(dataset, testCase);
    const missing = matchedSources.filter((item) => !item.sourceId);
    if (testCase.answerable && missing.length) {
      return sourceMissingResult(testCase, matchedSources, `未找到已编译 source: ${missing.map((item) => item.filename).join(", ")}`);
    }

    let agentRunId = "";
    let agentDetail: AgentRunDetail;
    try {
      const execution = this.execution.start("llmWiki", {
        query: testCase.question,
        sourcePolicy: run.sourcePolicy,
        budget: run.budget,
        models: run.models,
      });
      agentRunId = execution.runId;
      agentDetail = await execution.done;
    } catch (error) {
      return {
        ...baseCaseResult(testCase, matchedSources),
        status: "agent_failed",
        agentRunId,
        agentStatus: "failed",
        events: [],
        error: formatError(error),
      };
    }

    if (agentDetail.status === "failed" || agentDetail.status === "cancelled") {
      return {
        ...baseCaseResult(testCase, matchedSources),
        status: "agent_failed",
        agentRunId,
        agentStatus: agentDetail.status,
        answerMarkdown: agentDetail.resultMd,
        events: agentDetail.events.map(toPlainEvent),
        error: agentDetail.errors.join("; ") || agentDetail.resultMd,
      };
    }

    const answerMarkdown = String(agentDetail.resultMd || "");
    const resultJson = agentDetail.resultJson || {};
    const hitSourceIds = collectHitSourceIds(resultJson);
    const expectedSourceIds = matchedSources.map((item) => item.sourceId).filter((item): item is string => Boolean(item));
    const sourceHit =
      testCase.answerable && expectedSourceIds.length
        ? expectedSourceIds.every((sourceId) => hitSourceIds.includes(sourceId))
        : null;
    const mustIncludeHits = testCase.mustInclude.filter((item) => includesLoose(answerMarkdown, item));
    const metrics = metricsFromAgentDetail(agentDetail);

    try {
      const judged = await this.judge({
        model: run.judgeModel,
        testCase,
        answerMarkdown,
        resultJson,
      });
      return {
        ...baseCaseResult(testCase, matchedSources),
        status: "success",
        agentRunId,
        agentStatus: agentDetail.status,
        matchedSources,
        expectedSourceIds,
        hitSourceIds,
        sourceHit,
        mustInclude: testCase.mustInclude,
        mustIncludeHits,
        answerMarkdown,
        facts: judged.facts,
        faithfulness: judged.faithfulness,
        answerCorrectness: judged.answerCorrectness,
        abstainCorrectness: judged.abstainCorrectness,
        metrics,
        events: agentDetail.events.map(toPlainEvent),
        error: "",
      };
    } catch (error) {
      return {
        ...baseCaseResult(testCase, matchedSources),
        status: "judge_failed",
        agentRunId,
        agentStatus: agentDetail.status,
        matchedSources,
        expectedSourceIds,
        hitSourceIds,
        sourceHit,
        mustInclude: testCase.mustInclude,
        mustIncludeHits,
        answerMarkdown,
        facts: testCase.expectedFacts.map((fact) => ({
          ...fact,
          status: "missing",
          evidencePath: "",
          evidence: "",
          reason: "Judge 未完成判分",
        })),
        faithfulness: metric("not_applicable", "Judge 未完成判分"),
        answerCorrectness: metric("not_applicable", "Judge 未完成判分"),
        abstainCorrectness: metric("not_applicable", "Judge 未完成判分"),
        metrics,
        events: agentDetail.events.map(toPlainEvent),
        error: formatError(error),
      };
    }
  }

  private matchRelevantSources(
    dataset: AgentEvaluationDataset,
    testCase: AgentEvaluationDatasetCase,
  ): AgentEvaluationMatchedSource[] {
    const manifest = this.retrieval.getManifest();
    return testCase.relevantSourceIds.map((sourceId) => {
      const source = dataset.sources.find((item) => item.id === sourceId);
      if (!source) throw new Error(`case ${testCase.id} 引用了不存在的 source: ${sourceId}`);
      const matched = manifest.sources
        .filter((item) => item.status === "ready" && item.sha256 === source.sha256)
        .sort((a, b) => b.ingested_at.localeCompare(a.ingested_at))[0];
      return {
        datasetSourceId: source.id,
        filename: source.filename,
        sha256: source.sha256,
        sourceId: matched?.source_id || null,
        ingestedAt: matched?.ingested_at || "",
      };
    });
  }

  private async judge(args: {
    model: string;
    testCase: AgentEvaluationDatasetCase;
    answerMarkdown: string;
    resultJson: Record<string, unknown>;
  }): Promise<{
    facts: AgentEvaluationFactResult[];
    faithfulness: AgentEvaluationMetricResult;
    answerCorrectness: AgentEvaluationMetricResult;
    abstainCorrectness: AgentEvaluationMetricResult;
  }> {
    const response = await this.model.respond({
      model: args.model,
      textFormat: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "你是 LLM Wiki Agent 评测器。",
            "只基于 expectedFacts、expectedAnswer、Agent 答案和 Agent 检索证据判分。",
            "不要用外部知识补充答案，也不要因为表达方式不同就判错。",
            "facts.status 只能是 correct、missing、incorrect。",
            "faithfulness/answerCorrectness/abstainCorrectness.status 只能是 correct、incorrect、not_applicable。",
            "answerable=false 时，只有答案明确说明资料不足或当前 Wiki 无法支持回答，且没有编造事实，abstainCorrectness 才是 correct。",
            "只输出 JSON，不输出 Markdown。",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              output_schema: {
                facts: "array of {factId,status,evidencePath,evidence,reason}",
                faithfulness: "{status,reason}",
                answerCorrectness: "{status,reason}",
                abstainCorrectness: "{status,reason}",
              },
              case: {
                id: args.testCase.id,
                question: args.testCase.question,
                answerable: args.testCase.answerable,
                expectedAnswer: args.testCase.expectedAnswer,
                expectedFacts: args.testCase.expectedFacts,
                mustInclude: args.testCase.mustInclude,
                evaluationType: args.testCase.evaluationType,
              },
              agentAnswer: truncate(args.answerMarkdown, 12000),
              agentEvidence: evidenceForJudge(args.resultJson),
            },
            null,
            2,
          ),
        },
      ],
    });
    const output = parseJudgeOutput(extractContent(response));
    const byId = new Map((output.facts || []).map((item) => [stringField(item.factId), item]));
    const facts = args.testCase.expectedFacts.map((fact) => {
      const item = byId.get(fact.id);
      const status = item ? normalizeFactStatus(item.status) : "missing";
      return {
        ...fact,
        status,
        evidencePath: stringField(item?.evidencePath),
        evidence: stringField(item?.evidence),
        reason: stringField(item?.reason) || (item ? "" : "Judge 未返回该事实的判断"),
      };
    });
    return {
      facts,
      faithfulness: normalizeMetric(output.faithfulness, args.testCase.answerable ? "incorrect" : "not_applicable"),
      answerCorrectness: normalizeMetric(output.answerCorrectness, args.testCase.answerable ? "incorrect" : "not_applicable"),
      abstainCorrectness: normalizeMetric(output.abstainCorrectness, args.testCase.answerable ? "not_applicable" : "incorrect"),
    };
  }
}

export function summarizeAgentEvaluation(cases: AgentEvaluationCaseResult[]) {
  return summarizeAgentCases(cases);
}

function sourceMissingResult(
  testCase: AgentEvaluationDatasetCase,
  matchedSources: AgentEvaluationMatchedSource[],
  reason: string,
): AgentEvaluationCaseResult {
  return {
    ...baseCaseResult(testCase, matchedSources),
    status: "source_missing",
    facts: testCase.expectedFacts.map((fact) => ({
      ...fact,
      status: "missing",
      evidencePath: "",
      evidence: "",
      reason,
    })),
    error: "",
  };
}

function baseCaseResult(
  testCase: AgentEvaluationDatasetCase,
  matchedSources: AgentEvaluationMatchedSource[],
): AgentEvaluationCaseResult {
  return {
    caseId: testCase.id,
    question: testCase.question,
    expectedAnswer: testCase.expectedAnswer,
    evaluationType: testCase.evaluationType,
    answerable: testCase.answerable,
    status: "pending",
    agentRunId: "",
    agentStatus: "",
    matchedSources,
    expectedSourceIds: matchedSources.map((item) => item.sourceId).filter((item): item is string => Boolean(item)),
    hitSourceIds: [],
    sourceHit: null,
    mustInclude: testCase.mustInclude,
    mustIncludeHits: [],
    answerMarkdown: "",
    facts: [],
    factScore: 0,
    taskScore: 0,
    faithfulness: metric("not_applicable", ""),
    answerCorrectness: metric("not_applicable", ""),
    abstainCorrectness: metric("not_applicable", ""),
    metrics: emptyMetrics(),
    events: [],
    error: "",
  };
}

function evidenceForJudge(resultJson: Record<string, unknown>) {
  return {
    knowledgeSnippets: arrayValue(resultJson.knowledgeSnippets).slice(0, 20).map((item) => {
      const raw = recordValue(item);
      return {
        path: stringField(raw.path),
        title: stringField(raw.title),
        sources: stringArray(raw.sources),
        sourceSupport: stringField(raw.sourceSupport),
        content: truncate(stringField(raw.content), 5000),
      };
    }),
    rawSources: arrayValue(resultJson.rawSources).slice(0, 12),
    citations: arrayValue(resultJson.citations).slice(0, 20),
    gaps: arrayValue(resultJson.gaps).slice(0, 20),
    coverageSummary: stringField(resultJson.coverageSummary),
    stopReason: stringField(resultJson.stopReason),
  };
}

function collectHitSourceIds(resultJson: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const item of arrayValue(resultJson.knowledgeSnippets)) {
    out.push(...stringArray(recordValue(item).sources));
  }
  for (const item of arrayValue(resultJson.rawSources)) {
    const raw = recordValue(item);
    out.push(stringField(raw.source_id));
  }
  for (const item of arrayValue(resultJson.citations)) {
    out.push(...stringArray(recordValue(item).sources));
  }
  return [...new Set(out.filter(Boolean))];
}

function metricsFromAgentDetail(result: AgentRunDetail): AgentEvaluationCaseMetrics {
  const meta = result.runnerMeta || {};
  const json = result.resultJson || {};
  return {
    rounds: numberField(meta.rounds) || arrayValue(json.retrievalRounds).length,
    readPages: numberField(meta.pageCount) || numberField(json.pageCount),
    keptPages: numberField(meta.keptPageCount) || numberField(json.keptPageCount) || arrayValue(json.knowledgeSnippets).length,
    rawSources: numberField(meta.sourceCount) || numberField(json.sourceCount) || arrayValue(json.rawSources).length,
    modelCalls: numberField(result.stats?.modelCalls) || numberField(result.tokens?.modelCalls),
    totalTokens: numberField(result.tokens?.totalTokens),
    stopReason: stringField(meta.stopReason) || stringField(json.stopReason),
  };
}

function emptyMetrics(): AgentEvaluationCaseMetrics {
  return {
    rounds: 0,
    readPages: 0,
    keptPages: 0,
    rawSources: 0,
    modelCalls: 0,
    totalTokens: 0,
    stopReason: "",
  };
}

function normalizeBudget(value: unknown): AgentEvaluationBudget {
  const raw = recordValue(value);
  return {
    maxRounds: clampInt(raw.maxRounds, 1, 8, 4),
    maxEvidencePages: clampInt(raw.maxEvidencePages, 8, 96, 48),
    maxRawSources: clampInt(raw.maxRawSources, 0, 24, 12),
    tokenLimit: positiveIntOrNull(raw.tokenLimit),
  };
}

function normalizeModels(value: unknown, fallbackModel: string): AgentEvaluationModels {
  const raw = recordValue(value);
  return {
    plannerModel: stringField(raw.plannerModel) || fallbackModel,
    reviewerModel: stringField(raw.reviewerModel) || fallbackModel,
    synthesizerModel: stringField(raw.synthesizerModel) || fallbackModel,
  };
}

function normalizeSourcePolicy(value: unknown): AgentEvaluationSourcePolicy {
  if (value === "auto" || value === "wiki-only" || value === "key-sources" || value === "exhaustive") return value;
  return "key-sources";
}

function parseJudgeOutput(content: string): AgentJudgeOutput {
  const text = content.trim();
  const candidates = [text, text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim(), extractObject(text)];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as AgentJudgeOutput;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // try next candidate
    }
  }
  throw new Error("Judge 未返回合法 JSON");
}

function extractContent(response: unknown): string {
  const body = response as {
    content?: unknown;
    choices?: Array<{ message?: { content?: unknown }; text?: unknown }>;
  };
  const content =
    body.content ??
    body.choices?.[0]?.message?.content ??
    body.choices?.[0]?.text;
  if (typeof content === "string") return content;
  throw new Error("Judge 未返回内容");
}

function normalizeFactStatus(value: unknown): AgentEvaluationFactStatus {
  if (value === "correct" || value === "missing" || value === "incorrect") return value;
  throw new Error(`Judge 返回了非法事实状态: ${String(value || "")}`);
}

function normalizeMetric(value: unknown, fallback: AgentEvaluationMetricStatus): AgentEvaluationMetricResult {
  const raw = recordValue(value);
  const status = normalizeMetricStatus(raw.status, fallback);
  return { status, reason: stringField(raw.reason) };
}

function normalizeMetricStatus(value: unknown, fallback: AgentEvaluationMetricStatus): AgentEvaluationMetricStatus {
  if (value === "correct" || value === "incorrect" || value === "not_applicable") return value;
  return fallback;
}

function metric(status: AgentEvaluationMetricStatus, reason: string): AgentEvaluationMetricResult {
  return { status, reason };
}

function includesLoose(text: string, needle: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, "");
  return normalize(text).includes(normalize(needle));
}

function toPlainEvent(event: AgentRunEvent): Record<string, unknown> {
  return { ...event };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(Math.round(numeric), min), max);
}

function positiveIntOrNull(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringField).filter(Boolean) : [];
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function truncate(value: string, limit: number): string {
  const text = String(value || "");
  return text.length <= limit ? text : `${text.slice(0, limit)}\n...[truncated]`;
}

function extractObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : "";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
