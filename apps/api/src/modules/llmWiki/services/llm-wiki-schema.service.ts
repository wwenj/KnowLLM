import { Injectable, OnModuleInit } from "@nestjs/common";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { llmWikiConfig } from "../llm-wiki.config";
import { LlmWikiSchema } from "../contracts/llm-wiki.types";

const SCHEMA_FILE = "AGENTS.md";

@Injectable()
export class LlmWikiSchemaService implements OnModuleInit {
  onModuleInit(): void {
    this.ensureSchema();
  }

  read(): LlmWikiSchema {
    this.ensureSchema();
    const file = this.schemaPath();
    const content = fs.readFileSync(file, "utf-8");
    return {
      content,
      sha256: hashText(content),
      updated_at: fs.statSync(file).mtime.toISOString(),
    };
  }

  save(content: string): LlmWikiSchema {
    const text = String(content || "").trim();
    if (!text) throw new Error("schema 内容不能为空");
    fs.mkdirSync(this.schemaRoot(), { recursive: true });
    atomicWriteText(this.schemaPath(), `${text}\n`);
    return this.read();
  }

  private ensureSchema(): void {
    fs.mkdirSync(this.schemaRoot(), { recursive: true });
    if (!fs.existsSync(this.schemaPath())) {
      atomicWriteText(this.schemaPath(), defaultSchema());
    }
  }

  private schemaRoot(): string {
    return path.join(llmWikiConfig.root, "schema");
  }

  private schemaPath(): string {
    return path.join(this.schemaRoot(), SCHEMA_FILE);
  }
}

export function defaultSchema(): string {
  return `# LLM Wiki Schema

## Purpose
沉淀长期技术知识、Agent 方案、工程架构、个人研究材料。

## Source Rules
- source 是唯一事实源。
- 不允许模型改写 source。
- Wiki 页面必须能追溯到 source id。

## Ingest Rules
- 每次 ingest 必须生成 summary。
- concepts/entities 必须优先尝试更新已有页面，而不是无脑新建。
- 新 source 支持旧结论时，合并增强。
- 新 source 补充旧结论时，扩展页面。
- 新 source 与旧页面冲突时，不直接覆盖，生成 issue。

## Page Rules
- 每页聚焦一个主题。
- 关键结论必须标注 source id。
- 页面应主动链接相关 concept/entity。
- 信息不足写“未确认项”。

## Query Rules
- 查询优先读取 wiki 页面。
- 重要结论可回读 raw source 验证。
- 证据不足必须明确说明。
`;
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function atomicWriteText(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, text, "utf-8");
  fs.renameSync(tmp, file);
}
