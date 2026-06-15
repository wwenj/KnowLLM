import assert from "node:assert/strict";
import test from "node:test";
import type { LlmWikiSchemaService } from "./llm-wiki-schema.service";
import type { LlmWikiSearchService } from "./llm-wiki-search.service";
import type { LlmWikiStoreService } from "./llm-wiki-store.service";
import { LlmWikiRetrievalService } from "./llm-wiki-retrieval.service";

const sourceId = "a".repeat(32);
const page = {
  path: "concepts/agent.md",
  title: "Agent",
  type: "concept" as const,
  tags: ["agent"],
  sources: [sourceId],
  schema_hash: "schema",
  updated_at: "2026-06-15T00:00:00.000Z",
  content: "# Agent\n\n[[entities/model.md]]\n\n`[[entities/ignored.md]]`",
};

test("retrieval service exposes one stable read-only contract", () => {
  const store = {
    listSources: () => [
      {
        source_id: sourceId,
        filename: "agent.md",
        status: "ready",
        touched_pages: [page.path],
      },
    ],
    tree: () => ({ groups: [{ group: "Concepts", pages: [{ ...page, content: undefined }] }] }),
    pageExists: (path: string) => path === "index.md",
    getPage: (path: string) => (path === "index.md" ? { ...page, path, content: "# Index" } : page),
    getSource: () => ({ source_id: sourceId, filename: "agent.md" }),
    readSource: () => "raw source",
  };
  const search = {
    search: (query: string, limit?: number) => ({ query, hits: [], returned: Number(limit || 0) }),
  };
  const schema = {
    read: () => ({ content: "# Schema", sha256: "schema", updated_at: "2026-06-15T00:00:00.000Z" }),
  };
  const service = new LlmWikiRetrievalService(
    store as unknown as LlmWikiStoreService,
    search as unknown as LlmWikiSearchService,
    schema as unknown as LlmWikiSchemaService,
  );

  assert.equal(service.getManifest().stats.readySources, 1);
  assert.deepEqual(service.readPage(page.path).links, ["entities/model.md"]);
  assert.equal(service.readSource(sourceId).content, "raw source");
  assert.equal(service.search("agent", 3).returned, 3);
  assert.throws(() => service.readPage("../secret.md"), /path 非法/);
});
