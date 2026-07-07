import type {
  LlmWikiCoverageReport,
  LlmWikiDraftPage,
  LlmWikiFact,
  LlmWikiPageClaims,
  LlmWikiPublishGateIssue,
} from "../contracts/llm-wiki.types";
import { extractWikiLinks, isWikiMarkdownPath } from "../llm-wiki-page.utils";
import { uniqueStrings } from "./llm-wiki-fact.utils";

export interface LlmWikiPublishGateInput {
  pages: LlmWikiDraftPage[];
  pageClaims: LlmWikiPageClaims[];
  facts: LlmWikiFact[];
}

export interface LlmWikiPublishGateResult {
  pages: LlmWikiDraftPage[];
  pageClaims: LlmWikiPageClaims[];
  coverage: LlmWikiCoverageReport;
  issues: LlmWikiPublishGateIssue[];
  passed: boolean;
}

export function runPublishGate(input: LlmWikiPublishGateInput): LlmWikiPublishGateResult {
  const issues: LlmWikiPublishGateIssue[] = [];
  const merged = mergeDuplicateTitles(input.pages, input.pageClaims, issues);
  const linked = fixDeadLinks(merged.pages, issues);
  const pagePaths = new Set(linked.map((page) => page.path));
  const pageClaims = merged.pageClaims.filter((claim) => pagePaths.has(claim.path));
  issues.push(...validateSemanticPages(linked, pageClaims, input.facts));
  const coverage = calculateCoverage(input.facts, pageClaims);
  if (coverage.mustTotal > 0 && coverage.mustCoverage < 0.95) {
    issues.push({
      kind: "blocked_publish",
      target: "coverage",
      message: "must fact 覆盖率不足，禁止发布",
      details: `mustCoverage=${coverage.mustCoverage.toFixed(4)}, missing=${coverage.missingMustFactIds.join(", ")}`,
      source_ids: uniqueStrings(input.facts.map((fact) => fact.sourceId)),
    });
  }
  return {
    pages: linked,
    pageClaims,
    coverage,
    issues,
    passed: !issues.some((issue) => issue.kind === "blocked_publish"),
  };
}

function validateSemanticPages(
  pages: LlmWikiDraftPage[],
  claims: LlmWikiPageClaims[],
  facts: LlmWikiFact[],
): LlmWikiPublishGateIssue[] {
  const issues: LlmWikiPublishGateIssue[] = [];
  const pageByPath = new Map(pages.map((page) => [page.path, page]));
  const factById = new Map(facts.map((fact) => [fact.factId, fact]));
  for (const page of pages) {
    if (looksLikeFactDump(page.body)) {
      issues.push({
        kind: "blocked_publish",
        target: page.path,
        message: "正式 Wiki 页面不能是 fact/evidence/trace 清单",
        details: "页面正文包含批量 Evidence、Trace、factId 或 sourceSpan 痕迹，需要改成语义 Wiki 页面。",
        source_ids: [page.source_id],
      });
    }
  }
  for (const claim of claims) {
    const page = pageByPath.get(claim.path);
    if (!page) continue;
    for (const factId of claim.factIds) {
      const fact = factById.get(factId);
      if (!fact) continue;
      if (!isFactSupportedByPageBody(fact, page.body)) {
        issues.push({
          kind: "blocked_publish",
          target: claim.path,
          message: "page-claims 声明的 fact 未被页面正文支撑",
          details: `${fact.factId}: ${fact.fact}`,
          source_ids: [fact.sourceId],
        });
      }
    }
  }
  return issues;
}

function mergeDuplicateTitles(
  pages: LlmWikiDraftPage[],
  claims: LlmWikiPageClaims[],
  issues: LlmWikiPublishGateIssue[],
): { pages: LlmWikiDraftPage[]; pageClaims: LlmWikiPageClaims[] } {
  const claimsByPath = new Map(claims.map((claim) => [claim.path, claim]));
  const groups = new Map<string, LlmWikiDraftPage[]>();
  for (const page of pages) {
    const key = `${page.type}:${canonicalTitle(page.title)}`;
    groups.set(key, [...(groups.get(key) || []), page]);
  }

  const resultPages: LlmWikiDraftPage[] = [];
  const resultClaims: LlmWikiPageClaims[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      const page = group[0];
      resultPages.push(page);
      const claim = claimsByPath.get(page.path);
      if (claim) resultClaims.push(claim);
      continue;
    }
    const [first, ...rest] = group;
    const body = [
      first.body,
      ...rest.map((page) => {
        const body = stripHeading(page.body, page.title);
        return body ? `## ${page.title}\n\n${body}` : "";
      }),
    ]
      .filter(Boolean)
      .join("\n\n");
    const factIds = uniqueStrings(group.flatMap((page) => claimsByPath.get(page.path)?.factIds || []));
    const sourceIds = uniqueStrings(group.flatMap((page) => claimsByPath.get(page.path)?.sourceIds || [page.source_id]));
    resultPages.push({
      ...first,
      tags: uniqueStrings(group.flatMap((page) => page.tags)).slice(0, 20),
      factIds,
      body: ensureHeading(body, first.title),
    });
    resultClaims.push({
      path: first.path,
      factIds,
      sourceIds,
      updatedAt: new Date().toISOString(),
    });
    issues.push({
      kind: "auto_fixed",
      target: first.path,
      message: "重复标题已在发布前合并",
      details: group.map((page) => page.path).join(", "),
      source_ids: sourceIds,
    });
  }
  return { pages: resultPages, pageClaims: resultClaims };
}

function fixDeadLinks(pages: LlmWikiDraftPage[], issues: LlmWikiPublishGateIssue[]): LlmWikiDraftPage[] {
  const byPath = new Set(pages.map((page) => page.path));
  const byTitle = new Map(pages.map((page) => [canonicalTitle(page.title), page.path] as const));
  return pages.map((page) => {
    let changed = false;
    const body = page.body.replace(/\[\[([^\]]+)\]\]/g, (full, raw: string) => {
      const [targetRaw, labelRaw] = String(raw || "").split("|");
      const target = targetRaw.split("#")[0].trim();
      const label = (labelRaw || target).trim();
      const resolved = resolveLink(target, byPath, byTitle);
      if (resolved) {
        if (resolved !== target) changed = true;
        return `[[${resolved}${label && label !== resolved ? `|${label}` : ""}]]`;
      }
      changed = true;
      return label || target;
    });
    if (changed || extractWikiLinks(body).some((link) => !resolveLink(link, byPath, byTitle))) {
      issues.push({
        kind: "auto_fixed",
        target: page.path,
        message: "死链已在发布前解析或移除",
        details: page.path,
        source_ids: [page.source_id],
      });
    }
    return { ...page, body };
  });
}

function calculateCoverage(facts: LlmWikiFact[], claims: LlmWikiPageClaims[]): LlmWikiCoverageReport {
  const claimed = new Set(claims.flatMap((claim) => claim.factIds));
  const mustFacts = facts.filter((fact) => fact.importance === "must");
  const missing = mustFacts.filter((fact) => !claimed.has(fact.factId)).map((fact) => fact.factId);
  const mustCovered = mustFacts.length - missing.length;
  return {
    mustTotal: mustFacts.length,
    mustCovered,
    mustCoverage: mustFacts.length ? mustCovered / mustFacts.length : 1,
    missingMustFactIds: missing,
  };
}

function looksLikeFactDump(body: string): boolean {
  const text = String(body || "");
  const evidenceCount = matchCount(text, /\bEvidence\s*:/gi);
  const traceCount = matchCount(text, /\bTrace\s*:/gi);
  const factIdCount = matchCount(text, /\bfactId\b|\bfact\s+[a-f0-9]{32}:/gi);
  const sourceSpanCount = matchCount(text, /\bsourceSpan\b/gi);
  return evidenceCount >= 2 || traceCount >= 1 || factIdCount >= 2 || sourceSpanCount >= 1;
}

export function isFactSupportedByPageBody(fact: LlmWikiFact, body: string): boolean {
  const normalizedBody = normalizeText(body);
  if (!normalizedBody) return false;
  if (fact.retention === "exact") {
    return exactFactSupported(fact, body, normalizedBody);
  }
  return (
    textOverlaps(normalizeText(fact.fact), normalizedBody) ||
    textOverlaps(normalizeText(fact.evidence), normalizedBody)
  );
}

function exactFactSupported(fact: LlmWikiFact, rawBody: string, normalizedBody: string): boolean {
  const raw = String(rawBody || "");
  const required = requiredExactLiterals(fact);
  if (required.length > 0) return required.every((literal) => literalInBody(raw, literal));
  return (
    textOverlaps(normalizeText(fact.fact), normalizedBody) ||
    textOverlaps(normalizeText(fact.evidence), normalizedBody)
  );
}

function requiredExactLiterals(fact: LlmWikiFact): string[] {
  const text = `${fact.fact}\n${fact.evidence}`;
  const tokens = uniqueStrings(text.match(/[A-Za-z0-9_.:/-]{2,}/g) || []);
  const anchors = tokens.filter((token) => {
    if (/^\d+(?:\.\d+)?$/.test(token)) return true;
    if (/^[A-Z]+[0-9][A-Z0-9._-]*$/.test(token)) return true;
    if (/[_:/]/.test(token)) return true;
    if (/^v?\d+\.\d+(?:\.\d+)?$/i.test(token)) return true;
    return false;
  });
  return anchors.sort((a, b) => b.length - a.length).slice(0, 8);
}

function literalInBody(body: string, literal: string): boolean {
  return String(body || "").toLowerCase().includes(String(literal || "").toLowerCase());
}

function normalizeText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[`*_#[\](){}|>~"'“”‘’《》〈〉，。；：！？、,.!?;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textOverlaps(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a.length >= 10 && b.includes(a)) return true;
  const terms = uniqueTerms(a);
  if (terms.length >= 2) {
    const bSet = new Set(uniqueTerms(b));
    const matched = terms.filter((term) => bSet.has(term)).length;
    if (matched / terms.length >= 0.6) return true;
  }
  return cjkOverlaps(a, b);
}

function uniqueTerms(text: string): string[] {
  return [...new Set(text.split(/\s+/).filter((item) => item.length >= 2))];
}

function cjkOverlaps(a: string, b: string): boolean {
  if (!hasCjk(a) || !hasCjk(b)) return false;
  const grams = cjkGrams(a);
  if (grams.length < 3) return false;
  const bSet = new Set(cjkGrams(b));
  const matched = grams.filter((gram) => bSet.has(gram)).length;
  const minMatched = Math.min(6, Math.max(3, Math.ceil(grams.length * 0.2)));
  return matched >= minMatched && matched / grams.length >= 0.18;
}

function cjkGrams(text: string): string[] {
  const blocks = String(text || "").match(/[\u3400-\u9fff]+/g) || [];
  const grams: string[] = [];
  for (const block of blocks) {
    if (block.length === 1) continue;
    if (block.length === 2) {
      grams.push(block);
      continue;
    }
    for (let index = 0; index <= block.length - 2; index += 1) {
      grams.push(block.slice(index, index + 2));
    }
    for (let index = 0; index <= block.length - 3; index += 1) {
      grams.push(block.slice(index, index + 3));
    }
  }
  return uniqueStrings(grams);
}

function hasCjk(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

function matchCount(text: string, regex: RegExp): number {
  return String(text || "").match(regex)?.length || 0;
}

function resolveLink(target: string, byPath: Set<string>, byTitle: Map<string, string>): string | null {
  const normalized = target.replace(/\\/g, "/").trim();
  if (!normalized) return null;
  if (byPath.has(normalized)) return normalized;
  const withMd = normalized.endsWith(".md") ? normalized : `${normalized}.md`;
  if (isWikiMarkdownPath(withMd) && byPath.has(withMd)) return withMd;
  return byTitle.get(canonicalTitle(normalized)) || null;
}

function canonicalTitle(title: string): string {
  return String(title || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function stripHeading(body: string, title: string): string {
  const text = String(body || "").trim();
  const escaped = escapeRegExp(title.trim());
  return text.replace(new RegExp(`^#\\s+${escaped}\\s*\\n+`, "i"), "").trim();
}

function ensureHeading(content: string, title: string): string {
  const text = String(content || "").trim();
  return `${text.startsWith("#") ? text : `# ${title}\n\n${text}`}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
