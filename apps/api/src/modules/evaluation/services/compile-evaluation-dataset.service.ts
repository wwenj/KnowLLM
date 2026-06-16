import { Injectable } from "@nestjs/common";
import { nowIso, sha256 } from "../../../common/fs-json";
import type {
  CompileEvaluationDataset,
  CompileEvaluationDatasetCase,
  CompileEvaluationDatasetSource,
  CompileEvaluationExpectedFact,
} from "../evaluation.types";
import { CompileEvaluationStoreService } from "./compile-evaluation-store.service";

@Injectable()
export class CompileEvaluationDatasetService {
  constructor(private readonly store: CompileEvaluationStoreService) {}

  upload(data: Buffer): CompileEvaluationDataset {
    if (!data.length) throw new Error("请选择评测数据集 JSON 文件");
    if (data.length > 10 * 1024 * 1024) throw new Error("评测数据集不能超过 10MB");
    let raw: unknown;
    try {
      raw = JSON.parse(data.toString("utf-8"));
    } catch {
      throw new Error("评测数据集不是合法 JSON");
    }
    return this.store.saveDataset(normalizeDataset(raw));
  }

  list() {
    return { items: this.store.listDatasets() };
  }

  get(datasetId: string) {
    return this.store.getDataset(datasetId);
  }
}

export function normalizeDataset(value: unknown): CompileEvaluationDataset {
  const raw = record(value);
  const datasetId = safeId(raw.datasetId, "datasetId");
  const name = requiredString(raw.name, "name", 200);
  const sourceValues = array(raw.sources, "sources");
  const caseValues = array(raw.cases, "cases");
  if (!sourceValues.length) throw new Error("sources 不能为空");
  if (!caseValues.length) throw new Error("cases 不能为空");

  const sources = sourceValues.map(normalizeSource);
  assertUnique(sources.map((item) => item.id), "source id");
  const sourceIds = new Set(sources.map((item) => item.id));
  const cases = caseValues.map((item) => normalizeCase(item, sourceIds));
  assertUnique(cases.map((item) => item.id), "case id");
  return { datasetId, name, uploadedAt: nowIso(), sources, cases };
}

function normalizeSource(value: unknown): CompileEvaluationDatasetSource {
  const raw = record(value);
  const content = sourceContent(raw.content);
  return {
    id: safeId(raw.id, "source.id"),
    filename: requiredString(raw.filename, "source.filename", 200),
    content,
    sha256: sha256(content),
  };
}

function sourceContent(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("source.content 不能为空");
  if (value.length > 2_000_000) throw new Error("source.content 过长");
  return value;
}

function normalizeCase(value: unknown, sourceIds: Set<string>): CompileEvaluationDatasetCase {
  const raw = record(value);
  const sourceIdList = array(raw.sourceIds, "case.sourceIds").map((item) => safeId(item, "case.sourceId"));
  if (!sourceIdList.length) throw new Error("case.sourceIds 不能为空");
  for (const sourceId of sourceIdList) {
    if (!sourceIds.has(sourceId)) throw new Error(`case 引用了不存在的 source: ${sourceId}`);
  }
  const expectedFacts = array(raw.expectedFacts, "case.expectedFacts").map(normalizeFact);
  if (!expectedFacts.length) throw new Error("case.expectedFacts 不能为空");
  assertUnique(expectedFacts.map((item) => item.id), "fact id");
  return {
    id: safeId(raw.id, "case.id"),
    name: requiredString(raw.name, "case.name", 200),
    sourceIds: [...new Set(sourceIdList)],
    expectedFacts,
  };
}

function normalizeFact(value: unknown): CompileEvaluationExpectedFact {
  const raw = record(value);
  return {
    id: safeId(raw.id, "fact.id"),
    fact: requiredString(raw.fact, "fact.fact", 2000),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("数据集结构非法");
  return value as Record<string, unknown>;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} 必须是数组`);
  return value;
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

function assertUnique(values: string[], field: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${field} 不能重复`);
}
