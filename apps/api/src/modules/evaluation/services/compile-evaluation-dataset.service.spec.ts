import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDataset } from "./compile-evaluation-dataset.service";

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
