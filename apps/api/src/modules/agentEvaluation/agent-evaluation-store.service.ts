import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  ensureDir,
  nowIso,
  randomId,
  readJson,
  writeJson,
} from "../../common/fs-json";
import { getDataRoot } from "../../config/data-root";
import {
  AGENT_EVALUATION_SCHEMA_VERSION,
  AgentEvaluationCaseMetrics,
  AgentEvaluationCaseResult,
  AgentEvaluationDataset,
  AgentEvaluationRun,
  AgentEvaluationRunSummary,
  AgentEvaluationSummary,
} from "./agent-evaluation.types";

@Injectable()
export class AgentEvaluationStoreService implements OnModuleInit {
  private readonly root = path.join(
    getDataRoot(),
    "evaluations",
    "llm-wiki-agent",
    "runs",
  );

  onModuleInit(): void {
    ensureDir(this.root);
    for (const run of this.readAll()) {
      if (run.status !== "running") continue;
      this.save({
        ...run,
        status: "failed",
        endedAt: nowIso(),
        progress: { ...run.progress, currentCaseId: "" },
        cases: run.cases.map((item) =>
          item.status === "running"
            ? {
                ...item,
                status: "execution_failed",
                error: "服务重启，当前题目未完成",
              }
            : item,
        ),
        errors: [...run.errors, "服务重启，未完成的评测已终止"],
      });
    }
  }

  create(args: {
    knowledgeBaseId: string;
    dataset: AgentEvaluationDataset;
    caseIds: string[];
    fastModel: string;
    qualityModel: string;
    judgeModel: string;
  }): AgentEvaluationRun {
    const selected = new Set(args.caseIds);
    const cases = args.dataset.cases
      .filter((item) => selected.has(item.id))
      .map(createCaseResult);
    const run: AgentEvaluationRun = {
      schemaVersion: AGENT_EVALUATION_SCHEMA_VERSION,
      runId: randomId(),
      knowledgeBaseId: args.knowledgeBaseId,
      datasetId: args.dataset.datasetId,
      datasetName: args.dataset.name,
      datasetHash: args.dataset.datasetHash,
      revisionId: args.dataset.revisionId,
      fastModel: args.fastModel,
      qualityModel: args.qualityModel,
      judgeModel: args.judgeModel,
      status: "running",
      startedAt: nowIso(),
      endedAt: "",
      progress: { completed: 0, total: cases.length, currentCaseId: "" },
      cases,
      summary: summarizeAgentEvaluation(cases),
      errors: [],
    };
    this.save(run);
    return run;
  }

  get(runId: string): AgentEvaluationRun {
    const run = readJson<AgentEvaluationRun | null>(this.file(runId), null);
    if (!run || run.schemaVersion !== AGENT_EVALUATION_SCHEMA_VERSION) {
      throw new NotFoundException("Agent 评测记录不存在");
    }
    return normalizeKnowledgeBase(run);
  }

  list(knowledgeBaseId?: string): AgentEvaluationRunSummary[] {
    return this.readAll()
      .filter((run) => !knowledgeBaseId || run.knowledgeBaseId === knowledgeBaseId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map(({ cases: _cases, ...summary }) => summary);
  }

  save(run: AgentEvaluationRun): AgentEvaluationRun {
    const next = { ...run, summary: summarizeAgentEvaluation(run.cases) };
    writeJson(this.file(next.runId), next);
    return next;
  }

  delete(runId: string): { ok: true; runId: string } {
    const run = this.get(runId);
    if (run.status === "running") {
      throw new BadRequestException("运行中的评测不能删除");
    }
    fs.unlinkSync(this.file(runId));
    return { ok: true, runId };
  }

  private readAll(): AgentEvaluationRun[] {
    if (!fs.existsSync(this.root)) return [];
    return fs
      .readdirSync(this.root)
      .filter((name) => /^[a-f0-9]{32}\.json$/.test(name))
      .map((name) =>
        readJson<AgentEvaluationRun | null>(path.join(this.root, name), null),
      )
      .filter((run): run is AgentEvaluationRun =>
        Boolean(run && run.schemaVersion === AGENT_EVALUATION_SCHEMA_VERSION),
      )
      .map(normalizeKnowledgeBase);
  }

  private file(runId: string): string {
    const safe = String(runId || "").trim();
    if (!/^[a-f0-9]{32}$/.test(safe))
      throw new BadRequestException("runId 非法");
    return path.join(this.root, `${safe}.json`);
  }
}

function normalizeKnowledgeBase(run: AgentEvaluationRun): AgentEvaluationRun {
  return run.knowledgeBaseId ? run : { ...run, knowledgeBaseId: "default" };
}

export function summarizeAgentEvaluation(
  cases: AgentEvaluationCaseResult[],
): AgentEvaluationSummary {
  const judged = cases.filter((item) => item.status === "judged");
  const executable = cases.filter((item) =>
    ["judged", "judge_failed"].includes(item.status),
  );
  const facts = judged.flatMap((item) => item.facts);
  const abstain = judged.filter((item) => !item.answerable);
  const scored = judged.filter((item) => item.caseScore !== null);
  const enoughValid = cases.length > 0 && scored.length / cases.length >= 0.8;
  const overallScore = enoughValid
    ? round(
        scored.reduce((sum, item) => sum + (item.caseScore || 0), 0) /
          scored.length,
      )
    : null;
  const durations = cases
    .map((item) => item.metrics.durationMs)
    .filter((duration) => duration > 0);
  const countStage = (stage: string) =>
    cases
      .flatMap((item) => item.facts)
      .filter((fact) => fact.failureStage === stage).length;
  return {
    totalCases: cases.length,
    validCases: scored.length,
    supportedFacts: facts.filter((item) => item.status === "supported").length,
    partialFacts: facts.filter((item) => item.status === "partial").length,
    missingFacts: facts.filter((item) => item.status === "missing").length,
    incorrectFacts: facts.filter((item) => item.status === "incorrect").length,
    abstainCorrect: abstain.filter((item) => item.abstainStatus === "correct")
      .length,
    abstainTotal: abstain.length,
    abstainAccuracy: abstain.length
      ? round(
          abstain.reduce(
            (sum, item) =>
              sum +
              (item.abstainStatus === "correct"
                ? 1
                : item.abstainStatus === "partial"
                  ? 0.7
                  : 0),
            0,
          ) / abstain.length,
        )
      : null,
    materialHallucinationCount: judged.filter(
      (item) => item.hallucinationLevel !== "none",
    ).length,
    overallScore,
    passLevel:
      overallScore === null
        ? "unavailable"
        : overallScore >= 85
          ? "excellent"
          : overallScore >= 75
            ? "acceptable"
            : "needs_improvement",
    executionSuccessRate: cases.length
      ? round(executable.length / cases.length)
      : 0,
    totalTokens: sumMetrics(cases, "totalTokens"),
    totalModelCalls: sumMetrics(cases, "modelCalls"),
    totalReadPages: sumMetrics(cases, "readPages"),
    totalSearches: sumMetrics(cases, "searches"),
    totalRetries: sumMetrics(cases, "retries"),
    totalTimeouts: sumMetrics(cases, "timeouts"),
    averageDurationMs: durations.length
      ? Math.round(
          durations.reduce((sum, value) => sum + value, 0) / durations.length,
        )
      : 0,
    failureBreakdown: {
      retrievalMiss: countStage("retrieval_miss"),
      evidenceExtractionMiss: countStage("evidence_extraction_miss"),
      finalAnswerMiss: countStage("final_answer_miss"),
      incorrectAnswer: countStage("incorrect_answer"),
      executionFailure:
        countStage("execution_failure") +
        cases.filter(
          (item) =>
            item.requiredFacts.length === 0 &&
            ["execution_failed", "judge_failed"].includes(item.status),
        ).length,
    },
  };
}

export function scoreAnswerableCase(
  facts: AgentEvaluationCaseResult["facts"],
  hallucinationLevel: AgentEvaluationCaseResult["hallucinationLevel"],
): number {
  if (!facts.length) return 0;
  const raw =
    (facts.reduce((sum, fact) => sum + fact.score, 0) / facts.length) * 100;
  const cap =
    hallucinationLevel === "safety"
      ? 40
      : hallucinationLevel === "material"
        ? 60
        : 100;
  return round(Math.min(raw, cap));
}

export function scoreAbstainCase(status: string): number {
  return status === "correct" ? 100 : status === "partial" ? 70 : 0;
}

function createCaseResult(
  item: AgentEvaluationDataset["cases"][number],
): AgentEvaluationCaseResult {
  return {
    caseId: item.id,
    question: item.question,
    answerable: item.answerable,
    expectedAnswer: item.expectedAnswer,
    requiredFacts: item.requiredFacts,
    evaluationType: item.evaluationType,
    status: "pending",
    agentRunId: "",
    agentStatus: "",
    answerMarkdown: "",
    verifiedEvidence: [],
    readPageKeys: [],
    facts: [],
    abstainStatus: "not_applicable",
    abstainReason: "",
    hallucinationLevel: "none",
    hallucinationReason: "",
    caseScore: null,
    metrics: emptyMetrics(),
    error: "",
  };
}

function emptyMetrics(): AgentEvaluationCaseMetrics {
  return {
    durationMs: 0,
    totalTokens: 0,
    modelCalls: 0,
    readPages: 0,
    searches: 0,
    retries: 0,
    timeouts: 0,
    stopReason: "",
  };
}

function sumMetrics(
  cases: AgentEvaluationCaseResult[],
  key: keyof AgentEvaluationCaseMetrics,
): number {
  return cases.reduce((sum, item) => sum + Number(item.metrics[key] || 0), 0);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
