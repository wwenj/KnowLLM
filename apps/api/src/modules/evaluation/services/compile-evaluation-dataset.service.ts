import { Injectable, OnModuleInit } from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";
import { nowIso, sha256 } from "../../../common/fs-json";
import { findWorkspaceRoot, getApiRoot } from "../../../config/env";
import type {
  CompileEvaluationDataset,
  CompileEvaluationDatasetCase,
  CompileEvaluationDatasetSource,
  CompileEvaluationExpectedFact,
  CompileEvaluationFactImportance,
} from "../evaluation.types";
import { CompileEvaluationStoreService } from "./compile-evaluation-store.service";

export const BUILTIN_COMPILE_DATASET_ID = "zh_klipper3d_manual_mini";

@Injectable()
export class CompileEvaluationDatasetService implements OnModuleInit {
  constructor(private readonly store: CompileEvaluationStoreService) {}

  onModuleInit(): void {
    this.ensureBuiltInDataset(true);
  }

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
    this.ensureBuiltInDataset();
    return { items: this.store.listDatasets() };
  }

  get(datasetId: string) {
    if (datasetId === BUILTIN_COMPILE_DATASET_ID) this.ensureBuiltInDataset();
    return this.store.getDataset(datasetId);
  }

  delete(datasetId: string) {
    if (datasetId === BUILTIN_COMPILE_DATASET_ID) throw new Error("内置评测数据集不能删除");
    return this.store.deleteDataset(datasetId);
  }

  private ensureBuiltInDataset(force = false): CompileEvaluationDataset {
    let existing: CompileEvaluationDataset | null = null;
    try {
      existing = this.store.getDataset(BUILTIN_COMPILE_DATASET_ID);
      if (!force) return existing;
    } catch {
      existing = null;
    }
    const dataset = loadBuiltInCompileDataset(existing?.uploadedAt || nowIso());
    return this.store.saveDataset(dataset);
  }
}

export function loadBuiltInCompileDataset(uploadedAt = nowIso()): CompileEvaluationDataset {
  const datasetDir = path.join(findWorkspaceRoot(getApiRoot()), "eval", BUILTIN_COMPILE_DATASET_ID);
  const file = path.join(datasetDir, "compile_cases.json");
  if (!fs.existsSync(file)) throw new Error(`内置评测集不存在: ${file}`);
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    ...normalizeDataset(raw),
    uploadedAt,
  };
}

export function normalizeDataset(value: unknown): CompileEvaluationDataset {
  const input = expandDirectoryDataset(record(value));
  const raw = record(input);
  const datasetId = safeId(raw.datasetId, "datasetId");
  const name = requiredString(raw.name, "name", 200);
  const sourceValues = array(raw.sources, "sources");
  const caseValues = array(raw.cases, "cases");
  if (!sourceValues.length) throw new Error("sources 不能为空");
  if (!caseValues.length) throw new Error("cases 不能为空");

  const sources = sourceValues.map(normalizeSource);
  assertUnique(sources.map((item) => item.id), "source id");
  const sourceIds = new Set(sources.map((item) => item.id));
  const sourceById = new Map(sources.map((item) => [item.id, item]));
  const cases = caseValues.map((item) => normalizeCase(item, sourceIds, sourceById));
  assertUnique(cases.map((item) => item.id), "case id");
  return { datasetId, name, uploadedAt: nowIso(), sources, cases };
}

function expandDirectoryDataset(raw: Record<string, unknown>): unknown {
  if (Array.isArray(raw.sources)) return raw;
  if (!Array.isArray(raw.cases)) return raw;

  const datasetId = safeId(raw.datasetId, "datasetId");
  const datasetDir = path.join(findWorkspaceRoot(getApiRoot()), "eval", datasetId);
  const sourceDir = safeRelativePath(optionalString(raw.sourceDir, 200) || "sources", "sourceDir");
  const manifest = readSourceManifest(path.join(datasetDir, "source_manifest.json"));
  const sourcesDir = path.join(datasetDir, sourceDir);
  const manifestSources = array(manifest.sources, "source_manifest.sources").map(record);
  const sourceIdByFilename = new Map(
    manifestSources.map((source) => [
      requiredString(source.filename, "source_manifest.source.filename", 300),
      safeId(source.id, "source_manifest.source.id"),
    ]),
  );

  return {
    datasetId,
    name: optionalString(raw.name, 200) || optionalString(manifest.name, 200) || datasetId,
    sources: manifestSources.map((source) => {
      const filename = requiredString(source.filename, "source_manifest.source.filename", 300);
      const contentPath = resolveInside(sourcesDir, filename, "source filename");
      if (!fs.existsSync(contentPath)) throw new Error(`source 文件不存在: ${filename}`);
      return {
        id: safeId(source.id, "source_manifest.source.id"),
        filename,
        content: fs.readFileSync(contentPath, "utf8"),
      };
    }),
    cases: raw.cases.map((item) => expandDirectoryCase(item, sourceIdByFilename)),
  };
}

function expandDirectoryCase(value: unknown, sourceIdByFilename: Map<string, string>): unknown {
  const raw = record(value);
  if (Array.isArray(raw.sourceIds)) return raw;
  const sourceFiles = array(raw.sourceFiles, "case.sourceFiles").map((item) => requiredString(item, "case.sourceFile", 300));
  return {
    ...raw,
    sourceIds: sourceFiles.map((filename) => {
      const sourceId = sourceIdByFilename.get(filename);
      if (!sourceId) throw new Error(`case 引用了不存在的 source 文件: ${filename}`);
      return sourceId;
    }),
  };
}

function readSourceManifest(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) throw new Error(`目录版评测集缺少 source_manifest.json: ${file}`);
  try {
    return record(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    throw new Error("source_manifest.json 不是合法 JSON");
  }
}

function resolveInside(root: string, relativePath: string, field: string): string {
  const safePath = safeRelativePath(relativePath, field);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, safePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${field} 不能指向评测目录外`);
  }
  return resolved;
}

function safeRelativePath(value: string, field: string): string {
  if (!value || path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
    throw new Error(`${field} 必须是相对路径`);
  }
  return value;
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

function normalizeCase(
  value: unknown,
  sourceIds: Set<string>,
  sourceById: Map<string, CompileEvaluationDatasetSource>,
): CompileEvaluationDatasetCase {
  const raw = record(value);
  const sourceIdList = array(raw.sourceIds, "case.sourceIds").map((item) => safeId(item, "case.sourceId"));
  if (!sourceIdList.length) throw new Error("case.sourceIds 不能为空");
  for (const sourceId of sourceIdList) {
    if (!sourceIds.has(sourceId)) throw new Error(`case 引用了不存在的 source: ${sourceId}`);
  }
  const expectedFacts = array(raw.expectedFacts, "case.expectedFacts").map((item) =>
    normalizeFact(item, sourceIdList, sourceById),
  );
  if (!expectedFacts.length) throw new Error("case.expectedFacts 不能为空");
  assertUnique(expectedFacts.map((item) => item.id), "fact id");
  return {
    id: safeId(raw.id, "case.id"),
    name: requiredString(raw.name, "case.name", 200),
    sourceIds: [...new Set(sourceIdList)],
    expectedFacts,
  };
}

function normalizeFact(
  value: unknown,
  sourceIds: string[],
  sourceById: Map<string, CompileEvaluationDatasetSource>,
): CompileEvaluationExpectedFact {
  const raw = record(value);
  const fallbackSourceFile = sourceById.get(sourceIds[0])?.filename || "";
  const selectedFilenames = new Set(sourceIds.map((id) => sourceById.get(id)?.filename).filter(Boolean));
  const sourceFile = optionalString(raw.sourceFile, 300) || fallbackSourceFile;
  if (sourceFile && selectedFilenames.size && !selectedFilenames.has(sourceFile)) {
    throw new Error(`fact.sourceFile 不属于当前 case: ${sourceFile}`);
  }
  return {
    id: safeId(raw.id, "fact.id"),
    fact: requiredString(raw.fact, "fact.fact", 2000),
    sourceFile,
    evidence: optionalString(raw.evidence, 8000),
    type: optionalString(raw.type, 100) || "general",
    importance: normalizeImportance(raw.importance),
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

function optionalString(value: unknown, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > max) throw new Error("字符串字段过长");
  return text;
}

function normalizeImportance(value: unknown): CompileEvaluationFactImportance {
  const text = optionalString(value, 20);
  if (text === "should" || text === "nice") return text;
  return "must";
}

function assertUnique(values: string[], field: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${field} 不能重复`);
}
