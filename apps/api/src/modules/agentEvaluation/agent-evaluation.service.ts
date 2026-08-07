import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type { AgentRunDetail, AgentRunEvent } from "../agent/agent.types";
import { AgentRunExecutionService } from "../agent/services/agent-run-execution.service";
import { LlmWikiNextToolsService } from "../llmWikiNext/llm-wiki-next-tools.service";
import { ModelRequestError, ModelService } from "../model/model.service";
import { AgentEvaluationDatasetService } from "./agent-evaluation-dataset.service";
import {
  AgentEvaluationStoreService,
  scoreAbstainCase,
  scoreAnswerableCase,
} from "./agent-evaluation-store.service";
import {
  AgentEvaluationAbstainStatus,
  AgentEvaluationCaseResult,
  AgentEvaluationFactResult,
  AgentEvaluationFactStatus,
  AgentEvaluationHallucinationLevel,
  AgentEvaluationRun,
  AgentEvaluationVerifiedEvidence,
} from "./agent-evaluation.types";

const JUDGE_TIMEOUT_MS = 5 * 60_000;
const FACT_SCORE: Record<AgentEvaluationFactStatus, number> = {
  supported: 1,
  partial: 0.7,
  missing: 0,
  incorrect: 0,
};

interface CreateRunInput {
  knowledgeBaseId?: string;
  datasetId?: string;
  caseIds?: string[];
  fastModel: string;
  qualityModel: string;
  judgeModel: string;
}

interface ActiveJob {
  controller: AbortController;
  agentRunId: string;
}

interface JudgeFact {
  factId: string;
  status: AgentEvaluationFactStatus;
  evidenceIds: string[];
  reason: string;
  answerCovered: boolean;
  evidenceSupported: boolean;
}

interface JudgeResult {
  facts: JudgeFact[];
  abstainStatus: AgentEvaluationAbstainStatus;
  abstainReason: string;
  hallucinationLevel: AgentEvaluationHallucinationLevel;
  hallucinationReason: string;
}

@Injectable()
export class AgentEvaluationService {
  private readonly logger = new Logger(AgentEvaluationService.name);
  private readonly jobs = new Map<string, ActiveJob>();

  constructor(
    private readonly datasets: AgentEvaluationDatasetService,
    private readonly store: AgentEvaluationStoreService,
    private readonly agents: AgentRunExecutionService,
    private readonly wiki: LlmWikiNextToolsService,
    private readonly models: ModelService,
  ) {}

  listDatasets(knowledgeBaseId: string) {
    return { items: this.datasets.listDatasets(knowledgeBaseId) };
  }

  getDataset(knowledgeBaseId: string, datasetId: string) {
    return this.datasets.getDataset(knowledgeBaseId, datasetId);
  }

  uploadDataset(knowledgeBaseId: string, buffer: Buffer) {
    return this.datasets.upload(knowledgeBaseId, buffer);
  }

  deleteDataset(knowledgeBaseId: string, datasetId: string) {
    return this.datasets.delete(knowledgeBaseId, datasetId);
  }

  listRuns(knowledgeBaseId: string) {
    return { items: this.store.list(knowledgeBaseId) };
  }

  getRun(runId: string) {
    return this.store.get(runId);
  }

  createRun(input: CreateRunInput): AgentEvaluationRun {
    const knowledgeBaseId = String(input.knowledgeBaseId || "default").trim();
    const datasetId = String(input.datasetId || "").trim();
    const dataset = this.datasets.getRunnableDataset(knowledgeBaseId, datasetId);
    const fastModel = this.requireModel(input.fastModel, "fastModel");
    const qualityModel = this.requireModel(input.qualityModel, "qualityModel");
    const judgeModel = this.requireModel(input.judgeModel, "judgeModel");
    const available = new Set(dataset.cases.map((item) => item.id));
    const caseIds = input.caseIds?.length
      ? [...new Set(input.caseIds.map((item) => String(item || "").trim()))]
      : dataset.cases.map((item) => item.id);
    if (!caseIds.length) throw new BadRequestException("至少选择一道评测题");
    const unknown = caseIds.filter((caseId) => !available.has(caseId));
    if (unknown.length) {
      throw new BadRequestException(`评测题不存在: ${unknown.join(", ")}`);
    }
    const run = this.store.create({
      knowledgeBaseId,
      dataset,
      caseIds,
      fastModel,
      qualityModel,
      judgeModel,
    });
    const controller = new AbortController();
    this.jobs.set(run.runId, { controller, agentRunId: "" });
    void this.execute(run.runId, controller).finally(() =>
      this.jobs.delete(run.runId),
    );
    return run;
  }

  cancel(runId: string) {
    const run = this.store.get(runId);
    if (run.status !== "running")
      return { ok: false, runId, status: run.status };
    const job = this.jobs.get(runId);
    job?.controller.abort();
    if (job?.agentRunId) {
      try {
        this.agents.cancel("llmWiki", job.agentRunId);
      } catch (error) {
        this.logger.warn(`cancel child Agent failed: ${messageOf(error)}`);
      }
    }
    this.finishCancelled(runId);
    return { ok: true, runId, status: "cancelled" };
  }

  delete(runId: string) {
    return this.store.delete(runId);
  }

  private async execute(
    runId: string,
    controller: AbortController,
  ): Promise<void> {
    try {
      let run = this.store.get(runId);
      for (let index = 0; index < run.cases.length; index += 1) {
        if (controller.signal.aborted) return this.finishCancelled(runId);
        if (!this.revisionMatches(run.knowledgeBaseId, run.revisionId))
          return this.invalidate(runId);
        run.cases[index] = { ...run.cases[index], status: "running" };
        run.progress.currentCaseId = run.cases[index].caseId;
        this.store.save(run);
        const caseResult = await this.executeCase(
          run,
          run.cases[index],
          controller,
        );
        if (controller.signal.aborted) {
          this.finishCancelled(runId);
          return;
        }
        run = this.store.get(runId);
        if (run.status !== "running") return;
        run.cases[index] = caseResult;
        run.progress.completed = index + 1;
        run.progress.currentCaseId = "";
        run = this.store.save(run);
        if (run.cases[index].status === "invalidated")
          return this.invalidate(runId);
      }
      run.status = "completed";
      run.endedAt = new Date().toISOString();
      this.store.save(run);
    } catch (error) {
      const run = this.store.get(runId);
      if (controller.signal.aborted || run.status === "cancelled") {
        this.finishCancelled(runId);
        return;
      }
      run.status = "failed";
      run.endedAt = new Date().toISOString();
      run.progress.currentCaseId = "";
      run.errors.push(messageOf(error));
      this.store.save(run);
      this.logger.error(
        `Agent evaluation ${runId} failed: ${messageOf(error)}`,
      );
    }
  }

  private async executeCase(
    run: AgentEvaluationRun,
    item: AgentEvaluationCaseResult,
    controller: AbortController,
  ): Promise<AgentEvaluationCaseResult> {
    const started = Date.now();
    const execution = this.agents.start("llmWiki", {
      query: item.question,
      knowledgeBaseId: run.knowledgeBaseId,
      fastModel: run.fastModel,
      qualityModel: run.qualityModel,
    });
    const job = this.jobs.get(run.runId);
    if (job) job.agentRunId = execution.runId;
    item.agentRunId = execution.runId;
    let detail: AgentRunDetail;
    try {
      detail = await execution.done;
    } catch (error) {
      return failedCase(
        item,
        "execution_failed",
        messageOf(error),
        Date.now() - started,
      );
    } finally {
      if (job) job.agentRunId = "";
    }
    if (controller.signal.aborted || detail.status === "cancelled") {
      return failedCase(
        item,
        "execution_failed",
        "评测已取消",
        Date.now() - started,
      );
    }
    item.agentStatus = detail.status;
    item.answerMarkdown = answerOf(detail);
    item.readPageKeys = collectReadPageKeys(detail);
    item.metrics = agentMetrics(detail, Date.now() - started);
    if (!(["success", "insufficient"] as string[]).includes(detail.status)) {
      return failedCase(
        item,
        "execution_failed",
        detail.errors.join("；") || "Agent 执行失败",
        Date.now() - started,
        detail,
      );
    }
    item.verifiedEvidence = this.verifyEvidence(run.knowledgeBaseId, detail);
    if (!this.revisionMatches(run.knowledgeBaseId, run.revisionId)) {
      return {
        ...item,
        status: "invalidated",
        error: "Published Revision 已变化",
      };
    }

    let judged: { value: JudgeResult; attempts: number; tokens: number };
    try {
      judged = await this.judge(run, item, controller.signal);
    } catch (error) {
      const failed = failedCase(
        item,
        "judge_failed",
        `Judge 失败: ${messageOf(error)}`,
        Date.now() - started,
        detail,
      );
      failed.metrics.modelCalls += 2;
      failed.metrics.retries += 1;
      if (error instanceof ModelRequestError && error.category === "timeout") {
        failed.metrics.timeouts += 1;
      }
      return failed;
    }
    item.metrics.durationMs = Date.now() - started;
    item.metrics.modelCalls += judged.attempts;
    item.metrics.retries += judged.attempts - 1;
    item.metrics.totalTokens += judged.tokens;
    item.status = "judged";
    item.abstainStatus = judged.value.abstainStatus;
    item.abstainReason = judged.value.abstainReason;
    item.hallucinationLevel = judged.value.hallucinationLevel;
    item.hallucinationReason = judged.value.hallucinationReason;
    item.facts = item.requiredFacts.map((fact) => {
      const result = judged.value.facts.find(
        (candidate) => candidate.factId === fact.id,
      )!;
      return {
        ...fact,
        status: result.status,
        score: FACT_SCORE[result.status],
        evidenceIds: result.evidenceIds,
        reason: result.reason,
        failureStage: failureStage(item, fact.evidence.pageKey, result),
      };
    });
    item.caseScore = item.answerable
      ? scoreAnswerableCase(item.facts, item.hallucinationLevel)
      : scoreAbstainCase(item.abstainStatus);
    return item;
  }

  private async judge(
    run: AgentEvaluationRun,
    item: AgentEvaluationCaseResult,
    signal: AbortSignal,
  ): Promise<{ value: JudgeResult; attempts: number; tokens: number }> {
    let lastError: unknown;
    let tokens = 0;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (signal.aborted) throw new Error("评测已取消");
      try {
        const response = await withTimeout(
          signal,
          JUDGE_TIMEOUT_MS,
          (judgeSignal) =>
            this.models.respond({
              model: run.judgeModel,
              signal: judgeSignal,
              maxOutputTokens: 12_000,
              textFormat: judgeFormat(),
              messages: [
                { role: "system", content: judgeInstructions() },
                {
                  role: "user",
                  content: JSON.stringify({
                    question: item.question,
                    expectedAnswer: item.expectedAnswer,
                    requiredFacts: item.requiredFacts,
                    agentAnswer: item.answerMarkdown,
                    verifiedEvidence: item.verifiedEvidence,
                  }),
                },
              ],
            }),
        );
        tokens += Number(response.usage?.total_tokens || 0);
        return {
          value: validateJudge(JSON.parse(response.content) as unknown, item),
          attempts: attempt,
          tokens,
        };
      } catch (error) {
        lastError = error;
        if (error instanceof ModelRequestError) {
          tokens += Number(error.usage?.total_tokens || 0);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Judge 输出无效");
  }

  private verifyEvidence(
    knowledgeBaseId: string,
    detail: AgentRunDetail,
  ): AgentEvaluationVerifiedEvidence[] {
    const raw = Array.isArray(detail.resultJson?.verifiedEvidence)
      ? detail.resultJson?.verifiedEvidence
      : [];
    const pages = new Map<string, string>();
    const out: AgentEvaluationVerifiedEvidence[] = [];
    for (const value of raw) {
      const item = asRecord(value);
      if (item.kind !== "page") continue;
      const evidenceId = text(item.evidenceId);
      const pageKey = text(item.pageKey || item.path);
      const quote = text(item.quote);
      const claim = text(item.claim);
      if (!evidenceId || !pageKey || !quote || !claim) continue;
      try {
        let body = pages.get(pageKey);
        if (body === undefined) {
          body = this.wiki.readPage(knowledgeBaseId, pageKey).page.bodyMarkdown;
          pages.set(pageKey, body);
        }
        if (body.includes(quote))
          out.push({ evidenceId, pageKey, quote, claim });
      } catch {
        // Invalid evidence is intentionally dropped before Judge.
      }
    }
    return uniqueBy(out, (item) => item.evidenceId);
  }

  private requireModel(value: string, field: string): string {
    const model = String(value || "").trim();
    if (!model || !this.models.findModel(model)) {
      throw new BadRequestException(`${field} 不是已配置模型`);
    }
    return model;
  }

  private revisionMatches(knowledgeBaseId: string, revisionId: string): boolean {
    try {
      return this.wiki.getPublishedIdentity(knowledgeBaseId).revisionId === revisionId;
    } catch {
      return false;
    }
  }

  private invalidate(runId: string): void {
    const run = this.store.get(runId);
    run.status = "invalidated";
    run.endedAt = new Date().toISOString();
    run.progress.currentCaseId = "";
    run.cases = run.cases.map((item) => ({
      ...item,
      status: ["pending", "running"].includes(item.status)
        ? "invalidated"
        : item.status,
      caseScore: null,
      error: ["pending", "running"].includes(item.status)
        ? "Published Revision 已变化"
        : item.error,
    }));
    run.errors.push("Published Revision 已变化，本次评测不生成分数");
    this.store.save(run);
  }

  private finishCancelled(runId: string): void {
    const run = this.store.get(runId);
    if (run.status !== "running") return;
    run.status = "cancelled";
    run.endedAt = new Date().toISOString();
    run.progress.currentCaseId = "";
    run.cases = run.cases.map((item) =>
      ["pending", "running"].includes(item.status)
        ? { ...item, status: "execution_failed", error: "评测已取消" }
        : item,
    );
    this.store.save(run);
  }
}

function judgeInstructions(): string {
  return [
    "你是严格但不过度苛刻的 Agent 评测 Judge。只能读取用户提供的五类字段。",
    "逐条判断 requiredFacts：supported=答案正确且证据支持；partial=核心正确但非核心条件、数字或证据不完整；missing=未回答；incorrect=明确冲突。",
    "不要因措辞不同、没有命中 Gold pageKey 或答案更简洁而扣分，只要 verifiedEvidence 中其他 Published 页面证据足够即可。",
    "answerCovered 表示最终答案是否表达该事实；evidenceSupported 表示 verifiedEvidence 是否足以支持。",
    "拒答题：正确说明资料不足且无编造=correct；有少量无依据推测=partial；编造具体答案=incorrect。",
    "material 表示重要事实编造；safety 表示安全参数严重错误；已标 incorrect 的同一事实不要重复作为 hallucination 扣分。",
    "严格按 JSON Schema 输出，不添加额外字段。",
  ].join("\n");
}

function judgeFormat() {
  return {
    type: "json_schema" as const,
    name: "agent_evaluation_judge_v2",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "facts",
        "abstainStatus",
        "abstainReason",
        "hallucinationLevel",
        "hallucinationReason",
      ],
      properties: {
        facts: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "factId",
              "status",
              "evidenceIds",
              "reason",
              "answerCovered",
              "evidenceSupported",
            ],
            properties: {
              factId: { type: "string" },
              status: {
                type: "string",
                enum: ["supported", "partial", "missing", "incorrect"],
              },
              evidenceIds: { type: "array", items: { type: "string" } },
              reason: { type: "string" },
              answerCovered: { type: "boolean" },
              evidenceSupported: { type: "boolean" },
            },
          },
        },
        abstainStatus: {
          type: "string",
          enum: ["correct", "partial", "incorrect", "not_applicable"],
        },
        abstainReason: { type: "string" },
        hallucinationLevel: {
          type: "string",
          enum: ["none", "material", "safety"],
        },
        hallucinationReason: { type: "string" },
      },
    },
  };
}

function validateJudge(
  value: unknown,
  item: AgentEvaluationCaseResult,
): JudgeResult {
  const raw = asRecord(value);
  const facts = Array.isArray(raw.facts) ? raw.facts.map(parseJudgeFact) : [];
  const expectedIds = item.requiredFacts.map((fact) => fact.id).sort();
  const actualIds = facts.map((fact) => fact.factId).sort();
  if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds)) {
    throw new Error("Judge facts 与 requiredFacts 不一致");
  }
  const validEvidenceIds = new Set(
    item.verifiedEvidence.map((evidence) => evidence.evidenceId),
  );
  for (const fact of facts) {
    if (
      fact.evidenceIds.some((evidenceId) => !validEvidenceIds.has(evidenceId))
    ) {
      throw new Error(`Judge 引用了未验证证据: ${fact.factId}`);
    }
    if (fact.status === "supported" && !fact.evidenceSupported) {
      throw new Error(`Judge 将无证据事实判为 supported: ${fact.factId}`);
    }
  }
  const abstainStatus = enumValue(raw.abstainStatus, [
    "correct",
    "partial",
    "incorrect",
    "not_applicable",
  ] as const);
  if (item.answerable && abstainStatus !== "not_applicable") {
    throw new Error("可回答题的 abstainStatus 必须是 not_applicable");
  }
  if (!item.answerable && abstainStatus === "not_applicable") {
    throw new Error("拒答题必须给出 abstainStatus");
  }
  return {
    facts,
    abstainStatus,
    abstainReason: text(raw.abstainReason),
    hallucinationLevel: enumValue(raw.hallucinationLevel, [
      "none",
      "material",
      "safety",
    ] as const),
    hallucinationReason: text(raw.hallucinationReason),
  };
}

function parseJudgeFact(value: unknown): JudgeFact {
  const raw = asRecord(value);
  if (
    typeof raw.answerCovered !== "boolean" ||
    typeof raw.evidenceSupported !== "boolean"
  ) {
    throw new Error("Judge fact 布尔字段非法");
  }
  return {
    factId: text(raw.factId),
    status: enumValue(raw.status, [
      "supported",
      "partial",
      "missing",
      "incorrect",
    ] as const),
    evidenceIds: Array.isArray(raw.evidenceIds)
      ? raw.evidenceIds.map(text).filter(Boolean)
      : [],
    reason: text(raw.reason),
    answerCovered: raw.answerCovered,
    evidenceSupported: raw.evidenceSupported,
  };
}

export function classifyFailureStage(
  status: AgentEvaluationFactStatus,
  evidenceSupported: boolean,
  answerCovered: boolean,
  goldPageKey: string,
  readPageKeys: string[],
) {
  if (status === "supported") return null;
  if (status === "incorrect") return "incorrect_answer" as const;
  if (evidenceSupported) return "final_answer_miss" as const;
  if (readPageKeys.includes(goldPageKey))
    return "evidence_extraction_miss" as const;
  return "retrieval_miss" as const;
}

function failureStage(
  item: AgentEvaluationCaseResult,
  goldPageKey: string,
  fact: JudgeFact,
) {
  return classifyFailureStage(
    fact.status,
    fact.evidenceSupported,
    fact.answerCovered,
    goldPageKey,
    item.readPageKeys,
  );
}

function failedCase(
  item: AgentEvaluationCaseResult,
  status: "execution_failed" | "judge_failed",
  error: string,
  durationMs: number,
  detail?: AgentRunDetail,
): AgentEvaluationCaseResult {
  return {
    ...item,
    status,
    agentStatus: detail?.status || item.agentStatus,
    answerMarkdown: detail ? answerOf(detail) : item.answerMarkdown,
    facts: item.requiredFacts.map(
      (fact): AgentEvaluationFactResult => ({
        ...fact,
        status: "missing",
        score: 0,
        evidenceIds: [],
        reason: error,
        failureStage: "execution_failure",
      }),
    ),
    caseScore: null,
    metrics: detail
      ? agentMetrics(detail, durationMs)
      : { ...item.metrics, durationMs },
    error,
  };
}

function answerOf(detail: AgentRunDetail): string {
  return text(detail.resultJson?.answerMarkdown) || detail.resultMd || "";
}

function collectReadPageKeys(detail: AgentRunDetail): string[] {
  const keys: string[] = [];
  const snippets = Array.isArray(detail.resultJson?.knowledgeSnippets)
    ? detail.resultJson?.knowledgeSnippets
    : [];
  for (const value of snippets) {
    const item = asRecord(value);
    const pageKey = text(item.pageKey || item.path);
    if (pageKey) keys.push(pageKey);
  }
  for (const event of detail.events) {
    if (event.type !== "tool_response") continue;
    collectPageKeys(event.response, keys);
  }
  return [...new Set(keys)];
}

function collectPageKeys(value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectPageKeys(item, out);
    return;
  }
  if (!value || typeof value !== "object") return;
  const raw = value as Record<string, unknown>;
  const pageKey = text(raw.pageKey);
  if (pageKey) out.push(pageKey);
  for (const child of Object.values(raw)) collectPageKeys(child, out);
}

function agentMetrics(detail: AgentRunDetail, durationMs: number) {
  const retries = detail.events.filter((event) =>
    ["model_retry", "model_json_retry"].includes(event.type),
  ).length;
  const timeouts = detail.events.filter(isTimeoutEvent).length;
  return {
    durationMs,
    totalTokens: Number(detail.tokens?.totalTokens || 0),
    modelCalls: Number(
      detail.tokens?.modelCalls || detail.stats?.modelCalls || 0,
    ),
    readPages: Number(detail.stats?.pages || 0),
    searches: Number(detail.stats?.searches || 0),
    retries,
    timeouts,
    stopReason: text(detail.resultJson?.stopReason),
  };
}

function isTimeoutEvent(event: AgentRunEvent): boolean {
  const value = JSON.stringify(event).toLowerCase();
  return event.type === "model_error" && value.includes("timeout");
}

async function withTimeout<T>(
  parent: AbortSignal,
  timeoutMs: number,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason);
  parent.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("Judge timeout")),
    timeoutMs,
  );
  try {
    return await task(controller.signal);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort", abort);
  }
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] {
  const target = text(value);
  if (!allowed.includes(target)) throw new Error(`Judge 枚举值非法: ${target}`);
  return target as T[number];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
