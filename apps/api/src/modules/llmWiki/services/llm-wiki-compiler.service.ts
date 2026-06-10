import { Injectable } from "@nestjs/common";
import { normalizeWhitespace, safeMarkdownPath, slugify, stripFrontmatter, titleFromMarkdown } from "../../../common/text";
import { ModelService } from "../../model/model.service";
import { llmWikiConfig } from "../llm-wiki.config";
import type { LlmWikiDraftPage, LlmWikiPageRef, LlmWikiSchema } from "../llm-wiki.types";
import { pagePathForTitle } from "./llm-wiki-store.service";

interface CompilerOutput {
  summary?: CompilerPage;
  concepts?: CompilerPage[];
  entities?: CompilerPage[];
}

interface CompilerPage {
  path?: string;
  title?: string;
  content?: string;
  tags?: unknown;
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
    signal?: AbortSignal;
  }): Promise<LlmWikiDraftPage[]> {
    if (this.model.hasConfiguredModel()) {
      try {
        const content = await this.model.complete({
          model: this.model.resolveLlmWikiModel(),
          temperature: 0.2,
          responseFormat: { type: "json_object" },
          messages: [
            { role: "system", content: compilerInstructions() },
            { role: "user", content: buildPrompt(args) }
          ],
          signal: args.signal
        });
        return normalizeCompilerOutput(parseJsonObject(content), args.sourceId, args.filename);
      } catch {
        return fallbackCompile(args);
      }
    }
    return fallbackCompile(args);
  }
}

function compilerInstructions(): string {
  return [
    "你是本地 LLM Wiki 编译器。",
    "只基于输入 source 编译 Markdown wiki 页面，不引入外部事实。",
    "只输出 JSON，不输出 Markdown 代码块。",
    "JSON 结构必须是：",
    "{\"summary\":{\"title\":string,\"content\":string,\"tags\":string[]},\"concepts\":[{\"path\":\"concepts/<slug>.md\",\"title\":string,\"content\":string,\"tags\":string[]}],\"entities\":[{\"path\":\"entities/<slug>.md\",\"title\":string,\"content\":string,\"tags\":string[]}]}",
    "每个 content 必须是完整 Markdown，以一级标题开头；关键结论后标注来源 source_id。",
    "信息不足时写未确认项，不要编造。"
  ].join("\n");
}

function buildPrompt(args: {
  sourceId: string;
  filename: string;
  source: string;
  existingPages: LlmWikiPageRef[];
  schema: LlmWikiSchema;
}): string {
  const source = args.source.length > llmWikiConfig.maxSourceChars
    ? args.source.slice(0, llmWikiConfig.maxSourceChars)
    : args.source;
  const pages = args.existingPages
    .filter((page) => page.path !== "index.md")
    .slice(0, 80)
    .map((page) => `- ${page.path}: ${page.title}`)
    .join("\n");
  return `
source_id: ${args.sourceId}
filename: ${args.filename}

schema:
${args.schema.content}

existing_pages:
${pages || "none"}

source:
\`\`\`markdown
${source}
\`\`\`
`.trim();
}

function parseJsonObject(content: string): CompilerOutput {
  const raw = content.trim();
  const candidates = [
    raw,
    raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim(),
    raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as CompilerOutput;
    } catch {
      // try next
    }
  }
  throw new Error("模型输出不是合法 JSON");
}

function normalizeCompilerOutput(raw: CompilerOutput, sourceId: string, filename: string): LlmWikiDraftPage[] {
  const title = String(raw.summary?.title || filename || "Source Summary").trim().slice(0, 160);
  const pages: LlmWikiDraftPage[] = [
    {
      path: `summaries/${sourceId}.md`,
      title,
      type: "summary",
      tags: stringArray(raw.summary?.tags),
      body: withAttribution(ensureHeading(String(raw.summary?.content || ""), title), sourceId),
      source_id: sourceId
    }
  ];
  normalizePages(raw.concepts || [], "concepts", sourceId).forEach((page) => pages.push(page));
  normalizePages(raw.entities || [], "entities", sourceId).forEach((page) => pages.push(page));
  return pages;
}

function normalizePages(input: CompilerPage[], dir: "concepts" | "entities", sourceId: string): LlmWikiDraftPage[] {
  const seen = new Set<string>();
  return input.slice(0, 8).map((page, index) => {
    const title = String(page.title || `${dir}-${index + 1}`).trim().slice(0, 160);
    const wantedPath = String(page.path || "").startsWith(`${dir}/`)
      ? safeMarkdownPath(String(page.path))
      : pagePathForTitle(dir, title, index + 1);
    const relPath = uniquePath(wantedPath, seen);
    return {
      path: relPath,
      title,
      type: dir === "concepts" ? "concept" : "entity",
      tags: stringArray(page.tags),
      body: withAttribution(ensureHeading(String(page.content || ""), title), sourceId),
      source_id: sourceId
    };
  });
}

function fallbackCompile(args: { sourceId: string; filename: string; source: string }): LlmWikiDraftPage[] {
  const title = titleFromMarkdown(args.source, args.filename);
  const excerpt = stripFrontmatter(args.source).slice(0, 4000).trim();
  const summaryBody = [
    `# ${title}`,
    "",
    "## 摘要",
    "",
    excerpt || "source 没有可提取的文本内容。",
    "",
    "## 未确认项",
    "",
    "- 当前未配置模型，服务仅生成基础摘要页，未做概念抽取。",
    "",
    `来源：source ${args.sourceId}`
  ].join("\n");
  const pages: LlmWikiDraftPage[] = [
    {
      path: `summaries/${args.sourceId}.md`,
      title,
      type: "summary",
      tags: ["fallback"],
      body: summaryBody,
      source_id: args.sourceId
    }
  ];

  const headings = [...args.source.matchAll(/^#{2,3}\s+(.+)$/gm)]
    .map((match) => normalizeWhitespace(match[1]))
    .filter(Boolean)
    .slice(0, 5);
  headings.forEach((heading, index) => {
    pages.push({
      path: `concepts/${slugify(heading, `concept-${index + 1}`)}.md`,
      title: heading,
      type: "concept",
      tags: ["auto"],
      body: [`# ${heading}`, "", `该概念来自 source ${args.sourceId} 的标题结构。`, "", `来源：source ${args.sourceId}`].join("\n"),
      source_id: args.sourceId
    });
  });
  return pages;
}

function ensureHeading(content: string, title: string): string {
  const body = stripFrontmatter(content).trim();
  return body.startsWith("#") ? `${body}\n` : `# ${title}\n\n${body || "未生成有效内容。"}\n`;
}

function withAttribution(content: string, sourceId: string): string {
  return content.includes(`source ${sourceId}`) ? content : `${content.trim()}\n\n来源：source ${sourceId}\n`;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 12);
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
