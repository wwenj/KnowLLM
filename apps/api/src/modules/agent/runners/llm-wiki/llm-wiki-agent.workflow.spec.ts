import assert from "node:assert/strict";
import test from "node:test";
import type { ModelService } from "../../../model/model.service";
import type { AgentRunnerContext } from "../../agent.types";
import type { LlmWikiAgentTools } from "./llm-wiki-agent.tools";
import type { LlmWikiAgentInput } from "./llm-wiki-agent.types";
import { LlmWikiAgentWorkflow } from "./llm-wiki-agent.workflow";

test("workflow keeps the planner -> page -> source review flow behind llmWiki tools", async () => {
  const sourceId = "a".repeat(32);
  const calls: string[] = [];
  const tools = {
    getManifest: () => ({
      stats: { sourceCount: 1, readySources: 1, pageCount: 1 },
      schema: { content: "# Schema", sha256: "schema", updated_at: "" },
      index: "# Index",
      pages: [
        {
          path: "concepts/agent.md",
          title: "Agent",
          type: "concept",
          tags: [],
          sources: [sourceId],
          schema_hash: "schema",
          updated_at: "",
        },
      ],
      sources: [{ source_id: sourceId, filename: "agent.md", status: "ready", touched_pages: ["concepts/agent.md"] }],
    }),
    searchWiki: () => {
      calls.push("search");
      return { query: "", hits: [], returned: 0 };
    },
    readWikiPage: (path: string) => {
      calls.push(`page:${path}`);
      return {
        path,
        title: "Agent",
        type: "concept",
        tags: [],
        sources: [sourceId],
        schema_hash: "schema",
        updated_at: "",
        content: "# Agent\n\nVerified fact.",
        links: [],
      };
    },
    readRawSource: (id: string) => {
      calls.push(`source:${id}`);
      return { source_id: id, filename: "agent.md", content: "Verified fact." };
    },
  };
  const model = {
    resolveModel: (modelName: string) => modelName || "test",
    findModel: (modelName: string) => ({ model: modelName }),
    hasConfiguredModel: () => true,
    chat: async ({ messages }: { messages: Array<{ content: unknown }> }) => {
      const system = String(messages[0]?.content || "");
      const value = system.includes("查询规划器")
        ? {
            queryIntent: "specific",
            tasks: [
              {
                goal: "find fact",
                requiredPaths: ["concepts/agent.md"],
                optionalPaths: [],
                searchQueries: [],
                expectedContribution: "fact",
              },
            ],
          }
        : system.includes("evidence reviewer")
          ? {
              keepPages: [{ path: "concepts/agent.md", taskGoals: ["find fact"], relevanceScore: 100, evidenceScore: 100 }],
              dropPages: [],
              coverage: {},
              gaps: [],
              nextActions: [],
              stop: true,
              stopReason: "complete",
            }
          : system.includes("Knowledge Agent")
            ? {
                answerMarkdown: "# Synthesized answer\n\nVerified fact.",
                citations: [{ path: "concepts/agent.md", title: "Agent", sources: [sourceId] }],
                gaps: [],
                coverageSummary: "complete",
              }
            : {
              sourceReviews: [{ path: "concepts/agent.md", sourceSupport: "verified", supportSummary: "verified" }],
              gaps: [],
              coverageSummary: "complete",
            };
      return { choices: [{ message: { content: JSON.stringify(value) } }] };
    },
  };
  const workflow = new LlmWikiAgentWorkflow(
    tools as unknown as LlmWikiAgentTools,
    model as unknown as ModelService,
  );
  const legacyModeKey = ["output", "Mode"].join("");
  const input = workflow.validateInput({
    query: "What is the fact?",
    [legacyModeKey]: "snippets",
    sourcePolicy: "key-sources",
    budget: { maxRounds: 2, maxEvidencePages: 8, maxRawSources: 2, tokenLimit: null },
    models: { plannerModel: "test", reviewerModel: "test", synthesizerModel: "test" },
  });
  assert.equal(input[legacyModeKey], undefined);
  const events: string[] = [];
  const result = await workflow.start({
    runId: "a".repeat(32),
    agentType: "llmWiki",
    input,
    signal: new AbortController().signal,
    appendEvent: (event) => events.push(event.type),
    updateRunnerMeta: () => undefined,
  } as AgentRunnerContext<LlmWikiAgentInput>);

  assert.deepEqual(calls, ["search", `page:concepts/agent.md`, `source:${sourceId}`]);
  assert.equal(result.status, "success");
  assert.match(result.content, /Synthesized answer/);
  assert.equal((result.resultJson?.knowledgeSnippets as unknown[]).length, 1);
  assert.ok(events.includes("plan_created"));
  assert.ok(events.includes("sources_reviewed"));
});
