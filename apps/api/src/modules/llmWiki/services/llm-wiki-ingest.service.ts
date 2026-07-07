import { Injectable } from "@nestjs/common";
import { ModelService } from "../../model/model.service";
import type { LlmWikiIngestJobReport } from "../contracts/llm-wiki.types";
import { llmWikiConfig } from "../llm-wiki.config";
import { LLM_WIKI_INGEST_STOPPED, LlmWikiCompilerService } from "./llm-wiki-compiler.service";
import { LlmWikiSchemaService } from "./llm-wiki-schema.service";
import { LlmWikiSearchService } from "./llm-wiki-search.service";
import { LlmWikiStoreService } from "./llm-wiki-store.service";

@Injectable()
export class LlmWikiIngestService {
  private readonly jobs = new Map<string, {
    controller: AbortController;
    jobId: string;
    model: string;
    started: boolean;
    promise?: Promise<void>;
  }>();
  private readonly queue: string[] = [];
  private readonly stoppedJobs = new Set<string>();
  private activeCount = 0;

  constructor(
    private readonly store: LlmWikiStoreService,
    private readonly compiler: LlmWikiCompilerService,
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
    const report = this.store.createIngestJob(current.source_id, model);
    this.store.prepareIngest(current.source_id);
    const controller = new AbortController();
    this.jobs.set(current.source_id, {
      controller,
      jobId: report.jobId,
      model,
      started: false,
    });
    this.queue.push(current.source_id);
    this.schedule();
    return { jobId: report.jobId, sourceId: current.source_id, status: report.status };
  }

  stopIngest(sourceId: string) {
    const current = this.store.getSource(sourceId);
    const running = this.jobs.get(current.source_id);
    if (!running && current.status !== "ingesting") {
      return { ok: true, sourceId: current.source_id, status: current.status, stopped: false };
    }
    running?.controller.abort();
    this.removeFromQueue(current.source_id);
    this.jobs.delete(current.source_id);
    if (running?.started && running.jobId) this.stoppedJobs.add(running.jobId);
    this.store.resetIngestToUploaded(current.source_id, running?.jobId || "");
    this.search.invalidate();
    return { ok: true, sourceId: current.source_id, status: "uploaded" as const, stopped: true };
  }

  reingestSources(sourceIds: string[], requestedModel = "") {
    return [...new Set(sourceIds)]
      .filter(Boolean)
      .map((sourceId) => this.ingestSource(sourceId, requestedModel));
  }

  rebuildAll(requestedModel = "") {
    if (this.jobs.size > 0) throw new Error("source 正在解析，不能开始全量 rebuild");
    const sources = this.store.listSources().map((source) => source.source_id);
    this.store.clearCompiledWikiArtifacts();
    return this.reingestSources(sources, requestedModel);
  }

  private schedule(): void {
    while (this.activeCount < llmWikiConfig.ingestConcurrency && this.queue.length) {
      const sourceId = this.queue.shift();
      if (!sourceId) continue;
      const job = this.jobs.get(sourceId);
      if (!job || job.controller.signal.aborted) continue;
      job.started = true;
      this.activeCount += 1;
      const promise = this.runIngest(sourceId, job.model, job.jobId, job.controller.signal).finally(() => {
        this.activeCount = Math.max(0, this.activeCount - 1);
        this.jobs.delete(sourceId);
        this.schedule();
      });
      job.promise = promise;
    }
  }

  private removeFromQueue(sourceId: string): void {
    const index = this.queue.indexOf(sourceId);
    if (index >= 0) this.queue.splice(index, 1);
  }

  private async runIngest(sourceId: string, model: string, jobId: string, signal: AbortSignal): Promise<void> {
    let report = this.store.getIngestJob(jobId);
    try {
      assertNotStopped(signal);
      report = this.saveJobEvent(report, {
        stage: "compiling",
        message: "开始编译：切分 source、抽取 facts、规划并写入语义页面",
      });
      const meta = this.store.getSource(sourceId);
      const source = this.store.readSource(sourceId);
      const schema = this.schema.read();
      const compiled = await this.compiler.compileSource({
        sourceId,
        filename: meta.filename,
        source,
        existingPages: this.store.listPageRefs(),
        schema,
        model,
        signal,
      });
      assertNotStopped(signal);
      report = this.saveJobEvent(
        {
          ...report,
          pages: compiled.pages.map((page) => page.path),
          factCount: compiled.factLedger.facts.length,
          coverage: compiled.coverage,
          issues: compiled.issues,
        },
        {
          stage: "publish_gate",
          message: `进入发布门禁：${compiled.factLedger.facts.length} facts，${compiled.pages.length} pages，must ${Math.round(
            compiled.coverage.mustCoverage * 100,
          )}%`,
        },
      );
      if (compiled.issues.some((issue) => issue.kind === "blocked_publish")) {
        throw new Error(
          `publish gate 未通过：${compiled.issues
            .filter((issue) => issue.kind === "blocked_publish")
            .map((issue) => issue.message)
            .join("; ")}`,
        );
      }
      assertNotStopped(signal);
      report = this.saveJobEvent(report, { stage: "publishing", message: "门禁通过，开始写入正式 Wiki" });
      assertNotStopped(signal);
      const touchedPages = this.store.publishCompiled({
        source: meta,
        pages: compiled.pages,
        pageClaims: compiled.pageClaims,
        sourceMap: { ...compiled.sourceMap, sha256: meta.sha256 },
        factLedger: compiled.factLedger,
        schemaHash: schema.sha256,
        contributionSummary: `fact-ledger compile ${compiled.factLedger.facts.length} facts`,
      });
      this.store.updateSource(sourceId, {
        status: "ready",
        schema_hash: schema.sha256,
        ingested_at: new Date().toISOString(),
        error: "",
        touched_pages: [...new Set(touchedPages)],
      });
      this.search.invalidate();
      this.saveJobEvent(
        {
          ...report,
          status: "success",
          endedAt: new Date().toISOString(),
          pages: touchedPages,
          error: "",
        },
        {
          stage: "published",
          status: "success",
          message: `发布完成，写入 ${touchedPages.length} 个页面`,
        },
      );
      this.store.appendLog(`解析 source ${sourceId} 完成，生成 ${touchedPages.length} 个页面`);
    } catch (err) {
      if (signal.aborted || isStoppedError(err)) {
        if (this.stoppedJobs.has(jobId)) {
          this.stoppedJobs.delete(jobId);
        } else {
          this.store.resetIngestToUploaded(sourceId, jobId);
          this.search.invalidate();
        }
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.store.markIngestFailed(sourceId, message);
      this.saveJobEvent(
        {
          ...report,
          status: "failed",
          endedAt: new Date().toISOString(),
          error: message,
        },
        {
          stage: report.stage || "failed",
          status: "failed",
          message,
        },
      );
      this.store.appendLog(`解析 source ${sourceId} 失败：${message}`);
    }
  }

  private saveJobEvent(
    report: LlmWikiIngestJobReport,
    event: { stage: string; status?: "running" | "success" | "failed"; message: string },
  ): LlmWikiIngestJobReport {
    const at = new Date().toISOString();
    return this.store.saveIngestJob({
      ...report,
      stage: event.stage,
      status: event.status || report.status,
      events: [
        ...(report.events || []),
        {
          stage: event.stage,
          status: event.status || "running",
          message: event.message,
          at,
        },
      ],
    });
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

function assertNotStopped(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw new Error(LLM_WIKI_INGEST_STOPPED);
}

function isStoppedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message === LLM_WIKI_INGEST_STOPPED || err.name === "AbortError";
}
