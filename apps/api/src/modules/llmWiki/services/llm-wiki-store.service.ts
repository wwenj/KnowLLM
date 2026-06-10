import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  ensureDir,
  nowIso,
  randomId,
  readJson,
  readText,
  removeDir,
  sha256,
  writeJson,
  writeText
} from "../../../common/fs-json";
import {
  safeFilename,
  safeMarkdownPath,
  slugify,
  stripFrontmatter,
  titleFromMarkdown,
  uniqueStrings
} from "../../../common/text";
import { llmWikiConfig } from "../llm-wiki.config";
import type {
  LlmWikiDraftPage,
  LlmWikiPage,
  LlmWikiPageRef,
  LlmWikiPageType,
  LlmWikiSchema,
  LlmWikiSourceMeta,
  LlmWikiSourceStatus,
  LlmWikiStats,
  LlmWikiTree
} from "../llm-wiki.types";

interface ParsedPage extends LlmWikiPage {
  body: string;
  hasFrontmatter: boolean;
}

export interface DetachSourceResult {
  touched_pages: string[];
  needs_reconcile: Array<{ path: string; remaining_sources: string[] }>;
}

const VALID_SOURCE_EXTS = new Set([".md", ".txt", ".html"]);
const VALID_PAGE_TYPES = new Set<LlmWikiPageType>([
  "index",
  "summary",
  "concept",
  "entity",
  "comparison",
  "manual"
]);
const DEFAULT_SCHEMA = `# KnowLLM LLM Wiki Schema

- summary: 每个 source 的摘要页面，保留核心结论、边界和未确认项。
- concept: 可复用概念、流程、约束、协议和设计原则。
- entity: 产品、组织、人物、模块、框架、系统或接口。
- comparison: 多对象对比和取舍。
- manual: 人工维护页面。

所有页面必须只基于已上传 source 或人工明确输入，不补外部事实。
`;

@Injectable()
export class LlmWikiStoreService implements OnModuleInit {
  onModuleInit(): void {
    this.ensureSpace();
    this.markStaleIngestingFailed();
  }

  root(): string {
    return llmWikiConfig.root;
  }

  ensureSpace(): void {
    ensureDir(this.sourcesRoot());
    ensureDir(this.wikiRoot());
    ensureDir(path.join(this.wikiRoot(), "summaries"));
    ensureDir(path.join(this.wikiRoot(), "concepts"));
    ensureDir(path.join(this.wikiRoot(), "entities"));
    ensureDir(path.join(this.wikiRoot(), "comparisons"));
    if (!fs.existsSync(this.schemaPath())) writeText(this.schemaPath(), DEFAULT_SCHEMA);
    if (!fs.existsSync(this.pagePath("index.md"))) this.rebuildWikiIndex();
  }

  createSource(filename: string, data: Buffer): LlmWikiSourceMeta {
    this.ensureSpace();
    const name = safeFilename(filename);
    const ext = path.extname(name).toLowerCase() || ".txt";
    if (!VALID_SOURCE_EXTS.has(ext)) {
      throw new BadRequestException("当前最小服务只支持 .md、.txt、.html 文本 source");
    }
    if (!data.length) throw new BadRequestException("文件内容不能为空");
    if (data.length > llmWikiConfig.maxUploadBytes) {
      throw new BadRequestException(`文件过大，最大允许 ${llmWikiConfig.maxUploadBytes} bytes`);
    }
    if (data.subarray(0, 4096).includes(0)) {
      throw new BadRequestException("二进制文件不能作为 LLM Wiki source 上传");
    }
    const content = data.toString("utf-8");
    if (!content.trim()) throw new BadRequestException("文件内容不能为空");

    const sourceId = randomId();
    ensureDir(this.sourceDir(sourceId));
    writeText(this.sourcePath(sourceId, ext), content);
    const meta: LlmWikiSourceMeta = {
      source_id: sourceId,
      filename: name,
      ext,
      size: data.length,
      sha256: sha256(data),
      schema_hash: "",
      status: "uploaded",
      uploaded_at: nowIso(),
      ingested_at: "",
      error: "",
      touched_pages: []
    };
    writeJson(this.metaPath(sourceId), meta);
    return meta;
  }

  listSources(): LlmWikiSourceMeta[] {
    this.ensureSpace();
    return fs
      .readdirSync(this.sourcesRoot(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.readSourceMeta(entry.name))
      .filter((item): item is LlmWikiSourceMeta => Boolean(item))
      .sort((a, b) => (b.uploaded_at || "").localeCompare(a.uploaded_at || ""));
  }

  stats(items = this.listSources()): LlmWikiStats {
    const stats: LlmWikiStats = {
      total: items.length,
      uploaded: 0,
      ingesting: 0,
      ready: 0,
      failed: 0,
      page_count: this.listPageRefs().length
    };
    for (const item of items) stats[item.status] += 1;
    return stats;
  }

  getSource(sourceId: string): LlmWikiSourceMeta {
    const source = this.readSourceMeta(sourceId);
    if (!source) throw new NotFoundException("source 不存在");
    return source;
  }

  readSource(sourceId: string): string {
    const meta = this.getSource(sourceId);
    return readText(this.sourcePath(meta.source_id, meta.ext));
  }

  updateSource(sourceId: string, patch: Partial<LlmWikiSourceMeta>): LlmWikiSourceMeta {
    const current = this.getSource(sourceId);
    const next = normalizeSourceMeta({ ...current, ...patch }, current.source_id);
    writeJson(this.metaPath(current.source_id), next);
    return next;
  }

  renameSource(sourceId: string, filename: string): LlmWikiSourceMeta {
    const current = this.getSource(sourceId);
    const name = safeFilename(filename);
    const ext = path.extname(name).toLowerCase() || current.ext;
    if (ext !== current.ext) throw new BadRequestException("重命名不能修改文件类型");
    return this.updateSource(sourceId, { filename: name });
  }

  prepareIngest(sourceId: string): LlmWikiSourceMeta {
    return this.updateSource(sourceId, { status: "ingesting", error: "" });
  }

  markIngestFailed(sourceId: string, error: string): LlmWikiSourceMeta {
    return this.updateSource(sourceId, {
      status: "failed",
      error: String(error || "解析失败").slice(0, 1000)
    });
  }

  markStaleIngestingFailed(): number {
    let count = 0;
    for (const source of this.listSources()) {
      if (source.status !== "ingesting") continue;
      this.updateSource(source.source_id, {
        status: "failed",
        error: "服务重启，解析任务已中断"
      });
      count += 1;
    }
    return count;
  }

  deleteSourceCascade(sourceId: string): DetachSourceResult {
    const meta = this.getSource(sourceId);
    const result = this.detachSourceFromWiki(meta.source_id);
    removeDir(this.sourceDir(meta.source_id));
    this.rebuildWikiIndex();
    return result;
  }

  detachSourceFromWiki(sourceId: string): DetachSourceResult {
    const meta = this.getSource(sourceId);
    const touched: string[] = [];
    const needsReconcile: DetachSourceResult["needs_reconcile"] = [];
    const relatedPaths = uniqueStrings([
      `summaries/${meta.source_id}.md`,
      ...meta.touched_pages,
      ...this.listPagesParsed()
        .filter((page) => page.sources.includes(meta.source_id))
        .map((page) => page.path)
    ]);

    for (const relPath of relatedPaths) {
      if (relPath === "index.md" || !this.pageExists(relPath)) continue;
      const page = this.readPageParsed(relPath);
      if (page.type === "summary") {
        this.deletePage(relPath, false);
        touched.push(relPath);
        continue;
      }
      const sources = page.sources.filter((item) => item !== meta.source_id);
      if (!sources.length) {
        this.deletePage(relPath, false);
        touched.push(relPath);
        continue;
      }
      this.writePageFromBody(relPath, page.body, {
        title: page.title,
        type: page.type,
        tags: page.tags,
        sources,
        schema_hash: page.schema_hash || "",
        updated_at: nowIso()
      });
      touched.push(relPath);
      needsReconcile.push({ path: relPath, remaining_sources: sources });
    }

    this.updateSource(meta.source_id, { touched_pages: [] });
    return { touched_pages: uniqueStrings(touched), needs_reconcile: needsReconcile };
  }

  saveCompiledPage(args: {
    source: LlmWikiSourceMeta;
    draft: LlmWikiDraftPage;
    schemaHash: string;
  }): string {
    const relPath =
      args.draft.type === "summary" ? `summaries/${args.source.source_id}.md` : args.draft.path;
    const current = this.pageExists(relPath) ? this.readPageParsed(relPath) : null;
    this.writePageFromBody(relPath, ensureHeading(args.draft.body, args.draft.title), {
      title: args.draft.title,
      type: args.draft.type,
      tags: uniqueStrings([...(current?.tags || []), ...args.draft.tags]),
      sources: uniqueStrings([...(current?.sources || []), args.source.source_id]),
      schema_hash: args.schemaHash,
      updated_at: nowIso()
    });
    return relPath;
  }

  listPages(): LlmWikiPage[] {
    this.ensureSpace();
    return this.listPagePaths().map((relPath) => this.readPageParsed(relPath));
  }

  listPageRefs(): LlmWikiPageRef[] {
    return this.listPages().map(toPageRef);
  }

  listPagesParsed(): ParsedPage[] {
    return this.listPagePaths().map((relPath) => this.readPageParsed(relPath));
  }

  tree(): LlmWikiTree {
    const groups = new Map<string, LlmWikiPageRef[]>();
    for (const page of this.listPageRefs()) {
      const group = page.path.includes("/") ? page.path.split("/")[0] : "root";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)?.push(page);
    }
    return {
      groups: [...groups.entries()].map(([group, pages]) => ({
        group,
        pages: pages.sort((a, b) => a.path.localeCompare(b.path))
      }))
    };
  }

  getPage(relPath: string): LlmWikiPage {
    const safe = safeMarkdownPath(relPath || "index.md");
    if (safe === "index.md" && !this.pageExists(safe)) this.rebuildWikiIndex();
    if (!this.pageExists(safe)) throw new NotFoundException("wiki 页面不存在");
    return this.readPageParsed(safe);
  }

  savePage(relPath: string, content: string): LlmWikiPage {
    const safe = safeMarkdownPath(relPath || "index.md");
    const parsed = parsePageContent(safe, content);
    const body = parsed.body || stripFrontmatter(content);
    this.writePageFromBody(safe, body, {
      title: parsed.title,
      type: parsed.type,
      tags: parsed.tags,
      sources: parsed.sources,
      schema_hash: parsed.schema_hash || this.getSchema().sha256,
      updated_at: nowIso()
    });
    if (safe !== "index.md") this.rebuildWikiIndex();
    return this.getPage(safe);
  }

  deletePage(relPath: string, rebuildIndex = true): void {
    const safe = safeMarkdownPath(relPath);
    if (safe === "index.md") throw new BadRequestException("index.md 不能删除");
    fs.rmSync(this.pagePath(safe), { force: true });
    if (rebuildIndex) this.rebuildWikiIndex();
  }

  pageExists(relPath: string): boolean {
    return fs.existsSync(this.pagePath(safeMarkdownPath(relPath)));
  }

  getSchema(): LlmWikiSchema {
    this.ensureSpaceWithoutIndex();
    const content = readText(this.schemaPath(), DEFAULT_SCHEMA);
    const stat = fs.existsSync(this.schemaPath()) ? fs.statSync(this.schemaPath()) : null;
    return {
      content,
      sha256: sha256(content),
      updated_at: stat ? stat.mtime.toISOString() : nowIso()
    };
  }

  saveSchema(content: string): LlmWikiSchema {
    this.ensureSpaceWithoutIndex();
    const next = String(content || "").trim();
    if (!next) throw new BadRequestException("schema 不能为空");
    writeText(this.schemaPath(), `${next}\n`);
    return this.getSchema();
  }

  rebuildWikiIndex(): LlmWikiPage {
    this.ensureSpaceWithoutIndex();
    const pages = this.listPagePaths()
      .filter((item) => item !== "index.md")
      .map((item) => this.readPageParsed(item))
      .sort((a, b) => a.path.localeCompare(b.path));
    const lines = [
      "# LLM Wiki Index",
      "",
      `更新时间：${nowIso()}`,
      "",
      ...pages.map((page) => `- [[${page.path}]] ${page.title} (${page.type})`)
    ];
    this.writePageFromBody("index.md", `${lines.join("\n")}\n`, {
      title: "LLM Wiki Index",
      type: "index",
      tags: ["index"],
      sources: uniqueStrings(pages.flatMap((page) => page.sources)),
      schema_hash: this.getSchema().sha256,
      updated_at: nowIso()
    });
    return this.getPage("index.md");
  }

  debugSummary() {
    const sources = this.listSources();
    const pages = this.listPageRefs();
    return {
      root: this.root(),
      stats: this.stats(sources),
      sources: sources.map(({ source_id, filename, status, touched_pages }) => ({
        source_id,
        filename,
        status,
        touched_pages
      })),
      pages
    };
  }

  private ensureSpaceWithoutIndex(): void {
    ensureDir(this.sourcesRoot());
    ensureDir(this.wikiRoot());
    ensureDir(path.join(this.wikiRoot(), "summaries"));
    ensureDir(path.join(this.wikiRoot(), "concepts"));
    ensureDir(path.join(this.wikiRoot(), "entities"));
    ensureDir(path.join(this.wikiRoot(), "comparisons"));
    if (!fs.existsSync(this.schemaPath())) writeText(this.schemaPath(), DEFAULT_SCHEMA);
  }

  private listPagePaths(): string[] {
    this.ensureSpaceWithoutIndex();
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          out.push(path.relative(this.wikiRoot(), full).replace(/\\/g, "/"));
        }
      }
    };
    walk(this.wikiRoot());
    return out.sort();
  }

  private readPageParsed(relPath: string): ParsedPage {
    const safe = safeMarkdownPath(relPath);
    const raw = readText(this.pagePath(safe));
    return parsePageContent(safe, raw);
  }

  private writePageFromBody(
    relPath: string,
    body: string,
    meta: Omit<LlmWikiPageRef, "path">
  ): void {
    const safe = safeMarkdownPath(relPath);
    const content = renderPage({
      path: safe,
      title: meta.title || titleFromMarkdown(body, path.basename(safe, ".md")),
      type: meta.type || inferPageType(safe),
      tags: uniqueStrings(meta.tags || []),
      sources: uniqueStrings(meta.sources || []),
      schema_hash: meta.schema_hash || "",
      updated_at: meta.updated_at || nowIso(),
      content: body
    });
    if (Buffer.byteLength(content, "utf-8") > llmWikiConfig.maxWikiFileBytes) {
      throw new BadRequestException("wiki 页面内容过大");
    }
    writeText(this.pagePath(safe), content);
  }

  private readSourceMeta(sourceId: string): LlmWikiSourceMeta | null {
    const id = safeSourceId(sourceId);
    const meta = readJson<Partial<LlmWikiSourceMeta> | null>(this.metaPath(id), null);
    return meta ? normalizeSourceMeta(meta, id) : null;
  }

  private sourcesRoot(): string {
    return path.join(this.root(), "sources");
  }

  private wikiRoot(): string {
    return path.join(this.root(), "wiki");
  }

  private schemaPath(): string {
    return path.join(this.root(), "schema.md");
  }

  private sourceDir(sourceId: string): string {
    return path.join(this.sourcesRoot(), safeSourceId(sourceId));
  }

  private metaPath(sourceId: string): string {
    return path.join(this.sourceDir(sourceId), "meta.json");
  }

  private sourcePath(sourceId: string, ext: string): string {
    return path.join(this.sourceDir(sourceId), `source${ext}`);
  }

  private pagePath(relPath: string): string {
    return path.join(this.wikiRoot(), safeMarkdownPath(relPath));
  }
}

function normalizeSourceMeta(meta: Partial<LlmWikiSourceMeta>, sourceId: string): LlmWikiSourceMeta {
  const status = meta.status && ["uploaded", "ingesting", "ready", "failed"].includes(meta.status)
    ? (meta.status as LlmWikiSourceStatus)
    : "uploaded";
  return {
    source_id: safeSourceId(meta.source_id || sourceId),
    filename: safeFilename(meta.filename || "source.txt"),
    ext: String(meta.ext || ".txt"),
    size: Number(meta.size || 0),
    sha256: String(meta.sha256 || ""),
    schema_hash: String(meta.schema_hash || ""),
    status,
    uploaded_at: String(meta.uploaded_at || nowIso()),
    ingested_at: String(meta.ingested_at || ""),
    error: String(meta.error || ""),
    touched_pages: Array.isArray(meta.touched_pages) ? uniqueStrings(meta.touched_pages) : []
  };
}

function safeSourceId(value: string): string {
  const text = String(value || "").trim();
  if (!/^[a-f0-9]{32}$/.test(text)) throw new BadRequestException("source_id 非法");
  return text;
}

function toPageRef(page: LlmWikiPage): LlmWikiPageRef {
  const { content: _content, ...ref } = page;
  return ref;
}

function parsePageContent(relPath: string, raw: string): ParsedPage {
  const safe = safeMarkdownPath(relPath);
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const frontmatter = match ? parseFrontmatter(match[1]) : {};
  const body = match ? raw.slice(match[0].length).trimStart() : raw;
  const type = normalizePageType(frontmatter.type, inferPageType(safe));
  const title = String(frontmatter.title || titleFromMarkdown(body, path.basename(safe, ".md"))).slice(0, 160);
  return {
    path: safe,
    title,
    type,
    tags: arrayValue(frontmatter.tags),
    sources: arrayValue(frontmatter.sources),
    schema_hash: String(frontmatter.schema_hash || ""),
    updated_at: String(frontmatter.updated_at || ""),
    content: raw,
    body,
    hasFrontmatter: Boolean(match)
  };
}

function parseFrontmatter(input: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let currentArrayKey = "";
  for (const line of input.split(/\r?\n/)) {
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      currentArrayKey = keyMatch[1];
      const value = keyMatch[2];
      out[currentArrayKey] = value ? parseScalar(value) : [];
      continue;
    }
    const itemMatch = line.match(/^\s*-\s*(.*)$/);
    if (itemMatch && currentArrayKey) {
      const current = Array.isArray(out[currentArrayKey]) ? (out[currentArrayKey] as unknown[]) : [];
      current.push(parseScalar(itemMatch[1]));
      out[currentArrayKey] = current;
    }
  }
  return out;
}

function parseScalar(value: string): unknown {
  const text = value.trim();
  if (!text) return "";
  if (text.startsWith("\"")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text.replace(/^"|"$/g, "");
    }
  }
  return text;
}

function arrayValue(value: unknown): string[] {
  if (Array.isArray(value)) return uniqueStrings(value.map((item) => String(item || "")));
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function renderPage(page: LlmWikiPage): string {
  const body = stripFrontmatter(page.content || "").trim();
  return [
    "---",
    `title: ${JSON.stringify(page.title)}`,
    `type: ${page.type}`,
    "tags:",
    ...page.tags.map((tag) => `  - ${JSON.stringify(tag)}`),
    "sources:",
    ...page.sources.map((source) => `  - ${JSON.stringify(source)}`),
    `schema_hash: ${JSON.stringify(page.schema_hash || "")}`,
    `updated_at: ${JSON.stringify(page.updated_at || nowIso())}`,
    "---",
    "",
    body || `# ${page.title}`,
    ""
  ].join("\n");
}

function normalizePageType(value: unknown, fallback: LlmWikiPageType): LlmWikiPageType {
  return typeof value === "string" && VALID_PAGE_TYPES.has(value as LlmWikiPageType)
    ? (value as LlmWikiPageType)
    : fallback;
}

function inferPageType(relPath: string): LlmWikiPageType {
  if (relPath === "index.md") return "index";
  if (relPath.startsWith("summaries/")) return "summary";
  if (relPath.startsWith("concepts/")) return "concept";
  if (relPath.startsWith("entities/")) return "entity";
  if (relPath.startsWith("comparisons/")) return "comparison";
  return "manual";
}

function ensureHeading(content: string, title: string): string {
  const body = stripFrontmatter(String(content || "")).trim();
  return body.startsWith("#") ? `${body}\n` : `# ${title}\n\n${body || "未生成有效内容。"}\n`;
}

export function pagePathForTitle(dir: "concepts" | "entities", title: string, index: number): string {
  return `${dir}/${slugify(title, `${dir}-${index}`)}.md`;
}
