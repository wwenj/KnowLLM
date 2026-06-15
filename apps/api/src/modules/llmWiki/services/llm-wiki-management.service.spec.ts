import assert from "node:assert/strict";
import test from "node:test";
import type { LlmWikiIngestService } from "./llm-wiki-ingest.service";
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
  const ingest = { ingestSource: (sourceId: string) => ({ source_id: sourceId }) };
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
  assert.equal(service.ingestSource("a".repeat(32)).source_id, "a".repeat(32));
  assert.equal(service.savePage("concepts/a.md", "# A").path, "concepts/a.md");
  service.deletePage("concepts/a.md");
  service.deleteSource("a".repeat(32));

  assert.deepEqual(calls, [
    "invalidate",
    "delete:concepts/a.md",
    "invalidate",
    "invalidate",
  ]);
});
