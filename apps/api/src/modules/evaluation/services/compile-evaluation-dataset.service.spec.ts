import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  buildPrivateBenchmarkDataset,
  normalizeDataset,
} from "./compile-evaluation-dataset.service";

test("compile evaluation dataset validates sources, cases and expected facts", () => {
  const sourceContent = "fact a\n";
  const dataset = normalizeDataset({
    datasetId: "private-mini-v1",
    name: "Private Mini",
    sources: [{ id: "source-a", filename: "a.md", content: sourceContent }],
    cases: [
      {
        id: "case-a",
        name: "Case A",
        sourceIds: ["source-a"],
        expectedFacts: [{ id: "fact-a", fact: "fact a" }],
      },
    ],
  });

  assert.equal(dataset.sources[0].sha256.length, 64);
  assert.equal(dataset.sources[0].content, sourceContent);
  assert.equal(dataset.cases[0].expectedFacts[0].fact, "fact a");
  assert.throws(
    () =>
      normalizeDataset({
        datasetId: "invalid",
        name: "Invalid",
        sources: [{ id: "source-a", filename: "a.md", content: "a" }],
        cases: [{ id: "case-a", name: "Case", sourceIds: ["missing"], expectedFacts: [] }],
      }),
    /不存在的 source/,
  );
});

test("private benchmark is converted into compile cases and excludes abstain cases", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowllm-compile-eval-"));
  const sourcesRoot = path.join(root, "sources");
  fs.mkdirSync(sourcesRoot);
  fs.writeFileSync(path.join(sourcesRoot, "a.md"), "exact source content\n", "utf-8");
  fs.writeFileSync(
    path.join(root, "questions.json"),
    JSON.stringify({
      dataset_id: "private-benchmark",
      version: "v1",
      questions: [
        {
          id: "Q001",
          answerable: true,
          question: "事实是什么？",
          expected_facts: ["事实 A"],
          relevant_sources: ["sources/a.md"],
        },
        {
          id: "Q002",
          answerable: false,
          question: "未知事实是什么？",
          expected_facts: ["不能确认"],
          relevant_sources: [],
        },
      ],
    }),
    "utf-8",
  );

  try {
    const dataset = buildPrivateBenchmarkDataset(root);
    assert.equal(dataset.datasetId, "private-benchmark");
    assert.equal(dataset.sources[0].content, "exact source content\n");
    assert.deepEqual(dataset.cases, [
      {
        id: "Q001",
        name: "事实是什么？",
        sourceIds: ["a"],
        expectedFacts: [{ id: "Q001-fact-01", fact: "事实 A" }],
      },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
