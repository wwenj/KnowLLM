import assert from "node:assert/strict";
import test from "node:test";
import type { LlmWikiRetrievalService } from "../../../llmWiki/services/llm-wiki-retrieval.service";
import { LlmWikiAgentTools } from "./llm-wiki-agent.tools";

test("agent tools only delegate to the llmWiki retrieval contract", () => {
  const calls: string[] = [];
  const retrieval = {
    getManifest: () => {
      calls.push("manifest");
      return { kind: "manifest" };
    },
    search: (query: string, limit?: number) => {
      calls.push(`search:${query}:${limit}`);
      return { query, hits: [], returned: 0 };
    },
    readPage: (path: string) => {
      calls.push(`page:${path}`);
      return { path };
    },
    readSource: (sourceId: string) => {
      calls.push(`source:${sourceId}`);
      return { source_id: sourceId };
    },
  };
  const tools = new LlmWikiAgentTools(retrieval as unknown as LlmWikiRetrievalService);

  tools.getManifest();
  tools.searchWiki("agent", 5);
  tools.readWikiPage("concepts/agent.md");
  tools.readRawSource("a".repeat(32));

  assert.deepEqual(calls, [
    "manifest",
    "search:agent:5",
    "page:concepts/agent.md",
    `source:${"a".repeat(32)}`,
  ]);
});
