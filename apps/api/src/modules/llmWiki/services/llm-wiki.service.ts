import { BadRequestException, Injectable, OnModuleInit } from "@nestjs/common";
import type { LlmWikiLintMode } from "../llm-wiki.types";
import { LlmWikiCompilerService } from "./llm-wiki-compiler.service";
import { LlmWikiIssueService } from "./llm-wiki-issue.service";
import { LlmWikiSearchService } from "./llm-wiki-search.service";
import { LlmWikiStoreService } from "./llm-wiki-store.service";

@Injectable()
export class LlmWikiService implements OnModuleInit {
  private readonly jobs = new Map<string, Promise<void>>();

  constructor(
    private readonly store: LlmWikiStoreService,
    private readonly compiler: LlmWikiCompilerService,
    private readonly issues: LlmWikiIssueService,
    private readonly search: LlmWikiSearchService
  ) {}

  onModuleInit(): void {
    this.store.ensureSpace();
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

  ingestSource(sourceId: string) {
    const source = this.store.getSource(sourceId);
    if (this.jobs.has(source.source_id) || source.status === "ingesting") {
      throw new BadRequestException("source 正在解析");
    }
    const meta = this.store.prepareIngest(source.source_id);
    const job = this.runIngest(source.source_id);
    this.jobs.set(source.source_id, job);
    void job.finally(() => this.jobs.delete(source.source_id));
    return meta;
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
        details: `剩余 source: ${item.remaining_sources.join(", ")}`,
        source_ids: item.remaining_sources
      }))
    );
    return { ok: true, source_id: sourceId };
  }

  rawSource(sourceId: string) {
    const meta = this.store.getSource(sourceId);
    return {
      source_id: meta.source_id,
      filename: meta.filename,
      content: this.store.readSource(meta.source_id)
    };
  }

  wikiTree() {
    return this.store.tree();
  }

  getPage(relPath: string) {
    return this.store.getPage(relPath);
  }

  savePage(relPath: string, content: string) {
    return this.store.savePage(relPath, content);
  }

  deletePage(relPath: string) {
    this.store.deletePage(relPath);
    return { ok: true, path: relPath };
  }

  searchWiki(query: string, limit?: number) {
    return this.search.search(query, limit);
  }

  getSchema() {
    return this.store.getSchema();
  }

  saveSchema(content: string) {
    return this.store.saveSchema(content);
  }

  lintWiki(mode?: LlmWikiLintMode) {
    return this.issues.runLint(mode || "all");
  }

  listIssues(status?: "open" | "resolved" | "all") {
    return this.issues.list(status || "open");
  }

  resolveIssue(issueId: string) {
    return this.issues.resolve(issueId);
  }

  debugSummary() {
    return this.store.debugSummary();
  }

  private async runIngest(sourceId: string): Promise<void> {
    try {
      const source = this.store.getSource(sourceId);
      const content = this.store.readSource(sourceId);
      const schema = this.store.getSchema();
      const drafts = await this.compiler.compileSource({
        sourceId,
        filename: source.filename,
        source: content,
        existingPages: this.store.listPageRefs(),
        schema
      });
      this.store.detachSourceFromWiki(sourceId);
      const touchedPages = drafts.map((draft) =>
        this.store.saveCompiledPage({
          source,
          draft,
          schemaHash: schema.sha256
        })
      );
      this.store.rebuildWikiIndex();
      this.store.updateSource(sourceId, {
        status: "ready",
        schema_hash: schema.sha256,
        ingested_at: new Date().toISOString(),
        error: "",
        touched_pages: [...new Set(touchedPages)]
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.markIngestFailed(sourceId, message);
    }
  }
}
