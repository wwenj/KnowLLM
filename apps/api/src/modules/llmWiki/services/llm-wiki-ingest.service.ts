import { Injectable } from "@nestjs/common";
import { ModelService } from "../../model/model.service";
import { llmWikiConfig } from "../llm-wiki.config";
import { LlmWikiCompilerService } from "./llm-wiki-compiler.service";
import { LlmWikiFusionService } from "./llm-wiki-fusion.service";
import { LlmWikiIssueService } from "./llm-wiki-issue.service";
import { LlmWikiSchemaService } from "./llm-wiki-schema.service";
import { LlmWikiSearchService } from "./llm-wiki-search.service";
import { LlmWikiStoreService } from "./llm-wiki-store.service";

@Injectable()
export class LlmWikiIngestService {
  private readonly jobs = new Map<string, Promise<void>>();

  constructor(
    private readonly store: LlmWikiStoreService,
    private readonly compiler: LlmWikiCompilerService,
    private readonly fusion: LlmWikiFusionService,
    private readonly issues: LlmWikiIssueService,
    private readonly search: LlmWikiSearchService,
    private readonly schema: LlmWikiSchemaService,
    private readonly model: ModelService,
  ) {}

  ingestSource(sourceId: string, requestedModel = "") {
    const current = this.store.getSource(sourceId);
    if (this.jobs.has(current.source_id) || current.status === "ingesting") {
      throw new Error("source 正在解析");
    }
    const model = this.resolveIngestModel(requestedModel);
    const meta = this.store.prepareIngest(current.source_id);
    const job = this.runIngest(current.source_id, model);
    this.jobs.set(current.source_id, job);
    void job.finally(() => this.jobs.delete(current.source_id));
    return meta;
  }

  private async runIngest(sourceId: string, model: string): Promise<void> {
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
        model,
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
          model,
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

  private resolveIngestModel(requestedModel: string): string {
    const requested = String(requestedModel || "").trim();
    const configured = requested || llmWikiConfig.model;
    const resolved = this.model.resolveModel(configured);
    if (resolved) return resolved;
    if (requested) throw new Error(`解析模型不存在或不可用：${requested}`);
    throw new Error("未配置可用的解析模型");
  }
}
