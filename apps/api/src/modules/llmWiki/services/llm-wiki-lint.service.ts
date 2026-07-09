import { Injectable } from "@nestjs/common";
import {
  LlmWikiIssue,
  LlmWikiIssueKind,
  LlmWikiLintMode,
} from "../contracts/llm-wiki.types";
import { extractWikiLinks, isWikiMarkdownPath } from "../llm-wiki-page.utils";
import { llmWikiConfig } from "../llm-wiki.config";
import { LlmWikiIssueService, LlmWikiIssueInput } from "./llm-wiki-issue.service";
import { LlmWikiStoreService } from "./llm-wiki-store.service";

const STRUCTURAL_ISSUE_KINDS: LlmWikiIssueKind[] = [
  "dead_link",
  "orphan_page",
  "duplicate_title",
  "missing_claim_source",
  "oversized_page",
];

const OVERSIZED_PAGE_BYTES = Math.floor(llmWikiConfig.maxWikiFileBytes * 0.8);

@Injectable()
export class LlmWikiLintService {
  constructor(
    private readonly store: LlmWikiStoreService,
    private readonly issues: LlmWikiIssueService,
  ) {}

  run(mode: LlmWikiLintMode = "all"): { issues: LlmWikiIssue[]; total: number } {
    const inputs = this.runChecks(mode);
    const issues = this.issues.upsertMany(inputs);
    this.issues.resolveMissingOpenIssues(checkedKinds(mode), issues.map((issue) => issue.id));
    return { issues, total: issues.length };
  }

  private runChecks(mode: LlmWikiLintMode): LlmWikiIssueInput[] {
    const inputs: LlmWikiIssueInput[] = [];
    if (mode === "structural" || mode === "all") inputs.push(...this.runStructuralChecks());
    if (mode === "evidence") inputs.push(...this.runHealthGate());
    return inputs;
  }

  private runStructuralChecks(): LlmWikiIssueInput[] {
    const inputs: LlmWikiIssueInput[] = [];
    const pages = this.store.listPages();
    const pagePaths = new Set(pages.map((page) => page.path));
    const inbound = new Map<string, Set<string>>();
    const titleGroups = new Map<string, string[]>();

    for (const page of pages) {
      const titleKey = normalizeTitle(page.title);
      if (titleKey) titleGroups.set(titleKey, [...(titleGroups.get(titleKey) || []), page.path]);

      if (Buffer.byteLength(page.content || "", "utf-8") > OVERSIZED_PAGE_BYTES) {
        inputs.push({
          kind: "oversized_page",
          severity: "warning",
          target: page.path,
          message: `页面接近大小上限，建议拆分：${page.path}`,
          details: `bytes=${Buffer.byteLength(page.content || "", "utf-8")}; threshold=${OVERSIZED_PAGE_BYTES}`,
          source_ids: page.sources,
        });
      }

      const links = extractWikiLinks(page.content || "")
        .filter((target) => target.endsWith(".md") && isWikiMarkdownPath(target));
      for (const target of links) {
        if (!pagePaths.has(target)) {
          inputs.push({
            kind: "dead_link",
            severity: "warning",
            target: page.path,
            message: `死链：[[${target}]]`,
            details: `from=${page.path}\nto=${target}`,
            source_ids: page.sources,
          });
          continue;
        }
        if (page.path !== "index.md") {
          const refs = inbound.get(target) || new Set<string>();
          refs.add(page.path);
          inbound.set(target, refs);
        }
      }
    }

    for (const [title, paths] of titleGroups) {
      const nonIndexPaths = paths.filter((item) => item !== "index.md");
      if (nonIndexPaths.length < 2) continue;
      inputs.push({
        kind: "duplicate_title",
        severity: "warning",
        target: nonIndexPaths[0],
        message: `重复标题：${title}`,
        details: nonIndexPaths.join("\n"),
        source_ids: sourceIdsForPages(pages, nonIndexPaths),
      });
    }

    inputs.push(...this.runPageClaimsChecks(pagePaths));
    return dedupeIssues(inputs);
  }

  private runPageClaimsChecks(pagePaths: Set<string>): LlmWikiIssueInput[] {
    const inputs: LlmWikiIssueInput[] = [];
    for (const claim of this.store.listPageClaims()) {
      if (!pagePaths.has(claim.path)) {
        inputs.push({
          kind: "missing_claim_source",
          severity: "error",
          target: claim.path,
          message: "page-claims 指向不存在页面",
          details: claim.factIds.join(", "),
          source_ids: claim.sourceIds,
        });
      }
    }
    for (const page of this.store.listPageRefs()) {
      if (page.path === "index.md") continue;
      const claims = this.store.readPageClaims(page.path);
      if (!claims) {
        inputs.push({
          kind: "missing_claim_source",
          severity: "error",
          target: page.path,
          message: "正式页面缺少 page-claims",
          source_ids: page.sources,
        });
      }
    }
    return inputs;
  }

  private runHealthGate(): LlmWikiIssueInput[] {
    const inputs: LlmWikiIssueInput[] = [];
    const pagePaths = new Set(this.store.listPageRefs().map((page) => page.path));
    for (const claim of this.store.listPageClaims()) {
      if (!pagePaths.has(claim.path)) {
        inputs.push({
          kind: "blocked_publish",
          severity: "error",
          target: claim.path,
          message: "page-claims 指向不存在页面",
          details: claim.factIds.join(", "),
          source_ids: claim.sourceIds,
        });
      }
    }
    for (const page of this.store.listPageRefs()) {
      if (page.path === "index.md") continue;
      const claims = this.store.readPageClaims(page.path);
      if (!claims) {
        inputs.push({
          kind: "blocked_publish",
          severity: "error",
          target: page.path,
          message: "正式页面缺少 page-claims",
          source_ids: page.sources,
        });
      }
    }
    return inputs;
  }
}

function checkedKinds(mode: LlmWikiLintMode): LlmWikiIssueKind[] {
  if (mode === "structural") return STRUCTURAL_ISSUE_KINDS;
  if (mode === "evidence") return ["blocked_publish"];
  return STRUCTURAL_ISSUE_KINDS;
}

function normalizeTitle(title: string): string {
  return String(title || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function sourceIdsForPages(
  pages: Array<{ path: string; sources: string[] }>,
  paths: string[],
): string[] {
  const pathSet = new Set(paths);
  return [...new Set(pages.filter((page) => pathSet.has(page.path)).flatMap((page) => page.sources))];
}

function dedupeIssues(inputs: LlmWikiIssueInput[]): LlmWikiIssueInput[] {
  const seen = new Set<string>();
  return inputs.filter((input) => {
    const key = [input.kind, input.target, input.message].join("\n");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
