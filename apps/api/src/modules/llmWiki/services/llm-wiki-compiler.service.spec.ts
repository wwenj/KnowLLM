import assert from "node:assert/strict";
import test from "node:test";
import type { ModelService } from "../../model/model.service";
import { LlmWikiCompilerService } from "./llm-wiki-compiler.service";

test("compiler writes semantic wiki pages instead of fact dump pages", async () => {
  const sourceId = "a".repeat(32);
  const calls: string[] = [];
  const model = {
    chat: async (options: { messages: Array<{ role: string; content: unknown }> }) => {
      const system = String(options.messages[0]?.content || "");
      calls.push(system.split("\n")[0]);
      if (system.includes("fact extractor")) {
        return json({
          facts: [
            {
              factId: `${sourceId}:m112`,
              sourceId,
              sectionId: "s0001",
              type: "command",
              importance: "must",
              fact: "M112 triggers emergency stop",
              evidence: "M112 triggers emergency stop",
              sourceSpan: { start: 0, end: 28 },
              entities: ["G-Code"],
              retention: "exact",
            },
            {
              factId: `${sourceId}:max_velocity`,
              sourceId,
              sectionId: "s0001",
              type: "default",
              importance: "must",
              fact: "max_velocity defaults to 300",
              evidence: "max_velocity defaults to 300",
              sourceSpan: { start: 29, end: 57 },
              entities: ["G-Code"],
              retention: "exact",
            },
          ],
        });
      }
      if (system.includes("semantic page planner")) {
        return json({
          pages: [
            {
              path: `summaries/${sourceId}.md`,
              title: "Klipper G-Code",
              type: "summary",
              tags: ["summary"],
              semanticGoal: "说明这份 source 的主题和入口页面。",
              factIds: [`${sourceId}:m112`, `${sourceId}:max_velocity`],
              linkTargets: ["references/g-code.md"],
            },
            {
              path: "references/g-code.md",
              title: "G-Code Reference",
              type: "reference",
              tags: ["reference", "g-code"],
              semanticGoal: "整理 G-Code 命令和配置默认值。",
              factIds: [`${sourceId}:m112`, `${sourceId}:max_velocity`],
              linkTargets: [],
            },
          ],
        });
      }
      if (system.includes("semantic page writer")) {
        const payload = JSON.parse(String(options.messages[1]?.content || "{}")) as {
          pagePlan?: { path?: string };
        };
        if (payload.pagePlan?.path?.startsWith("summaries/")) {
          return json({
            body: "# Klipper G-Code\n\n这份 source 说明 `M112` 会 triggers emergency stop，并说明 `max_velocity` defaults to `300`。\n\n## 页面\n\n- [[references/g-code.md]]：G-Code 命令和配置默认值。",
            claimedFactIds: [`${sourceId}:m112`, `${sourceId}:max_velocity`],
          });
        }
        return json({
          body: "# G-Code Reference\n\n## 命令\n\n| 命令 | 作用 |\n| --- | --- |\n| `M112` | triggers emergency stop |\n\n## 配置默认值\n\n`max_velocity` 默认值是 `300`。",
          tags: ["reference"],
          claimedFactIds: [`${sourceId}:m112`, `${sourceId}:max_velocity`],
        });
      }
      throw new Error("unexpected model call");
    },
  };
  const compiler = new LlmWikiCompilerService(model as unknown as ModelService);

  const result = await compiler.compileSource({
    sourceId,
    filename: "klipper.md",
    source: "# G-Code\n\nM112 triggers emergency stop\n\nmax_velocity defaults to 300\n",
    existingPages: [],
    schema: { content: "# Schema", sha256: "schema", updated_at: "" },
    model: "test:model",
  });

  assert.deepEqual(calls, [
    "你是 LLM Wiki fact extractor，只从给定 section 抽取可追踪事实。",
    "你是 LLM Wiki semantic page planner。你的任务不是生成 facts 列表，而是规划可长期阅读的语义 Wiki 页面。",
    "你是 LLM Wiki semantic page writer。你要把 pagePlan 和 facts 写成可阅读的 Markdown Wiki 页面。",
    "你是 LLM Wiki semantic page writer。你要把 pagePlan 和 facts 写成可阅读的 Markdown Wiki 页面。",
  ]);
  assert.equal(result.issues.some((issue) => issue.kind === "blocked_publish"), false);
  assert.equal(result.coverage.mustCoverage, 1);
  assert.equal(result.pages.length, 2);
  assert.equal(result.pages.some((page) => /Evidence:|Trace:|factId/.test(page.body)), false);
  assert.equal(result.pages.find((page) => page.path === "references/g-code.md")?.body.includes("max_velocity"), true);
  assert.equal(result.pageClaims.every((claim) => claim.factIds.length === 2), true);
});

test("compiler verifies and prunes writer overclaims before building page claims", async () => {
  const sourceId = "b".repeat(32);
  const configFactId = `${sourceId}:config-check`;
  const tempFactId = `${sourceId}:temperature-check`;
  const model = {
    chat: async (options: { messages: Array<{ role: string; content: unknown }> }) => {
      const system = String(options.messages[0]?.content || "");
      if (system.includes("fact extractor")) {
        return json({
          facts: [
            {
              factId: configFactId,
              sourceId,
              sectionId: "s0001",
              type: "definition",
              importance: "must",
              fact: "配置检查用于确认 Klipper 的 printer.cfg 是否可被解析，并报告配置错误。",
              evidence: "配置检查会解析 printer.cfg 并报告配置错误。",
              sourceSpan: { start: 0, end: 40 },
              entities: ["配置检查"],
              retention: "semantic",
            },
            {
              factId: tempFactId,
              sourceId,
              sectionId: "s0001",
              type: "procedure_step",
              importance: "must",
              fact: "温度验证需要确认喷嘴和热床温度持续更新且没有异常升高。",
              evidence: "验证温度持续更新且没有异常升高。",
              sourceSpan: { start: 41, end: 80 },
              entities: ["温度验证"],
              retention: "semantic",
            },
          ],
        });
      }
      if (system.includes("semantic page planner")) {
        return json({
          pages: [
            {
              path: `summaries/${sourceId}.md`,
              title: "配置检查",
              type: "summary",
              tags: ["summary"],
              semanticGoal: "说明配置检查文档的入口。",
              factIds: [configFactId, tempFactId],
              linkTargets: ["procedures/temperature-check.md"],
            },
            {
              path: "procedures/temperature-check.md",
              title: "温度验证",
              type: "procedure",
              tags: ["procedure"],
              semanticGoal: "说明温度验证流程。",
              factIds: [tempFactId],
              linkTargets: [],
            },
          ],
        });
      }
      if (system.includes("semantic page writer")) {
        const payload = JSON.parse(String(options.messages[1]?.content || "{}")) as {
          pagePlan?: { path?: string };
        };
        if (payload.pagePlan?.path?.startsWith("summaries/")) {
          return json({
            body: "# 配置检查\n\n本文介绍配置检查，它会解析 Klipper 的 `printer.cfg`，并帮助发现配置错误。\n\n- [[procedures/temperature-check.md]]",
            claimedFactIds: [configFactId, tempFactId],
          });
        }
        return json({
          body: "# 温度验证\n\n验证时观察喷嘴和热床温度是否持续更新，且不能出现异常升高。",
          claimedFactIds: [],
        });
      }
      throw new Error("unexpected model call");
    },
  };
  const compiler = new LlmWikiCompilerService(model as unknown as ModelService);

  const result = await compiler.compileSource({
    sourceId,
    filename: "config-check.md",
    source: "# 配置检查\n\n配置检查会解析 printer.cfg。\n\n温度验证需要观察温度。",
    existingPages: [],
    schema: { content: "# Schema", sha256: "schema", updated_at: "" },
    model: "test:model",
  });

  const summaryClaim = result.pageClaims.find((claim) => claim.path === `summaries/${sourceId}.md`);
  const procedureClaim = result.pageClaims.find((claim) => claim.path === "procedures/temperature-check.md");
  assert.deepEqual(summaryClaim?.factIds, [configFactId]);
  assert.deepEqual(procedureClaim?.factIds, [tempFactId]);
  assert.equal(result.coverage.mustCoverage, 1);
  assert.equal(result.issues.some((issue) => issue.kind === "blocked_publish"), false);
});

function json(payload: unknown) {
  return { choices: [{ message: { content: JSON.stringify(payload) } }] };
}
