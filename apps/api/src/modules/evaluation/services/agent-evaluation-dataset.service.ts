import { Injectable } from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";
import { nowIso, sha256 } from "../../../common/fs-json";
import type {
  AgentEvaluationDataset,
  AgentEvaluationDatasetCase,
  AgentEvaluationDatasetSummary,
  AgentEvaluationDatasetSource,
  AgentEvaluationExpectedFact,
} from "../evaluation.types";
import { AgentEvaluationStoreService } from "./agent-evaluation-store.service";

@Injectable()
export class AgentEvaluationDatasetService {
  constructor(private readonly store: AgentEvaluationStoreService) {}

  upload(data: Buffer): AgentEvaluationDataset {
    if (!data.length) throw new Error("请选择 Agent 评测数据集 JSON 文件");
    if (data.length > 20 * 1024 * 1024) throw new Error("Agent 评测数据集不能超过 20MB");
    let raw: unknown;
    try {
      raw = JSON.parse(data.toString("utf-8"));
    } catch {
      throw new Error("Agent 评测数据集不是合法 JSON");
    }
    return this.store.saveDataset(normalizeAgentDataset(this.withBuiltinSources(raw)));
  }

  list() {
    const uploaded = this.store.listDatasets();
    const byId = new Map<string, AgentEvaluationDatasetSummary>();
    for (const item of this.listBuiltinDatasets().map(toDatasetSummary)) byId.set(item.datasetId, item);
    for (const item of uploaded) byId.set(item.datasetId, item);
    return { items: [...byId.values()].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)) };
  }

  get(datasetId: string) {
    try {
      return this.store.getDataset(datasetId);
    } catch {
      const dataset = this.listBuiltinDatasets().find((item) => item.datasetId === datasetId);
      if (dataset) return dataset;
      throw new Error("Agent 评测数据集不存在");
    }
  }

  private listBuiltinDatasets(): AgentEvaluationDataset[] {
    const evalRoot = findEvalRoot();
    if (!evalRoot) return [];
    return fs
      .readdirSync(evalRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(evalRoot, entry.name))
      .map((dir) => readBuiltinDataset(dir))
      .filter((item): item is AgentEvaluationDataset => Boolean(item));
  }

  private withBuiltinSources(value: unknown): unknown {
    const raw = record(value);
    if (Array.isArray(raw.sources)) return value;
    if (!Array.isArray(raw.cases)) return value;
    const datasetId = safeId(raw.datasetId, "datasetId");
    const builtin = this.listBuiltinDatasets().find((item) => item.datasetId === datasetId);
    if (!builtin) {
      throw new Error(`单独上传 agent_cases.json 时，未找到内置数据集: eval/${datasetId}`);
    }
    return {
      datasetId,
      name: optionalString(raw.name, 200) || builtin.name,
      sources: builtin.sources.map(({ id, filename, content }) => ({ id, filename, content })),
      cases: raw.cases,
    };
  }
}

export function normalizeAgentDataset(value: unknown): AgentEvaluationDataset {
  const raw = record(value);
  const datasetId = safeId(raw.datasetId, "datasetId");
  const name = requiredString(raw.name, "name", 200);
  const sourceValues = array(raw.sources, "sources");
  const caseValues = array(raw.cases, "cases");
  if (!sourceValues.length) throw new Error("sources 不能为空");
  if (!caseValues.length) throw new Error("cases 不能为空");

  const sources = sourceValues.map(normalizeSource);
  assertUnique(sources.map((item) => item.id), "source id");
  assertUnique(sources.map((item) => item.filename), "source filename");

  const sourceIds = new Set(sources.map((item) => item.id));
  const sourceIdByFilename = new Map(sources.map((item) => [item.filename, item.id]));
  const cases = caseValues.map((item) => normalizeCase(item, sourceIds, sourceIdByFilename));
  assertUnique(cases.map((item) => item.id), "case id");

  return { datasetId, name, uploadedAt: nowIso(), sources, cases };
}

function normalizeSource(value: unknown): AgentEvaluationDatasetSource {
  const raw = record(value);
  const content = sourceContent(raw.content);
  return {
    id: safeId(raw.id, "source.id"),
    filename: requiredString(raw.filename, "source.filename", 200),
    content,
    sha256: sha256(content),
  };
}

function normalizeCase(
  value: unknown,
  sourceIds: Set<string>,
  sourceIdByFilename: Map<string, string>,
): AgentEvaluationDatasetCase {
  const raw = record(value);
  const id = safeId(raw.id, "case.id");
  const answerable = raw.answerable !== false;
  const relevantSourceIds = normalizeRelevantSourceIds(raw, sourceIds, sourceIdByFilename);
  if (answerable && !relevantSourceIds.length) throw new Error(`case ${id} 缺少 relevantSources`);
  const expectedFacts = normalizeFacts(raw.expectedFacts, id, answerable);
  return {
    id,
    question: requiredString(raw.question, "case.question", 2000),
    answerable,
    expectedAnswer: answerable ? requiredString(raw.expectedAnswer, "case.expectedAnswer", 8000) : optionalString(raw.expectedAnswer, 8000),
    expectedFacts,
    relevantSourceIds,
    mustInclude: stringArray(raw.mustInclude, "case.mustInclude", 200).slice(0, 50),
    evaluationType: optionalString(raw.evaluationType, 100) || "single_doc_fact",
  };
}

function normalizeRelevantSourceIds(
  raw: Record<string, unknown>,
  sourceIds: Set<string>,
  sourceIdByFilename: Map<string, string>,
): string[] {
  const out: string[] = [];
  const candidates = [
    ...stringArray(raw.relevantSourceIds, "case.relevantSourceIds", 200),
    ...stringArray(raw.sourceIds, "case.sourceIds", 200),
  ];
  for (const value of candidates) {
    if (!sourceIds.has(value)) throw new Error(`case 引用了不存在的 source: ${value}`);
    out.push(value);
  }
  for (const filename of stringArray(raw.relevantSources, "case.relevantSources", 200)) {
    const id = sourceIdByFilename.get(filename);
    if (!id) throw new Error(`case 引用了不存在的 source 文件: ${filename}`);
    out.push(id);
  }
  return [...new Set(out)];
}

function normalizeFacts(value: unknown, caseId: string, answerable: boolean): AgentEvaluationExpectedFact[] {
  const values = Array.isArray(value) ? value : [];
  if (answerable && !values.length) throw new Error(`case ${caseId} 缺少 expectedFacts`);
  const facts = values.map((item, index) => normalizeFact(item, caseId, index));
  assertUnique(facts.map((item) => item.id), `case ${caseId} fact id`);
  return facts;
}

function normalizeFact(value: unknown, caseId: string, index: number): AgentEvaluationExpectedFact {
  if (typeof value === "string") {
    return {
      id: `${caseId}-F${String(index + 1).padStart(2, "0")}`,
      fact: requiredString(value, "fact", 4000),
    };
  }
  const raw = record(value);
  return {
    id: safeId(raw.id ?? `${caseId}-F${String(index + 1).padStart(2, "0")}`, "fact.id"),
    fact: requiredString(raw.fact, "fact.fact", 4000),
  };
}

function sourceContent(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("source.content 不能为空");
  if (value.length > 2_000_000) throw new Error("source.content 过长");
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("数据集结构非法");
  return value as Record<string, unknown>;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} 必须是数组`);
  return value;
}

function stringArray(value: unknown, field: string, maxItemLength: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${field} 必须是数组`);
  return value.map((item) => requiredString(item, field, maxItemLength));
}

function safeId(value: unknown, field: string): string {
  const text = requiredString(value, field, 100);
  if (!/^[A-Za-z0-9._-]+$/.test(text)) throw new Error(`${field} 只能包含字母、数字、点、下划线和中划线`);
  return text;
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

function assertUnique(values: string[], field: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${field} 不能重复`);
}

function readBuiltinDataset(dir: string): AgentEvaluationDataset | null {
  const manifestFile = path.join(dir, "source_manifest.json");
  const casesFile = path.join(dir, "agent_cases.json");
  const sourcesDir = path.join(dir, "sources");
  if (!fs.existsSync(manifestFile) || !fs.existsSync(casesFile) || !fs.existsSync(sourcesDir)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf-8")) as Record<string, unknown>;
    const agentCases = JSON.parse(fs.readFileSync(casesFile, "utf-8")) as Record<string, unknown>;
    const manifestSources = array(manifest.sources, "source_manifest.sources");
    const sources = manifestSources.map((item) => {
      const raw = record(item);
      const filename = requiredString(raw.filename, "manifest.source.filename", 200);
      return {
        id: safeId(raw.id ?? filename.replace(/\.md$/i, ""), "manifest.source.id"),
        filename,
        content: fs.readFileSync(path.join(sourcesDir, filename), "utf-8"),
      };
    });
    const dataset = normalizeAgentDataset({
      datasetId: manifest.datasetId,
      name: agentCases.name || `${optionalString(manifest.name, 200) || manifest.datasetId} Agent 评测集`,
      sources,
      cases: agentCases.cases,
    });
    return {
      ...dataset,
      uploadedAt: optionalString(manifest.createdAt, 100) || dataset.uploadedAt,
    };
  } catch {
    return null;
  }
}

function findEvalRoot(): string | null {
  let current = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(current, "eval");
    if (fs.existsSync(path.join(candidate, "llmwiki_evaluation_design.md"))) return candidate;
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }
  return null;
}

function toDatasetSummary(dataset: AgentEvaluationDataset): AgentEvaluationDatasetSummary {
  return {
    datasetId: dataset.datasetId,
    name: dataset.name,
    uploadedAt: dataset.uploadedAt,
    sourceCount: dataset.sources.length,
    caseCount: dataset.cases.length,
    factCount: dataset.cases.reduce((sum, item) => sum + item.expectedFacts.length, 0),
    abstainCaseCount: dataset.cases.filter((item) => !item.answerable).length,
  };
}
