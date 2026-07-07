import { createHash } from "crypto";
import type {
  LlmWikiFact,
  LlmWikiFactImportance,
  LlmWikiFactRetention,
  LlmWikiFactType,
  LlmWikiNormalizedPage,
  LlmWikiPageClaims,
  LlmWikiPageType,
} from "../contracts/llm-wiki.types";

const MUST_BY_DEFAULT = new Set<LlmWikiFactType>([
  "warning",
  "constraint",
  "default",
  "version_change",
  "command",
  "config",
]);

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

export function defaultImportanceForFactType(type: LlmWikiFactType): LlmWikiFactImportance {
  return MUST_BY_DEFAULT.has(type) ? "must" : "should";
}

export function normalizeFact(
  value: unknown,
  context: {
    sourceId: string;
    sectionId: string;
    index: number;
    sectionStart: number;
    sectionEnd: number;
  },
): LlmWikiFact {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const type = normalizeFactType(input.type);
  const fact = stringField(input.fact).slice(0, 2000);
  const evidence = stringField(input.evidence || input.quote || input.sourceText).slice(0, 2000) || fact;
  if (!fact) throw new Error(`fact 为空: ${context.sectionId}#${context.index}`);
  const sourceSpan = normalizeSpan(input.sourceSpan, context.sectionStart, context.sectionEnd);
  const factId = normalizeFactId(input.factId, context.sourceId) || createFactId({
    sourceId: context.sourceId,
    sectionId: context.sectionId,
    index: context.index,
    text: `${type}\n${fact}\n${evidence}`,
  });
  return {
    factId,
    sourceId: context.sourceId,
    sectionId: stringField(input.sectionId) || context.sectionId,
    type,
    importance: normalizeImportance(input.importance, type),
    fact,
    evidence,
    sourceSpan,
    entities: stringArray(input.entities).slice(0, 20),
    retention: normalizeRetention(input.retention, type),
  };
}

export function createFactId(args: {
  sourceId: string;
  sectionId: string;
  index: number;
  text: string;
}): string {
  const digest = createHash("sha256")
    .update(`${args.sourceId}\n${args.sectionId}\n${args.index}\n${args.text}`)
    .digest("hex")
    .slice(0, 24);
  return `${args.sourceId}:${digest}`;
}

export function pageTypeForFact(fact: Pick<LlmWikiFact, "type">): Exclude<LlmWikiPageType, "index" | "summary"> {
  if (fact.type === "procedure_step") return "procedure";
  if (fact.type === "version_change") return "changelog";
  if (fact.type === "exception" || fact.type === "error_case") return "troubleshooting";
  if (
    fact.type === "command" ||
    fact.type === "config" ||
    fact.type === "parameter" ||
    fact.type === "default" ||
    fact.type === "api_request" ||
    fact.type === "api_response" ||
    fact.type === "warning" ||
    fact.type === "constraint"
  ) {
    return "reference";
  }
  return "concept";
}

export function pageDirForType(type: Exclude<LlmWikiPageType, "index">): string {
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

export function titleForFactGroup(type: LlmWikiPageType, facts: LlmWikiFact[], fallback: string): string {
  const primaryEntity = facts.flatMap((fact) => fact.entities).find(Boolean);
  if (primaryEntity) return primaryEntity.slice(0, 160);
  const first = facts[0]?.fact || fallback;
  const compact = first.replace(/\s+/g, " ").trim();
  if (type === "reference") return titleFromPrefix(compact, "参考");
  if (type === "procedure") return titleFromPrefix(compact, "流程");
  if (type === "changelog") return titleFromPrefix(compact, "变更");
  if (type === "troubleshooting") return titleFromPrefix(compact, "排障");
  return titleFromPrefix(compact, "概念");
}

export function pathForPage(type: Exclude<LlmWikiPageType, "index">, title: string, seed: string): string {
  if (type === "summary") return `summaries/${seed}.md`;
  const slug = slugify(title) || createHash("sha256").update(`${type}\n${title}\n${seed}`).digest("hex").slice(0, 12);
  return `${pageDirForType(type)}/${slug}.md`;
}

export function buildPageClaimsForPages(
  pages: Array<LlmWikiNormalizedPage & { factIds?: string[]; source_id?: string }>,
  facts: LlmWikiFact[],
): LlmWikiPageClaims[] {
  const factById = new Map(facts.map((fact) => [fact.factId, fact]));
  return pages.map((page) => {
    const factIds = uniqueStrings(page.factIds || []).filter((id) => factById.has(id));
    const sourceIds = uniqueStrings(factIds.map((id) => factById.get(id)?.sourceId || ""));
    return {
      path: page.path,
      factIds,
      sourceIds,
      updatedAt: new Date().toISOString(),
    };
  });
}

export function pageClaimsHash(relPath: string): string {
  return createHash("sha256").update(relPath).digest("hex").slice(0, 32);
}

export function slugify(text: string): string {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[`"'()[\]{}<>]+/g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 80);
}

export function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const item = String(value || "").trim();
    if (item) seen.add(item);
  }
  return [...seen];
}

export function normalizeFactType(value: unknown): LlmWikiFactType {
  const text = String(value || "").trim();
  return FACT_TYPES.includes(text as LlmWikiFactType) ? (text as LlmWikiFactType) : "definition";
}

function normalizeImportance(value: unknown, type: LlmWikiFactType): LlmWikiFactImportance {
  if (value === "must" || value === "should" || value === "nice") return value;
  return defaultImportanceForFactType(type);
}

function normalizeRetention(value: unknown, type: LlmWikiFactType): LlmWikiFactRetention {
  if (value === "exact" || value === "semantic" || value === "background") return value;
  if (
    type === "command" ||
    type === "config" ||
    type === "parameter" ||
    type === "default" ||
    type === "api_request" ||
    type === "api_response" ||
    type === "version_change"
  ) {
    return "exact";
  }
  return "semantic";
}

function normalizeSpan(value: unknown, fallbackStart: number, fallbackEnd: number): { start: number; end: number } {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const start = numberField(input.start, fallbackStart);
  const end = numberField(input.end, fallbackEnd);
  if (end < start) return { start: fallbackStart, end: fallbackEnd };
  return { start, end };
}

function normalizeFactId(value: unknown, sourceId: string): string {
  const text = stringField(value);
  return text.startsWith(`${sourceId}:`) && text.length <= 96 ? text : "";
}

function titleFromPrefix(text: string, fallback: string): string {
  const cleaned = text.replace(/^[-*]\s*/, "").slice(0, 80).trim();
  return cleaned || fallback;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return uniqueStrings(value);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberField(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}
