import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFact } from "./llm-wiki-fact.utils";
import { runPublishGate } from "./llm-wiki-publish-gate";

test("fact normalize marks command/config/warning/default/version_change as must by default", () => {
  for (const type of ["command", "config", "warning", "default", "version_change"] as const) {
    const fact = normalizeFact(
      {
        type,
        fact: `${type} fact`,
        evidence: `${type} evidence`,
        sourceSpan: { start: 1, end: 10 },
      },
      {
        sourceId: "a".repeat(32),
        sectionId: "s0001",
        index: 0,
        sectionStart: 0,
        sectionEnd: 20,
      },
    );
    assert.equal(fact.importance, "must");
  }
});

test("publish gate merges duplicate titles, strips dead links, and blocks missing must facts", () => {
  const sourceId = "a".repeat(32);
  const coveredFact = normalizeFact(
    {
      type: "command",
      fact: "M112 triggers emergency stop",
      evidence: "M112: emergency stop",
    },
    { sourceId, sectionId: "s0001", index: 0, sectionStart: 0, sectionEnd: 20 },
  );
  const missingFact = normalizeFact(
    {
      type: "config",
      fact: "max_velocity defaults to 300",
      evidence: "max_velocity: 300",
    },
    { sourceId, sectionId: "s0001", index: 1, sectionStart: 21, sectionEnd: 40 },
  );
  const gate = runPublishGate({
    facts: [coveredFact, missingFact],
    pages: [
      {
        path: "references/g-code.md",
        title: "G-Code",
        type: "reference",
        tags: [],
        source_id: sourceId,
        factIds: [coveredFact.factId],
        body: "# G-Code\n\nSee [[missing/page.md]].",
      },
      {
        path: "references/g-code-2.md",
        title: "G-Code",
        type: "reference",
        tags: [],
        source_id: sourceId,
        factIds: [],
        body: "# G-Code\n\nDuplicate.",
      },
    ],
    pageClaims: [
      { path: "references/g-code.md", factIds: [coveredFact.factId], sourceIds: [sourceId] },
      { path: "references/g-code-2.md", factIds: [], sourceIds: [sourceId] },
    ],
  });

  assert.equal(gate.pages.length, 1);
  assert.equal(gate.pages[0].body.includes("[[missing/page.md]]"), false);
  assert.equal(gate.coverage.mustTotal, 2);
  assert.equal(gate.coverage.mustCovered, 1);
  assert.equal(gate.passed, false);
  assert.equal(gate.issues.some((issue) => issue.kind === "auto_fixed"), true);
  assert.equal(gate.issues.some((issue) => issue.kind === "blocked_publish"), true);
});

test("publish gate blocks fact dump pages", () => {
  const sourceId = "b".repeat(32);
  const fact = normalizeFact(
    {
      type: "command",
      fact: "M112 triggers emergency stop",
      evidence: "M112 triggers emergency stop",
    },
    { sourceId, sectionId: "s0001", index: 0, sectionStart: 0, sectionEnd: 30 },
  );
  const gate = runPublishGate({
    facts: [fact],
    pages: [
      {
        path: "references/g-code.md",
        title: "G-Code",
        type: "reference",
        tags: [],
        source_id: sourceId,
        factIds: [fact.factId],
        body: "# G-Code\n\n- factId: x\n  Evidence: M112 triggers emergency stop\n  Trace: s0001\n\n- factId: y\n  Evidence: M112 triggers emergency stop",
      },
    ],
    pageClaims: [{ path: "references/g-code.md", factIds: [fact.factId], sourceIds: [sourceId] }],
  });

  assert.equal(gate.passed, false);
  assert.equal(
    gate.issues.some((issue) => issue.kind === "blocked_publish" && issue.message.includes("fact/evidence/trace")),
    true,
  );
});

test("publish gate blocks exact claims when required literals are missing from body", () => {
  const sourceId = "c".repeat(32);
  const fact = normalizeFact(
    {
      type: "default",
      fact: "max_velocity defaults to 300",
      evidence: "max_velocity defaults to 300",
    },
    { sourceId, sectionId: "s0001", index: 0, sectionStart: 0, sectionEnd: 30 },
  );
  const gate = runPublishGate({
    facts: [fact],
    pages: [
      {
        path: "references/config.md",
        title: "Config",
        type: "reference",
        tags: [],
        source_id: sourceId,
        factIds: [fact.factId],
        body: "# Config\n\n`max_velocity` 是速度相关配置，默认值请以原文为准。",
      },
    ],
    pageClaims: [{ path: "references/config.md", factIds: [fact.factId], sourceIds: [sourceId] }],
  });

  assert.equal(gate.passed, false);
  assert.equal(
    gate.issues.some((issue) => issue.kind === "blocked_publish" && issue.message.includes("未被页面正文支撑")),
    true,
  );
});

test("publish gate accepts Chinese semantic claims when the page paraphrases the fact", () => {
  const sourceId = "d".repeat(32);
  const fact = normalizeFact(
    {
      type: "definition",
      importance: "must",
      retention: "semantic",
      fact: "配置检查用于确认 Klipper 的 printer.cfg 是否可被解析，并报告配置错误。",
      evidence: "配置检查会解析 printer.cfg 并报告配置错误。",
    },
    { sourceId, sectionId: "s0001", index: 0, sectionStart: 0, sectionEnd: 40 },
  );
  const gate = runPublishGate({
    facts: [fact],
    pages: [
      {
        path: "concepts/config-check.md",
        title: "配置检查",
        type: "concept",
        tags: [],
        source_id: sourceId,
        factIds: [fact.factId],
        body: "# 配置检查\n\n配置检查会读取并解析 Klipper 的 `printer.cfg`，用于提前发现配置错误和无效参数。",
      },
    ],
    pageClaims: [{ path: "concepts/config-check.md", factIds: [fact.factId], sourceIds: [sourceId] }],
  });

  assert.equal(gate.passed, true);
  assert.equal(gate.coverage.mustCovered, 1);
});
