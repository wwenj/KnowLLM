import { Injectable } from "@nestjs/common";
import {
  LlmWikiIssue,
  LlmWikiIssueKind,
  LlmWikiLintMode,
} from "../contracts/llm-wiki.types";
import { LlmWikiIssueService, LlmWikiIssueInput } from "./llm-wiki-issue.service";
import { LlmWikiStoreService } from "./llm-wiki-store.service";

const AUTO_RESOLVED_ISSUE_KINDS: LlmWikiIssueKind[] = [
  "dead_link",
  "orphan_page",
  "missing_frontmatter",
  "missing_source",
  "deleted_source_ref",
  "duplicate_title",
  "schema_drift",
  "missing_claim_source",
  "weak_evidence",
  "needs_reconcile",
  "no_concept_generated",
  "index_missing",
  "oversized_page",
  "stale_source_digest",
];

@Injectable()
export class LlmWikiLintService {
  constructor(
    private readonly store: LlmWikiStoreService,
    private readonly issues: LlmWikiIssueService,
  ) {}

  run(_mode: LlmWikiLintMode = "all"): { issues: LlmWikiIssue[]; total: number } {
    const inputs = this.runHealthGate();
    const issues = this.issues.upsertMany(inputs);
    this.issues.resolveMissingOpenIssues(AUTO_RESOLVED_ISSUE_KINDS, []);
    return { issues, total: issues.length };
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
