import assert from "node:assert/strict";
import test from "node:test";
import type { LlmWikiNextToolsService } from "../../../llmWikiNext/llm-wiki-next-tools.service";
import { LlmWikiAgentTools } from "./llm-wiki-agent.tools";

test("agent tools only delegate to llmWikiNext published Tool contract", () => {
  const calls: string[] = [];
  const service = {
    getCatalog: () => {
      calls.push("catalog");
      return { stats: {}, pages: [], sources: [] };
    },
    searchWiki: (query: string) => {
      calls.push(`search:${query}`);
      return { query, items: [] };
    },
    readPage: (pageKey: string) => {
      calls.push(`page:${pageKey}`);
      return { page: { pageKey }, relations: {}, sources: [] };
    },
    readSource: (sourceId: string, startLine?: number, endLine?: number) => {
      calls.push(`source:${sourceId}:${startLine}-${endLine}`);
      return { source: { sourceId }, range: {}, content: "", pages: [], factRefs: [] };
    },
  };
  const tools = new LlmWikiAgentTools(service as unknown as LlmWikiNextToolsService);

  tools.getCatalog();
  tools.searchWiki("agent");
  tools.readPage("agent-overview");
  tools.readSource("a".repeat(32), 10, 20);

  assert.deepEqual(calls, ["catalog", "search:agent", "page:agent-overview", `source:${"a".repeat(32)}:10-20`]);
});
