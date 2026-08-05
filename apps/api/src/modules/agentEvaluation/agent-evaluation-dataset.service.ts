import { Injectable } from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";
import { sha256 } from "../../common/fs-json";
import { LlmWikiNextToolsService } from "../llmWikiNext/llm-wiki-next-tools.service";
import {
  AGENT_EVALUATION_SCHEMA_VERSION,
  AgentEvaluationDataset,
  AgentEvaluationDatasetCase,
  AgentEvaluationRequiredFact,
} from "./agent-evaluation.types";

@Injectable()
export class AgentEvaluationDatasetService {
  constructor(private readonly wiki: LlmWikiNextToolsService) {}

  getDataset(): AgentEvaluationDataset {
    const { text, value } = readBuiltinDataset();
    const normalized = normalizeDataset(value);
    const identity = this.wiki.getPublishedIdentity();
    const compatible = normalized.revisionId === identity.revisionId;
    if (compatible) this.validateEvidence(normalized.cases);
    return {
      ...normalized,
      schemaVersion: AGENT_EVALUATION_SCHEMA_VERSION,
      datasetHash: sha256(text),
      currentRevisionId: identity.revisionId,
      compatible,
      caseCount: normalized.cases.length,
      factCount: normalized.cases.reduce(
        (sum, item) => sum + item.requiredFacts.length,
        0,
      ),
      answerableCount: normalized.cases.filter((item) => item.answerable)
        .length,
      abstainCount: normalized.cases.filter((item) => !item.answerable).length,
    };
  }

  getRunnableDataset(): AgentEvaluationDataset {
    const dataset = this.getDataset();
    if (!dataset.compatible) {
      throw new Error(
        `评测集绑定 Revision ${dataset.revisionId}，当前 Published Revision 为 ${dataset.currentRevisionId}`,
      );
    }
    return dataset;
  }

  private validateEvidence(cases: AgentEvaluationDatasetCase[]): void {
    const pages = new Map<string, string>();
    for (const testCase of cases) {
      for (const fact of testCase.requiredFacts) {
        let body = pages.get(fact.evidence.pageKey);
        if (body === undefined) {
          body = this.wiki.readPage(fact.evidence.pageKey).page.bodyMarkdown;
          pages.set(fact.evidence.pageKey, body);
        }
        if (!body.includes(fact.evidence.quote)) {
          throw new Error(
            `评测事实 ${fact.id} 的 quote 不存在于 Published 页面 ${fact.evidence.pageKey}`,
          );
        }
      }
    }
  }
}

interface NormalizedDatasetBase {
  datasetId: string;
  name: string;
  revisionId: string;
  generatedAt: string;
  source: "published_wiki";
  cases: AgentEvaluationDatasetCase[];
}

export function normalizeDataset(value: unknown): NormalizedDatasetBase {
  const raw = record(value, "数据集");
  const source = requiredString(raw.source, "source", 100);
  if (source !== "published_wiki")
    throw new Error("source 必须是 published_wiki");
  const cases = array(raw.cases, "cases").map(normalizeCase);
  if (!cases.length) throw new Error("cases 不能为空");
  assertUnique(
    cases.map((item) => item.id),
    "case id",
  );
  assertUnique(
    cases.map((item) => item.question),
    "case question",
  );
  return {
    datasetId: safeId(raw.datasetId, "datasetId"),
    name: requiredString(raw.name, "name", 200),
    revisionId: safeId(raw.revisionId, "revisionId"),
    generatedAt: requiredString(raw.generatedAt, "generatedAt", 100),
    source,
    cases,
  };
}

function normalizeCase(value: unknown): AgentEvaluationDatasetCase {
  const raw = record(value, "case");
  const id = safeId(raw.id, "case.id");
  if (typeof raw.answerable !== "boolean") {
    throw new Error(`case ${id} 的 answerable 必须是 boolean`);
  }
  const requiredFacts = array(raw.requiredFacts, "case.requiredFacts").map(
    (item) => normalizeFact(item, id),
  );
  assertUnique(
    requiredFacts.map((item) => item.id),
    `case ${id} fact id`,
  );
  if (
    raw.answerable &&
    (requiredFacts.length < 2 || requiredFacts.length > 4)
  ) {
    throw new Error(`case ${id} 必须包含 2-4 条 requiredFacts`);
  }
  if (!raw.answerable && requiredFacts.length) {
    throw new Error(`拒答 case ${id} 的 requiredFacts 必须为空`);
  }
  const expectedBehavior = optionalString(raw.expectedBehavior, 50);
  if (!raw.answerable && expectedBehavior !== "abstain") {
    throw new Error(`拒答 case ${id} 必须声明 expectedBehavior=abstain`);
  }
  return {
    id,
    question: requiredString(raw.question, "case.question", 2000),
    answerable: raw.answerable,
    expectedAnswer: requiredString(
      raw.expectedAnswer,
      "case.expectedAnswer",
      8000,
    ),
    requiredFacts,
    expectedBehavior: raw.answerable ? undefined : "abstain",
    evaluationType:
      optionalString(raw.evaluationType, 100) ||
      (raw.answerable ? "general" : "abstain"),
  };
}

function normalizeFact(
  value: unknown,
  caseId: string,
): AgentEvaluationRequiredFact {
  const raw = record(value, "fact");
  const evidence = record(raw.evidence, "fact.evidence");
  return {
    id: safeId(raw.id, `case ${caseId} fact.id`),
    fact: requiredString(raw.fact, "fact.fact", 4000),
    evidence: {
      pageKey: safeId(evidence.pageKey, "fact.evidence.pageKey"),
      quote: requiredString(evidence.quote, "fact.evidence.quote", 8000),
    },
  };
}

function readBuiltinDataset(): { text: string; value: unknown } {
  const file = findDatasetFile();
  const text = fs.readFileSync(file, "utf-8");
  try {
    return { text, value: JSON.parse(text) as unknown };
  } catch {
    throw new Error(`内置 Agent 评测集不是合法 JSON: ${file}`);
  }
}

function findDatasetFile(): string {
  let current = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(
      current,
      "eval",
      "zh_klipper3d_manual_mini",
      "agent_cases.json",
    );
    if (fs.existsSync(candidate)) return candidate;
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }
  throw new Error(
    "未找到内置 Agent 评测集 eval/zh_klipper3d_manual_mini/agent_cases.json",
  );
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} 结构非法`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} 必须是数组`);
  return value;
}

function requiredString(value: unknown, field: string, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${field} 不能为空`);
  if (text.length > max) throw new Error(`${field} 过长`);
  return text;
}

function optionalString(value: unknown, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > max) throw new Error("字符串字段过长");
  return text;
}

function safeId(value: unknown, field: string): string {
  const text = requiredString(value, field, 100);
  if (!/^[A-Za-z0-9._-]+$/.test(text)) throw new Error(`${field} 非法`);
  return text;
}

function assertUnique(values: string[], field: string): void {
  if (new Set(values).size !== values.length)
    throw new Error(`${field} 不能重复`);
}
