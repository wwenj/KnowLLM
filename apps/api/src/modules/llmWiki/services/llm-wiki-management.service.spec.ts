import assert from "node:assert/strict";
import test from "node:test";
import type { ModelService } from "../../model/model.service";
import type { LlmWikiCompilerService } from "./llm-wiki-compiler.service";
import { LlmWikiIngestService } from "./llm-wiki-ingest.service";
import type { LlmWikiIssueService } from "./llm-wiki-issue.service";
import type { LlmWikiLintService } from "./llm-wiki-lint.service";
import { LlmWikiManagementService } from "./llm-wiki-management.service";
import type { LlmWikiSchemaService } from "./llm-wiki-schema.service";
import type { LlmWikiSearchService } from "./llm-wiki-search.service";
import type { LlmWikiStoreService } from "./llm-wiki-store.service";

test("management service owns writes and delegates ingest without exposing internals", () => {
  const calls: string[] = [];
  const remainingSourceId = "b".repeat(32);
  const store = {
    listSources: () => [{ source_id: remainingSourceId, status: "ready" }],
    listIngestJobs: () => [],
    listPageRefs: () => [],
    listPageClaims: () => [],
    readFactLedger: () => null,
    stats: () => ({ total: 0 }),
    createSource: (filename: string) => ({ filename }),
    renameSource: () => ({ filename: "renamed.md" }),
    deleteSourceCascade: () => ({ needs_reconcile: [], touched_pages: [] }),
    savePage: (path: string) => ({ path }),
    deletePage: (path: string) => calls.push(`delete:${path}`),
  };
  const ingestCalls: Array<{ sourceId: string; model: string }> = [];
  const ingest = {
    ingestSource: (sourceId: string, model: string) => {
      ingestCalls.push({ sourceId, model });
      return { jobId: "b".repeat(32), sourceId, status: "running" as const };
    },
    stopIngest: (sourceId: string) => {
      ingestCalls.push({ sourceId, model: "stop" });
      return { ok: true, sourceId, status: "uploaded", stopped: true };
    },
    reingestSources: (sourceIds: string[], model: string) => {
      sourceIds.forEach((sourceId) => ingestCalls.push({ sourceId, model }));
      return sourceIds.map((sourceId) => ({ jobId: "c".repeat(32), sourceId, status: "running" as const }));
    },
  };
  const issues = { upsertMany: () => [], list: () => ({ items: [] }), resolve: (id: string) => ({ id }) };
  const search = { invalidate: () => calls.push("invalidate") };
  const schema = { read: () => ({ content: "" }), save: (content: string) => ({ content }) };
  const lint = { run: (mode: string) => ({ mode }) };
  const service = new LlmWikiManagementService(
    store as unknown as LlmWikiStoreService,
    ingest as unknown as LlmWikiIngestService,
    issues as unknown as LlmWikiIssueService,
    search as unknown as LlmWikiSearchService,
    schema as unknown as LlmWikiSchemaService,
    lint as unknown as LlmWikiLintService,
  );

  assert.equal(service.uploadSource("a.md", Buffer.from("a")).filename, "a.md");
  assert.equal(
    service.ingestSource("a".repeat(32), "provider-a:model-a").sourceId,
    "a".repeat(32),
  );
  assert.equal(service.savePage("concepts/a.md", "# A").path, "concepts/a.md");
  service.deletePage("concepts/a.md");
  service.stopIngest("a".repeat(32));
  service.deleteSource("a".repeat(32), "provider-a:model-a");

  assert.deepEqual(calls, [
    "invalidate",
    "delete:concepts/a.md",
    "invalidate",
    "invalidate",
    "invalidate",
  ]);
  assert.deepEqual(ingestCalls, [
    { sourceId: "a".repeat(32), model: "provider-a:model-a" },
    { sourceId: "a".repeat(32), model: "stop" },
    { sourceId: remainingSourceId, model: "provider-a:model-a" },
  ]);
});

test("ingest rejects an unavailable explicit model before changing source status", () => {
  let prepared = false;
  const store = {
    getSource: (sourceId: string) => ({
      source_id: sourceId,
      status: "uploaded",
    }),
    prepareIngest: () => {
      prepared = true;
      return {};
    },
  };
  const model = { resolveModel: () => "" };
  const service = new LlmWikiIngestService(
    store as unknown as LlmWikiStoreService,
    {} as LlmWikiCompilerService,
    {} as LlmWikiSearchService,
    {} as LlmWikiSchemaService,
    model as ModelService,
  );

  assert.throws(
    () => service.ingestSource("a".repeat(32), "missing:model"),
    /解析模型不存在或不可用/,
  );
  assert.equal(prepared, false);
});

test("stop ingest aborts running compile, deletes job report, and restores uploaded state", async () => {
  const sourceId = "a".repeat(32);
  let signalSeen: AbortSignal | undefined;
  let status: "uploaded" | "ingesting" = "uploaded";
  const calls: string[] = [];
  const reports = new Map<string, { jobId: string; sourceId: string; status: "running"; stage: string; model: string }>();
  const store = {
    getSource: (id: string) => ({ source_id: id, status, filename: "a.md" }),
    createIngestJob: (id: string, model: string) => {
      const report = { jobId: "j".repeat(32), sourceId: id, status: "running" as const, stage: "queued", model };
      reports.set(report.jobId, report);
      return report;
    },
    prepareIngest: () => {
      status = "ingesting";
      calls.push("prepare");
      return { source_id: sourceId, status };
    },
    getIngestJob: (jobId: string) => reports.get(jobId),
    saveIngestJob: (report: { jobId: string; stage: string }) => {
      calls.push(`stage:${report.stage}`);
      return report;
    },
    readSource: () => "# A",
    listPageRefs: () => [],
    resetIngestToUploaded: (_id: string, jobId: string) => {
      status = "uploaded";
      calls.push("reset");
      calls.push(`delete-job:${jobId}`);
      return { source_id: sourceId, status: "uploaded" };
    },
    markIngestFailed: () => calls.push("failed"),
    appendLog: () => undefined,
  };
  const compiler = {
    compileSource: ({ signal }: { signal?: AbortSignal }) => {
      signalSeen = signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    },
  };
  const service = new LlmWikiIngestService(
    store as unknown as LlmWikiStoreService,
    compiler as unknown as LlmWikiCompilerService,
    { invalidate: () => calls.push("invalidate") } as unknown as LlmWikiSearchService,
    { read: () => ({ content: "", sha256: "schema" }) } as unknown as LlmWikiSchemaService,
    { resolveModel: () => "provider:model" } as unknown as ModelService,
  );

  service.ingestSource(sourceId, "provider:model");
  const stopped = service.stopIngest(sourceId);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(stopped.status, "uploaded");
  assert.equal(stopped.stopped, true);
  assert.equal(signalSeen?.aborted, true);
  assert.equal(calls.includes("failed"), false);
  assert.equal(calls.includes("reset"), true);
  assert.equal(calls.includes(`delete-job:${"j".repeat(32)}`), true);
});

test("rebuild queues source ingests instead of compiling every source at once", async () => {
  const sourceIds = ["a".repeat(32), "b".repeat(32), "c".repeat(32)];
  const reports = new Map<string, any>();
  const statuses = new Map(sourceIds.map((id) => [id, "uploaded"]));
  const compileStarts: string[] = [];
  const compileResolvers: Array<() => void> = [];
  let jobIndex = 0;
  const store = {
    listSources: () => sourceIds.map((id) => ({ source_id: id, status: statuses.get(id), filename: `${id}.md` })),
    clearCompiledWikiArtifacts: () => undefined,
    getSource: (id: string) => ({ source_id: id, status: statuses.get(id), filename: `${id}.md`, sha256: id }),
    createIngestJob: (id: string, model: string) => {
      jobIndex += 1;
      const jobId = `${String(jobIndex).padStart(32, "0")}`;
      const report = {
        jobId,
        sourceId: id,
        status: "running" as const,
        stage: "queued",
        model,
        startedAt: new Date().toISOString(),
        endedAt: "",
        pages: [],
        factCount: 0,
        coverage: { mustTotal: 0, mustCovered: 0, mustCoverage: 1, missingMustFactIds: [] },
        issues: [],
        error: "",
        events: [],
      };
      reports.set(jobId, report);
      return report;
    },
    prepareIngest: (id: string) => {
      statuses.set(id, "ingesting");
      return { source_id: id, status: "ingesting" };
    },
    getIngestJob: (jobId: string) => reports.get(jobId),
    saveIngestJob: (report: { jobId: string }) => {
      reports.set(report.jobId, report);
      return report;
    },
    readSource: (id: string) => `# ${id}`,
    listPageRefs: () => [],
    publishCompiled: () => [],
    updateSource: (id: string, patch: { status?: string }) => {
      if (patch.status) statuses.set(id, patch.status);
    },
    markIngestFailed: (id: string) => statuses.set(id, "failed"),
    appendLog: () => undefined,
  };
  const compiler = {
    compileSource: ({ sourceId }: { sourceId: string }) => {
      compileStarts.push(sourceId);
      return new Promise((resolve) => {
        compileResolvers.push(() =>
          resolve({
            pages: [],
            pageClaims: [],
            sourceMap: { sourceId, filename: `${sourceId}.md`, sha256: sourceId, title: sourceId, sections: [] },
            factLedger: { sourceId, schemaHash: "schema", model: "provider:model", generatedAt: "", facts: [] },
            coverage: { mustTotal: 0, mustCovered: 0, mustCoverage: 1, missingMustFactIds: [] },
            issues: [],
          }),
        );
      });
    },
  };
  const service = new LlmWikiIngestService(
    store as unknown as LlmWikiStoreService,
    compiler as unknown as LlmWikiCompilerService,
    { invalidate: () => undefined } as unknown as LlmWikiSearchService,
    { read: () => ({ content: "", sha256: "schema" }) } as unknown as LlmWikiSchemaService,
    { resolveModel: () => "provider:model" } as unknown as ModelService,
  );

  const jobs = service.rebuildAll("provider:model");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(jobs.length, 3);
  assert.deepEqual(compileStarts, [sourceIds[0], sourceIds[1]]);

  compileResolvers[0]?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(compileStarts, [sourceIds[0], sourceIds[1], sourceIds[2]]);
  compileResolvers[1]?.();
  compileResolvers[2]?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
});
