import assert from "node:assert/strict";
import test from "node:test";
import type { ModelService } from "../../model/model.service";
import { LlmWikiCompilerService } from "./llm-wiki-compiler.service";

test("normal source compile uses one model call and returns a candidate, not a published wiki", async () => {
  const sourceId = "a".repeat(32);
  const source = "# G-Code\n\nM112 triggers emergency stop\n\nmax_velocity defaults to 300\n";
  const calls: string[] = [];
  const model = {
    chat: async (options: { messages: Array<{ role: string; content: unknown }> }) => {
      calls.push(String(options.messages[0]?.content || ""));
      return json({
        sourceTitle: "G-Code",
        pages: [
          {
            path: `summaries/${sourceId}.md`,
            title: "G-Code",
            type: "summary",
            tags: ["summary"],
            action: "create",
            body: "# G-Code\n\n这份文档说明 `M112` 会触发 emergency stop，并记录 `max_velocity` 默认值。",
          },
          {
            path: "references/g-code.md",
            title: "G-Code Reference",
            type: "reference",
            tags: ["g-code"],
            action: "create",
            body: "# G-Code Reference\n\n`M112` triggers emergency stop。\n\n`max_velocity` defaults to `300`。",
          },
        ],
        claims: [
          {
            path: `summaries/${sourceId}.md`,
            text: "M112 triggers emergency stop",
          },
          {
            path: "references/g-code.md",
            text: "max_velocity defaults to 300",
          },
        ],
      });
    },
  };
  const compiler = new LlmWikiCompilerService(model as unknown as ModelService);

  const result = await compiler.compileSource({
    sourceId,
    filename: "klipper.md",
    source,
    existingPages: [],
    schema: { content: "# Schema", sha256: "schema", updated_at: "" },
    model: "test:model",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].includes("Source Integration Compiler"), true);
  assert.equal(result.status, "candidate_ready");
  assert.equal(result.modelUsage.modelCalls, 1);
  assert.equal(result.pages.length, 2);
  assert.equal(result.claims.length, 2);
  assert.equal(result.pages.some((page) => /Evidence:|Trace:|factId/.test(page.body)), false);
  assert.equal(result.issues.some((issue) => issue.kind === "blocked_publish"), false);
});

test("compiler does not multiply calls by existing pages or sections", async () => {
  const sourceId = "b".repeat(32);
  const source = "# Config\n\n配置检查会解析 printer.cfg 并报告配置错误。\n";
  let callCount = 0;
  const model = {
    chat: async () => {
      callCount += 1;
      return json({
        sourceTitle: "Config",
        pages: [
          {
            path: `summaries/${sourceId}.md`,
            title: "Config",
            type: "summary",
            tags: ["summary"],
            action: "create",
            body: "# Config\n\n配置检查会解析 `printer.cfg` 并报告配置错误。",
          },
        ],
      });
    },
  };
  const compiler = new LlmWikiCompilerService(model as unknown as ModelService);

  await compiler.compileSource({
    sourceId,
    filename: "config.md",
    source,
    existingPages: Array.from({ length: 50 }, (_, index) => ({
      path: `concepts/page-${index}.md`,
      title: `Page ${index}`,
      type: "concept" as const,
      tags: [],
      sources: [],
      schema_hash: "schema",
      updated_at: "",
    })),
    schema: { content: "# Schema", sha256: "schema", updated_at: "" },
    model: "test:model",
  });

  assert.equal(callCount, 1);
});

test("candidate gate blocks destructive delete actions locally", async () => {
  const sourceId = "c".repeat(32);
  const source = "# A\n\nA claim.";
  const model = {
    chat: async () =>
      json({
        sourceTitle: "A",
        pages: [
          {
            path: `summaries/${sourceId}.md`,
            title: "A",
            type: "summary",
            tags: ["summary"],
            action: "delete",
            body: "# A\n\nA claim.",
          },
        ],
        claims: [
          {
            path: `summaries/${sourceId}.md`,
            text: "A claim.",
          },
        ],
      }),
  };
  const compiler = new LlmWikiCompilerService(model as unknown as ModelService);

  const result = await compiler.compileSource({
    sourceId,
    filename: "a.md",
    source,
    existingPages: [],
    schema: { content: "# Schema", sha256: "schema", updated_at: "" },
    model: "test:model",
  });

  assert.equal(result.status, "needs_review");
  assert.equal(result.issues.some((issue) => issue.kind === "blocked_publish"), true);
});

test("compile succeeds when model returns pages without claims or evidence fields", async () => {
  const sourceId = "d".repeat(32);
  const source = "# 使用 PWM 工具\n\n该文档介绍如何配置 `output_pin` 和宏命令。\n";
  const model = {
    chat: async () =>
      json({
        sourceTitle: "使用 PWM 工具",
        pages: [
          {
            path: `summaries/${sourceId}.md`,
            title: "使用 PWM 工具",
            type: "summary",
            tags: ["summary"],
            action: "create",
            body: "# 使用 PWM 工具\n\n本文介绍如何配置 `output_pin` 和宏命令。",
          },
        ],
      }),
  };
  const compiler = new LlmWikiCompilerService(model as unknown as ModelService);

  const result = await compiler.compileSource({
    sourceId,
    filename: "pwm.md",
    source,
    existingPages: [],
    schema: { content: "# Schema", sha256: "schema", updated_at: "" },
    model: "test:model",
  });

  assert.equal(result.status, "candidate_ready");
  assert.equal(result.claims.length, 0);
  assert.equal(result.issues.some((issue) => issue.kind === "human_review"), false);
});

function json(payload: unknown) {
  return {
    choices: [{ message: { content: JSON.stringify(payload) } }],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}
