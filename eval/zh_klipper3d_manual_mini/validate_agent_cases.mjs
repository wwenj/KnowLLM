import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const datasetRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(datasetRoot, "../..");
const dataset = JSON.parse(
  fs.readFileSync(path.join(datasetRoot, "agent_cases.json"), "utf-8"),
);
const publishedRoot = path.join(
  workspaceRoot,
  ".knowllm/llm-wiki-next/default/published",
);
const pointer = JSON.parse(
  fs.readFileSync(path.join(publishedRoot, "current.json"), "utf-8"),
);

assert.equal(dataset.source, "published_wiki", "source 必须是 published_wiki");
assert.equal(dataset.cases.length, 30, "内置 Agent 评测集必须包含 30 题");
assert.equal(
  dataset.revisionId,
  pointer.revisionId,
  "评测集 Revision 与当前 Published Revision 不一致",
);

const caseIds = new Set();
let factCount = 0;
for (const testCase of dataset.cases) {
  assert.ok(!caseIds.has(testCase.id), `case id 重复: ${testCase.id}`);
  caseIds.add(testCase.id);
  if (testCase.answerable) {
    assert.ok(
      testCase.requiredFacts.length >= 2 && testCase.requiredFacts.length <= 4,
      `${testCase.id} 必须包含 2-4 条 requiredFacts`,
    );
  } else {
    assert.equal(
      testCase.expectedBehavior,
      "abstain",
      `${testCase.id} 必须声明 abstain`,
    );
    assert.equal(
      testCase.requiredFacts.length,
      0,
      `${testCase.id} 拒答题不能包含事实`,
    );
  }
  for (const fact of testCase.requiredFacts) {
    factCount += 1;
    const pageFile = path.join(
      publishedRoot,
      "revisions",
      pointer.revisionId,
      "pages",
      `${fact.evidence.pageKey}.md`,
    );
    assert.ok(
      fs.existsSync(pageFile),
      `${fact.id} pageKey 不存在: ${fact.evidence.pageKey}`,
    );
    const body = fs.readFileSync(pageFile, "utf-8");
    assert.ok(
      body.includes(fact.evidence.quote),
      `${fact.id} quote 不存在于 Published 页面`,
    );
  }
}

console.log(
  JSON.stringify({
    ok: true,
    datasetId: dataset.datasetId,
    revisionId: dataset.revisionId,
    caseCount: dataset.cases.length,
    factCount,
  }),
);
