import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDataRoot } from "../../config/data-root";
import { readJson, writeJson } from "../../common/fs-json";

export interface StoredAgentEvaluationDataset {
  knowledgeBaseId: string;
  dataset: Record<string, unknown>;
}

@Injectable()
export class AgentEvaluationDatasetStoreService {
  private readonly root = path.join(getDataRoot(), "evaluations", "llm-wiki-agent", "datasets");

  list(knowledgeBaseId: string): StoredAgentEvaluationDataset[] {
    const dir = this.dir(knowledgeBaseId);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => readJson<StoredAgentEvaluationDataset | null>(path.join(dir, name), null))
      .filter((item): item is StoredAgentEvaluationDataset => Boolean(item))
      .filter((item) => item.knowledgeBaseId === knowledgeBaseId);
  }

  get(knowledgeBaseId: string, datasetId: string): StoredAgentEvaluationDataset {
    const value = readJson<StoredAgentEvaluationDataset | null>(this.file(knowledgeBaseId, datasetId), null);
    if (!value || value.knowledgeBaseId !== knowledgeBaseId) throw new NotFoundException("评测数据集不存在");
    return value;
  }

  save(knowledgeBaseId: string, datasetId: string, dataset: Record<string, unknown>): void {
    const file = this.file(knowledgeBaseId, datasetId);
    if (fs.existsSync(file)) throw new BadRequestException("同名评测数据集已存在");
    writeJson(file, { knowledgeBaseId, dataset });
  }

  remove(knowledgeBaseId: string, datasetId: string): void {
    const file = this.file(knowledgeBaseId, datasetId);
    if (!fs.existsSync(file)) throw new NotFoundException("评测数据集不存在");
    fs.unlinkSync(file);
  }

  private dir(knowledgeBaseId: string): string {
    return path.join(this.root, safeKnowledgeBaseId(knowledgeBaseId));
  }

  private file(knowledgeBaseId: string, datasetId: string): string {
    const id = String(datasetId || "").trim();
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw new BadRequestException("datasetId 非法");
    return path.join(this.dir(knowledgeBaseId), `${id}.json`);
  }
}

function safeKnowledgeBaseId(value: string): string {
  const id = String(value || "").trim();
  if (id === "default" || /^[a-z0-9]{8}$/.test(id)) return id;
  throw new BadRequestException("知识库 ID 非法");
}
