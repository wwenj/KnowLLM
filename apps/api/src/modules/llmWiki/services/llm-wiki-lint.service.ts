import { Injectable } from "@nestjs/common";
import {
  LlmWikiIssue,
  LlmWikiIssueKind,
  LlmWikiLintMode,
  LlmWikiPage,
} from "../llm-wiki.types";
import { LlmWikiIssueService, LlmWikiIssueInput } from "./llm-wiki-issue.service";
import { LlmWikiSchemaService } from "./llm-wiki-schema.service";
import { LlmWikiStoreService } from "./llm-wiki-store.service";

const OVERSIZED_PAGE_CHARS = 12_000;
const STRUCTURAL_LINT_ISSUE_KINDS: LlmWikiIssueKind[] = [
  "dead_link",
  "orphan_page",
  "missing_frontmatter",
  "duplicate_title",
  "index_missing",
  "oversized_page",
];
const EVIDENCE_LINT_ISSUE_KINDS: LlmWikiIssueKind[] = [
  "missing_source",
  "deleted_source_ref",
  "schema_drift",
  "missing_claim_source",
  "stale_source_digest",
];

@Injectable()
export class LlmWikiLintService {
  constructor(
    private readonly store: LlmWikiStoreService,
    private readonly schema: LlmWikiSchemaService,
    private readonly issues: LlmWikiIssueService,
  ) {}

  run(mode: LlmWikiLintMode = "all"): { issues: LlmWikiIssue[]; total: number } {
    const pages = this.store.listPages();
    const schema = this.schema.read();
    const inputs: LlmWikiIssueInput[] = [];
    if (mode === "structural" || mode === "all") {
      inputs.push(...this.runStructural(pages));
    }
    if (mode === "evidence" || mode === "all") {
      inputs.push(...this.runEvidence(pages, schema.sha256));
    }
    const issues = this.issues.upsertMany(inputs);
    this.issues.resolveMissingOpenIssues(lintIssueKindsForMode(mode), issues.map((issue) => issue.id));
    return { issues, total: issues.length };
  }

  private runStructural(pages: LlmWikiPage[]): LlmWikiIssueInput[] {
    const issues: LlmWikiIssueInput[] = [];
    const pagePaths = new Set(pages.map((page) => page.path));
    const titleToPath = new Map(
      pages.map((page) => [page.title.trim().toLowerCase(), page.path] as const),
    );
    const inbound = new Map<string, number>(pages.map((page) => [page.path, 0]));
    const titleCounts = new Map<string, LlmWikiPage[]>();
    const indexContent = pages.find((page) => page.path === "index.md")?.content || "";

    for (const page of pages) {
      const titleKey = page.title.trim().toLowerCase();
      if (titleKey) titleCounts.set(titleKey, [...(titleCounts.get(titleKey) || []), page]);

      if (!hasRequiredFrontmatter(page)) {
        issues.push({
          kind: "missing_frontmatter",
          severity: "error",
          target: page.path,
          message: "页面缺少必要 frontmatter 字段：title/type/updated_at",
          source_ids: page.sources,
        });
      }
      if (stripFrontmatter(page.content).length > OVERSIZED_PAGE_CHARS) {
        issues.push({
          kind: "oversized_page",
          severity: "warning",
          target: page.path,
          message: "页面正文过长，建议拆分成更小的概念页",
          source_ids: page.sources,
        });
      }
      for (const link of extractWikiLinks(page.content)) {
        const target = resolveLinkTarget(link, pagePaths, titleToPath);
        if (!target) {
          if (!isStrictWikiLink(link, titleToPath)) continue;
          issues.push({
            kind: "dead_link",
            severity: "warning",
            target: page.path,
            message: `死链：[[${link}]]`,
            source_ids: page.sources,
          });
          continue;
        }
        if (page.path !== "index.md") inbound.set(target, (inbound.get(target) || 0) + 1);
      }
    }

    for (const page of pages) {
      if (page.path === "index.md") continue;
      if ((inbound.get(page.path) || 0) === 0) {
        issues.push({
          kind: "orphan_page",
          severity: "warning",
          target: page.path,
          message: "页面没有被任何非 index wiki 页面链接",
          source_ids: page.sources,
        });
      }
      if (!indexContent.includes(`[[${page.path}]]`)) {
        issues.push({
          kind: "index_missing",
          severity: "warning",
          target: page.path,
          message: "页面未出现在 wiki/index.md",
          source_ids: page.sources,
        });
      }
    }

    for (const [title, matchedPages] of titleCounts) {
      if (matchedPages.length < 2) continue;
      for (const page of matchedPages) {
        issues.push({
          kind: "duplicate_title",
          severity: "warning",
          target: page.path,
          message: `重复标题：${title}`,
          source_ids: page.sources,
        });
      }
    }
    return issues;
  }

  private runEvidence(pages: LlmWikiPage[], schemaHash: string): LlmWikiIssueInput[] {
    const issues: LlmWikiIssueInput[] = [];
    for (const page of pages) {
      if (page.path === "index.md") continue;
      if (!page.sources.length) {
        issues.push({
          kind: "missing_source",
          severity: "warning",
          target: page.path,
          message: "页面没有 source 引用，无法追溯事实来源",
        });
      }
      for (const sourceId of page.sources) {
        if (!this.store.sourceExists(sourceId)) {
          issues.push({
            kind: "deleted_source_ref",
            severity: "warning",
            target: page.path,
            message: `页面引用了不存在的 source：${sourceId}`,
            source_ids: [sourceId],
          });
        }
      }
      if (page.sources.length && !page.sources.some((sourceId) => page.content.includes(`source ${sourceId}`))) {
        issues.push({
          kind: "missing_claim_source",
          severity: "warning",
          target: page.path,
          message: "页面有 source 引用，但正文缺少 source id 标注",
          source_ids: page.sources,
        });
      }
      if (page.schema_hash !== schemaHash) {
        issues.push({
          kind: "schema_drift",
          severity: "info",
          target: page.path,
          message: "页面 schema_hash 与当前 schema 不一致",
          source_ids: page.sources,
        });
      }
      const contribution = this.store.readContribution(page.path);
      if (page.sources.length > 1 && !contribution) {
        issues.push({
          kind: "needs_reconcile",
          severity: "warning",
          target: page.path,
          message: "多 source 页面缺少 contribution 记录",
          source_ids: page.sources,
        });
      }
      if (contribution) {
        for (const sourceId of Object.keys(contribution.sources)) {
          try {
            const source = this.store.getSource(sourceId);
            const record = contribution.sources[sourceId];
            if (record.source_sha256 && record.source_sha256 !== source.sha256) {
              issues.push({
                kind: "stale_source_digest",
                severity: "warning",
                target: page.path,
                message: `source ${sourceId} 内容摘要已变化，页面需要重新核对`,
                source_ids: [sourceId],
              });
            }
          } catch {
            // deleted_source_ref already covers this case when frontmatter still references it.
          }
        }
      }
    }
    return issues;
  }
}

function hasRequiredFrontmatter(page: LlmWikiPage): boolean {
  const raw = page.content.trimStart();
  return raw.startsWith("---") && !!page.title && !!page.type && !!page.updated_at;
}

function extractWikiLinks(content: string): string[] {
  const links: string[] = [];
  const text = stripInlineCode(stripFencedCode(content));
  const regex = /\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    const target = (match[1] || "").split("|")[0].split("#")[0].trim();
    if (target) links.push(target);
  }
  return links;
}

function resolveLinkTarget(
  link: string,
  pagePaths: Set<string>,
  titleToPath: Map<string, string>,
): string | null {
  const target = link.replace(/\\/g, "/").trim();
  if (pagePaths.has(target)) return target;
  const withMd = target.endsWith(".md") ? target : `${target}.md`;
  if (pagePaths.has(withMd)) return withMd;
  return titleToPath.get(target.toLowerCase()) || null;
}

function isStrictWikiLink(link: string, titleToPath: Map<string, string>): boolean {
  const target = link.trim();
  return target.endsWith(".md") || target.includes("/") || titleToPath.has(target.toLowerCase());
}

function stripFencedCode(content: string): string {
  return String(content || "").replace(/```[\s\S]*?```/g, "");
}

function stripInlineCode(content: string): string {
  return String(content || "").replace(/`[^`\n]*`/g, "");
}

function stripFrontmatter(content: string): string {
  return String(content || "").replace(/^---[\s\S]*?---\s*/m, "").trim();
}

function lintIssueKindsForMode(mode: LlmWikiLintMode): LlmWikiIssueKind[] {
  if (mode === "structural") return STRUCTURAL_LINT_ISSUE_KINDS;
  if (mode === "evidence") return EVIDENCE_LINT_ISSUE_KINDS;
  return [...STRUCTURAL_LINT_ISSUE_KINDS, ...EVIDENCE_LINT_ISSUE_KINDS];
}
