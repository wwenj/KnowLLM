import { Injectable } from "@nestjs/common";
import { createHash } from "crypto";
import { ModelService, type RawChatResponseFormat } from "../../model/model.service";
import {
  LlmWikiCompileResult,
  LlmWikiDraftPage,
  LlmWikiFact,
  LlmWikiFactLedger,
  LlmWikiPageClaims,
  LlmWikiPageRef,
  LlmWikiPageType,
  LlmWikiSchema,
  LlmWikiSemanticPagePlan,
  LlmWikiSemanticWriterPage,
  LlmWikiSourceMap,
  LlmWikiSourceSection,
} from "../contracts/llm-wiki.types";
import { assertWikiMarkdownPath } from "../llm-wiki-page.utils";
import {
  buildPageClaimsForPages,
  pathForPage,
  normalizeFact,
  uniqueStrings,
} from "./llm-wiki-fact.utils";
import { isFactSupportedByPageBody, runPublishGate } from "./llm-wiki-publish-gate";

interface ChatChoice {
  message?: { content?: unknown };
  text?: unknown;
}

interface ChatCompletionLike {
  choices?: ChatChoice[];
}

interface FactExtractorOutput {
  facts?: unknown[];
}

interface SemanticPlanOutput {
  pages?: unknown[];
}

interface SemanticWriterOutput {
  path?: unknown;
  title?: unknown;
  type?: unknown;
  tags?: unknown;
  body?: unknown;
  content?: unknown;
  claimedFactIds?: unknown;
}

type SemanticPageType = Exclude<LlmWikiPageType, "index">;

const MAX_SECTION_CHARS = 16_000;
const FACTS_PER_WRITER_CALL = 80;
const PAGE_TYPES: SemanticPageType[] = [
  "summary",
  "concept",
  "entity",
  "reference",
  "procedure",
  "changelog",
  "troubleshooting",
];

const FACT_TYPES = [
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

const FACT_EXTRACTOR_RESPONSE_FORMAT: RawChatResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "llm_wiki_fact_extractor",
    strict: true,
    schema: {
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
              sourceId: { type: "string" },
              sectionId: { type: "string" },
              type: { type: "string", enum: FACT_TYPES },
              importance: { type: "string", enum: ["must", "should", "nice"] },
              fact: { type: "string" },
              evidence: { type: "string" },
              sourceSpan: {
                type: "object",
                additionalProperties: false,
                properties: {
                  start: { type: "number" },
                  end: { type: "number" },
                },
                required: ["start", "end"],
              },
              entities: { type: "array", items: { type: "string" } },
              retention: { type: "string", enum: ["exact", "semantic", "background"] },
            },
            required: [
              "factId",
              "sourceId",
              "sectionId",
              "type",
              "importance",
              "fact",
              "evidence",
              "sourceSpan",
              "entities",
              "retention",
            ],
          },
        },
      },
      required: ["facts"],
    },
  },
};

const SEMANTIC_PLANNER_RESPONSE_FORMAT: RawChatResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "llm_wiki_semantic_page_plan",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        pages: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              path: { type: "string" },
              title: { type: "string" },
              type: { type: "string", enum: PAGE_TYPES },
              tags: { type: "array", items: { type: "string" } },
              semanticGoal: { type: "string" },
              factIds: { type: "array", items: { type: "string" } },
              linkTargets: { type: "array", items: { type: "string" } },
            },
            required: [
              "path",
              "title",
              "type",
              "tags",
              "semanticGoal",
              "factIds",
              "linkTargets",
            ],
          },
        },
      },
      required: ["pages"],
    },
  },
};

const SEMANTIC_WRITER_RESPONSE_FORMAT: RawChatResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "llm_wiki_semantic_page",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string" },
        title: { type: "string" },
        type: { type: "string", enum: PAGE_TYPES },
        tags: { type: "array", items: { type: "string" } },
        body: { type: "string" },
        claimedFactIds: { type: "array", items: { type: "string" } },
      },
      required: ["path", "title", "type", "tags", "body", "claimedFactIds"],
    },
  },
};

@Injectable()
export class LlmWikiCompilerService {
  constructor(private readonly model: ModelService) {}

  async compileSource(args: {
    sourceId: string;
    filename: string;
    source: string;
    existingPages: LlmWikiPageRef[];
    schema: LlmWikiSchema;
    model: string;
    signal?: AbortSignal;
  }): Promise<LlmWikiCompileResult> {
    assertNotAborted(args.signal);
    const sourceMap = this.sectionSource({
      sourceId: args.sourceId,
      filename: args.filename,
      source: args.source,
    });
    assertNotAborted(args.signal);
    const factLedger = await this.extractFacts({
      sourceMap,
      schema: args.schema,
      model: args.model,
      signal: args.signal,
    });
    assertNotAborted(args.signal);
    const plans = await this.planPages({
      sourceId: args.sourceId,
      filename: args.filename,
      sourceMap,
      facts: factLedger.facts,
      existingPages: args.existingPages,
      schema: args.schema,
      model: args.model,
      signal: args.signal,
    });
    assertNotAborted(args.signal);
    const written = await this.writePages({
      sourceId: args.sourceId,
      sourceMap,
      facts: factLedger.facts,
      plans,
      schema: args.schema,
      model: args.model,
      signal: args.signal,
    });
    assertNotAborted(args.signal);
    const pages = this.normalizePages(
      written.map((page) => ({
        path: page.path,
        title: page.title,
        type: page.type,
        tags: page.tags,
        body: page.body,
        source_id: args.sourceId,
        factIds: page.claimedFactIds,
      })),
    ).filter((page) => page.type === "summary" || (page.factIds || []).length > 0);
    const pageClaims = this.buildPageClaims(pages, factLedger.facts);
    const gate = this.runPublishGate({ pages, pageClaims, facts: factLedger.facts });
    return {
      sourceMap,
      factLedger,
      pages: gate.pages,
      pageClaims: gate.pageClaims,
      coverage: gate.coverage,
      issues: gate.issues,
    };
  }

  sectionSource(args: {
    sourceId: string;
    filename: string;
    source: string;
  }): LlmWikiSourceMap {
    const source = String(args.source || "");
    const headingSections = splitByHeadings(source);
    const sections: Array<Omit<LlmWikiSourceSection, "sectionId">> = [];
    for (const section of headingSections) {
      sections.push(...splitByBlocks(section));
    }
    const normalized = sections.map((section, index) => ({
      ...section,
      sectionId: `s${String(index + 1).padStart(4, "0")}`,
    }));
    return {
      sourceId: args.sourceId,
      filename: args.filename,
      sha256: createHash("sha256").update(source).digest("hex"),
      title: normalized.find((section) => section.headingPath.length)?.headingPath[0] || args.filename,
      sections: normalized,
    };
  }

  private async extractFacts(args: {
    sourceMap: LlmWikiSourceMap;
    schema: LlmWikiSchema;
    model: string;
    signal?: AbortSignal;
  }): Promise<LlmWikiFactLedger> {
    const facts: LlmWikiFact[] = [];
    for (const section of args.sourceMap.sections) {
      assertNotAborted(args.signal);
      if (!section.content.trim()) continue;
      const raw = await this.callFactExtractor({
        sourceMap: args.sourceMap,
        section,
        schema: args.schema,
        model: args.model,
        signal: args.signal,
      });
      assertNotAborted(args.signal);
      raw.forEach((item, index) => {
        facts.push(
          normalizeFact(item, {
            sourceId: args.sourceMap.sourceId,
            sectionId: section.sectionId,
            index,
            sectionStart: section.startOffset,
            sectionEnd: section.endOffset,
          }),
        );
      });
    }
    const deduped = dedupeFacts(facts);
    if (!deduped.length) throw new Error("fact extractor 未抽取到任何 fact，编译失败");
    return {
      sourceId: args.sourceMap.sourceId,
      schemaHash: args.schema.sha256,
      model: args.model,
      generatedAt: new Date().toISOString(),
      facts: deduped,
    };
  }

  private async callFactExtractor(args: {
    sourceMap: LlmWikiSourceMap;
    section: LlmWikiSourceSection;
    schema: LlmWikiSchema;
    model: string;
    signal?: AbortSignal;
  }): Promise<unknown[]> {
    const res = await this.model.chat({
      model: args.model,
      temperature: 0,
      response_format: FACT_EXTRACTOR_RESPONSE_FORMAT,
      signal: args.signal,
      messages: [
        { role: "system", content: factExtractorInstructions() },
        {
          role: "user",
          content: JSON.stringify(
            {
              output_schema: {
                facts:
                  "array of {factId,sourceId,sectionId,type,importance,fact,evidence,sourceSpan:{start,end},entities,retention}",
              },
              source: {
                sourceId: args.sourceMap.sourceId,
                filename: args.sourceMap.filename,
                title: args.sourceMap.title,
              },
              section: args.section,
              schema: args.schema.content,
            },
            null,
            2,
          ),
        },
      ],
    });
    const output = parseFactsOutput(extractContent(res));
    return Array.isArray(output.facts) ? output.facts : [];
  }

  private async planPages(args: {
    sourceId: string;
    filename: string;
    sourceMap: LlmWikiSourceMap;
    facts: LlmWikiFact[];
    existingPages: LlmWikiPageRef[];
    schema: LlmWikiSchema;
    model: string;
    signal?: AbortSignal;
  }): Promise<LlmWikiSemanticPagePlan[]> {
    assertNotAborted(args.signal);
    const res = await this.model.chat({
      model: args.model,
      temperature: 0,
      response_format: SEMANTIC_PLANNER_RESPONSE_FORMAT,
      signal: args.signal,
      messages: [
        { role: "system", content: semanticPlannerInstructions() },
        {
          role: "user",
          content: JSON.stringify(
            {
              output_schema: {
                pages:
                  "array of {path,title,type,tags,semanticGoal,factIds,linkTargets}; type is summary|concept|entity|reference|procedure|changelog|troubleshooting",
              },
              source: {
                sourceId: args.sourceId,
                filename: args.filename,
                title: args.sourceMap.title,
                sections: args.sourceMap.sections.map((section) => ({
                  sectionId: section.sectionId,
                  title: section.title,
                  headingPath: section.headingPath,
                })),
              },
              schema: args.schema.content,
              existingPages: args.existingPages
                .filter((page) => page.path !== "index.md")
                .slice(0, 120)
                .map((page) => ({
                  path: page.path,
                  title: page.title,
                  type: page.type,
                  tags: page.tags,
                })),
              facts: factsForPrompt(args.facts),
            },
            null,
            2,
          ),
        },
      ],
    });
    const output = parseSemanticPlanOutput(extractContent(res));
    return normalizeSemanticPlans({
      rawPages: output.pages,
      sourceId: args.sourceId,
      filename: args.filename,
      facts: args.facts,
      existingPages: args.existingPages,
    });
  }

  private async writePages(args: {
    sourceId: string;
    sourceMap: LlmWikiSourceMap;
    facts: LlmWikiFact[];
    plans: LlmWikiSemanticPagePlan[];
    schema: LlmWikiSchema;
    model: string;
    signal?: AbortSignal;
  }): Promise<LlmWikiSemanticWriterPage[]> {
    const factById = new Map(args.facts.map((fact) => [fact.factId, fact]));
    const plannedPaths = new Set(args.plans.map((plan) => plan.path));
    const pages: LlmWikiSemanticWriterPage[] = [];
    for (const plan of args.plans) {
      assertNotAborted(args.signal);
      const assignedFacts = plan.factIds.map((factId) => factById.get(factId)).filter((fact): fact is LlmWikiFact => !!fact);
      if (!assignedFacts.length) throw new Error(`semantic writer 页面没有可写 facts: ${plan.path}`);
      const res = await this.model.chat({
        model: args.model,
        temperature: 0.2,
        response_format: SEMANTIC_WRITER_RESPONSE_FORMAT,
        signal: args.signal,
        messages: [
          { role: "system", content: semanticWriterInstructions(plan.type) },
          {
            role: "user",
            content: JSON.stringify(
              {
                output_schema: {
                  path: "string",
                  title: "string",
                  type: "summary|concept|entity|reference|procedure|changelog|troubleshooting",
                  tags: "string[]",
                  body: "markdown string",
                  claimedFactIds: "string[]",
                },
                schema: args.schema.content,
                source: {
                  sourceId: args.sourceId,
                  title: args.sourceMap.title,
                  sectionHints: sourceSectionHints(args.sourceMap, assignedFacts),
                },
                pagePlan: plan,
                allowedLinks: [...plannedPaths].filter((path) => path !== plan.path),
                facts: factsForPrompt(assignedFacts).slice(0, FACTS_PER_WRITER_CALL),
              },
              null,
              2,
            ),
          },
        ],
      });
      assertNotAborted(args.signal);
      const output = parseSemanticWriterOutput(extractContent(res));
      pages.push(normalizeSemanticWriterPage(output, plan, assignedFacts));
    }
    return pages;
  }

  private normalizePages(pages: LlmWikiDraftPage[]): LlmWikiDraftPage[] {
    const seen = new Set<string>();
    return pages.map((page, index) => {
      const path = uniquePagePath(page.path, seen, index);
      assertWikiMarkdownPath(path);
      return {
        ...page,
        path,
        title: page.title.trim().slice(0, 160) || "Untitled",
        tags: uniqueStrings(page.tags).slice(0, 20),
        body: ensureHeading(page.body, page.title),
      };
    });
  }

  private buildPageClaims(pages: LlmWikiDraftPage[], facts: LlmWikiFact[]): LlmWikiPageClaims[] {
    const factById = new Map(facts.map((fact) => [fact.factId, fact]));
    const verified = pages.map((page) => ({
      ...page,
      factIds: uniqueStrings(page.factIds || []).filter((factId) => {
        const fact = factById.get(factId);
        return !!fact && isFactSupportedByPageBody(fact, page.body);
      }),
    }));
    return buildPageClaimsForPages(verified, facts);
  }

  private runPublishGate(args: {
    pages: LlmWikiDraftPage[];
    pageClaims: LlmWikiPageClaims[];
    facts: LlmWikiFact[];
  }) {
    return runPublishGate(args);
  }
}

export const LLM_WIKI_INGEST_STOPPED = "LLM_WIKI_INGEST_STOPPED";

function assertNotAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw new Error(LLM_WIKI_INGEST_STOPPED);
}

function splitByHeadings(source: string): Omit<LlmWikiSourceSection, "sectionId">[] {
  const sections: Omit<LlmWikiSourceSection, "sectionId">[] = [];
  const lines = source.match(/.*(?:\n|$)/g)?.filter((line) => line.length) || [];
  const headingPath: string[] = [];
  let offset = 0;
  let current = createSection("Document", [], 0, 0);
  let inFence = false;

  for (const line of lines) {
    const start = offset;
    offset += line.length;
    if (/^\s*```/.test(line)) inFence = !inFence;
    const heading = !inFence ? /^(#{1,6})\s+(.+?)\s*$/.exec(line.trimEnd()) : null;
    if (heading) {
      flushSection(current, start, source, sections);
      const level = heading[1].length;
      headingPath.splice(level - 1);
      headingPath[level - 1] = heading[2].trim();
      current = createSection(heading[2].trim(), headingPath.slice(0, level), level, start);
    }
    current.content += line;
  }
  flushSection(current, source.length, source, sections);
  return sections.length
    ? sections
    : [
        {
          title: "Document",
          headingPath: [],
          level: 0,
          startOffset: 0,
          endOffset: source.length,
          content: source,
        },
      ];
}

function splitByBlocks(section: Omit<LlmWikiSourceSection, "sectionId">): Omit<LlmWikiSourceSection, "sectionId">[] {
  if (section.content.length <= MAX_SECTION_CHARS) return [section];
  const blocks: Array<{ content: string; start: number; end: number; kind: string }> = [];
  const lines = section.content.match(/.*(?:\n|$)/g)?.filter((line) => line.length) || [];
  let offset = section.startOffset;
  let current = { content: "", start: offset, end: offset, kind: "" };
  let inFence = false;

  for (const line of lines) {
    const start = offset;
    offset += line.length;
    const kind = classifyLine(line, inFence);
    if (/^\s*```/.test(line)) inFence = !inFence;
    const shouldSplit =
      current.content.length > 0 &&
      (current.content.length + line.length > MAX_SECTION_CHARS || (current.kind && kind && current.kind !== kind));
    if (shouldSplit) {
      blocks.push(current);
      current = { content: "", start, end: start, kind };
    }
    if (!current.kind) current.kind = kind;
    current.content += line;
    current.end = offset;
  }
  if (current.content.trim()) blocks.push(current);
  return blocks.map((block, index) => ({
    title: `${section.title} ${block.kind || "block"} ${index + 1}`.trim(),
    headingPath: section.headingPath,
    level: section.level,
    startOffset: block.start,
    endOffset: block.end,
    content: block.content,
  }));
}

function createSection(
  title: string,
  headingPath: string[],
  level: number,
  startOffset: number,
): Omit<LlmWikiSourceSection, "sectionId"> {
  return {
    title,
    headingPath,
    level,
    startOffset,
    endOffset: startOffset,
    content: "",
  };
}

function flushSection(
  section: Omit<LlmWikiSourceSection, "sectionId">,
  endOffset: number,
  source: string,
  sections: Omit<LlmWikiSourceSection, "sectionId">[],
): void {
  if (!section.content.trim()) return;
  sections.push({
    ...section,
    endOffset,
    content: source.slice(section.startOffset, endOffset),
  });
}

function classifyLine(line: string, inFence: boolean): string {
  if (inFence || /^\s*```/.test(line)) return "code";
  if (/^\s*\|.*\|\s*$/.test(line)) return "table";
  if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) return "list";
  if (/^\s*(?:[A-Za-z0-9_.-]+\s*[:=]|\[[^\]]+\])/.test(line)) return "config";
  return "paragraph";
}

function factExtractorInstructions(): string {
  return `
你是 LLM Wiki fact extractor，只从给定 section 抽取可追踪事实。
只输出 JSON，不输出 Markdown 代码块。
每个 fact 必须包含 factId、sourceId、sectionId、type、importance、fact、evidence、sourceSpan、entities、retention。
type 只能是 definition、command、config、parameter、default、procedure_step、warning、constraint、exception、version_change、api_request、api_response、error_case、relationship。
importance 只能是 must、should、nice。warning、constraint、default、version_change、command、config 默认 must。
retention 只能是 exact、semantic、background。命令、配置、参数、默认值、API 示例、版本变更应优先 exact。
sourceSpan 使用原始 source 字符偏移；无法精确定位时使用 section 的 startOffset/endOffset。
不要合并互相独立的事实，不要引入 section 外知识。
`.trim();
}

function semanticPlannerInstructions(): string {
  return `
你是 LLM Wiki semantic page planner。你的任务不是生成 facts 列表，而是规划可长期阅读的语义 Wiki 页面。
只输出 JSON，不输出 Markdown 代码块。
输出 pages 数组，每个页面包含 path、title、type、tags、semanticGoal、factIds、linkTargets。
页面类型只能是 summary、concept、entity、reference、procedure、changelog、troubleshooting。
页面必须是长语义页面的规划：一个页面表达一个完整主题，不要把每条 fact 拆成一个页面。
reference 承载命令、配置、参数、默认值、API 示例；procedure 承载安装、校准、操作流程；changelog 承载版本和行为变化；troubleshooting 承载错误、异常和排障；concept/entity 承载解释和关系；summary 承载 source 的整体理解和入口。
factIds 是该页面必须承载的事实账本，不是正文结构。所有 must fact 必须进入至少一个页面。
linkTargets 只能指向本次计划中的页面路径或已有页面路径；不要编造无法落地的路径。
不要为了检索粒度制造短页面；优先让 Agent 单页读懂一个主题。
`.trim();
}

function semanticWriterInstructions(type: SemanticPageType): string {
  return `
你是 LLM Wiki semantic page writer。你要把 pagePlan 和 facts 写成可阅读的 Markdown Wiki 页面。
只输出 JSON，不输出 Markdown 代码块。
正文必须是完整 Markdown，以一级标题开头。
正式正文不能写成事实清单、审计日志或 evidence dump；不要批量输出 Evidence:、Trace:、factId、sourceSpan。
facts 是写作约束和账本，不是页面结构。你必须把 claimedFactIds 对应的信息自然写入页面正文。
retention=exact 的命令、配置、参数、默认值、API 请求/响应、版本号和错误码必须保留关键字面值。
retention=semantic 的事实可以综合表达，但不能改变含义。
页面类型是 ${type}。请按该类型组织正文：summary 写整体理解；reference 用表格/代码块/小节；procedure 写连续步骤；changelog 写版本变化；troubleshooting 写现象-原因-处理；concept/entity 写解释、关系和边界。
可以使用 [[path.md]] 连接 allowedLinks 中的相关页面。不要链接未知页面。
claimedFactIds 只能包含正文实际承载的 factId。不要 claim 没写进正文的 fact。
`.trim();
}

function parseFactsOutput(content: string): FactExtractorOutput {
  const parsed = parseJsonObject(content, "fact extractor 输出不是合法 JSON") as FactExtractorOutput;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.facts)) {
    throw new Error("fact extractor 输出不是合法 JSON");
  }
  return parsed;
}

function parseSemanticPlanOutput(content: string): SemanticPlanOutput {
  const parsed = parseJsonObject(content, "semantic planner 输出不是合法 JSON") as SemanticPlanOutput;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.pages)) {
    throw new Error("semantic planner 输出不是合法 JSON");
  }
  return parsed;
}

function parseSemanticWriterOutput(content: string): SemanticWriterOutput {
  const parsed = parseJsonObject(content, "semantic writer 输出不是合法 JSON") as SemanticWriterOutput;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("semantic writer 输出不是合法 JSON");
  }
  return parsed;
}

function parseJsonObject(content: string, errorMessage: string): unknown {
  const raw = content.trim();
  const candidates = [
    raw,
    raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim(),
    extractJsonObject(raw),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next candidate
    }
  }
  throw new Error(`${errorMessage}: ${raw.slice(0, 500) || "empty response"}`);
}

function extractContent(res: unknown): string {
  const body = res as ChatCompletionLike;
  const choice = body.choices?.[0];
  const content = choice?.message?.content ?? choice?.text;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text || "");
        }
        return "";
      })
      .join("");
  }
  throw new Error("模型未返回可解析内容");
}

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : "";
}

function normalizeSemanticPlans(args: {
  rawPages: unknown[] | undefined;
  sourceId: string;
  filename: string;
  facts: LlmWikiFact[];
  existingPages: LlmWikiPageRef[];
}): LlmWikiSemanticPagePlan[] {
  const factById = new Map(args.facts.map((fact) => [fact.factId, fact]));
  const existingPaths = new Set(args.existingPages.map((page) => page.path));
  const seenPaths = new Set<string>();
  const rawPages = Array.isArray(args.rawPages) ? args.rawPages : [];
  const plans = rawPages
    .map((item, index) => normalizeSemanticPlan(item, {
      sourceId: args.sourceId,
      filename: args.filename,
      index,
      factById,
      seenPaths,
      existingPaths,
    }))
    .filter((plan): plan is LlmWikiSemanticPagePlan => !!plan);
  if (!plans.some((plan) => plan.type === "summary")) {
    throw new Error("semantic planner 必须生成 summary 页面");
  }
  const claimed = new Set(plans.flatMap((plan) => plan.factIds));
  const missingMust = args.facts.filter((fact) => fact.importance === "must" && !claimed.has(fact.factId));
  if (missingMust.length) {
    throw new Error(`semantic planner 未覆盖 must facts: ${missingMust.map((fact) => fact.factId).join(", ")}`);
  }
  if (!plans.length) throw new Error("semantic planner 未生成任何页面");
  const plannedPaths = new Set(plans.map((plan) => plan.path));
  return plans.map((plan) => ({
    ...plan,
    linkTargets: plan.linkTargets.filter((target) => plannedPaths.has(target) || existingPaths.has(target)),
  }));
}

function normalizeSemanticPlan(
  value: unknown,
  args: {
    sourceId: string;
    filename: string;
    index: number;
    factById: Map<string, LlmWikiFact>;
    seenPaths: Set<string>;
    existingPaths: Set<string>;
  },
): LlmWikiSemanticPagePlan | null {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const type = normalizePageType(raw.type);
  if (!type) return null;
  const title = stringField(raw.title).slice(0, 160) || (type === "summary" ? args.filename : `${type}-${args.index + 1}`);
  const rawFactIds = stringArray(raw.factIds).filter((factId) => args.factById.has(factId));
  if (!rawFactIds.length) throw new Error(`semantic planner 页面没有有效 factIds: ${title}`);
  const path = uniquePath(normalizePlanPath(raw.path, type, title, args.sourceId, args.index), args.seenPaths);
  assertWikiMarkdownPath(path);
  return {
    path,
    title,
    type,
    tags: uniqueStrings([type, ...stringArray(raw.tags)]).slice(0, 20),
    semanticGoal: stringField(raw.semanticGoal) || `编译 ${title} 的语义 Wiki 页面`,
    factIds: rawFactIds,
    linkTargets: uniqueStrings(stringArray(raw.linkTargets)).filter((target) => target !== path),
  };
}

function normalizeSemanticWriterPage(
  output: SemanticWriterOutput,
  plan: LlmWikiSemanticPagePlan,
  assignedFacts: LlmWikiFact[],
): LlmWikiSemanticWriterPage {
  const body = stringField(output.body) || stringField(output.content);
  if (!body.trim()) throw new Error(`semantic writer 未生成正文: ${plan.path}`);
  const assigned = new Set(assignedFacts.map((fact) => fact.factId));
  const supportedFactIds = assignedFacts
    .filter((fact) => isFactSupportedByPageBody(fact, body))
    .map((fact) => fact.factId);
  const supported = new Set(supportedFactIds);
  const claimedFactIds = uniqueStrings([...stringArray(output.claimedFactIds), ...supportedFactIds]).filter(
    (factId) => assigned.has(factId) && supported.has(factId),
  );
  return {
    path: plan.path,
    title: plan.title,
    type: plan.type,
    tags: uniqueStrings([...plan.tags, ...stringArray(output.tags)]).slice(0, 20),
    body: ensureHeading(body, plan.title),
    claimedFactIds,
  };
}

function normalizePlanPath(
  value: unknown,
  type: SemanticPageType,
  title: string,
  sourceId: string,
  index: number,
): string {
  if (type === "summary") return `summaries/${sourceId}.md`;
  const candidate = stringField(value).replace(/\\/g, "/");
  if (candidate && pathMatchesType(candidate, type)) return candidate;
  return pathForPage(type, title, `${sourceId}-${type}-${index + 1}`);
}

function pathMatchesType(relPath: string, type: SemanticPageType): boolean {
  if (type === "summary") return /^summaries\/[a-f0-9]{32}\.md$/.test(relPath);
  return relPath.startsWith(`${dirForType(type)}/`) && /^[A-Za-z0-9._/-]+\.md$/.test(relPath);
}

function dirForType(type: SemanticPageType): string {
  return {
    summary: "summaries",
    concept: "concepts",
    entity: "entities",
    reference: "references",
    procedure: "procedures",
    changelog: "changelogs",
    troubleshooting: "troubleshooting",
  }[type];
}

function normalizePageType(value: unknown): SemanticPageType | null {
  const text = String(value || "").trim();
  return PAGE_TYPES.includes(text as SemanticPageType) ? (text as SemanticPageType) : null;
}

function factsForPrompt(facts: LlmWikiFact[]) {
  return facts.map((fact) => ({
    factId: fact.factId,
    sourceId: fact.sourceId,
    sectionId: fact.sectionId,
    type: fact.type,
    importance: fact.importance,
    retention: fact.retention,
    fact: fact.fact,
    evidence: fact.evidence,
    entities: fact.entities,
    sourceSpan: fact.sourceSpan,
  }));
}

function sourceSectionHints(sourceMap: LlmWikiSourceMap, facts: LlmWikiFact[]) {
  const sectionIds = new Set(facts.map((fact) => fact.sectionId));
  return sourceMap.sections
    .filter((section) => sectionIds.has(section.sectionId))
    .map((section) => ({
      sectionId: section.sectionId,
      title: section.title,
      headingPath: section.headingPath,
      excerpt: section.content.replace(/\s+/g, " ").trim().slice(0, 1200),
    }));
}

function dedupeFacts(facts: LlmWikiFact[]): LlmWikiFact[] {
  const seen = new Set<string>();
  const result: LlmWikiFact[] = [];
  for (const fact of facts) {
    const key = `${fact.sourceId}:${fact.sectionId}:${fact.type}:${fact.fact.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(fact);
  }
  return result;
}

function uniquePagePath(path: string, seen: Set<string>, index: number): string {
  let current = path || `concepts/page-${index + 1}.md`;
  let count = 2;
  while (seen.has(current)) {
    current = current.replace(/\.md$/, `-${count}.md`);
    count += 1;
  }
  seen.add(current);
  return current;
}

function uniquePath(path: string, seen: Set<string>): string {
  let current = path;
  let count = 2;
  while (seen.has(current)) {
    current = path.replace(/\.md$/, `-${count}.md`);
    count += 1;
  }
  seen.add(current);
  return current;
}

function ensureHeading(content: string, title: string): string {
  const text = String(content || "").trim();
  return `${text.startsWith("#") ? text : `# ${title}\n\n${text || "未生成有效内容。"}`}\n`;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return uniqueStrings(value);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
