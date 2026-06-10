import { Injectable, NotFoundException } from "@nestjs/common";
import * as path from "node:path";
import { nowIso, randomId, readJson, writeJson } from "../../../common/fs-json";
import { uniqueStrings } from "../../../common/text";
import { llmWikiConfig } from "../llm-wiki.config";
import type { LlmWikiIssue, LlmWikiLintMode } from "../llm-wiki.types";
import { LlmWikiStoreService } from "./llm-wiki-store.service";

type IssueDraft = Omit<LlmWikiIssue, "id" | "status" | "created_at" | "updated_at">;

@Injectable()
export class LlmWikiIssueService {
  constructor(private readonly store: LlmWikiStoreService) {}

  runLint(mode: LlmWikiLintMode = "all") {
    const generated: IssueDraft[] = [];
    const sources = new Set(this.store.listSources().map((source) => source.source_id));
    const pages = this.store.listPages();

    if (!pages.some((page) => page.path === "index.md")) {
      generated.push({
        kind: "index_missing",
        severity: "error",
        target: "index.md",
        message: "缺少 LLM Wiki Index",
        details: "需要重建 wiki/index.md",
        source_ids: []
      });
    }

    for (const page of pages) {
      if (mode !== "evidence" && !page.updated_at) {
        generated.push({
          kind: "missing_frontmatter",
          severity: "warning",
          target: page.path,
          message: "页面缺少完整 frontmatter",
          details: "建议通过保存页面重新生成元数据",
          source_ids: page.sources
        });
      }
      if (mode !== "structural") {
        const missing = page.sources.filter((source) => !sources.has(source));
        if (missing.length) {
          generated.push({
            kind: "missing_source",
            severity: "warning",
            target: page.path,
            message: "页面引用了不存在的 source",
            details: missing.join(", "),
            source_ids: missing
          });
        }
        if (page.path !== "index.md" && page.type !== "manual" && page.sources.length === 0) {
          generated.push({
            kind: "weak_evidence",
            severity: "info",
            target: page.path,
            message: "页面没有 source 引用",
            details: "如果这是人工页面可忽略，否则建议补充 sources",
            source_ids: []
          });
        }
      }
    }

    const issues = this.upsertMany(generated);
    return { issues, total: issues.length };
  }

  upsertMany(drafts: IssueDraft[]): LlmWikiIssue[] {
    const current = this.readIssues();
    const byKey = new Map(current.map((issue) => [issueKey(issue), issue]));
    const touched: LlmWikiIssue[] = [];
    for (const draft of drafts) {
      const key = issueKey(draft);
      const existing = byKey.get(key);
      const next: LlmWikiIssue = existing
        ? {
            ...existing,
            ...draft,
            status: existing.status,
            source_ids: uniqueStrings(draft.source_ids || []),
            updated_at: nowIso()
          }
        : {
            ...draft,
            id: randomId(),
            status: "open",
            source_ids: uniqueStrings(draft.source_ids || []),
            created_at: nowIso(),
            updated_at: nowIso()
          };
      byKey.set(key, next);
      touched.push(next);
    }
    this.writeIssues([...byKey.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
    return touched;
  }

  list(status: "open" | "resolved" | "all" = "open") {
    const items = this.readIssues().filter((issue) => (status === "all" ? true : issue.status === status));
    return { items };
  }

  resolve(issueId: string): LlmWikiIssue {
    const items = this.readIssues();
    const idx = items.findIndex((issue) => issue.id === issueId);
    if (idx < 0) throw new NotFoundException("issue 不存在");
    items[idx] = { ...items[idx], status: "resolved", updated_at: nowIso() };
    this.writeIssues(items);
    return items[idx];
  }

  private issuesPath(): string {
    return path.join(llmWikiConfig.root, "issues.json");
  }

  private readIssues(): LlmWikiIssue[] {
    return readJson<LlmWikiIssue[]>(this.issuesPath(), []);
  }

  private writeIssues(items: LlmWikiIssue[]): void {
    writeJson(this.issuesPath(), items);
  }
}

function issueKey(issue: Pick<LlmWikiIssue, "kind" | "target">): string {
  return `${issue.kind}:${issue.target}`;
}
