import { Injectable, OnModuleInit } from "@nestjs/common";
import type { LlmWikiLintMode } from "../contracts/llm-wiki.types";
import { LlmWikiIngestService } from "./llm-wiki-ingest.service";
import { LlmWikiIssueService } from "./llm-wiki-issue.service";
import { LlmWikiLintService } from "./llm-wiki-lint.service";
import { LlmWikiSchemaService } from "./llm-wiki-schema.service";
import { LlmWikiSearchService } from "./llm-wiki-search.service";
import { LlmWikiStoreService } from "./llm-wiki-store.service";

@Injectable()
export class LlmWikiManagementService implements OnModuleInit {
  constructor(
    private readonly store: LlmWikiStoreService,
    private readonly ingest: LlmWikiIngestService,
    private readonly issues: LlmWikiIssueService,
    private readonly search: LlmWikiSearchService,
    private readonly schema: LlmWikiSchemaService,
    private readonly lint: LlmWikiLintService,
  ) {}

  onModuleInit(): void {
    this.search.invalidate();
  }

  overview() {
    const items = this.store.listSources();
    return { stats: this.store.stats(items), recent: items.slice(0, 5) };
  }

  listSources() {
    const items = this.store.listSources();
    return { items, stats: this.store.stats(items) };
  }

  uploadSource(filename: string, data: Buffer) {
    return this.store.createSource(filename, data);
  }

  ingestSource(sourceId: string, model = "") {
    return this.ingest.ingestSource(sourceId, model);
  }

  renameSource(sourceId: string, filename: string) {
    return this.store.renameSource(sourceId, filename);
  }

  deleteSource(sourceId: string) {
    const result = this.store.deleteSourceCascade(sourceId);
    this.issues.upsertMany(
      result.needs_reconcile.map((item) => ({
        kind: "needs_reconcile",
        severity: "warning",
        target: item.path,
        message: "source 删除后页面需要重新核对",
        details: `剩余 source：${item.remaining_sources.join(", ")}`,
        source_ids: item.remaining_sources,
      })),
    );
    this.search.invalidate();
    return { ok: true, source_id: sourceId };
  }

  getSchema() {
    return this.schema.read();
  }

  saveSchema(content: string) {
    return this.schema.save(content);
  }

  savePage(path: string, content: string) {
    const page = this.store.savePage(path, content);
    this.search.invalidate();
    return page;
  }

  deletePage(path: string) {
    this.store.deletePage(path);
    this.search.invalidate();
    return { ok: true, path };
  }

  lintWiki(mode?: LlmWikiLintMode) {
    return this.lint.run(mode);
  }

  listIssues(status?: "open" | "resolved" | "all") {
    return this.issues.list(status || "open");
  }

  resolveIssue(issueId: string) {
    return this.issues.resolve(issueId);
  }
}
