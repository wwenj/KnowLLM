import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";
import type { LlmWikiNextToolsService } from "../llmWikiNext/llm-wiki-next-tools.service";
import {
  AgentEvaluationDatasetService,
  normalizeDataset,
} from "./agent-evaluation-dataset.service";

const datasetFile = path.resolve(
  process.cwd(),
  "../../eval/zh_klipper3d_manual_mini/agent_cases.json",
);
const rawDataset = JSON.parse(fs.readFileSync(datasetFile, "utf-8")) as {
  revisionId: string;
  cases: Array<{
    requiredFacts: Array<{ evidence: { pageKey: string; quote: string } }>;
  }>;
};

test("内置数据集可合法加载并通过 Published quote 核验", () => {
  const quotes = quoteMap();
  const service = new AgentEvaluationDatasetService(
    fakeWiki(rawDataset.revisionId, (pageKey) => quotes.get(pageKey) || ""),
  );
  const dataset = service.getRunnableDataset();
  assert.equal(dataset.schemaVersion, 2);
  assert.equal(dataset.caseCount, 30);
  assert.equal(dataset.compatible, true);
  assert.equal(dataset.factCount > 0, true);
});

test("Revision 不匹配时禁止创建可运行数据集", () => {
  const service = new AgentEvaluationDatasetService(
    fakeWiki("anotherRevision", () => ""),
  );
  assert.equal(service.getDataset().compatible, false);
  assert.throws(() => service.getRunnableDataset(), /Revision/);
});

test("pageKey 缺失或 quote 不存在时拒绝数据集", () => {
  const service = new AgentEvaluationDatasetService(
    fakeWiki(rawDataset.revisionId, () => "不包含任何 Gold quote"),
  );
  assert.throws(() => service.getDataset(), /quote 不存在/);
});

test("拒答题必须为空 facts 且声明 abstain", () => {
  assert.throws(
    () =>
      normalizeDataset({
        datasetId: "demo",
        name: "demo",
        revisionId: "revision",
        generatedAt: new Date().toISOString(),
        source: "published_wiki",
        cases: [
          {
            id: "A001",
            question: "无资料的问题",
            answerable: false,
            expectedAnswer: "应拒答",
            requiredFacts: [
              {
                id: "F1",
                fact: "非法事实",
                evidence: { pageKey: "PAGE0001", quote: "quote" },
              },
            ],
          },
        ],
      }),
    /requiredFacts 必须为空/,
  );
});

function quoteMap(): Map<string, string> {
  const pages = new Map<string, string[]>();
  for (const item of rawDataset.cases) {
    for (const fact of item.requiredFacts) {
      const values = pages.get(fact.evidence.pageKey) || [];
      values.push(fact.evidence.quote);
      pages.set(fact.evidence.pageKey, values);
    }
  }
  return new Map([...pages].map(([key, values]) => [key, values.join("\n")]));
}

function fakeWiki(
  revisionId: string,
  readPage: (pageKey: string) => string,
): LlmWikiNextToolsService {
  return {
    getPublishedIdentity: () => ({
      revisionId,
      publishedAt: "2026-01-01T00:00:00.000Z",
      pageCount: 1,
      factCount: 1,
      sourceCount: 1,
    }),
    readPage: (pageKey: string) => ({
      page: { bodyMarkdown: readPage(pageKey) },
    }),
  } as unknown as LlmWikiNextToolsService;
}
