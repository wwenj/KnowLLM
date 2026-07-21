import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { ModelService, type RawChatResponseFormat } from "../../model/model.service";
import {
  type LlmWikiAnalysisArtifact,
  type LlmWikiChunkAnalysisCacheEntry,
  type LlmWikiClaim,
  type LlmWikiCompileCandidate,
  type LlmWikiCompileCandidatePage,
  type LlmWikiCompilePlan,
  type LlmWikiCompileUsage,
  type LlmWikiFact,
  type LlmWikiFactCoverageResult,
  type LlmWikiFactImportance,
  type LlmWikiFactRetention,
  type LlmWikiFactType,
  type LlmWikiPageClaims,
  type LlmWikiPageRef,
  type LlmWikiPageType,
  type LlmWikiPublishGateIssue,
  type LlmWikiSchema,
  type LlmWikiSemanticPagePlan,
  type LlmWikiSourceMap,
  type LlmWikiSourceSection,
} from "../contracts/llm-wiki.types";
import { assertWikiMarkdownPath, isWikiMarkdownPath } from "../llm-wiki-page.utils";
import { llmWikiConfig } from "../llm-wiki.config";
import { slugify, uniqueStrings } from "./llm-wiki-fact.utils";

interface ChatChoice {
  message?: { content?: unknown };
  text?: unknown;
}

interface ChatCompletionLike {
  choices?: ChatChoice[];
  usage?: unknown;
}

interface RawFact {
  type?: unknown;
  importance?: unknown;
  retention?: unknown;
  fact?: unknown;
  evidence?: unknown;
  entities?: unknown;
}

interface FactOutput {
  facts?: RawFact[];
  missingFacts?: RawFact[];
}

interface WriterOutput {
  body?: unknown;
  tags?: unknown;
  claimedFactIds?: unknown;
}

interface VerifyOutput {
  facts?: unknown[];
}

interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

type CandidatePageType = Exclude<LlmWikiPageType, "index">;

const PAGE_TYPES: CandidatePageType[] = [
  "summary",
  "concept",
  "entity",
  "reference",
  "procedure",
  "changelog",
  "troubleshooting",
];

const FACT_TYPES: LlmWikiFactType[] = [
  "definition",
  "command",
  "config",
  "parameter",
  "default",
  "procedure_step",
  "warning",
  "constraint",
  "exception",
  "version_change",
  "api_request",
  "api_response",
  "error_case",
  "relationship",
];

const FACT_RESPONSE_FORMAT = jsonSchema("llm_wiki_facts", {
  type: "object",
  additionalProperties: false,
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: FACT_TYPES },
          importance: { type: "string", enum: ["must", "should", "nice"] },
          retention: { type: "string", enum: ["exact", "semantic", "background"] },
          fact: { type: "string", maxLength: llmWikiConfig.maxFactTextChars },
          evidence: { type: "string", maxLength: llmWikiConfig.maxFactEvidenceChars },
          entities: { type: "array", maxItems: 30, items: { type: "string" } },
        },
        required: ["type", "importance", "retention", "fact", "evidence", "entities"],
      },
    },
  },
  required: ["facts"],
});

const AUDIT_RESPONSE_FORMAT = jsonSchema("llm_wiki_fact_audit", {
  type: "object",
  additionalProperties: false,
  properties: {
    missingFacts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: FACT_TYPES },
          importance: { type: "string", enum: ["must", "should", "nice"] },
          retention: { type: "string", enum: ["exact", "semantic", "background"] },
          fact: { type: "string", maxLength: llmWikiConfig.maxFactTextChars },
          evidence: { type: "string", maxLength: llmWikiConfig.maxFactEvidenceChars },
          entities: { type: "array", maxItems: 30, items: { type: "string" } },
        },
        required: ["type", "importance", "retention", "fact", "evidence", "entities"],
      },
    },
  },
  required: ["missingFacts"],
});

const WRITER_RESPONSE_FORMAT = jsonSchema("llm_wiki_page", {
  type: "object",
  additionalProperties: false,
  properties: {
    body: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    claimedFactIds: { type: "array", items: { type: "string" } },
  },
  required: ["body", "tags", "claimedFactIds"],
});

const VERIFY_RESPONSE_FORMAT = jsonSchema("llm_wiki_coverage", {
  type: "object",
  additionalProperties: false,
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          factId: { type: "string" },
          status: { type: "string", enum: ["correct", "missing", "incorrect"] },
          evidencePath: { type: "string" },
          wikiEvidence: { type: "string" },
          reason: { type: "string" },
        },
        required: ["factId", "status", "evidencePath", "wikiEvidence", "reason"],
      },
    },
  },
  required: ["facts"],
});

@Injectable()
export class LlmWikiCompilerService {
  constructor(private readonly model: ModelService) {}

  estimateAnalyzePlan(args: {
    sourceId: string;
    filename: string;
    source: string;
    existingPages: LlmWikiPageRef[];
    schema: LlmWikiSchema;
    model: string;
    cachedChunkKeys?: Set<string>;
  }): LlmWikiCompilePlan {
    const sourceMap = this.sectionSource(args);
    const chunkCount = sourceMap.sections.length;
    const cacheHits = sourceMap.sections.filter((section) => args.cachedChunkKeys?.has(chunkCacheKey(args, section))).length;
    const cacheMisses = chunkCount - cacheHits;
    const extractInputs = sourceMap.sections.map((section) => estimateCallInput(
      factExtractorInstructions(),
      { source: sectionForPrompt(section), schema: args.schema.content },
      FACT_RESPONSE_FORMAT,
    ));
    const auditInputs = sourceMap.sections.map((section, index) => Math.min(
      llmWikiConfig.maxAnalyzeInputTokens,
      Math.max(extractInputs[index], estimateCallInput(
        factAuditInstructions(),
        { source: sectionForPrompt(section), existingFacts: [], schema: args.schema.content },
        AUDIT_RESPONSE_FORMAT,
      ) + 3_200),
    ));
    const estimatedCalls = cacheMisses * 2;
    const maxModelCalls = cacheMisses * 4;
    const callPlan = [
      { ...makeCallBudget("extract_facts", cacheMisses, cacheMisses * 2, sum(extractInputs.filter((_, index) => !args.cachedChunkKeys?.has(chunkCacheKey(args, sourceMap.sections[index])))), llmWikiConfig.maxAnalyzeInputTokens, 3_000, llmWikiConfig.extractOutputTokens), cacheHits },
      { ...makeCallBudget("audit_facts", cacheMisses, cacheMisses * 2, sum(auditInputs.filter((_, index) => !args.cachedChunkKeys?.has(chunkCacheKey(args, sourceMap.sections[index])))), llmWikiConfig.maxAnalyzeInputTokens, 1_500, llmWikiConfig.auditOutputTokens), cacheHits },
    ];
    return createPlan({
      phase: "analyze",
      args,
      estimatedCalls,
      maxModelCalls,
      callPlan,
      affectedPageCandidates: candidateAffectedPages(args.sourceId, args.filename, args.existingPages),
    });
  }

  estimateComposePlan(args: {
    sourceId: string;
    filename: string;
    source: string;
    existingPages: LlmWikiPageRef[];
    schema: LlmWikiSchema;
    model: string;
    analysis: LlmWikiAnalysisArtifact;
  }): LlmWikiCompilePlan {
    assertAnalysisMatches(args.analysis, args);
    const pageCount = args.analysis.pagePlan.length;
    const estimatedCalls = pageCount * 2;
    const maxModelCalls = pageCount * 6;
    const pageFactInputs = args.analysis.pagePlan.map((page) => estimateTokens(JSON.stringify(
      page.factIds
        .map((factId) => args.analysis.factLedger.facts.find((fact) => fact.factId === factId))
        .filter((fact): fact is LlmWikiFact => !!fact)
        .map(factForPrompt),
    )));
    if (pageFactInputs.some((tokens) => tokens > llmWikiConfig.maxPageFactInputTokens)) {
      throw new Error("page plan 超过单页事实输入 token 上限，请重新 analyze");
    }
    const expectedWriterInput = sum(pageFactInputs.map((tokens) => Math.min(llmWikiConfig.maxComposeInputTokens, tokens + 1_500)));
    const callPlan = [
      makeCallBudget("write_pages", pageCount, pageCount * 2, expectedWriterInput, llmWikiConfig.maxComposeInputTokens, 4_000, llmWikiConfig.maxOutputTokensPerCall),
      makeCallBudget("verify_coverage", pageCount, pageCount * 2, pageCount * llmWikiConfig.maxComposeInputTokens, llmWikiConfig.maxComposeInputTokens, 1_500, llmWikiConfig.auditOutputTokens),
      makeCallBudget("repair_pages", 0, pageCount, 0, llmWikiConfig.maxComposeInputTokens, 0, llmWikiConfig.maxOutputTokensPerCall),
      makeCallBudget("verify_repair", 0, pageCount, 0, llmWikiConfig.maxComposeInputTokens, 0, llmWikiConfig.auditOutputTokens),
    ];
    return createPlan({
      phase: "compose",
      args,
      estimatedCalls,
      maxModelCalls,
      callPlan,
      affectedPageCandidates: uniqueStrings([
        ...args.analysis.pagePlan.map((page) => page.path),
        ...args.existingPages.filter((page) => page.sources.includes(args.sourceId)).map((page) => page.path),
      ]),
      analysisHash: args.analysis.analysisHash,
    });
  }

  estimateCompilePlan(args: {
    sourceId: string;
    filename: string;
    source: string;
    existingPages: LlmWikiPageRef[];
    schema: LlmWikiSchema;
    model?: string;
    analysis?: LlmWikiAnalysisArtifact | null;
  }): LlmWikiCompilePlan {
    const model = String(args.model || "");
    return args.analysis
      ? this.estimateComposePlan({ ...args, model, analysis: args.analysis })
      : this.estimateAnalyzePlan({ ...args, model });
  }

  sectionSource(args: { sourceId: string; filename: string; source: string; schema?: LlmWikiSchema }): LlmWikiSourceMap {
    const source = String(args.source || "");
    return {
      sourceId: args.sourceId,
      filename: args.filename,
      sha256: sha256(source),
      title: titleFromSource(source, args.filename),
      sections: splitIntoChunks(source, args.schema?.content || ""),
    };
  }

  chunkCacheKeys(args: { sourceId: string; filename: string; source: string; schema: LlmWikiSchema; model: string }): string[] {
    return this.sectionSource(args).sections.map((section) => chunkCacheKey(args, section));
  }

  async analyzeSource(args: {
    sourceId: string;
    filename: string;
    source: string;
    existingPages: LlmWikiPageRef[];
    schema: LlmWikiSchema;
    model: string;
    plan: LlmWikiCompilePlan;
    signal?: AbortSignal;
    onUsage?: (usage: LlmWikiCompileUsage) => void;
    chunkCache?: AnalyzeArgs["chunkCache"];
  }): Promise<LlmWikiAnalysisArtifact> {
    if (args.plan.phase !== "analyze") throw new Error("compile plan phase 必须是 analyze");
    assertPlanMatches(args.plan, args);
    const tracker = new UsageTracker(args.plan, args.onUsage);
    const sourceMap = this.sectionSource(args);
    const facts: LlmWikiFact[] = [];
    for (const section of sourceMap.sections) {
      assertNotAborted(args.signal);
      const cacheKey = chunkCacheKey(args, section);
      const cached = args.chunkCache?.read(cacheKey);
      if (cached?.auditComplete) {
        facts.push(...cached.facts);
        continue;
      }
      const extracted = cached?.extractedFacts || await this.extractChunkFacts(args, section, tracker);
      if (!cached?.extractedFacts) {
        args.chunkCache?.write({
          cacheKey,
          sourceId: args.sourceId,
          sourceHash: sourceMap.sha256,
          chunkId: section.sectionId,
          chunkStart: section.startOffset,
          chunkEnd: section.endOffset,
          schemaHash: args.schema.sha256,
          model: args.model,
          modelHash: sha256(args.model),
          promptHash: compilerPromptHash(),
          compilerVersion: llmWikiConfig.compilerVersion,
          extractedFacts: extracted,
          auditComplete: false,
          facts: extracted,
          createdAt: new Date().toISOString(),
        });
      }
      const audited = await this.auditChunkFacts(args, section, extracted, tracker);
      facts.push(...extracted, ...audited);
      args.chunkCache?.write({
        cacheKey,
        sourceId: args.sourceId,
        sourceHash: sourceMap.sha256,
        chunkId: section.sectionId,
        chunkStart: section.startOffset,
        chunkEnd: section.endOffset,
        schemaHash: args.schema.sha256,
        model: args.model,
        modelHash: sha256(args.model),
        promptHash: compilerPromptHash(),
        compilerVersion: llmWikiConfig.compilerVersion,
        extractedFacts: extracted,
        auditComplete: true,
        facts: [...extracted, ...audited],
        createdAt: new Date().toISOString(),
      });
    }
    const deduped = dedupeFacts(facts);
    if (!deduped.length) throw new Error("analyze 未提取到任何事实");
    const factLedger = {
      sourceId: args.sourceId,
      schemaHash: args.schema.sha256,
      model: args.model,
      generatedAt: new Date().toISOString(),
      facts: deduped,
    };
    const pagePlan = planPagesDeterministically(args, sourceMap, factLedger.facts);
    const usage = tracker.finish();
    const analysisHash = sha256(JSON.stringify({
      sourceHash: sourceMap.sha256,
      schemaHash: args.schema.sha256,
      model: args.model,
      compilerVersion: llmWikiConfig.compilerVersion,
      promptVersion: llmWikiConfig.promptVersion,
      promptHash: compilerPromptHash(),
      facts: factLedger.facts,
      pagePlan,
    }));
    return {
      sourceId: args.sourceId,
      sourceHash: sourceMap.sha256,
      schemaHash: args.schema.sha256,
      model: args.model,
      compilerVersion: llmWikiConfig.compilerVersion,
      promptVersion: llmWikiConfig.promptVersion,
      modelHash: sha256(args.model),
      promptHash: compilerPromptHash(),
      analysisHash,
      planHash: args.plan.hash,
      sourceMap,
      factLedger,
      pagePlan,
      usage,
      createdAt: new Date().toISOString(),
    };
  }

  async composeSource(args: {
    sourceId: string;
    filename: string;
    source: string;
    existingPages: LlmWikiPageRef[];
    schema: LlmWikiSchema;
    model: string;
    analysis: LlmWikiAnalysisArtifact;
    plan: LlmWikiCompilePlan;
    signal?: AbortSignal;
    onUsage?: (usage: LlmWikiCompileUsage) => void;
  }): Promise<LlmWikiCompileCandidate> {
    if (args.plan.phase !== "compose") throw new Error("compile plan phase 必须是 compose");
    assertPlanMatches(args.plan, args, args.analysis.analysisHash);
    assertAnalysisMatches(args.analysis, args);
    const tracker = new UsageTracker(args.plan, args.onUsage);
    let pages: LlmWikiCompileCandidatePage[] = [];
    for (const pagePlan of args.analysis.pagePlan) {
      const assignedFacts = pagePlan.factIds
        .map((factId) => args.analysis.factLedger.facts.find((fact) => fact.factId === factId))
        .filter((fact): fact is LlmWikiFact => !!fact);
      pages.push(await this.writePage(args, pagePlan, assignedFacts, tracker));
    }

    const initialResults = await this.verifyPageCoverage(args, pages, args.analysis.pagePlan, tracker, true);
    let factResults = initialResults;
    const repairTargets = groupRepairTargets(initialResults, args.analysis.pagePlan);
    let repairPasses = 0;
    if (repairTargets.size) {
      repairPasses = 1;
      pages = await this.repairPages(args, pages, repairTargets, tracker);
      const repairedPaths = new Set(repairTargets.keys());
      const repairedPlans = args.analysis.pagePlan.filter((page) => repairedPaths.has(page.path));
      const repairedResults = await this.verifyPageCoverage(args, pages, repairedPlans, tracker, false);
      const byFactId = new Map(initialResults.map((result) => [result.factId, result]));
      for (const result of repairedResults) byFactId.set(result.factId, result);
      factResults = args.analysis.factLedger.facts.map((fact) => byFactId.get(fact.factId) || missingCoverage(fact.factId));
    }

    pages = pages.map((page) => ({
      ...page,
      claimedFactIds: factResults
        .filter((result) => result.status === "correct" && result.evidencePath === page.path)
        .map((result) => result.factId),
    }));

    const coverageReport = buildCoverageReport(args.analysis.factLedger.facts, factResults, repairPasses);
    const pageClaims = buildPageClaims(args.sourceId, pages, coverageReport.facts || []);
    const claims = buildClaims(args.sourceId, args.analysis.factLedger.facts, coverageReport.facts || []);
    const issues = validateCandidate(pages, coverageReport);
    const composeUsage = tracker.finish();
    const usage = mergeUsage(args.analysis.usage, composeUsage);
    const now = new Date().toISOString();
    return {
      candidateId: sha256(`${args.plan.hash}\n${now}`).slice(0, 32),
      sourceId: args.sourceId,
      plan: args.plan,
      status: issues.some((issue) => issue.kind === "blocked_publish") ? "needs_review" : "candidate_ready",
      model: args.model,
      schemaHash: args.schema.sha256,
      compilerVersion: llmWikiConfig.compilerVersion,
      promptVersion: llmWikiConfig.promptVersion,
      modelHash: sha256(args.model),
      promptHash: compilerPromptHash(),
      sourceHash: sha256(args.source),
      sourceTitle: titleFromSource(args.source, args.filename),
      analysisHash: args.analysis.analysisHash,
      pages,
      claims,
      pageClaims,
      coverageReport,
      affectedPages: uniqueStrings([
        ...pages.map((page) => page.path),
        ...args.existingPages.filter((page) => page.sources.includes(args.sourceId)).map((page) => page.path),
      ]),
      issues,
      modelUsage: usage,
      phaseUsage: { analysis: args.analysis.usage, compose: composeUsage },
      createdAt: now,
      updatedAt: now,
    };
  }

  async compileSource(args: {
    sourceId: string;
    filename: string;
    source: string;
    existingPages: LlmWikiPageRef[];
    schema: LlmWikiSchema;
    model: string;
    signal?: AbortSignal;
  }): Promise<LlmWikiCompileCandidate> {
    const analyzePlan = this.estimateAnalyzePlan(args);
    const analysis = await this.analyzeSource({ ...args, plan: analyzePlan });
    const composePlan = this.estimateComposePlan({ ...args, analysis });
    return this.composeSource({ ...args, analysis, plan: composePlan });
  }

  private async extractChunkFacts(
    args: AnalyzeArgs,
    section: LlmWikiSourceSection,
    tracker: UsageTracker,
  ): Promise<LlmWikiFact[]> {
    return this.callFactsWithRetry({
      args,
      section,
      tracker,
      stage: "extract_facts",
      responseFormat: FACT_RESPONSE_FORMAT,
      system: factExtractorInstructions(),
      payload: { source: sectionForPrompt(section), schema: args.schema.content },
      field: "facts",
      origin: "extract",
    });
  }

  private async auditChunkFacts(
    args: AnalyzeArgs,
    section: LlmWikiSourceSection,
    existingFacts: LlmWikiFact[],
    tracker: UsageTracker,
  ): Promise<LlmWikiFact[]> {
    return this.callFactsWithRetry({
      args,
      section,
      tracker,
      stage: "audit_facts",
      responseFormat: AUDIT_RESPONSE_FORMAT,
      system: factAuditInstructions(),
      payload: {
        source: sectionForPrompt(section),
        existingFacts: existingFacts.map(factForAnalysisPrompt),
        schema: args.schema.content,
      },
      field: "missingFacts",
      allowEmpty: true,
      origin: "audit",
    });
  }

  private async callFactsWithRetry(options: {
    args: AnalyzeArgs;
    section: LlmWikiSourceSection;
    tracker: UsageTracker;
    stage: string;
    responseFormat: RawChatResponseFormat;
    system: string;
    payload: unknown;
    field: "facts" | "missingFacts";
    allowEmpty?: boolean;
    origin: "extract" | "audit";
  }): Promise<LlmWikiFact[]> {
    let lastError = "";
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      assertNotAborted(options.args.signal);
      try {
        const output = await this.callJson({
          model: options.args.model,
          signal: options.args.signal,
          tracker: options.tracker,
          stage: options.stage,
          attempt,
          responseFormat: options.responseFormat,
          system: options.system,
          payload: attempt === 1 ? options.payload : { input: options.payload, validationError: lastError.slice(0, 500) },
        }) as FactOutput;
        const facts = normalizeRawFacts(
          options.field === "facts" ? output.facts : output.missingFacts,
          options.section,
          options.args.sourceId,
          options.origin,
        );
        if (!facts.length && !options.allowEmpty) throw new Error("模型未返回任何事实");
        return facts;
      } catch (error) {
        lastError = formatError(error);
        if (isBudgetError(lastError)) throw error;
        if (attempt === 2) throw new Error(`${options.stage} 两次尝试均失败: ${lastError}`);
      }
    }
    return [];
  }

  private async writePage(
    args: ComposeArgs,
    plan: LlmWikiSemanticPagePlan,
    facts: LlmWikiFact[],
    tracker: UsageTracker,
  ): Promise<LlmWikiCompileCandidatePage> {
    let lastError = "";
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const output = await this.callJson({
          model: args.model,
          signal: args.signal,
          tracker,
          stage: "write_pages",
          attempt,
          responseFormat: WRITER_RESPONSE_FORMAT,
          system: pageWriterInstructions(plan.type),
          payload: {
            pagePlan: plan,
            facts: facts.map(factForPrompt),
            allowedLinks: plan.linkTargets,
            validationError: lastError.slice(0, 500),
          },
        }) as WriterOutput;
        const body = stringField(output.body);
        if (!body) throw new Error(`页面正文为空: ${plan.path}`);
        const assigned = new Set(facts.map((fact) => fact.factId));
        const claimed = uniqueStrings(stringArray(output.claimedFactIds)).filter((factId) => assigned.has(factId));
        const missingClaims = facts.filter((fact) => !claimed.includes(fact.factId));
        if (missingClaims.length) {
          throw new Error(`writer 未声明实际承载的 required facts: ${missingClaims.map((fact) => fact.factId).join(",")}`);
        }
        return {
          path: plan.path,
          title: plan.title,
          type: plan.type,
          tags: uniqueStrings([...plan.tags, ...stringArray(output.tags)]).slice(0, 20),
          body: ensureHeading(body, plan.title),
          sourceIds: [args.sourceId],
          action: "create",
          claimedFactIds: claimed,
        } as LlmWikiCompileCandidatePage & { claimedFactIds: string[] };
      } catch (error) {
        lastError = formatError(error);
        if (isBudgetError(lastError)) throw error;
        if (attempt === 2) throw new Error(`write_pages 两次尝试均失败: ${lastError}`);
      }
    }
    throw new Error(`页面生成失败: ${plan.path}`);
  }

  private async verifyPageCoverage(
    args: ComposeArgs,
    pages: LlmWikiCompileCandidatePage[],
    plans: LlmWikiSemanticPagePlan[],
    tracker: UsageTracker,
    retry: boolean,
  ): Promise<LlmWikiFactCoverageResult[]> {
    const results: LlmWikiFactCoverageResult[] = [];
    for (const plan of plans) {
      const page = pages.find((item) => item.path === plan.path);
      if (!page) throw new Error(`coverage 页面不存在: ${plan.path}`);
      const facts = plan.factIds
        .map((factId) => args.analysis.factLedger.facts.find((fact) => fact.factId === factId))
        .filter((fact): fact is LlmWikiFact => !!fact);
      if (!facts.length) throw new Error(`coverage 页面没有 assigned facts: ${plan.path}`);
      const maxAttempts = retry ? 2 : 1;
      let lastError = "";
      let normalized: LlmWikiFactCoverageResult[] | null = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const output = await this.callJson({
            model: args.model,
            signal: args.signal,
            tracker,
            stage: retry ? "verify_coverage" : "verify_repair",
            attempt,
            responseFormat: VERIFY_RESPONSE_FORMAT,
            system: coverageVerifierInstructions(),
            payload: {
              facts: facts.map(factForPrompt),
              pages: [pageForPrompt(page)],
              validationError: lastError.slice(0, 500),
            },
          }) as VerifyOutput;
          normalized = normalizeCoverage(output.facts, facts, [page]);
          break;
        } catch (error) {
          lastError = formatError(error);
          if (isBudgetError(lastError)) throw error;
          if (attempt === maxAttempts) throw new Error(`coverage verify 失败: ${lastError}`);
        }
      }
      results.push(...(normalized || facts.map((fact) => missingCoverage(fact.factId))));
    }
    return results;
  }

  private async repairPages(
    args: ComposeArgs,
    pages: LlmWikiCompileCandidatePage[],
    repairTargets: Map<string, string[]>,
    tracker: UsageTracker,
  ): Promise<LlmWikiCompileCandidatePage[]> {
    const next = [...pages];
    for (const [path, factIds] of repairTargets) {
      const index = next.findIndex((page) => page.path === path);
      if (index < 0) throw new Error(`repair target 页面不存在: ${path}`);
      const page = next[index];
      const facts = factIds
        .map((factId) => args.analysis.factLedger.facts.find((fact) => fact.factId === factId))
        .filter((fact): fact is LlmWikiFact => !!fact);
      const output = await this.callJson({
        model: args.model,
        signal: args.signal,
        tracker,
        stage: "repair_pages",
        attempt: 1,
        responseFormat: WRITER_RESPONSE_FORMAT,
        system: repairInstructions(),
        payload: { page: pageForPrompt(page), missingOrIncorrectFacts: facts.map(factForPrompt) },
      }) as WriterOutput;
      const body = stringField(output.body);
      if (!body) throw new Error(`repair 页面正文为空: ${path}`);
      const claimed = new Set(stringArray(output.claimedFactIds));
      const missingClaims = facts.filter((fact) => !claimed.has(fact.factId));
      if (missingClaims.length) {
        throw new Error(`repair 未声明实际承载的 required facts: ${missingClaims.map((fact) => fact.factId).join(",")}`);
      }
      next[index] = {
        ...page,
        body: ensureHeading(body, page.title),
        tags: uniqueStrings([...page.tags, ...stringArray(output.tags)]).slice(0, 20),
      };
    }
    return next;
  }

  private async callJson(options: {
    model: string;
    signal?: AbortSignal;
    tracker: UsageTracker;
    stage: string;
    attempt: number;
    responseFormat: RawChatResponseFormat;
    system: string;
    payload: unknown;
  }): Promise<unknown> {
    const payload = JSON.stringify(options.payload);
    const estimatedInputTokens = estimateCallInput(options.system, options.payload, options.responseFormat);
    const allowance = options.tracker.beforeCall(options.stage, options.attempt, estimatedInputTokens);
    const timeoutSignal = AbortSignal.timeout(llmWikiConfig.modelCallTimeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
    try {
      const response = await this.model.chat({
        model: options.model,
        temperature: 0,
        response_format: options.responseFormat,
        maxTokens: Math.max(1, allowance.maxOutputTokens - llmWikiConfig.providerOutputUsageMarginTokens),
        signal,
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: payload },
        ],
      });
      const content = extractContent(response);
      const reportedUsage = extractUsage(response);
      const usage = {
        inputTokens: reportedUsage.inputTokens || estimatedInputTokens,
        outputTokens: reportedUsage.outputTokens || estimateTokens(content),
      };
      options.tracker.afterCall(options.stage, options.attempt, usage, allowance);
      return parseJsonObject(content, `${options.stage} 输出不是合法 JSON`);
    } catch (error) {
      const failure = timeoutSignal.aborted && !options.signal?.aborted
        ? new Error(`模型调用超时: ${options.stage} 超过 ${llmWikiConfig.modelCallTimeoutMs}ms`)
        : error;
      options.tracker.failCall(options.stage, options.attempt, formatError(failure));
      throw failure;
    }
  }
}

export const LLM_WIKI_INGEST_STOPPED = "LLM_WIKI_INGEST_STOPPED";

type AnalyzeArgs = {
  sourceId: string;
  filename: string;
  source: string;
  schema: LlmWikiSchema;
  model: string;
  signal?: AbortSignal;
  onUsage?: (usage: LlmWikiCompileUsage) => void;
  chunkCache?: {
    read(cacheKey: string): LlmWikiChunkAnalysisCacheEntry | null;
    write(entry: LlmWikiChunkAnalysisCacheEntry): void;
  };
};

type ComposeArgs = AnalyzeArgs & {
  existingPages: LlmWikiPageRef[];
  analysis: LlmWikiAnalysisArtifact;
  plan: LlmWikiCompilePlan;
};

class UsageTracker {
  private usage: LlmWikiCompileUsage = emptyUsage();

  constructor(
    private readonly plan: LlmWikiCompilePlan,
    private readonly onUsage?: (usage: LlmWikiCompileUsage) => void,
  ) {}

  beforeCall(stage: string, attempt: number, estimatedInputTokens: number): CallAllowance {
    const stageBudget = this.plan.callPlan.find((item) => item.stage === stage);
    if (!stageBudget) throw new Error(`模型调用 stage 不在确认计划中: ${stage}`);
    const stageCalls = this.usage.calls.filter((call) => call.stage === stage).length;
    if (stageCalls >= stageBudget.maxCalls) {
      throw new Error(`模型调用 stage 预算已耗尽: ${stage} ${stageCalls}/${stageBudget.maxCalls}`);
    }
    const maxInputTokens = Math.max(1, Math.floor((stageBudget.hardInputTokens || 0) / Math.max(1, stageBudget.maxCalls)));
    const maxOutputTokens = Math.max(1, Math.floor((stageBudget.hardOutputTokens || 0) / Math.max(1, stageBudget.maxCalls)));
    if (estimatedInputTokens > maxInputTokens) {
      throw new Error(`模型调用输入超过确认上限: ${stage} ${estimatedInputTokens}/${maxInputTokens}`);
    }
    if (this.usage.modelCalls >= this.plan.maxModelCalls) {
      throw new Error(`模型调用预算已耗尽: ${this.usage.modelCalls}/${this.plan.maxModelCalls}`);
    }
    const actualTokens = this.usage.inputTokens + this.usage.outputTokens;
    const remaining = this.plan.maxTokens - actualTokens;
    if (remaining < estimatedInputTokens + maxOutputTokens) {
      throw new Error(`token 预算已耗尽: ${this.usage.inputTokens + this.usage.outputTokens}/${this.plan.maxTokens}`);
    }
    if (attempt > 1) this.usage.retries += 1;
    if (!stage) throw new Error("模型调用 stage 不能为空");
    this.usage.modelCalls += 1;
    this.usage.inputTokens += estimatedInputTokens;
    this.usage.calls.push({
      stage,
      attempt,
      inputTokens: estimatedInputTokens,
      outputTokens: 0,
      maxInputTokens,
      maxOutputTokens,
      status: "running",
      error: "",
    });
    this.emit();
    return { maxInputTokens, maxOutputTokens };
  }

  afterCall(stage: string, attempt: number, usage: ModelUsage, allowance: CallAllowance): void {
    const call = this.usage.calls[this.usage.calls.length - 1];
    if (!call || call.stage !== stage || call.attempt !== attempt) {
      throw new Error("模型调用 usage 记录顺序异常");
    }
    this.usage.inputTokens += usage.inputTokens - call.inputTokens;
    this.usage.outputTokens += usage.outputTokens;
    call.inputTokens = usage.inputTokens;
    call.outputTokens = usage.outputTokens;
    if (usage.inputTokens > allowance.maxInputTokens || usage.outputTokens > allowance.maxOutputTokens) {
      const error = `budget_violation: ${stage} 实际 ${usage.inputTokens}/${usage.outputTokens}，确认上限 ${allowance.maxInputTokens}/${allowance.maxOutputTokens}`;
      call.status = "failed";
      call.error = error;
      this.emit();
      throw new Error(error);
    }
    const actualTokens = this.usage.inputTokens + this.usage.outputTokens;
    if (actualTokens > this.plan.maxTokens) {
      const error = `模型返回后超过 token 硬上限: ${actualTokens}/${this.plan.maxTokens}`;
      call.status = "failed";
      call.error = error;
      this.emit();
      throw new Error(error);
    }
    call.status = "success";
    call.error = "";
    this.emit();
  }

  failCall(stage: string, attempt: number, error: string): void {
    const call = this.usage.calls[this.usage.calls.length - 1];
    if (!call || call.stage !== stage || call.attempt !== attempt) return;
    call.status = "failed";
    call.error = error.slice(0, 1000);
    this.emit();
  }

  finish(): LlmWikiCompileUsage {
    return this.snapshot();
  }

  private snapshot(): LlmWikiCompileUsage {
    return {
      ...this.usage,
      estimatedCostUsd: estimateCostUsd(this.usage.inputTokens, this.usage.outputTokens),
      calls: this.usage.calls.map((call) => ({ ...call })),
    };
  }

  private emit(): void {
    this.onUsage?.(this.snapshot());
  }
}

interface CallAllowance {
  maxInputTokens: number;
  maxOutputTokens: number;
}

function createPlan(options: {
  phase: "analyze" | "compose";
  args: {
    sourceId: string;
    source: string;
    schema: LlmWikiSchema;
    model: string;
    existingPages?: LlmWikiPageRef[];
  };
  estimatedCalls: number;
  maxModelCalls: number;
  callPlan: LlmWikiCompilePlan["callPlan"];
  affectedPageCandidates: string[];
  analysisHash?: string;
}): LlmWikiCompilePlan {
  const sourceHash = sha256(options.args.source);
  const wikiStateHash = hashWikiState(options.args.existingPages || [], options.args.sourceId);
  const estimatedInputTokens = sum(options.callPlan.map((item) => item.expectedInputTokens || 0));
  const estimatedOutputTokens = sum(options.callPlan.map((item) => item.expectedOutputTokens || 0));
  const estimatedTokens = estimatedInputTokens + estimatedOutputTokens;
  const maxTokens = sum(options.callPlan.map((item) => item.hardTokens || 0));
  const payload = {
    phase: options.phase,
    sourceId: options.args.sourceId,
    sourceHash,
    schemaHash: options.args.schema.sha256,
    model: options.args.model,
    modelHash: sha256(options.args.model),
    compilerVersion: llmWikiConfig.compilerVersion,
    promptVersion: llmWikiConfig.promptVersion,
    promptHash: compilerPromptHash(),
    wikiStateHash,
    maxModelCalls: options.maxModelCalls,
    maxTokens,
    analysisHash: options.analysisHash || "",
    affectedPageCandidates: options.affectedPageCandidates,
  };
  const hash = sha256(JSON.stringify(payload));
  return {
    phase: options.phase,
    planId: hash.slice(0, 32),
    planHash: hash,
    sourceIds: [options.args.sourceId],
    hash,
    schemaHash: options.args.schema.sha256,
    compilerVersion: llmWikiConfig.compilerVersion,
    promptVersion: llmWikiConfig.promptVersion,
    sourceHash,
    model: options.args.model,
    modelHash: payload.modelHash,
    promptHash: payload.promptHash,
    wikiStateHash,
    analysisHash: options.analysisHash,
    estimatedCalls: options.estimatedCalls,
    estimatedTokens,
    maxTokens,
    callPlan: options.callPlan,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd: estimateCostUsd(estimatedInputTokens, estimatedOutputTokens),
    maxModelCalls: options.maxModelCalls,
    hardTokens: maxTokens,
    affectedPageCandidates: options.affectedPageCandidates,
    requiresDigest: false,
    blocked: false,
    reason: "",
    createdAt: new Date().toISOString(),
  };
}

function makeCallBudget(
  stage: string,
  expectedCalls: number,
  maxCalls: number,
  expectedInputTokens: number,
  hardInputPerCall: number,
  expectedOutputPerCall: number,
  hardOutputPerCall: number,
): LlmWikiCompilePlan["callPlan"][number] {
  const expectedOutputTokens = expectedCalls * expectedOutputPerCall;
  const hardInputTokens = maxCalls * hardInputPerCall;
  const hardOutputTokens = maxCalls * hardOutputPerCall;
  return {
    stage,
    expectedCalls,
    maxCalls,
    expectedInputTokens,
    hardInputTokens,
    expectedOutputTokens,
    hardOutputTokens,
    expectedTokens: expectedInputTokens + expectedOutputTokens,
    hardTokens: hardInputTokens + hardOutputTokens,
  };
}

function estimateCallInput(system: string, payload: unknown, responseFormat: RawChatResponseFormat): number {
  return estimateTokens(`${system}\n${JSON.stringify(payload)}\n${JSON.stringify(responseFormat)}`);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function splitIntoChunks(source: string, schema: string): LlmWikiSourceSection[] {
  if (!source.length) return [];
  const target = llmWikiConfig.chunkTargetChars;
  const overlap = Math.min(
    llmWikiConfig.chunkOverlapChars,
    llmWikiConfig.chunkOverlapTokens * 4,
    Math.floor(target / 4),
  );
  const sections: LlmWikiSourceSection[] = [];
  let start = 0;
  while (start < source.length) {
    const hardEnd = Math.min(source.length, start + target);
    let end = hardEnd < source.length ? findChunkBoundary(source, start, hardEnd) : source.length;
    while (
      end > start + 512 &&
      estimateCallInput(
        factExtractorInstructions(),
        { source: sectionForPrompt({ sectionId: "preview", title: "", headingPath: [], level: 0, startOffset: start, endOffset: end, content: source.slice(start, end) }), schema },
        FACT_RESPONSE_FORMAT,
      ) > llmWikiConfig.maxAnalyzeInputTokens
    ) {
      const nextHardEnd = Math.max(start + 512, end - 512);
      end = findChunkBoundary(source, start, nextHardEnd);
    }
    if (end <= start || estimateTokens(source.slice(start, end)) <= 0) {
      throw new Error("无法在 analyze token 预算内切分 source");
    }
    const content = source.slice(start, end);
    sections.push({
      sectionId: `c${String(sections.length + 1).padStart(4, "0")}`,
      title: firstHeading(content) || `Chunk ${sections.length + 1}`,
      headingPath: headingPathAt(source, start),
      level: 0,
      startOffset: start,
      endOffset: end,
      content,
    });
    if (end >= source.length) break;
    const next = Math.max(start + 1, end - overlap);
    const aligned = findNextLineStart(source, next);
    start = aligned > start ? aligned : next;
  }
  return sections;
}

function findChunkBoundary(source: string, start: number, hardEnd: number): number {
  const minimum = start + Math.floor((hardEnd - start) * 0.7);
  const candidates = ["\n#", "\n\n", "\n"];
  for (const marker of candidates) {
    let index = source.lastIndexOf(marker, hardEnd);
    while (index >= minimum) {
      const boundary = index + 1;
      if (!isInsideCodeFence(source, boundary)) return boundary;
      index = source.lastIndexOf(marker, index - 1);
    }
  }
  return hardEnd;
}

function isInsideCodeFence(source: string, offset: number): boolean {
  const prefix = source.slice(0, offset);
  const fences = prefix.match(/^\s*(```|~~~)/gm) || [];
  return fences.length % 2 === 1;
}

function findNextLineStart(source: string, offset: number): number {
  const line = source.lastIndexOf("\n", offset);
  return line >= 0 ? line + 1 : offset;
}

function headingPathAt(source: string, offset: number): string[] {
  const path: Array<{ level: number; title: string }> = [];
  const prefix = source.slice(0, Math.max(0, offset));
  for (const line of prefix.split("\n")) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const level = match[1].length;
    const title = match[2].replace(/\s+#*\s*$/, "").trim();
    while (path.length && path[path.length - 1].level >= level) path.pop();
    path.push({ level, title });
  }
  return path.map((item) => item.title);
}

function pageTypeForFacts(facts: LlmWikiFact[]): CandidatePageType {
  const types = new Set(facts.map((fact) => fact.type));
  if (types.has("error_case") || types.has("exception") || types.has("warning")) return "troubleshooting";
  if (types.has("procedure_step")) return "procedure";
  if (types.has("version_change")) return "changelog";
  if (["command", "config", "parameter", "default", "api_request", "api_response"].some((type) => types.has(type as LlmWikiFactType))) return "reference";
  if (types.has("relationship")) return "entity";
  return "concept";
}

function normalizeRawFacts(
  rawFacts: RawFact[] | undefined,
  section: LlmWikiSourceSection,
  sourceId: string,
  origin: "extract" | "audit",
): LlmWikiFact[] {
  const checkedAt = new Date().toISOString();
  return (Array.isArray(rawFacts) ? rawFacts : []).map((raw, index) => {
    const fact = stringField(raw.fact);
    const evidence = stringField(raw.evidence);
    if (!fact || !evidence) throw new Error(`fact ${index + 1} 缺少 fact/evidence`);
    if (fact.length > llmWikiConfig.maxFactTextChars) {
      throw new Error(`fact ${index + 1} 超过 ${llmWikiConfig.maxFactTextChars} 字符限制`);
    }
    if (evidence.length > llmWikiConfig.maxFactEvidenceChars) {
      throw new Error(`fact ${index + 1} evidence 超过 ${llmWikiConfig.maxFactEvidenceChars} 字符限制`);
    }
    const localOffset = section.content.indexOf(evidence);
    if (localOffset < 0) throw new Error(`fact ${index + 1} evidence 不是 source 原文子串: ${evidence.slice(0, 120)}`);
    const start = section.startOffset + localOffset;
    const end = start + evidence.length;
    const type = normalizeFactType(raw.type);
    const importance = normalizeImportance(raw.importance, type);
    const retention = normalizeRetention(raw.retention, type);
    return {
      factId: sha256(`${sourceId}\n${start}\n${end}\n${type}\n${fact}`).slice(0, 32),
      sourceId,
      sectionId: section.sectionId,
      type,
      importance,
      retention,
      required: true,
      origin,
      fact,
      evidence,
      sourceSpan: { start, end },
      entities: uniqueStrings(stringArray(raw.entities)).slice(0, 30),
      evidenceValidation: { valid: true, method: "exact_substring", checkedAt },
    };
  });
}

function dedupeFacts(facts: LlmWikiFact[]): LlmWikiFact[] {
  const seen = new Set<string>();
  const result: LlmWikiFact[] = [];
  for (const fact of facts.sort((a, b) => a.sourceSpan.start - b.sourceSpan.start)) {
    const key = `${fact.sourceId}:${fact.sourceSpan.start}:${fact.sourceSpan.end}:${fact.type}:${normalizeText(fact.fact)}:${normalizeText(fact.evidence)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(fact);
  }
  return result;
}

function planPagesDeterministically(
  args: { sourceId: string; filename: string; source: string },
  sourceMap: LlmWikiSourceMap,
  facts: LlmWikiFact[],
): LlmWikiSemanticPagePlan[] {
  const bySection = new Map(sourceMap.sections.map((section) => [section.sectionId, section]));
  const ordered = [...facts].sort((a, b) => a.sourceSpan.start - b.sourceSpan.start || a.factId.localeCompare(b.factId));
  const groups: LlmWikiFact[][] = [];
  let current: LlmWikiFact[] = [];
  let currentTokens = 0;
  let currentStart = 0;
  let currentSection = "";
  for (const fact of ordered) {
    const section = bySection.get(fact.sectionId);
    const nextTokens = estimateTokens(JSON.stringify(factForPrompt(fact)));
    const nextSpan = current.length ? fact.sourceSpan.end - currentStart : 0;
    const sectionChanged = !!current.length && currentSection !== fact.sectionId;
    const exceeds = current.length >= llmWikiConfig.maxFactsPerPage ||
      currentTokens + nextTokens > llmWikiConfig.maxPageFactInputTokens ||
      nextSpan > llmWikiConfig.maxPageSourceSpanChars;
    if (current.length && (exceeds || (sectionChanged && currentTokens >= Math.floor(llmWikiConfig.maxPageFactInputTokens * 0.55)))) {
      groups.push(current);
      current = [];
      currentTokens = 0;
      currentStart = 0;
    }
    if (nextTokens > llmWikiConfig.maxPageFactInputTokens) {
      throw new Error(`单条 fact 超过页面输入 token 上限: ${fact.factId}`);
    }
    if (!current.length) {
      currentStart = fact.sourceSpan.start;
      currentSection = fact.sectionId;
    }
    current.push(fact);
    currentTokens += nextTokens;
    if (section && !currentSection) currentSection = section.sectionId;
  }
  if (current.length) groups.push(current);
  if (!groups.length) throw new Error("planner 未生成页面");
  if (groups.length > llmWikiConfig.maxAffectedPages) {
    throw new Error(`deterministic planner 页面数 ${groups.length} 超过上限 ${llmWikiConfig.maxAffectedPages}`);
  }
  const seenPaths = new Set<string>();
  const plans = groups.map((group, index) => {
    const section = bySection.get(group[0].sectionId);
    const type: CandidatePageType = index === 0 ? "summary" : pageTypeForFacts(group);
    const baseTitle = index === 0
      ? sourceMap.title
      : (section?.headingPath.at(-1) || section?.title || `${sourceMap.title} ${index + 1}`);
    const title = index === 0 ? baseTitle : `${baseTitle}${groups.filter((item, i) => i < index && bySection.get(item[0].sectionId)?.title === section?.title).length ? ` (${index + 1})` : ""}`;
    let path = type === "summary" ? `summaries/${args.sourceId}.md` : sourceScopedPath(type, args.sourceId, title, index);
    if (seenPaths.has(path)) path = sourceScopedPath(type, args.sourceId, `${title}-${index + 1}`, index);
    seenPaths.add(path);
    return {
      path,
      title: title.slice(0, 160),
      type,
      tags: [type],
      semanticGoal: `完整承载 ${title} 的 required facts`,
      factIds: group.map((fact) => fact.factId),
      linkTargets: [],
    };
  });
  const assigned = plans.flatMap((plan) => plan.factIds);
  if (new Set(assigned).size !== facts.length || assigned.length !== facts.length) {
    throw new Error("deterministic planner 未让每条 required fact 获得唯一 owning page");
  }
  return plans;
}

function normalizeCoverage(
  rawFacts: unknown[] | undefined,
  expectedFacts: LlmWikiFact[],
  pages: LlmWikiCompileCandidatePage[],
): LlmWikiFactCoverageResult[] {
  const inputs = Array.isArray(rawFacts) ? rawFacts : [];
  const byId = new Map(inputs.map((raw) => {
    const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    return [stringField(input.factId), input] as const;
  }));
  return expectedFacts.map((fact) => {
    const input = byId.get(fact.factId);
    const rawStatus = stringField(input?.status);
    let status: LlmWikiFactCoverageResult["status"] = rawStatus === "correct" || rawStatus === "incorrect" ? rawStatus : "missing";
    const evidencePath = stringField(input?.evidencePath);
    const wikiEvidence = stringField(input?.wikiEvidence);
    const page = pages.find((item) => item.path === evidencePath);
    if (
      (status === "correct" || status === "incorrect") &&
      (!page || !wikiEvidence || !normalizeText(page.body).includes(normalizeText(wikiEvidence)))
    ) {
      status = "missing";
    }
    return {
      factId: fact.factId,
      status,
      evidencePath: status === "correct" || status === "incorrect" ? evidencePath : "",
      wikiEvidence: status === "correct" || status === "incorrect" ? wikiEvidence : "",
      reason: stringField(input?.reason) || (status === "missing" ? "最终页面没有可验证证据" : ""),
    };
  });
}

function missingCoverage(factId: string): LlmWikiFactCoverageResult {
  return {
    factId,
    status: "missing",
    evidencePath: "",
    wikiEvidence: "",
    reason: "coverage verifier 未返回该 fact",
  };
}

function buildCoverageReport(
  facts: LlmWikiFact[],
  results: LlmWikiFactCoverageResult[],
  repairPasses: number,
) {
  const resultById = new Map(results.map((result) => [result.factId, result]));
  const normalized = facts.map((fact) => resultById.get(fact.factId) || missingCoverage(fact.factId));
  const required = facts.filter((fact) => fact.required !== false);
  const must = facts.filter((fact) => fact.importance === "must");
  const correctIds = new Set(normalized.filter((result) => result.status === "correct").map((result) => result.factId));
  const missingMustFactIds = must.filter((fact) => !correctIds.has(fact.factId)).map((fact) => fact.factId);
  const missingRequiredFactIds = required.filter((fact) => !correctIds.has(fact.factId)).map((fact) => fact.factId);
  return {
    mustTotal: must.length,
    mustCovered: must.length - missingMustFactIds.length,
    mustCoverage: must.length ? (must.length - missingMustFactIds.length) / must.length : 1,
    missingMustFactIds,
    requiredTotal: required.length,
    requiredCovered: required.length - missingRequiredFactIds.length,
    requiredCoverage: required.length ? (required.length - missingRequiredFactIds.length) / required.length : 1,
    missingRequiredFactIds,
    totalFacts: facts.length,
    correct: normalized.filter((result) => result.status === "correct").length,
    missing: normalized.filter((result) => result.status === "missing").length,
    incorrect: normalized.filter((result) => result.status === "incorrect").length,
    repairPasses,
    facts: normalized,
  };
}

function groupRepairTargets(
  results: LlmWikiFactCoverageResult[],
  plans: LlmWikiSemanticPagePlan[],
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const result of results) {
    if (result.status === "correct") continue;
    const plan = plans.find((item) => item.factIds.includes(result.factId));
    if (!plan) continue;
    grouped.set(plan.path, uniqueStrings([...(grouped.get(plan.path) || []), result.factId]));
  }
  return grouped;
}

function buildPageClaims(
  sourceId: string,
  pages: LlmWikiCompileCandidatePage[],
  results: LlmWikiFactCoverageResult[],
): LlmWikiPageClaims[] {
  return pages.map((page) => ({
    path: page.path,
    factIds: results.filter((result) => result.status === "correct" && result.evidencePath === page.path).map((result) => result.factId),
    sourceIds: [sourceId],
    updatedAt: new Date().toISOString(),
  }));
}

function buildClaims(
  sourceId: string,
  facts: LlmWikiFact[],
  results: LlmWikiFactCoverageResult[],
): LlmWikiClaim[] {
  const byId = new Map(facts.map((fact) => [fact.factId, fact]));
  return results
    .filter((result) => result.status === "correct" && isWikiMarkdownPath(result.evidencePath))
    .map((result) => ({
      claimId: sha256(`${sourceId}\n${result.factId}\n${result.evidencePath}`).slice(0, 32),
      path: result.evidencePath,
      text: byId.get(result.factId)?.fact || result.wikiEvidence,
      sourceId,
    }));
}

function validateCandidate(
  pages: LlmWikiCompileCandidatePage[],
  coverage: ReturnType<typeof buildCoverageReport>,
): LlmWikiPublishGateIssue[] {
  const issues: LlmWikiPublishGateIssue[] = [];
  if (pages.length > llmWikiConfig.maxAffectedPages) issues.push(blocked("candidate", "候选页面数超过确认上限"));
  for (const page of pages) {
    try {
      assertWikiMarkdownPath(page.path);
    } catch {
      issues.push(blocked(page.path, "candidate 页面路径非法"));
    }
    if (!page.body.trim().startsWith("#")) issues.push(blocked(page.path, "candidate 页面缺少一级标题"));
    if (page.action === "delete") issues.push(blocked(page.path, "candidate 不允许自动删除 Wiki 页面"));
  }
  if ((coverage.missingRequiredFactIds || []).length) {
    issues.push(blocked("coverage", `最终页面缺少 ${coverage.missingRequiredFactIds?.length || 0} 条 required facts`));
  }
  if ((coverage.incorrect || 0) > 0) issues.push(blocked("coverage", `最终页面存在 ${coverage.incorrect} 条错误事实`));
  return issues;
}

function assertPlanMatches(
  plan: LlmWikiCompilePlan,
  args: {
    sourceId: string;
    source: string;
    schema: LlmWikiSchema;
    model: string;
    existingPages?: LlmWikiPageRef[];
  },
  analysisHash = "",
): void {
  if (!plan.sourceIds.includes(args.sourceId)) throw new Error("plan sourceId 不匹配");
  if (plan.sourceHash !== sha256(args.source)) throw new Error("plan source hash 已过期");
  if (plan.schemaHash !== args.schema.sha256) throw new Error("plan schema hash 已过期");
  if (plan.model !== args.model) throw new Error("plan model 已变化");
  if (plan.modelHash !== sha256(args.model)) throw new Error("plan model hash 已变化");
  if (plan.promptHash !== compilerPromptHash()) throw new Error("plan prompt hash 已变化");
  if (plan.wikiStateHash !== hashWikiState(args.existingPages || [], args.sourceId)) throw new Error("plan Wiki 状态已变化");
  if (analysisHash && plan.analysisHash !== analysisHash) throw new Error("plan analysis hash 不匹配");
}

function assertAnalysisMatches(
  analysis: LlmWikiAnalysisArtifact,
  args: { sourceId: string; source: string; schema: LlmWikiSchema; model: string },
): void {
  if (analysis.sourceId !== args.sourceId) throw new Error("analysis sourceId 不匹配");
  if (analysis.sourceHash !== sha256(args.source)) throw new Error("analysis source hash 已过期");
  if (analysis.schemaHash !== args.schema.sha256) throw new Error("analysis schema hash 已过期");
  if (analysis.model !== args.model) throw new Error("analysis model 已变化");
  if (analysis.modelHash !== sha256(args.model)) throw new Error("analysis model hash 已过期");
  if (analysis.promptHash !== compilerPromptHash()) throw new Error("analysis prompt hash 已过期");
  if (analysis.compilerVersion !== llmWikiConfig.compilerVersion || analysis.promptVersion !== llmWikiConfig.promptVersion) {
    throw new Error("analysis compiler/prompt 版本已过期");
  }
}

function factExtractorInstructions(): string {
  return [
    "你是 llmWiki 事实提取器。完整阅读 source chunk，提取所有可独立验证的事实。",
    "命令、配置、参数、默认值、数值、URL、版本、警告、约束和异常必须单独保留。",
    `fact 必须简洁且不超过 ${llmWikiConfig.maxFactTextChars} 个字符。`,
    `evidence 必须逐字复制 source chunk 中能证明该 fact 的最短连续原文，不得改写且不超过 ${llmWikiConfig.maxFactEvidenceChars} 个字符。`,
    "一段原文包含多项事实时拆成多条；不得为多条事实重复复制整段原文。",
    "不要因为事实相似而合并，不要引入原文之外的信息，只输出 JSON。",
  ].join("\n");
}

function factAuditInstructions(): string {
  return [
    "你是 llmWiki 事实遗漏审计器。对照完整 source chunk 和 existingFacts，只返回遗漏事实。",
    "重点检查命令参数、精确数值、条件、例外、错误处理、URL、版本变化。",
    `fact 必须简洁且不超过 ${llmWikiConfig.maxFactTextChars} 个字符。`,
    `evidence 必须逐字复制 source chunk 中能证明该 fact 的最短连续原文，不得改写且不超过 ${llmWikiConfig.maxFactEvidenceChars} 个字符。`,
    "没有遗漏时返回空数组，只输出 JSON。",
  ].join("\n");
}

function pageWriterInstructions(type: CandidatePageType): string {
  return [
    `你是 llmWiki ${type} 页面 writer。`,
    "把输入 facts 全部自然写入正文；命令、配置、参数、数值、URL、版本和错误码必须保留关键字面值。",
    "正文以一级标题开始，可以组织小节、表格和代码块，但不得省略分配事实。",
    "claimedFactIds 只能包含正文实际承载的 facts，只输出 JSON。",
  ].join("\n");
}

function coverageVerifierInstructions(): string {
  return [
    "你是 llmWiki 最终页面事实覆盖验证器。逐条判断 fact 是否被 final pages 明确支持。",
    "correct 必须返回 final page 中逐字存在的 wikiEvidence 和 evidencePath。",
    "缺少参数、数值、条件、URL 或关键限制时判 missing；与事实冲突时判 incorrect。",
    "不得依据原始 fact 本身判 correct，只输出 JSON。",
  ].join("\n");
}

function repairInstructions(): string {
  return [
    "你是 llmWiki 页面修复器。保持现有页面结构，把所有 missingOrIncorrectFacts 完整、准确地补入正文。",
    "精确保留命令、配置、参数、数值、URL、版本、条件和异常，不删除已有正确内容。",
    "每个输入 fact 都必须实际写入正文并列入 claimedFactIds，只输出 JSON。",
  ].join("\n");
}

export function compilerPromptHash(): string {
  return sha256(JSON.stringify({
    factExtractor: factExtractorInstructions(),
    factAudit: factAuditInstructions(),
    pageWriters: PAGE_TYPES.map((type) => pageWriterInstructions(type)),
    verifier: coverageVerifierInstructions(),
    repair: repairInstructions(),
    settings: {
      maxAnalyzeInputTokens: llmWikiConfig.maxAnalyzeInputTokens,
      chunkTargetChars: llmWikiConfig.chunkTargetChars,
      chunkOverlapTokens: llmWikiConfig.chunkOverlapTokens,
      maxFactsPerPage: llmWikiConfig.maxFactsPerPage,
      maxPageFactInputTokens: llmWikiConfig.maxPageFactInputTokens,
      maxPageSourceSpanChars: llmWikiConfig.maxPageSourceSpanChars,
      extractOutputTokens: llmWikiConfig.extractOutputTokens,
      auditOutputTokens: llmWikiConfig.auditOutputTokens,
      providerOutputUsageMarginTokens: llmWikiConfig.providerOutputUsageMarginTokens,
      modelCallTimeoutMs: llmWikiConfig.modelCallTimeoutMs,
    },
    schemas: [FACT_RESPONSE_FORMAT, AUDIT_RESPONSE_FORMAT, WRITER_RESPONSE_FORMAT, VERIFY_RESPONSE_FORMAT],
  }));
}

function hashWikiState(pages: LlmWikiPageRef[], sourceId: string): string {
  return sha256(JSON.stringify(
    pages
      .filter((page) => page.sources.includes(sourceId))
      .map((page) => ({
        path: page.path,
        updatedAt: page.updated_at,
        schemaHash: page.schema_hash,
        sources: [...page.sources].sort(),
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  ));
}

function chunkCacheKey(
  args: { sourceId: string; source: string; schema: LlmWikiSchema; model: string },
  section: LlmWikiSourceSection,
): string {
  return sha256(JSON.stringify({
    sourceId: args.sourceId,
    sourceHash: sha256(args.source),
    chunkId: section.sectionId,
    chunkStart: section.startOffset,
    chunkEnd: section.endOffset,
    chunkHash: sha256(section.content),
    schemaHash: args.schema.sha256,
    model: args.model,
    modelHash: sha256(args.model),
    promptHash: compilerPromptHash(),
    compilerVersion: llmWikiConfig.compilerVersion,
  }));
}

function sectionForPrompt(section: LlmWikiSourceSection) {
  return {
    sectionId: section.sectionId,
    startOffset: section.startOffset,
    endOffset: section.endOffset,
    content: section.content,
  };
}

function factForPrompt(fact: LlmWikiFact) {
  return {
    factId: fact.factId,
    type: fact.type,
    importance: fact.importance,
    retention: fact.retention,
    fact: fact.fact,
    evidence: fact.evidence,
    sourceSpan: fact.sourceSpan,
  };
}

function factForAnalysisPrompt(fact: LlmWikiFact) {
  return {
    factId: fact.factId,
    type: fact.type,
    importance: fact.importance,
    retention: fact.retention,
    fact: fact.fact,
  };
}

function pageForPrompt(page: LlmWikiCompileCandidatePage) {
  return { path: page.path, title: page.title, type: page.type, body: page.body };
}

function sourceScopedPath(type: CandidatePageType, sourceId: string, title: string, index: number): string {
  const directories: Record<CandidatePageType, string> = {
    summary: "summaries",
    concept: "concepts",
    entity: "entities",
    reference: "references",
    procedure: "procedures",
    changelog: "changelogs",
    troubleshooting: "troubleshooting",
  };
  const directory = directories[type];
  const slug = slugify(title) || `page-${index + 1}`;
  return `${directory}/${sourceId.slice(0, 8)}-${slug}.md`;
}

function candidateAffectedPages(sourceId: string, filename: string, existingPages: LlmWikiPageRef[]): string[] {
  return uniqueStrings([
    `summaries/${sourceId}.md`,
    ...existingPages.filter((page) => page.sources.includes(sourceId)).map((page) => page.path),
    `concepts/${sourceId.slice(0, 8)}-${slugify(filename.replace(/\.[^.]+$/, "")) || "source"}.md`,
  ]).filter(isWikiMarkdownPath);
}

function normalizeFactType(value: unknown): LlmWikiFactType {
  const type = stringField(value) as LlmWikiFactType;
  return FACT_TYPES.includes(type) ? type : "definition";
}

function normalizeImportance(value: unknown, type: LlmWikiFactType): LlmWikiFactImportance {
  const importance = stringField(value) as LlmWikiFactImportance;
  if (importance === "must" || importance === "should" || importance === "nice") return importance;
  return ["command", "config", "parameter", "default", "warning", "constraint", "exception", "version_change"].includes(type)
    ? "must"
    : "should";
}

function normalizeRetention(value: unknown, type: LlmWikiFactType): LlmWikiFactRetention {
  const retention = stringField(value) as LlmWikiFactRetention;
  if (retention === "exact" || retention === "semantic" || retention === "background") return retention;
  return ["command", "config", "parameter", "default", "version_change", "api_request", "api_response"].includes(type)
    ? "exact"
    : "semantic";
}

function normalizePageType(value: unknown, fallback: CandidatePageType): CandidatePageType {
  const type = stringField(value) as CandidatePageType;
  return PAGE_TYPES.includes(type) ? type : fallback;
}

function emptyUsage(): LlmWikiCompileUsage {
  return { modelCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, retries: 0, calls: [] };
}

function mergeUsage(a: LlmWikiCompileUsage, b: LlmWikiCompileUsage): LlmWikiCompileUsage {
  const inputTokens = a.inputTokens + b.inputTokens;
  const outputTokens = a.outputTokens + b.outputTokens;
  return {
    modelCalls: a.modelCalls + b.modelCalls,
    inputTokens,
    outputTokens,
    estimatedCostUsd: estimateCostUsd(inputTokens, outputTokens),
    retries: a.retries + b.retries,
    calls: [...a.calls, ...b.calls],
  };
}

function jsonSchema(name: string, schema: Record<string, unknown>): RawChatResponseFormat {
  return { type: "json_schema", json_schema: { name, strict: true, schema } };
}

function estimateTokens(text: string): number {
  // UTF-8 bytes are not tokens. Dividing by two remains conservative for CJK
  // while avoiding a 3-4x overestimate for ordinary Markdown and code.
  return Math.max(1, Math.ceil(Buffer.byteLength(String(text || ""), "utf8") / 2));
}

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return Number((
    (inputTokens / 1_000_000) * llmWikiConfig.tokenPriceInputPerMillion +
    (outputTokens / 1_000_000) * llmWikiConfig.tokenPriceOutputPerMillion
  ).toFixed(6));
}

function isBudgetError(message: string): boolean {
  return /budget_violation|预算已耗尽|超过确认上限|超过 token 硬上限/i.test(message);
}

function extractUsage(response: unknown): ModelUsage {
  const body = response && typeof response === "object" ? response as { usage?: unknown } : {};
  const usage = body.usage && typeof body.usage === "object" ? body.usage as Record<string, unknown> : {};
  return {
    inputTokens: pickNumber(usage.input_tokens) ?? pickNumber(usage.prompt_tokens) ?? 0,
    outputTokens: pickNumber(usage.output_tokens) ?? pickNumber(usage.completion_tokens) ?? 0,
  };
}

function extractContent(response: unknown): string {
  const choice = (response as ChatCompletionLike).choices?.[0];
  const content = choice?.message?.content ?? choice?.text;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) return String((part as { text?: unknown }).text || "");
      return "";
    }).join("");
  }
  throw new Error("模型未返回可解析内容");
}

function parseJsonObject(content: string, message: string): unknown {
  const raw = content.trim();
  const candidates = [
    raw,
    raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim(),
    raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // try next
    }
  }
  throw new Error(`${message}: ${raw.slice(0, 500) || "empty response"}`);
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error(LLM_WIKI_INGEST_STOPPED);
}

function blocked(target: string, message: string): LlmWikiPublishGateIssue {
  return { kind: "blocked_publish", target, message, details: "", source_ids: [] };
}

function ensureHeading(body: string, title: string): string {
  const content = String(body || "").trim();
  return /^#\s+/.test(content) ? content : `# ${title}\n\n${content}`;
}

function titleFromSource(source: string, filename: string): string {
  return firstHeading(source) || filename.replace(/\.[^.]+$/, "") || "Untitled";
}

function firstHeading(source: string): string {
  return /^#\s+(.+)$/m.exec(source)?.[1]?.trim() || "";
}

function normalizeText(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringField).filter(Boolean) : [];
}

function pickNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
