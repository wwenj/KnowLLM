import assert from "node:assert/strict";
import test from "node:test";
import type { ModelService } from "../../model/model.service";
import { LlmWikiCompilerService } from "./llm-wiki-compiler.service";

const sourceId = "a".repeat(32);
const schema = { content: "# Schema", sha256: "schema", updated_at: "" };

test("analyze plan is bounded by token-aware chunks and exact retry slots", () => {
  const compiler = new LlmWikiCompilerService({} as ModelService);
  const source = `${"A".repeat(19_000)}\n\n${"B".repeat(6_000)}`;
  const sourceMap = compiler.sectionSource({ sourceId, filename: "long.md", source });
  const plan = compiler.estimateAnalyzePlan({ sourceId, filename: "long.md", source, existingPages: [], schema, model: "test:model" });

  assert.equal(sourceMap.sections.length >= 2, true);
  assert.equal(plan.estimatedCalls, sourceMap.sections.length * 2);
  assert.equal(plan.maxModelCalls, sourceMap.sections.length * 4);
  assert.equal(plan.callPlan.find((item) => item.stage === "extract_facts")?.maxCalls, sourceMap.sections.length * 2);
  assert.equal(plan.maxTokens, plan.callPlan.reduce((total, item) => total + (item.hardTokens || 0), 0));
  assert.equal(sourceMap.sections[0].startOffset, 0);
  assert.equal(sourceMap.sections.at(-1)?.endOffset, source.length);
});

test("chunking makes progress on long lines and avoids splitting a normal fenced code block", () => {
  const compiler = new LlmWikiCompilerService({} as ModelService);
  const longLineSource = `# Prefix\n${"x".repeat(45_000)}`;
  const longLineMap = compiler.sectionSource({ sourceId, filename: "line.md", source: longLineSource });
  assert.equal(longLineMap.sections.length >= 3, true);
  assert.equal(longLineMap.sections.every((item) => item.endOffset > item.startOffset), true);
  assert.equal(longLineMap.sections.at(-1)?.endOffset, longLineSource.length);

  const prefix = "A".repeat(15_000);
  const code = `\n\n\`\`\`ini\n${"B".repeat(3_000)}\n\`\`\`\n\n`;
  const fencedSource = `${prefix}${code}${"C".repeat(3_000)}`;
  const fencedMap = compiler.sectionSource({ sourceId, filename: "code.md", source: fencedSource });
  const opening = fencedSource.indexOf("```ini");
  const closingEnd = fencedSource.indexOf("```", opening + 3) + 3;
  assert.equal(fencedMap.sections[0].endOffset > opening && fencedMap.sections[0].endOffset < closingEnd, false);
});

test("analyze retries invalid evidence once and persists exact source spans", async () => {
  let extractAttempts = 0;
  const model = createModel({
    extract: (payload) => {
      extractAttempts += 1;
      const content = String(payload.source?.content || payload.input?.source?.content || "");
      return {
        facts: [rawFact(extractAttempts === 1 ? "not in source" : firstFactLine(content))],
      };
    },
  });
  const compiler = new LlmWikiCompilerService(model as unknown as ModelService);
  const source = "# Config\n\n`max_velocity` defaults to `300`.";
  const plan = compiler.estimateAnalyzePlan({ sourceId, filename: "config.md", source, existingPages: [], schema, model: "test:model" });
  const analysis = await compiler.analyzeSource({ sourceId, filename: "config.md", source, existingPages: [], schema, model: "test:model", plan });

  assert.equal(extractAttempts, 2);
  assert.equal(analysis.usage.retries, 1);
  assert.equal(analysis.factLedger.facts[0].evidence, "`max_velocity` defaults to `300`.");
  assert.equal(source.slice(analysis.factLedger.facts[0].sourceSpan.start, analysis.factLedger.facts[0].sourceSpan.end), analysis.factLedger.facts[0].evidence);
});

test("audit uses compact facts and deterministic planner assigns every fact once", async () => {
  const evidence = `Setting: ${"x".repeat(1_000)}`;
  const source = `# Config\n\n${evidence}`;
  let auditFacts: Array<Record<string, unknown>> = [];
  const model = createModel({
    extract: () => ({
      facts: [{ type: "config", importance: "must", retention: "exact", fact: "Setting is configured.", evidence, entities: [] }],
    }),
    audit: (payload) => {
      auditFacts = payload.existingFacts as Array<Record<string, unknown>>;
      return { missingFacts: [] };
    },
  });
  const compiler = new LlmWikiCompilerService(model as unknown as ModelService);
  const plan = compiler.estimateAnalyzePlan({ sourceId, filename: "config.md", source, existingPages: [], schema, model: "test:model" });

  const analysis = await compiler.analyzeSource({ sourceId, filename: "config.md", source, existingPages: [], schema, model: "test:model", plan });

  for (const fact of auditFacts) {
    assert.equal("evidence" in fact, false);
    assert.equal("sourceSpan" in fact, false);
  }
  assert.deepEqual(analysis.pagePlan.flatMap((item) => item.factIds), [analysis.factLedger.facts[0].factId]);
});

test("failed model attempts are counted and retain their retry reason", async () => {
  let attempts = 0;
  const model = createModel({
    extract: (payload) => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary provider failure");
      const content = String(payload.input?.source?.content || payload.source?.content || "");
      return { facts: [rawFact(firstFactLine(content))] };
    },
  });
  const compiler = new LlmWikiCompilerService(model as unknown as ModelService);
  const source = "# Config\n\nFact one.";
  const plan = compiler.estimateAnalyzePlan({ sourceId, filename: "config.md", source, existingPages: [], schema, model: "test:model" });
  const analysis = await compiler.analyzeSource({ sourceId, filename: "config.md", source, existingPages: [], schema, model: "test:model", plan });

  assert.equal(analysis.usage.modelCalls, 3);
  assert.equal(analysis.usage.retries, 1);
  assert.equal(analysis.usage.calls[0].status, "failed");
  assert.match(analysis.usage.calls[0].error || "", /temporary provider failure/);
});

test("full two-stage compile publishes only after every must fact has page evidence", async () => {
  const model = createModel();
  const compiler = new LlmWikiCompilerService(model as unknown as ModelService);
  const source = "# Config\n\n`M112` triggers emergency stop.\n\n`max_velocity` defaults to `300`.";
  const analyzePlan = compiler.estimateAnalyzePlan({ sourceId, filename: "config.md", source, existingPages: [], schema, model: "test:model" });
  const analysis = await compiler.analyzeSource({ sourceId, filename: "config.md", source, existingPages: [], schema, model: "test:model", plan: analyzePlan });
  const composePlan = compiler.estimateComposePlan({ sourceId, filename: "config.md", source, existingPages: [], schema, model: "test:model", analysis });
  const candidate = await compiler.composeSource({ sourceId, filename: "config.md", source, existingPages: [], schema, model: "test:model", analysis, plan: composePlan });

  assert.equal(candidate.status, "candidate_ready");
  assert.equal(candidate.coverageReport?.mustCoverage, 1);
  assert.equal(candidate.coverageReport?.incorrect, 0);
  assert.equal(candidate.pageClaims?.[0].factIds.length, 2);
  assert.equal(candidate.modelUsage.modelCalls, 4);
  assert.equal(candidate.modelUsage.modelCalls <= analyzePlan.maxModelCalls + composePlan.maxModelCalls, true);
});

test("compose performs one repair pass and then succeeds", async () => {
  let writeCalls = 0;
  const model = createModel({
    writer: (payload) => {
      writeCalls += 1;
      const facts = payload.facts as Array<{ factId: string; fact: string }>;
      if (writeCalls > 1) return writerPayload(facts);
      return { ...writerPayload(facts), body: `# Config\n\n${facts[0]?.fact || ""}` };
    },
  });
  const compiler = new LlmWikiCompilerService(model as unknown as ModelService);
  const source = "# Config\n\nFact one.\n\nFact two.";
  const analysis = await analyze(compiler, source);
  const plan = compiler.estimateComposePlan({ sourceId, filename: "config.md", source, existingPages: [], schema, model: "test:model", analysis });
  const candidate = await compiler.composeSource({ sourceId, filename: "config.md", source, existingPages: [], schema, model: "test:model", analysis, plan });

  assert.equal(candidate.status, "candidate_ready");
  assert.equal(candidate.coverageReport?.repairPasses, 1);
  assert.equal(candidate.coverageReport?.mustCoverage, 1);
});

test("persistent must missing is saved as needs_review and cannot publish", async () => {
  const model = createModel({
    writer: (payload) => {
      const facts = payload.facts as Array<{ factId: string; fact: string }>;
      return { ...writerPayload(facts), body: `# Config\n\n${facts[0]?.fact || ""}` };
    },
    repair: (payload) => ({
      body: payload.page.body,
      tags: [],
      claimedFactIds: (payload.missingOrIncorrectFacts as Array<{ factId: string }>).map((fact) => fact.factId),
    }),
  });
  const compiler = new LlmWikiCompilerService(model as unknown as ModelService);
  const source = "# Config\n\nFact one.\n\nFact two.";
  const analysis = await analyze(compiler, source);
  const plan = compiler.estimateComposePlan({ sourceId, filename: "config.md", source, existingPages: [], schema, model: "test:model", analysis });
  const candidate = await compiler.composeSource({ sourceId, filename: "config.md", source, existingPages: [], schema, model: "test:model", analysis, plan });

  assert.equal(candidate.status, "needs_review");
  assert.equal((candidate.coverageReport?.missingMustFactIds.length || 0) > 0, true);
  assert.equal(candidate.issues.some((issue) => issue.kind === "blocked_publish"), true);
  assert.equal(candidate.pages[0].claimedFactIds?.length, 1);
});

test("hard model-call budget stops the stage without hidden calls", async () => {
  let calls = 0;
  const model = createModel({ onCall: () => { calls += 1; } });
  const compiler = new LlmWikiCompilerService(model as unknown as ModelService);
  const source = "# Config\n\nFact one.";
  const plan = compiler.estimateAnalyzePlan({ sourceId, filename: "config.md", source, existingPages: [], schema, model: "test:model" });
  plan.maxModelCalls = 1;

  await assert.rejects(
    compiler.analyzeSource({ sourceId, filename: "config.md", source, existingPages: [], schema, model: "test:model", plan }),
    /模型调用预算已耗尽/,
  );
  assert.equal(calls, 1);
});

test("chunk cache reuses successful chunks without any hidden model call", async () => {
  let calls = 0;
  const model = createModel({ onCall: () => { calls += 1; } });
  const compiler = new LlmWikiCompilerService(model as unknown as ModelService);
  const source = "# Config\n\nFact one.";
  const cache = new Map<string, any>();
  const firstPlan = compiler.estimateAnalyzePlan({ sourceId, filename: "config.md", source, existingPages: [], schema, model: "test:model" });
  const first = await compiler.analyzeSource({
    sourceId, filename: "config.md", source, existingPages: [], schema, model: "test:model", plan: firstPlan,
    chunkCache: { read: (key) => cache.get(key) || null, write: (entry) => cache.set(entry.cacheKey, entry) },
  });
  assert.equal(first.usage.modelCalls, 2);
  const keys = new Set(compiler.chunkCacheKeys({ sourceId, filename: "config.md", source, schema, model: "test:model" }));
  const cachedPlan = compiler.estimateAnalyzePlan({ sourceId, filename: "config.md", source, existingPages: [], schema, model: "test:model", cachedChunkKeys: keys });
  const reused = await compiler.analyzeSource({
    sourceId, filename: "config.md", source, existingPages: [], schema, model: "test:model", plan: cachedPlan,
    chunkCache: { read: (key) => cache.get(key) || null, write: (entry) => cache.set(entry.cacheKey, entry) },
  });
  assert.equal(cachedPlan.maxModelCalls, 0);
  assert.equal(reused.usage.modelCalls, 0);
  assert.equal(calls, 2);
});

test("provider usage beyond confirmed output cap stops as budget_violation", async () => {
  const model = {
    chat: async () => ({
      choices: [{ message: { content: JSON.stringify({ facts: [rawFact("Fact one.")] }) } }],
      usage: { input_tokens: 100, output_tokens: 99 },
    }),
  };
  const compiler = new LlmWikiCompilerService(model as unknown as ModelService);
  const source = "# Config\n\nFact one.";
  const plan = compiler.estimateAnalyzePlan({ sourceId, filename: "config.md", source, existingPages: [], schema, model: "test:model" });
  const extract = plan.callPlan.find((item) => item.stage === "extract_facts");
  if (!extract) throw new Error("missing extract budget");
  extract.hardOutputTokens = 10 * extract.maxCalls;
  plan.maxTokens = plan.callPlan.reduce((total, item) => total + (item.hardTokens || 0), 0) - (8_000 - 10) * extract.maxCalls;
  await assert.rejects(
    compiler.analyzeSource({ sourceId, filename: "config.md", source, existingPages: [], schema, model: "test:model", plan }),
    /budget_violation/,
  );
});

async function analyze(compiler: LlmWikiCompilerService, source: string) {
  const plan = compiler.estimateAnalyzePlan({ sourceId, filename: "config.md", source, existingPages: [], schema, model: "test:model" });
  return compiler.analyzeSource({ sourceId, filename: "config.md", source, existingPages: [], schema, model: "test:model", plan });
}

function createModel(overrides: {
  extract?: (payload: Record<string, any>) => unknown;
  audit?: (payload: Record<string, any>) => unknown;
  planner?: (payload: Record<string, any>) => unknown;
  writer?: (payload: Record<string, any>) => unknown;
  repair?: (payload: Record<string, any>) => unknown;
  onCall?: () => void;
} = {}) {
  return {
    chat: async (options: { messages: Array<{ content: unknown }> }) => {
      overrides.onCall?.();
      const system = String(options.messages[0]?.content || "");
      const payload = JSON.parse(String(options.messages[1]?.content || "{}")) as Record<string, any>;
      if (system.includes("事实提取器")) {
        const content = String(payload.source?.content || payload.input?.source?.content || "");
        return json(overrides.extract?.(payload) || { facts: factLines(content).map(rawFact) });
      }
      if (system.includes("遗漏审计器")) return json(overrides.audit?.(payload) || { missingFacts: [] });
      if (system.includes("页面规划器")) {
        const facts = payload.facts as Array<{ factId: string }>;
        return json(overrides.planner?.(payload) || pagePlanPayload(facts));
      }
      if (system.includes("页面 writer")) {
        return json(overrides.writer?.(payload) || writerPayload(payload.facts));
      }
      if (system.includes("页面修复器")) {
        const facts = payload.missingOrIncorrectFacts as Array<{ factId: string; fact: string }>;
        return json(overrides.repair?.(payload) || {
          body: `${payload.page.body}\n\n${facts.map((fact) => fact.fact).join("\n\n")}`,
          tags: [],
          claimedFactIds: facts.map((fact) => fact.factId),
        });
      }
      if (system.includes("覆盖验证器")) {
        const pages = payload.pages as Array<{ path: string; body: string }>;
        const facts = payload.facts as Array<{ factId: string; fact: string }>;
        return json({ facts: facts.map((fact) => {
          const page = pages.find((item) => item.body.includes(fact.fact));
          return page
            ? { factId: fact.factId, status: "correct", evidencePath: page.path, wikiEvidence: fact.fact, reason: "covered" }
            : { factId: fact.factId, status: "missing", evidencePath: "", wikiEvidence: "", reason: "missing" };
        }) });
      }
      throw new Error(`unexpected prompt: ${system}`);
    },
  };
}

function pagePlanPayload(facts: Array<{ factId: string }>) {
  return {
    pages: [{
      path: `summaries/${sourceId}.md`,
      title: "Config",
      type: "summary",
      tags: ["summary"],
      semanticGoal: "cover all facts",
      factIds: facts.map((fact) => fact.factId),
      linkTargets: [],
    }],
  };
}

function factLines(content: string): string[] {
  return content.split(/\n+/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
}

function firstFactLine(content: string): string {
  return factLines(content)[0] || content.trim();
}

function rawFact(evidence: string) {
  return { type: "config", importance: "must", retention: "exact", fact: evidence, evidence, entities: [] };
}

function writerPayload(facts: Array<{ factId: string; fact: string }>) {
  return {
    body: `# Config\n\n${facts.map((fact) => fact.fact).join("\n\n")}`,
    tags: ["summary"],
    claimedFactIds: facts.map((fact) => fact.factId),
  };
}

function json(payload: unknown) {
  return {
    choices: [{ message: { content: JSON.stringify(payload) } }],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}
