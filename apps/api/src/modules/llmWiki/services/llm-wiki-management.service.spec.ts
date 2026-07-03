import assert from "node:assert/strict";
import test from "node:test";
import type { ModelService } from "../../model/model.service";
import type { LlmWikiCompilerService } from "./llm-wiki-compiler.service";
import type { LlmWikiFusionService } from "./llm-wiki-fusion.service";
import { LlmWikiIngestService } from "./llm-wiki-ingest.service";
import type { LlmWikiIssueService } from "./llm-wiki-issue.service";
import type { LlmWikiLintService } from "./llm-wiki-lint.service";
import { LlmWikiManagementService } from "./llm-wiki-management.service";
import type { LlmWikiSchemaService } from "./llm-wiki-schema.service";
import type { LlmWikiSearchService } from "./llm-wiki-search.service";
import type { LlmWikiStoreService } from "./llm-wiki-store.service";

test("management service owns writes and delegates ingest without exposing internals", () => {
  const calls: string[] = [];
  const store = {
    listSources: () => [],
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
      return { source_id: sourceId };
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
    service.ingestSource("a".repeat(32), "provider-a:model-a").source_id,
    "a".repeat(32),
  );
  assert.equal(service.savePage("concepts/a.md", "# A").path, "concepts/a.md");
  service.deletePage("concepts/a.md");
  service.deleteSource("a".repeat(32));

  assert.deepEqual(calls, [
    "invalidate",
    "delete:concepts/a.md",
    "invalidate",
    "invalidate",
  ]);
  assert.deepEqual(ingestCalls, [
    { sourceId: "a".repeat(32), model: "provider-a:model-a" },
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
    {} as LlmWikiFusionService,
    {} as LlmWikiIssueService,
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
