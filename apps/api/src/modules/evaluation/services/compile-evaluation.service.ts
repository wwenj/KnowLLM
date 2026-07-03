import { Injectable, Logger } from "@nestjs/common";
import { nowIso } from "../../../common/fs-json";
import { LlmWikiRetrievalService } from "../../llmWiki/services/llm-wiki-retrieval.service";
import { ModelService } from "../../model/model.service";
import type {
  CompileEvaluationCaseResult,
  CompileEvaluationDataset,
  CompileEvaluationDatasetCase,
  CompileEvaluationFactResult,
  CompileEvaluationFactStatus,
  CompileEvaluationFactImportance,
  CompileEvaluationMatchedSource,
  CompileEvaluationPassLevel,
  CompileEvaluationRun,
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

@Injectable()
export class CompileEvaluationService {
  private readonly logger = new Logger(CompileEvaluationService.name);

  constructor(
    private readonly store: CompileEvaluationStoreService,
    private readonly retrieval: LlmWikiRetrievalService,
    private readonly model: ModelService,
  ) {}

  createRun(input: unknown) {
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
    const run = this.store.createRun({ dataset, caseIds, judgeModel });
    void this.execute(run.runId, dataset).catch((error) => {
      this.logger.error(`compile evaluation ${run.runId} failed: ${formatError(error)}`);
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

  private async execute(runId: string, dataset: CompileEvaluationDataset): Promise<void> {
    let run = this.store.getRun(runId);
    try {
      for (const caseId of run.caseIds) {
        const testCase = dataset.cases.find((item) => item.id === caseId);
        if (!testCase) continue;
        run = this.store.saveRun({
          ...run,
          progress: { ...run.progress, currentCaseId: caseId },
        });
        const result = await this.evaluateCase(dataset, testCase, run.judgeModel);
        const cases = [...run.cases.filter((item) => item.caseId !== caseId), result];
        run = this.store.saveRun({
          ...run,
          cases,
          progress: {
            completed: run.progress.completed + 1,
            total: run.progress.total,
            currentCaseId: caseId,
          },
          summary: summarize(cases),
        });
      }
      this.store.saveRun({
        ...run,
        status: "success",
        endedAt: nowIso(),
        progress: { ...run.progress, currentCaseId: "" },
        summary: summarize(run.cases),
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
    dataset: CompileEvaluationDataset,
    testCase: CompileEvaluationDatasetCase,
    judgeModel: string,
  ): Promise<CompileEvaluationCaseResult> {
    const manifest = this.retrieval.getManifest();
    const sources = testCase.sourceIds.map((id) => dataset.sources.find((item) => item.id === id)!);
    const matchedSources = sources.map((source): CompileEvaluationMatchedSource => {
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
        })),
        error: "",
      };
    }

    const matchedIds = new Set(matchedSources.map((item) => item.sourceId).filter(Boolean) as string[]);
    const pageRefs = manifest.pages.filter(
      (page) => page.path !== "index.md" && page.sources.some((sourceId) => matchedIds.has(sourceId)),
    );
    const pages = pageRefs.map((page) => this.retrieval.readPage(page.path));
    try {
      const facts = await this.judge({
        model: judgeModel,
        testCase,
        sources: sources.map(({ id, filename, content }) => ({ id, filename, content })),
        pages: pages.map(({ path, title, content }) => ({ path, title, content })),
      });
      return {
        caseId: testCase.id,
        name: testCase.name,
        status: "success",
        matchedSources,
        pagePaths: pages.map((page) => page.path),
        facts,
        error: "",
      };
    } catch (error) {
      return {
        caseId: testCase.id,
        name: testCase.name,
        status: "failed",
        matchedSources,
        pagePaths: pages.map((page) => page.path),
        facts: [],
        error: formatError(error),
      };
    }
  }

  private async judge(args: {
    model: string;
    testCase: CompileEvaluationDatasetCase;
    sources: Array<{ id: string; filename: string; content: string }>;
    pages: Array<{ path: string; title: string; content: string }>;
  }): Promise<CompileEvaluationFactResult[]> {
    const response = await this.model.chat({
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
    const output = parseJudgeOutput(extractContent(response));
    const byId = new Map((output.facts || []).map((item) => [stringField(item.factId), item]));
    return args.testCase.expectedFacts.map((fact) => {
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
      };
    });
  }
}

export function summarize(cases: CompileEvaluationCaseResult[]) {
  const summary = emptySummary();
  for (const item of cases) {
    if (item.status === "source_missing") summary.sourceMissingCases += 1;
    if (item.status === "failed") summary.failedCases += 1;
    for (const fact of item.facts) {
      const weight = fact.weight || factWeight(fact.importance);
      const importance = normalizeImportance(fact.importance);
      summary.totalFacts += 1;
      summary[fact.status] += 1;
      summary.totalWeight += weight;
      if (fact.status === "correct") summary.correctWeight += weight;
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
  summary.passLevel = passLevel(summary.weightedScore, summary.incorrectRate);
  return summary;
}

export function factWeight(importance: CompileEvaluationFactImportance): number {
  const normalized = normalizeImportance(importance);
  if (normalized === "nice") return 1;
  if (normalized === "should") return 2;
  return 3;
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

function passLevel(weightedScore: number, incorrectRate: number): CompileEvaluationPassLevel {
  if (weightedScore >= 95 && incorrectRate <= 0.01) return "excellent";
  if (weightedScore >= 80 && incorrectRate <= 0.03) return "pass";
  if (weightedScore >= 60) return "needs_improvement";
  return "failed";
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

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
