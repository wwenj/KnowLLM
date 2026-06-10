import { Injectable, OnModuleInit } from "@nestjs/common";
import { LlmWikiCompilerService } from "./llm-wiki-compiler.service";
import { LlmWikiFusionService } from "./llm-wiki-fusion.service";
import { LlmWikiIssueService } from "./llm-wiki-issue.service";
import { LlmWikiLintService } from "./llm-wiki-lint.service";
import { LlmWikiSchemaService } from "./llm-wiki-schema.service";
import { LlmWikiSearchService } from "./llm-wiki-search.service";
import { LlmWikiStoreService } from "./llm-wiki-store.service";
import { LlmWikiLintMode } from "../llm-wiki.types";

@Injectable()
export class LlmWikiService implements OnModuleInit {
  private readonly jobs = new Map<string, Promise<void>>();

  constructor(
    private readonly store: LlmWikiStoreService,
    private readonly compiler: LlmWikiCompilerService,
    private readonly fusion: LlmWikiFusionService,
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
    const meta = this.store.createSource(filename, data);
    this.search.invalidate();
    return meta;
  }

  getSchema() {
    return this.schema.read();
  }

  saveSchema(content: string) {
    return this.schema.save(content);
  }

  ingestSource(sourceId: string) {
    const current = this.store.getSource(sourceId);
    if (this.jobs.has(current.source_id) || current.status === "ingesting") {
      throw new Error("source 正在解析");
    }
    const meta = this.store.prepareIngest(current.source_id);
    const job = this.runIngest(current.source_id);
    this.jobs.set(current.source_id, job);
    void job.finally(() => this.jobs.delete(current.source_id));
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
        details: `剩余 source：${item.remaining_sources.join(", ")}`,
        source_ids: item.remaining_sources,
      })),
    );
    this.search.invalidate();
    return { ok: true, source_id: sourceId };
  }

  rawSource(sourceId: string) {
    const meta = this.store.getSource(sourceId);
    return {
      source_id: meta.source_id,
      filename: meta.filename,
      content: this.store.readSource(meta.source_id),
    };
  }

  wikiTree() {
    return this.store.tree();
  }

  getPage(relPath: string) {
    return this.store.getPage(relPath);
  }

  savePage(relPath: string, content: string) {
    const page = this.store.savePage(relPath, content);
    this.search.invalidate();
    return page;
  }

  deletePage(relPath: string) {
    this.store.deletePage(relPath);
    this.search.invalidate();
    return { ok: true, path: relPath };
  }

  searchWiki(query: string, limit?: number) {
    return this.search.search(query, limit);
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

  debugSummary() {
    const sources = this.store.listSources();
    const pages = this.store.listPageRefs();
    return {
      root: this.store.root(),
      stats: this.store.stats(sources),
      sources: sources.map(({ source_id, filename, status, touched_pages }) => ({
        source_id,
        filename,
        status,
        touched_pages,
      })),
      pages,
    };
  }

  private async runIngest(sourceId: string): Promise<void> {
    try {
      const meta = this.store.getSource(sourceId);
      const source = this.store.readSource(sourceId);
      const schema = this.schema.read();
      const drafts = await this.compiler.compileSource({
        sourceId,
        filename: meta.filename,
        source,
        existingPages: this.store.listPageRefs(),
        schema,
      });
      const noConcept = !drafts.some((page) => page.type === "concept");
      this.store.detachSourceFromWiki(sourceId);
      const touchedPages: string[] = [];
      for (const draft of drafts) {
        const result = await this.fusion.mergeDraft({
          schema,
          source: meta,
          sourceContent: source,
          draft,
        });
        if (result.issues.length) this.issues.upsertMany(result.issues);
        if (!result.page) {
          this.store.appendLog(`解析 source ${sourceId} 跳过页面：${draft.path}`);
          continue;
        }
        const relPath = this.store.saveFusionPage({
          source: meta,
          page: result.page,
          sources: result.sources,
          schemaHash: schema.sha256,
          contributionSummary: result.change_summary,
        });
        touchedPages.push(relPath);
      }
      if (noConcept) {
        this.issues.upsertMany([
          {
            kind: "no_concept_generated",
            severity: "warning",
            target: sourceId,
            message: "模型没有为 source 生成 concept 页面",
            details: "本次 ingest 只生成了 summary/entity 或空结果，需要人工确认 source 是否有可复用概念。",
            source_ids: [sourceId],
          },
        ]);
      }
      this.store.rebuildWikiIndex();
      this.store.updateSource(sourceId, {
        status: "ready",
        schema_hash: schema.sha256,
        ingested_at: new Date().toISOString(),
        error: "",
        touched_pages: [...new Set(touchedPages)],
      });
      this.search.invalidate();
      this.store.appendLog(`解析 source ${sourceId} 完成，生成 ${touchedPages.length} 个页面`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.store.markIngestFailed(sourceId, message);
      this.store.appendLog(`解析 source ${sourceId} 失败：${message}`);
    }
  }
}
