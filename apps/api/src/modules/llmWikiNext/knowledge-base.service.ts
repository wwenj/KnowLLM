import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDataRoot } from "../../config/data-root";
import { readJson, writeJson } from "../../common/fs-json";

export interface KnowledgeBase {
  id: string;
  name: string;
}

@Injectable()
export class KnowledgeBaseService {
  private readonly root = path.join(getDataRoot(), "llm-wiki-next");
  private readonly registryPath = path.join(this.root, "knowledge-bases.json");

  constructor() {
    fs.mkdirSync(this.root, { recursive: true });
    this.ensureDefault();
  }

  list(): KnowledgeBase[] {
    return this.read().sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }

  get(id: string): KnowledgeBase {
    const normalized = normalizeId(id);
    const item = this.read().find((candidate) => candidate.id === normalized);
    if (!item) throw new NotFoundException("知识库不存在");
    return item;
  }

  create(name: string): KnowledgeBase {
    const normalizedName = normalizeName(name);
    const items = this.read();
    const item: KnowledgeBase = { id: this.newId(items), name: normalizedName };
    this.save([...items, item]);
    fs.mkdirSync(this.workspaceRoot(item.id), { recursive: true });
    return item;
  }

  rename(id: string, name: string): KnowledgeBase {
    const normalized = normalizeId(id);
    const normalizedName = normalizeName(name);
    const items = this.read();
    const index = items.findIndex((item) => item.id === normalized);
    if (index < 0) throw new NotFoundException("知识库不存在");
    const item = { ...items[index], name: normalizedName };
    items[index] = item;
    this.save(items);
    return item;
  }

  remove(id: string): KnowledgeBase {
    const item = this.get(id);
    this.save(this.read().filter((candidate) => candidate.id !== item.id));
    fs.rmSync(this.workspaceRoot(item.id), { recursive: true, force: true });
    return item;
  }

  workspaceRoot(id: string): string {
    return path.join(this.root, normalizeId(id));
  }

  hasActiveRuns(id: string): boolean {
    const knowledgeBaseId = normalizeId(id);
    const dataRoot = getDataRoot();
    const agentRoot = path.join(dataRoot, "agents", "runs", "llmWiki");
    if (fs.existsSync(agentRoot)) {
      for (const entry of fs.readdirSync(agentRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const meta = readJson<Record<string, unknown> | null>(path.join(agentRoot, entry.name, "meta.json"), null);
        if (meta?.status === "running" && (meta.knowledgeBaseId || "default") === knowledgeBaseId) return true;
      }
    }
    const evaluationRoot = path.join(dataRoot, "evaluations", "llm-wiki-agent", "runs");
    if (fs.existsSync(evaluationRoot)) {
      for (const entry of fs.readdirSync(evaluationRoot)) {
        if (!entry.endsWith(".json")) continue;
        const run = readJson<Record<string, unknown> | null>(path.join(evaluationRoot, entry), null);
        if (run?.status === "running" && (run.knowledgeBaseId || "default") === knowledgeBaseId) return true;
      }
    }
    return false;
  }

  private ensureDefault(): void {
    if (fs.existsSync(this.registryPath)) return;
    const items = this.read();
    const existing = items.find((item) => item.id === "default");
    if (existing) {
      if (existing.name !== "3D 打印使用指南") {
        existing.name = "3D 打印使用指南";
        this.save(items);
      }
      return;
    }
    this.save([{ id: "default", name: "3D 打印使用指南" }, ...items]);
  }

  private read(): KnowledgeBase[] {
    const raw = readJson<unknown>(this.registryPath, []);
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    return raw.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const candidate = value as Record<string, unknown>;
      const id = typeof candidate.id === "string" && /^[a-z0-9]{8}$/.test(candidate.id)
        ? candidate.id
        : candidate.id === "default" ? "default" : "";
      const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
      if (!id || !name || seen.has(id)) return [];
      seen.add(id);
      return [{ id, name }];
    });
  }

  private save(items: KnowledgeBase[]): void {
    writeJson(this.registryPath, items);
  }

  private newId(items: KnowledgeBase[]): string {
    const existing = new Set(items.map((item) => item.id));
    for (let attempts = 0; attempts < 20; attempts += 1) {
      const id = randomBytes(4).toString("hex");
      if (!existing.has(id)) return id;
    }
    throw new Error("知识库 ID 生成失败，请重试");
  }
}

function normalizeId(value: string): string {
  const id = String(value || "").trim();
  if (id === "default" || /^[a-z0-9]{8}$/.test(id)) return id;
  throw new BadRequestException("知识库 ID 非法");
}

function normalizeName(value: string): string {
  const name = String(value || "").trim();
  if (!name || name.length > 80) throw new BadRequestException("知识库名称不能为空且不能超过 80 个字符");
  return name;
}
