import { Injectable, Logger } from "@nestjs/common";
import { nowIso, sha256 } from "../../../common/fs-json";
import type { LlmWikiRetrievalManifest } from "../../llmWiki/contracts/llm-wiki-retrieval.types";
import { LlmWikiRetrievalService } from "../../llmWiki/services/llm-wiki-retrieval.service";
import { ModelService } from "../../model/model.service";
import type {
  CompileEvaluationCaseResult,
  CompileEvaluationDataset,
  CompileEvaluationDatasetCase,
  CompileEvaluationExpectedFact,
  CompileEvaluationFactResult,
  CompileEvaluationFactStatus,
  CompileEvaluationFactImportance,
  CompileEvaluationMatchedSource,
  CompileEvaluationPassLevel,
  CompileEvaluationRun,
  CompileEvaluationUsage,
  CompileEvaluationWikiSnapshot,
} from "../evaluation.types";
import { CompileEvaluationStoreService, emptySummary } from "./compile-evaluation-store.service";

interface JudgeOutput {
  facts?: Array<{
    factId?: unknown;
    status?: unknown;
    evidencePath?: unknown;
    evidence?: unknown;
    wikiEvidence?: unknown;
    reason?: unknown;
    confidence?: unknown;
  }>;
}

interface JudgeResult {
  facts: CompileEvaluationFactResult[];
  usage: CompileEvaluationUsage;
}

class JudgeExecutionError extends Error {
  constructor(message: string, readonly usage: CompileEvaluationUsage) {
    super(message);
  }
}

const DEFAULT_COMPILE_EVALUATION_CONCURRENCY = positiveInt(process.env.COMPILE_EVALUATION_CONCURRENCY, 20);

@Injectable()
export class CompileEvaluationService {
  private readonly logger = new Logger(CompileEvaluationService.name);

  constructor(
    private readonly store: CompileEvaluationStoreService,
    private readonly retrieval: LlmWikiRetrievalService,
    private readonly model: ModelService,
  ) {}

  createRun(input: unknown, retryOfRunId = "") {
    const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const dataset = this.store.getDataset(stringField(raw.datasetId));
    const requested = Array.isArray(raw.caseIds) ? raw.caseIds.map(stringField).filter(Boolean) : [];
    const available = new Set(dataset.cases.map((item) => item.id));
    const caseIds = requested.length ? [...new Set(requested)] : dataset.cases.map((item) => item.id);
    if (!caseIds.length) throw new Error("请选择至少一个评测 case");
    for (const caseId of caseIds) {
      if (!available.has(caseId)) throw new Error(`case 不存在: ${caseId}`);
    }
    const judgeModel = this.model.resolveModel(stringField(raw.judgeModel));
    if (!judgeModel) throw new Error("未配置 Judge 模型");
    const workerCount = Math.min(50, positiveInt(raw.concurrency, DEFAULT_COMPILE_EVALUATION_CONCURRENCY));
    const snapshot = this.freezeWikiSnapshot();
    const run = this.store.createRun({
      dataset,
      caseIds,
      judgeModel,
      datasetHash: sha256(JSON.stringify(dataset)),
      snapshot,
      workerCount,
      retryOfRunId,
    });
    void this.execute(run.runId, dataset).catch((error) => {
      this.logger.error(`compile evaluation ${run.runId} failed: ${formatError(error)}`);
    });
    return run;
  }

  retryFailed(runId: string, input: unknown) {
    const previous = this.store.getRun(runId);
    if (previous.status === "running") throw new Error("运行中的评测不能重跑失败 case");
    const failedCaseIds = previous.cases
      .filter((item) => item.status === "evaluation_failed" || item.status === "failed")
      .map((item) => item.caseId);
    if (!failedCaseIds.length) throw new Error("当前评测没有可重跑的失败 case");
    const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    return this.createRun(
      {
        datasetId: previous.datasetId,
        caseIds: failedCaseIds,
        judgeModel: stringField(raw.judgeModel) || previous.judgeModel,
        concurrency: raw.concurrency ?? previous.workerCount,
      },
      previous.runId,
    );
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

  private async execute(runId: string, dataset: CompileEvaluationDataset): Promise<void> {
    let run = this.store.getRun(runId);
    try {
      const snapshot = this.store.getSnapshot(runId);
      const caseOrder = new Map(run.caseIds.map((caseId, index) => [caseId, index]));
      const cases: CompileEvaluationCaseResult[] = [];
      let nextIndex = 0;
      const workerCount = Math.min(run.workerCount, run.caseIds.length);
      const worker = async () => {
        while (nextIndex < run.caseIds.length) {
          const caseId = run.caseIds[nextIndex];
          nextIndex += 1;
          if (!caseId) continue;
          const testCase = dataset.cases.find((item) => item.id === caseId);
          if (!testCase) continue;
          const result = await this.evaluateCaseSafely(dataset, testCase, run.judgeModel, snapshot);
          cases.push(result);
          cases.sort((a, b) => (caseOrder.get(a.caseId) ?? 0) - (caseOrder.get(b.caseId) ?? 0));
          run = this.store.saveRun({
            ...run,
            cases: [...cases],
            progress: {
              completed: cases.length,
              total: run.progress.total,
              currentCaseId: caseId,
            },
            summary: summarize(cases),
            usage: summarizeUsage(cases),
          });
        }
      };
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
      const summary = summarize(cases);
      this.store.saveRun({
        ...run,
        status: summary.failedCases ? "partial" : "success",
        endedAt: nowIso(),
        progress: { ...run.progress, currentCaseId: "" },
        summary,
        usage: summarizeUsage(cases),
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

  private async evaluateCaseSafely(
    dataset: CompileEvaluationDataset,
    testCase: CompileEvaluationDatasetCase,
    judgeModel: string,
    snapshot: CompileEvaluationWikiSnapshot,
  ): Promise<CompileEvaluationCaseResult> {
    try {
      return await this.evaluateCase(dataset, testCase, judgeModel, snapshot);
    } catch (error) {
      return failedCaseResult(
        testCase,
        formatError(error),
        error instanceof JudgeExecutionError ? error.usage : emptyUsage(),
      );
    }
  }

  private async evaluateCase(
    dataset: CompileEvaluationDataset,
    testCase: CompileEvaluationDatasetCase,
    judgeModel: string,
    snapshot: CompileEvaluationWikiSnapshot,
  ): Promise<CompileEvaluationCaseResult> {
    const sources = testCase.sourceIds.map((id) => dataset.sources.find((item) => item.id === id)!);
    const matchedSources = sources.map((source): CompileEvaluationMatchedSource => {
      const matched = snapshot.sources
        .filter((item) => isEvaluableSourceStatus(item.status) && item.sha256 === source.sha256)
        .sort((a, b) => b.ingestedAt.localeCompare(a.ingestedAt))[0];
      return {
        datasetSourceId: source.id,
        filename: source.filename,
        sha256: source.sha256,
        sourceId: matched?.sourceId || null,
        ingestedAt: matched?.ingestedAt || "",
      };
    });
    const missing = matchedSources.filter((item) => !item.sourceId);
    if (missing.length) {
      return {
        caseId: testCase.id,
        name: testCase.name,
        status: "source_missing",
        matchedSources,
        pagePaths: [],
        facts: testCase.expectedFacts.map((fact) => ({
          ...fact,
          ...normalizeExpectedFactForResult(fact),
          status: "missing",
          evidencePath: "",
          wikiEvidence: "",
          reason: `未找到已编译 source: ${missing.map((item) => item.filename).join(", ")}`,
          confidence: 0,
          weight: factWeight(fact.importance),
          score: 0,
          coveredByClaims: false,
          judgeNeedsReview: false,
          unsupportedCorrect: false,
        })),
        usage: emptyUsage(),
        error: "",
      };
    }

    const matchedIds = new Set(matchedSources.map((item) => item.sourceId).filter(Boolean) as string[]);
    const pages = snapshot.pages.filter(
      (page) => page.path !== "index.md" && page.sourceIds.some((sourceId) => matchedIds.has(sourceId)),
    );
    const pagePathSet = new Set(pages.map((page) => page.path));
    const pageClaims = snapshot.pageClaims.filter((claim) => pagePathSet.has(claim.path));
    const claimedFactIds = new Set(pageClaims.flatMap((claim) => claim.factIds));
    const ledgerFacts = snapshot.facts.filter(
      (fact) => matchedIds.has(fact.sourceId) && claimedFactIds.has(fact.factId),
    );
    const coveredByClaims = new Map(
      testCase.expectedFacts.map((fact) => [fact.id, expectedFactCoveredByClaims(fact, ledgerFacts)] as const),
    );
    let judged: JudgeResult;
    try {
      judged = await this.judge({
        model: judgeModel,
        testCase,
        sources: sources.map(({ id, filename, content }) => ({ id, filename, content })),
        pages: pages.map(({ path, title, content }) => ({ path, title, content })),
      });
    } catch (error) {
      return failedCaseResult(
        testCase,
        formatError(error),
        error instanceof JudgeExecutionError ? error.usage : emptyUsage(),
        matchedSources,
        pages.map((page) => page.path),
      );
    }
    const facts = judged.facts.map((fact) =>
      finalizeJudgeFact({
        fact,
        coveredByClaims: coveredByClaims.get(fact.id) || false,
        pages: pages.map(({ path, content }) => ({ path, content })),
      }),
    );
    return {
      caseId: testCase.id,
      name: testCase.name,
      status: "success",
      matchedSources,
      pagePaths: pages.map((page) => page.path),
      facts,
      usage: judged.usage,
      error: "",
    };
  }

  private freezeWikiSnapshot(): CompileEvaluationWikiSnapshot {
    let lastError = "";
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const before = this.retrieval.getManifest();
        const readPages = () => before.pages
          .filter((page) => page.path !== "index.md")
          .map((page) => this.retrieval.readPage(page.path))
          .map((page) => ({ path: page.path, title: page.title, content: page.content, sourceIds: page.sources }));
        const readClaims = (pagePaths: string[]) => pagePaths
          .map((pagePath) => this.retrieval.readPageClaims(pagePath))
          .filter((claim): claim is NonNullable<typeof claim> => !!claim)
          .map((claim) => ({ path: claim.path, factIds: claim.factIds, sourceIds: claim.sourceIds }));
        const readFacts = () => this.retrieval.listFacts().map((fact) => ({
          factId: fact.factId,
          sourceId: fact.sourceId,
          fact: fact.fact,
          evidence: fact.evidence,
          entities: fact.entities,
          type: fact.type,
        }));
        const pages = readPages();
        const pagePaths = pages.map((page) => page.path);
        const pageClaims = readClaims(pagePaths);
        const facts = readFacts();
        const pagesCheck = readPages();
        const pageClaimsCheck = readClaims(pagePaths);
        const factsCheck = readFacts();
        const after = this.retrieval.getManifest();
        if (
          manifestHash(before) !== manifestHash(after) ||
          sha256(JSON.stringify({ pages, pageClaims, facts })) !==
            sha256(JSON.stringify({ pages: pagesCheck, pageClaims: pageClaimsCheck, facts: factsCheck }))
        ) {
          lastError = "冻结期间 Wiki 页面、claims 或 facts 发生变化";
          continue;
        }
        const payload = {
          createdAt: nowIso(),
          sources: before.sources.map((source) => ({
            sourceId: source.source_id,
            filename: source.filename,
            status: source.status,
            sha256: source.sha256,
            ingestedAt: source.ingested_at,
            compilerVersion: source.compiler_version || "legacy-unknown",
            promptVersion: source.prompt_version || "legacy-unknown",
            compileModel: source.compile_model || "unknown",
          })),
          pages,
          pageClaims,
          facts,
        };
        return { ...payload, snapshotHash: sha256(JSON.stringify(payload)) };
      } catch (error) {
        lastError = formatError(error);
      }
    }
    throw new Error(`无法冻结一致的 Wiki 快照: ${lastError || "unknown"}`);
  }

  private async judge(args: {
    model: string;
    testCase: CompileEvaluationDatasetCase;
    sources: Array<{ id: string; filename: string; content: string }>;
    pages: Array<{ path: string; title: string; content: string }>;
  }): Promise<JudgeResult> {
    let response: unknown;
    try {
      response = await this.model.chat({
        model: args.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "你是 LLM Wiki 编译结果评测器。",
              "只判断最终 Wiki 是否正确保留 expectedFacts，不评价文风、页面结构或原始文档本身。",
              "originalSources 与 expectedFacts.evidence 只用于理解原文依据；判定 correct 必须来自 finalWikiPages。",
              "status 只能是 correct、missing、incorrect。",
              "correct: Wiki 明确支持该事实；missing: Wiki 未包含足够信息；incorrect: Wiki 对该事实给出冲突或错误描述。",
              "每条事实必须返回 finalWikiPages 中最能支持判断的 evidencePath 与 wikiEvidence；找不到则留空。",
              "confidence 是 0 到 1 的数字，表示你对该判断的置信度。",
              "只输出 JSON，不输出 Markdown。",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify(
              {
                output_schema: {
                  facts: "array of {factId,status,evidencePath,wikiEvidence,reason,confidence}",
                },
                case: { id: args.testCase.id, name: args.testCase.name },
                expectedFacts: args.testCase.expectedFacts,
                originalSources: args.sources,
                finalWikiPages: args.pages,
              },
              null,
              2,
            ),
          },
        ],
      });
    } catch (error) {
      throw new JudgeExecutionError(formatError(error), { ...emptyUsage(), modelCalls: 1 });
    }
    const usage = extractUsage(response);
    try {
      const output = parseJudgeOutput(extractContent(response));
      const byId = new Map((output.facts || []).map((item) => [stringField(item.factId), item]));
      return {
        usage,
        facts: args.testCase.expectedFacts.map((fact) => {
          const item = byId.get(fact.id);
          const status = item ? normalizeFactStatus(item.status) : "missing";
          const weight = factWeight(fact.importance);
          return {
            ...fact,
            ...normalizeExpectedFactForResult(fact),
            status,
            evidencePath: stringField(item?.evidencePath),
            wikiEvidence: stringField(item?.wikiEvidence) || stringField(item?.evidence),
            reason: stringField(item?.reason) || (item ? "" : "Judge 未返回该事实的判断"),
            confidence: numberOrNull(item?.confidence),
            weight,
            score: status === "correct" ? weight : 0,
            coveredByClaims: false,
            judgeNeedsReview: false,
            unsupportedCorrect: false,
          };
        }),
      };
    } catch (error) {
      throw new JudgeExecutionError(formatError(error), usage);
    }
  }
}

function finalizeJudgeFact(args: {
  fact: CompileEvaluationFactResult;
  coveredByClaims: boolean;
  pages: Array<{ path: string; content: string }>;
}): CompileEvaluationFactResult {
  const evidenceHits =
    args.fact.status !== "correct" ||
    Boolean(
      args.fact.evidencePath &&
      args.fact.wikiEvidence &&
      wikiEvidenceHitsPages(args.fact.wikiEvidence, args.fact.evidencePath, args.pages),
    );
  if (!evidenceHits) {
    return {
      ...args.fact,
      status: "missing",
      score: 0,
      coveredByClaims: args.coveredByClaims,
      judgeNeedsReview: true,
      unsupportedCorrect: true,
      reason: args.fact.reason
        ? `${args.fact.reason}; Judge correct 的 wikiEvidence 未命中最终页面正文`
        : "Judge correct 的 wikiEvidence 未命中最终页面正文",
    };
  }
  return {
    ...args.fact,
    coveredByClaims: args.coveredByClaims,
    judgeNeedsReview: false,
    unsupportedCorrect: false,
  };
}

function expectedFactCoveredByClaims(
  expected: CompileEvaluationExpectedFact,
  facts: Array<{ fact: string; evidence: string; entities: string[]; type: string }>,
): boolean {
  const expectedFact = normalizeText(expected.fact);
  const expectedEvidence = normalizeText(expected.evidence);
  return facts.some((fact) => {
    const ledgerText = normalizeText([fact.fact, fact.evidence, fact.type, fact.entities.join(" ")].join(" "));
    return textOverlaps(expectedFact, ledgerText) || textOverlaps(expectedEvidence, ledgerText);
  });
}

function wikiEvidenceHitsPages(
  wikiEvidence: string,
  evidencePath: string,
  pages: Array<{ path: string; content: string }>,
): boolean {
  const needle = normalizeText(wikiEvidence);
  if (!needle) return false;
  const page = pages.find((item) => item.path === evidencePath);
  return Boolean(page && normalizeText(page.content).includes(needle));
}

function failedCaseResult(
  testCase: CompileEvaluationDatasetCase,
  error: string,
  usage: CompileEvaluationUsage,
  matchedSources: CompileEvaluationMatchedSource[] = [],
  pagePaths: string[] = [],
): CompileEvaluationCaseResult {
  return {
    caseId: testCase.id,
    name: testCase.name,
    status: "evaluation_failed",
    matchedSources,
    pagePaths,
    facts: [],
    usage,
    error,
  };
}

export function summarize(cases: CompileEvaluationCaseResult[]) {
  const summary = emptySummary();
  for (const item of cases) {
    if (item.status === "source_missing") summary.sourceMissingCases += 1;
    if (item.status === "failed" || item.status === "evaluation_failed") summary.failedCases += 1;
    for (const fact of item.facts) {
      const weight = fact.weight || factWeight(fact.importance);
      const importance = normalizeImportance(fact.importance);
      summary.totalFacts += 1;
      summary[fact.status] += 1;
      summary.totalWeight += weight;
      if (fact.status === "correct") summary.correctWeight += weight;
      if (fact.coveredByClaims) summary.coveredByClaims += 1;
      if (fact.judgeNeedsReview) summary.judgeNeedsReview += 1;
      if (fact.unsupportedCorrect) summary.unsupportedCorrect += 1;
      if (importance === "must") {
        summary.mustTotal += 1;
        if (fact.status === "correct") summary.mustCorrect += 1;
      }
    }
  }
  summary.rawAccuracy = summary.totalFacts ? summary.correct / summary.totalFacts : 0;
  summary.accuracy = summary.rawAccuracy;
  summary.weightedScore = summary.totalWeight ? (summary.correctWeight / summary.totalWeight) * 100 : 0;
  summary.mustAccuracy = summary.mustTotal ? summary.mustCorrect / summary.mustTotal : 0;
  summary.missingRate = summary.totalFacts ? summary.missing / summary.totalFacts : 0;
  summary.incorrectRate = summary.totalFacts ? summary.incorrect / summary.totalFacts : 0;
  summary.passLevel = passLevel(summary.weightedScore, summary.incorrectRate, summary.mustAccuracy);
  return summary;
}

export function factWeight(importance: CompileEvaluationFactImportance): number {
  const normalized = normalizeImportance(importance);
  if (normalized === "nice") return 1;
  if (normalized === "should") return 2;
  return 3;
}

function summarizeUsage(cases: CompileEvaluationCaseResult[]): CompileEvaluationUsage {
  return cases.reduce(
    (total, item) => ({
      modelCalls: total.modelCalls + (item.usage?.modelCalls || 0),
      inputTokens: total.inputTokens + (item.usage?.inputTokens || 0),
      outputTokens: total.outputTokens + (item.usage?.outputTokens || 0),
      totalTokens: total.totalTokens + (item.usage?.totalTokens || 0),
    }),
    emptyUsage(),
  );
}

function emptyUsage(): CompileEvaluationUsage {
  return { modelCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function normalizeExpectedFactForResult(fact: Partial<CompileEvaluationFactResult>): {
  sourceFile: string;
  evidence: string;
  type: string;
  importance: CompileEvaluationFactImportance;
} {
  return {
    sourceFile: stringField(fact.sourceFile),
    evidence: stringField(fact.evidence),
    type: stringField(fact.type) || "general",
    importance: normalizeImportance(fact.importance),
  };
}

function normalizeImportance(value: unknown): CompileEvaluationFactImportance {
  if (value === "nice" || value === "should") return value;
  return "must";
}

function passLevel(weightedScore: number, incorrectRate: number, mustAccuracy: number): CompileEvaluationPassLevel {
  if (weightedScore >= 95 && incorrectRate <= 0.01 && mustAccuracy >= 0.95) return "excellent";
  if (weightedScore >= 80 && incorrectRate <= 0.03 && mustAccuracy >= 0.85) return "pass";
  if (weightedScore >= 60) return "needs_improvement";
  return "failed";
}

function manifestHash(manifest: LlmWikiRetrievalManifest): string {
  return sha256(
    JSON.stringify({
      sources: manifest.sources.map((item) => ({
        id: item.source_id,
        status: item.status,
        sha256: item.sha256,
        ingestedAt: item.ingested_at,
        touchedPages: item.touched_pages,
      })),
      pages: manifest.pages.map((item) => ({
        path: item.path,
        updatedAt: item.updated_at,
        schemaHash: item.schema_hash,
        sources: item.sources,
      })),
      pageClaims: manifest.pageClaims,
      facts: manifest.facts,
    }),
  );
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseJudgeOutput(content: string): JudgeOutput {
  const text = content.trim();
  const candidates = [text, text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim(), extractObject(text)];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as JudgeOutput;
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.facts)) return parsed;
    } catch {
      // try next candidate
    }
  }
  throw new Error("Judge 未返回合法 JSON");
}

function extractContent(response: unknown): string {
  const body = response as { choices?: Array<{ message?: { content?: unknown }; text?: unknown }> };
  const content = body.choices?.[0]?.message?.content ?? body.choices?.[0]?.text;
  if (typeof content === "string") return content;
  throw new Error("Judge 未返回内容");
}

function extractUsage(response: unknown): CompileEvaluationUsage {
  const usage = (response as {
    usage?: {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      input_tokens?: unknown;
      output_tokens?: unknown;
      total_tokens?: unknown;
    };
  }).usage;
  const inputTokens = nonNegativeNumber(usage?.input_tokens ?? usage?.prompt_tokens);
  const outputTokens = nonNegativeNumber(usage?.output_tokens ?? usage?.completion_tokens);
  return {
    modelCalls: 1,
    inputTokens,
    outputTokens,
    totalTokens: nonNegativeNumber(usage?.total_tokens) || inputTokens + outputTokens,
  };
}

function nonNegativeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeFactStatus(value: unknown): CompileEvaluationFactStatus {
  if (value === "correct" || value === "missing" || value === "incorrect") return value;
  throw new Error(`Judge 返回了非法事实状态: ${String(value || "")}`);
}

function numberOrNull(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(1, Math.max(0, number));
}

function extractObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : "";
}

function normalizeText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[`*_#[\](){}|>~"'，。；：！？、,.!?;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textOverlaps(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a.length >= 12 && b.includes(a)) return true;
  if (b.length >= 12 && a.includes(b)) return true;
  const terms = uniqueTerms(a);
  if (terms.length < 3) return false;
  const bSet = new Set(uniqueTerms(b));
  const matched = terms.filter((term) => bSet.has(term)).length;
  return matched / terms.length >= 0.6;
}

function uniqueTerms(text: string): string[] {
  return [...new Set(text.split(/\s+/).filter((item) => item.length >= 2))];
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isEvaluableSourceStatus(status: string): boolean {
  return status === "published" || status === "ready";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
