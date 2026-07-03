import { Injectable } from "@nestjs/common";
import { ModelService } from "../../model/model.service";
import { llmWikiConfig } from "../llm-wiki.config";
import {
  LlmWikiCompiledOutput,
  LlmWikiCompilerPage,
  LlmWikiDraftPage,
  LlmWikiNormalizedPage,
  LlmWikiPageRef,
  LlmWikiSchema,
} from "../contracts/llm-wiki.types";

interface ChatChoice {
  message?: { content?: unknown };
  text?: unknown;
}

interface ChatCompletionLike {
  choices?: ChatChoice[];
}

@Injectable()
export class LlmWikiCompilerService {
  constructor(private readonly model: ModelService) {}

  async compileSource(args: {
    sourceId: string;
    filename: string;
    source: string;
    existingPages: LlmWikiPageRef[];
    schema: LlmWikiSchema;
    model: string;
  }): Promise<LlmWikiDraftPage[]> {
    const text = args.source || "";
    const truncated = text.length > llmWikiConfig.maxSourceChars;
    const source = truncated ? text.slice(0, llmWikiConfig.maxSourceChars) : text;
    const res = await this.model.chat({
      model: args.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: compilerInstructions() },
        {
          role: "user",
          content: buildCompilePrompt({
            sourceId: args.sourceId,
            filename: args.filename,
            source,
            truncated,
            existingPages: args.existingPages,
            schema: args.schema,
          }),
        },
      ],
    });
    return normalizeCompiledOutput({
      raw: parseCompiledOutput(extractContent(res)),
      sourceId: args.sourceId,
      filename: args.filename,
    });
  }
}

function compilerInstructions(): string {
  return `
你是本地 Karpathy-style LLM Wiki 编译器。你的任务是把 raw source 编译成可长期维护的 Markdown wiki 页面。

硬性要求：
1. 只基于输入 source，不引入外部知识。
2. 只输出 JSON，不输出 Markdown 代码块。
3. JSON 结构必须是：
{
  "summary": {"title": string, "content": string, "tags": string[]},
  "concepts": [{"path": "concepts/<slug>.md", "title": string, "content": string, "tags": string[]}],
  "entities": [{"path": "entities/<slug>.md", "title": string, "content": string, "tags": string[]}]
}
4. concepts/entities 每类最多 8 个；path 文件名只能包含英文字母、数字、点、下划线和中划线。
5. 每个 content 必须是完整 Markdown，以一级标题开头；用 [[concepts/x.md]] 或 [[entities/x.md]] 连接相关页面。
6. 重点提炼概念、实体、约束、流程、决策和未确认项，不要照抄全文。
7. 关键结论后标注“来源：source <source_id>”。
8. 信息不足时写“未确认项”，不要编造。
`.trim();
}

function buildCompilePrompt(args: {
  sourceId: string;
  filename: string;
  source: string;
  truncated: boolean;
  existingPages: LlmWikiPageRef[];
  schema: LlmWikiSchema;
}): string {
  const pages = args.existingPages
    .filter((page) => page.path !== "index.md")
    .slice(0, 80)
    .map((page) => `- ${page.path}：${page.title}`)
    .join("\n");
  return `
source_id：${args.sourceId}
文件名：${args.filename}
是否截断：${args.truncated ? "是，仅编译前半部分" : "否"}

当前 schema：
${args.schema.content}

当前已有 wiki 页面：
${pages || "暂无"}

请生成：
- summary：200-800 字，解释这份 source 的核心内容、结论和未确认项。
- concepts：1-8 个概念页面，每页聚焦一个可复用知识点。
- entities：0-8 个实体页面，实体可以是产品、组织、人物、模块、框架、协议或系统。

原始 source：

\`\`\`markdown
${args.source}
\`\`\`
`.trim();
}

function extractContent(res: unknown): string {
  const body = res as ChatCompletionLike;
  const choice = body.choices?.[0];
  const content = choice?.message?.content ?? choice?.text;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text || "");
        }
        return "";
      })
      .join("");
  }
  throw new Error("模型未返回可解析内容");
}

function parseCompiledOutput(content: string): LlmWikiCompiledOutput {
  const raw = content.trim();
  const candidates = [
    raw,
    raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim(),
    extractJsonObject(raw),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as LlmWikiCompiledOutput;
    } catch {
      // try next candidate
    }
  }
  throw new Error("模型输出不是合法 JSON");
}

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : "";
}

function normalizeCompiledOutput(args: {
  raw: LlmWikiCompiledOutput;
  sourceId: string;
  filename: string;
}): LlmWikiDraftPage[] {
  const pages: LlmWikiDraftPage[] = [];
  const summaryTitle = String(args.raw.summary?.title || args.filename || "Source Summary")
    .trim()
    .slice(0, 160);
  pages.push({
    path: `summaries/${args.sourceId}.md`,
    title: summaryTitle || "Source Summary",
    type: "summary",
    tags: stringArray(args.raw.summary?.tags),
    source_id: args.sourceId,
    body: withSourceAttribution(
      ensureHeading(String(args.raw.summary?.content || "未生成有效摘要。"), summaryTitle),
      args.sourceId,
    ),
  });

  const seen = new Set<string>(["summaries"]);
  normalizeCompilerPages(args.raw.concepts || [], "concepts", "concept", seen).forEach((page) =>
    pages.push({ ...withAttribution(page, args.sourceId), source_id: args.sourceId }),
  );
  normalizeCompilerPages(args.raw.entities || [], "entities", "entity", seen).forEach((page) =>
    pages.push({ ...withAttribution(page, args.sourceId), source_id: args.sourceId }),
  );
  return pages;
}

function normalizeCompilerPages(
  input: LlmWikiCompilerPage[],
  dir: "concepts" | "entities",
  type: "concept" | "entity",
  seen: Set<string>,
): LlmWikiNormalizedPage[] {
  return input.slice(0, 8).map((page, idx) => {
    const title = String(page.title || `${type}-${idx + 1}`).trim().slice(0, 160);
    const path = uniquePath(safePagePath(String(page.path || ""), dir, title, idx + 1), seen);
    return {
      path,
      title: title || `${type}-${idx + 1}`,
      type,
      tags: stringArray(page.tags),
      body: ensureHeading(String(page.content || ""), title || `${type}-${idx + 1}`),
    };
  });
}

function withAttribution(
  page: LlmWikiNormalizedPage,
  sourceId: string,
): LlmWikiNormalizedPage {
  return { ...page, body: withSourceAttribution(page.body, sourceId) };
}

function withSourceAttribution(content: string, sourceId: string): string {
  const text = ensureTrailingNewline(content);
  return text.includes(`source ${sourceId}`)
    ? text
    : ensureTrailingNewline(`${text}\n来源：source ${sourceId}`);
}

function safePagePath(rawPath: string, dir: "concepts" | "entities", title: string, idx: number): string {
  const raw = rawPath.trim().replace(/\\/g, "/");
  const rawName =
    raw.startsWith(`${dir}/`) && raw.endsWith(".md") && raw.split("/").length === 2
      ? raw.slice(`${dir}/`.length, -".md".length)
      : "";
  const slug = slugify(rawName || title || `${dir}-${idx}`) || `${dir}-${idx}`;
  return `${dir}/${slug}.md`;
}

function uniquePath(relPath: string, seen: Set<string>): string {
  let next = relPath;
  let count = 2;
  while (seen.has(next)) {
    next = relPath.replace(/\.md$/, `-${count}.md`);
    count += 1;
  }
  seen.add(next);
  return next;
}

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 80);
}

function ensureHeading(content: string, title: string): string {
  const text = String(content || "").trim();
  return ensureTrailingNewline(text.startsWith("#") ? text : `# ${title}\n\n${text || "未生成有效内容。"}`);
}

function ensureTrailingNewline(content: string): string {
  const text = String(content || "").trim();
  return text ? `${text}\n` : "";
}

function stringArray(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return [
    ...new Set(
      values
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, 20),
    ),
  ];
}
