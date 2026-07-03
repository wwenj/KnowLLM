import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { AgentEvaluationDatasetService, normalizeAgentDataset } from "./agent-evaluation-dataset.service";

test("agent evaluation dataset maps relevant source filenames and string facts", () => {
  const dataset = normalizeAgentDataset({
    datasetId: "agent-mini",
    name: "Agent Mini",
    sources: [{ id: "source-a", filename: "a.md", content: "TTL is 2 hours." }],
    cases: [
      {
        id: "A001",
        question: "What is the TTL?",
        answerable: true,
        expectedAnswer: "TTL is 2 hours.",
        expectedFacts: ["TTL is 2 hours."],
        relevantSources: ["a.md"],
        mustInclude: ["TTL"],
        evaluationType: "single_doc_fact",
      },
      {
        id: "A002",
        question: "What is the SLA?",
        answerable: false,
        expectedAnswer: "",
        expectedFacts: [],
        relevantSources: [],
        mustInclude: [],
        evaluationType: "abstain",
      },
    ],
  });

  assert.equal(dataset.sources[0].sha256.length, 64);
  assert.deepEqual(dataset.cases[0].relevantSourceIds, ["source-a"]);
  assert.equal(dataset.cases[0].expectedFacts[0].id, "A001-F01");
  assert.equal(dataset.cases[1].answerable, false);
});

test("agent evaluation dataset rejects answerable cases without relevant sources", () => {
  assert.throws(
    () =>
      normalizeAgentDataset({
        datasetId: "invalid",
        name: "Invalid",
        sources: [{ id: "source-a", filename: "a.md", content: "a" }],
        cases: [
          {
            id: "A001",
            question: "Question?",
            answerable: true,
            expectedAnswer: "Answer.",
            expectedFacts: ["Answer."],
            relevantSources: ["missing.md"],
          },
        ],
      }),
    /不存在的 source 文件/,
  );
});

test("agent evaluation upload accepts built-in agent_cases.json without sources", () => {
  let saved: unknown = null;
  const service = new AgentEvaluationDatasetService({
    saveDataset: (dataset: unknown) => {
      saved = dataset;
      return dataset;
    },
    listDatasets: () => [],
    getDataset: () => {
      throw new Error("not found");
    },
  } as never);
  const file = path.resolve(process.cwd(), "../../eval/zh_klipper3d_manual_mini/agent_cases.json");
  const dataset = service.upload(fs.readFileSync(file));

  assert.equal(dataset.datasetId, "zh_klipper3d_manual_mini");
  assert.equal(dataset.sources.length, 51);
  assert.equal(dataset.cases.length, 50);
  assert.equal(saved, dataset);
});

test("agent evaluation dataset list only returns uploaded datasets", () => {
  const uploaded = {
    datasetId: "uploaded",
    name: "Uploaded",
    uploadedAt: "2026-07-03T00:00:00.000Z",
    sourceCount: 1,
    caseCount: 1,
    factCount: 1,
    abstainCaseCount: 0,
  };
  const service = new AgentEvaluationDatasetService({
    listDatasets: () => [uploaded],
  } as never);

  assert.deepEqual(service.list(), { items: [uploaded] });
});
