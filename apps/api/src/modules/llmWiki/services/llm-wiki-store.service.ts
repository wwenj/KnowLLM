import { Injectable, OnModuleInit } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
// gray-matter uses `export =`; this import keeps CommonJS runtime behavior correct.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import matter = require("gray-matter");
import { llmWikiConfig } from "../llm-wiki.config";
import { assertWikiMarkdownPath, isWikiMarkdownPath } from "../llm-wiki-page.utils";
import {
  LlmWikiPageContribution,
  LlmWikiNormalizedPage,
  LlmWikiPage,
  LlmWikiPageRef,
  LlmWikiPageType,
  LlmWikiSourceMeta,
  LlmWikiSourceStatus,
  LlmWikiStats,
  LlmWikiTree,
} from "../contracts/llm-wiki.types";

const VALID_STATUSES = new Set<LlmWikiSourceStatus>([
  "uploaded",
  "ingesting",
  "ready",
  "failed",
]);

interface ParsedPage {
  path: string;
  raw: string;
  body: string;
  title: string;
  type: LlmWikiPageType;
  tags: string[];
  sources: string[];
  schema_hash: string;
  updated_at: string;
  hasFrontmatter: boolean;
}

export interface LlmWikiSourceDetachResult {
  touched_pages: string[];
  needs_reconcile: Array<{
    path: string;
    remaining_sources: string[];
  }>;
}

@Injectable()
export class LlmWikiStoreService implements OnModuleInit {
  onModuleInit(): void {
    this.ensureSpace();
    this.markStaleIngestingFailed();
  }

  root(): string {
    return llmWikiConfig.root;
  }

  createSource(filename: string, data: Buffer): LlmWikiSourceMeta {
    const name = safeFilename(filename);
    const ext = safeExt(name);
    if (!data.length) throw new Error("文件内容不能为空");
    if (data.length > llmWikiConfig.maxUploadBytes) {
      throw new Error(`文件过大，最大允许 ${llmWikiConfig.maxUploadBytes} bytes`);
    }
    if (data.subarray(0, 4096).includes(0)) {
      throw new Error("二进制文件不能作为 LLM Wiki source 上传");
    }
    const text = data.toString("utf-8");
    if (!text.trim()) throw new Error("文件内容不能为空");

    this.ensureSpace();
    const sourceId = randomUUID().replace(/-/g, "");
    const root = this.sourceDir(sourceId);
    fs.mkdirSync(root, { recursive: true });
    atomicWriteText(this.sourcePath(sourceId, ext), text);
    const meta: LlmWikiSourceMeta = {
      source_id: sourceId,
      filename: name,
      ext,
      size: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
      schema_hash: "",
      status: "uploaded",
      uploaded_at: nowIso(),
      ingested_at: "",
      error: "",
      touched_pages: [],
    };
    atomicWriteJson(this.metaPath(sourceId), meta);
    this.appendLog(`上传 source ${sourceId}：${name}`);
    return meta;
  }

  listSources(): LlmWikiSourceMeta[] {
    this.ensureSpace();
    return fs
      .readdirSync(this.sourcesRoot(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const meta = readJson<Partial<LlmWikiSourceMeta>>(
          path.join(this.sourcesRoot(), entry.name, "meta.json"),
        );
        return meta ? this.normalizeMeta(meta, entry.name) : null;
      })
      .filter((item): item is LlmWikiSourceMeta => !!item)
      .sort((a, b) => (b.uploaded_at || "").localeCompare(a.uploaded_at || ""));
  }

  stats(items = this.listSources()): LlmWikiStats {
    const stats: LlmWikiStats = {
      total: items.length,
      uploaded: 0,
      ingesting: 0,
      ready: 0,
      failed: 0,
      page_count: this.listPageRefs().length,
    };
    for (const item of items) {
      stats[item.status] += 1;
    }
    return stats;
  }

  getSource(sourceId: string): LlmWikiSourceMeta {
    const id = safeSourceId(sourceId);
    const meta = readJson<Partial<LlmWikiSourceMeta>>(this.metaPath(id));
    if (!meta) throw new Error("source 不存在");
    return this.normalizeMeta(meta, id);
  }

  updateSource(
    sourceId: string,
    patch: Partial<LlmWikiSourceMeta>,
  ): LlmWikiSourceMeta {
    const current = this.getSource(sourceId);
    const next = this.normalizeMeta({ ...current, ...patch }, current.source_id);
    atomicWriteJson(this.metaPath(current.source_id), next);
    return next;
  }

  renameSource(sourceId: string, filename: string): LlmWikiSourceMeta {
    const current = this.getSource(sourceId);
    const name = safeFilename(filename);
    const ext = safeExt(name);
    if (ext !== current.ext) {
      throw new Error("重命名不能修改文件类型");
    }
    const next = this.updateSource(sourceId, { filename: name });
    this.appendLog(`重命名 source ${sourceId}：${name}`);
    return next;
  }

  prepareIngest(sourceId: string): LlmWikiSourceMeta {
    return this.updateSource(sourceId, {
      status: "ingesting",
      error: "",
    });
  }

  markIngestFailed(sourceId: string, error: string): LlmWikiSourceMeta {
    return this.updateSource(sourceId, {
      status: "failed",
      error: (error || "解析失败").slice(0, 1000),
    });
  }

  markStaleIngestingFailed(): number {
    let count = 0;
    for (const item of this.listSources()) {
      if (item.status === "ingesting") {
        this.updateSource(item.source_id, {
          status: "failed",
          error: "服务重启，解析任务已中断",
        });
        count += 1;
      }
    }
    return count;
  }

  readSource(sourceId: string): string {
    const meta = this.getSource(sourceId);
    return readText(this.sourcePath(meta.source_id, meta.ext), true);
  }

  deleteSourceCascade(sourceId: string): LlmWikiSourceDetachResult {
    const meta = this.getSource(sourceId);
    const result = this.detachSourceFromWiki(meta.source_id);
    fs.rmSync(this.sourceDir(meta.source_id), { recursive: true, force: true });
    this.appendLog(`删除 source ${meta.source_id}：${meta.filename}`);
    return result;
  }

  detachSourceFromWiki(sourceId: string): LlmWikiSourceDetachResult {
    const id = safeSourceId(sourceId);
    const meta = this.getSource(id);
    const pages = this.listPagesParsed();
    const touched: string[] = [];
    const needsReconcile: LlmWikiSourceDetachResult["needs_reconcile"] = [];
    const relatedPaths = new Set<string>([
      `summaries/${id}.md`,
      ...meta.touched_pages,
      ...pages
        .filter((page) => page.sources.includes(id))
        .map((page) => page.path),
    ]);

    for (const relPath of relatedPaths) {
      if (relPath === "index.md") continue;
      if (!this.pageExists(relPath)) continue;
      const page = this.readPageParsed(relPath);
      if (page.path.startsWith("summaries/")) {
        this.deletePageFile(relPath);
        this.deleteContribution(relPath);
        touched.push(relPath);
        continue;
      }
      const sources = page.sources.filter((source) => source !== id);
      if (!sources.length) {
        this.deletePageFile(relPath);
        this.deleteContribution(relPath);
        touched.push(relPath);
        continue;
      }
      this.writePageFromBody(relPath, page.body, {
        title: page.title,
        type: page.type,
        tags: page.tags,
        sources,
        schema_hash: page.schema_hash,
      });
      this.removeContributionSource(relPath, id);
      needsReconcile.push({ path: relPath, remaining_sources: sources });
      touched.push(relPath);
    }

    this.rebuildIndex();
    this.updateSource(id, { touched_pages: [] });
    return { touched_pages: uniqueStrings(touched), needs_reconcile: needsReconcile };
  }

  saveFusionPage(args: {
    source: LlmWikiSourceMeta;
    page: LlmWikiNormalizedPage;
    sources: string[];
    schemaHash: string;
    contributionSummary: string;
  }): string {
    this.ensureSpace();
    const relPath =
      args.page.type === "summary" ? `summaries/${args.source.source_id}.md` : args.page.path;
    this.writePageFromBody(relPath, ensureHeading(args.page.body, args.page.title), {
      title: args.page.title,
      type: args.page.type,
      tags: args.page.tags,
      sources: uniqueStrings(args.sources),
      schema_hash: args.schemaHash,
    });
    this.updateContribution(relPath, args.source, args.schemaHash, args.contributionSummary);
    return relPath;
  }

  rebuildWikiIndex(): void {
    this.rebuildIndex();
  }

  tree(): LlmWikiTree {
    const groups = [
      { group: "Root", paths: ["index.md"] },
      { group: "Summaries", paths: this.listPageRefsByPrefix("summaries/") },
      { group: "Concepts", paths: this.listPageRefsByPrefix("concepts/") },
      { group: "Entities", paths: this.listPageRefsByPrefix("entities/") },
    ];
    return {
      groups: groups
        .map((group) => ({
          group: group.group,
          pages: group.paths
            .map((item) =>
              typeof item === "string"
                ? this.pageExists(item)
                  ? this.readPageRef(item)
                  : null
                : item,
            )
            .filter((item): item is LlmWikiPageRef => !!item),
        }))
        .filter((group) => group.pages.length > 0),
    };
  }

  listPageRefs(): LlmWikiPageRef[] {
    return this.listPagesParsed().map((page) => toPageRef(page));
  }

  listPages(): LlmWikiPage[] {
    return this.listPagesParsed().map((page) => ({
      ...toPageRef(page),
      content: page.raw,
    }));
  }

  getPage(relPath: string): LlmWikiPage {
    const page = this.readPageParsed(relPath);
    return { ...toPageRef(page), content: page.raw };
  }

  savePage(relPath: string, content: string): LlmWikiPage {
    validateWikiPath(relPath);
    if (Buffer.byteLength(content || "") > llmWikiConfig.maxWikiFileBytes) {
      throw new Error(`wiki page 过大: ${relPath}`);
    }
    const existing = this.pageExists(relPath) ? this.readPageParsed(relPath) : null;
    const parsed = parseMarkdownPage(relPath, String(content || ""));
    const title = parsed.title || existing?.title || titleFromBody(parsed.body, relPath);
    const frontmatter = {
      title,
      type: parsed.type,
      tags: parsed.tags.length ? parsed.tags : existing?.tags || [],
      sources: parsed.sources.length ? parsed.sources : existing?.sources || [],
      schema_hash: parsed.schema_hash || existing?.schema_hash || "",
    };
    this.writePageFromBody(relPath, parsed.body, frontmatter);
    if (relPath !== "index.md") this.rebuildIndex();
    this.appendLog(`保存 wiki page：${relPath}`);
    return this.getPage(relPath);
  }

  deletePage(relPath: string): void {
    validateWikiPath(relPath);
    if (relPath === "index.md") throw new Error("index.md 不能删除");
    if (!this.pageExists(relPath)) throw new Error("wiki page 不存在");
    this.deletePageFile(relPath);
    this.rebuildIndex();
    this.removeTouchedPage(relPath);
    this.appendLog(`删除 wiki page：${relPath}`);
  }

  pageExists(relPath: string): boolean {
    return fs.existsSync(this.resolveWikiPath(relPath));
  }

  sourceExists(sourceId: string): boolean {
    try {
      this.getSource(sourceId);
      return true;
    } catch {
      return false;
    }
  }

  readContribution(relPath: string): LlmWikiPageContribution | null {
    validateWikiPath(relPath);
    const file = this.contributionPath(relPath);
    const contribution = readJson<LlmWikiPageContribution>(file);
    return contribution && contribution.path === relPath ? contribution : null;
  }

  updateContribution(
    relPath: string,
    source: LlmWikiSourceMeta,
    schemaHash: string,
    summary: string,
  ): LlmWikiPageContribution {
    validateWikiPath(relPath);
    const current = this.readContribution(relPath) || { path: relPath, sources: {} };
    const next: LlmWikiPageContribution = {
      path: relPath,
      sources: {
        ...current.sources,
        [source.source_id]: {
          source_sha256: source.sha256,
          schema_hash: schemaHash,
          contributed_at: nowIso(),
          summary: String(summary || "").slice(0, 1000),
        },
      },
    };
    atomicWriteJson(this.contributionPath(relPath), next);
    return next;
  }

  appendLog(message: string): void {
    const file = path.join(this.logRoot(), `${today()}.md`);
    const line = `- ${new Date().toISOString()} ${message}\n`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line, "utf-8");
  }

  private ensureSpace(): void {
    fs.mkdirSync(this.sourcesRoot(), { recursive: true });
    fs.mkdirSync(this.schemaRoot(), { recursive: true });
    fs.mkdirSync(this.wikiRoot(), { recursive: true });
    fs.mkdirSync(path.join(this.wikiRoot(), "summaries"), { recursive: true });
    fs.mkdirSync(path.join(this.wikiRoot(), "concepts"), { recursive: true });
    fs.mkdirSync(path.join(this.wikiRoot(), "entities"), { recursive: true });
    fs.mkdirSync(this.logRoot(), { recursive: true });
    fs.mkdirSync(this.contributionRoot(), { recursive: true });
    if (!fs.existsSync(this.resolveWikiPath("index.md"))) {
      this.rebuildIndex();
    }
  }

  private rebuildIndex(): void {
    fs.mkdirSync(this.wikiRoot(), { recursive: true });
    const refs = this.listPageRefs()
      .filter((page) => page.path !== "index.md")
      .sort((a, b) => pageTypeOrder(a.type) - pageTypeOrder(b.type) || a.path.localeCompare(b.path));
    const byType = {
      summary: refs.filter((page) => page.type === "summary"),
      concept: refs.filter((page) => page.type === "concept"),
      entity: refs.filter((page) => page.type === "entity"),
    };
    const lines = ["# LLM Wiki Index", ""];
    appendIndexSection(lines, "Summaries", byType.summary);
    appendIndexSection(lines, "Concepts", byType.concept);
    appendIndexSection(lines, "Entities", byType.entity);
    if (lines.length === 2) lines.push("暂无 wiki 页面。");
    this.writePageFromBody("index.md", lines.join("\n"), {
      title: "LLM Wiki Index",
      type: "index",
      tags: ["llm-wiki"],
      sources: [],
      schema_hash: "",
    });
  }

  private writePageFromBody(
    relPath: string,
    body: string,
    frontmatter: {
      title: string;
      type: LlmWikiPageType;
      tags: string[];
      sources: string[];
      schema_hash?: string;
    },
  ): void {
    validateWikiPath(relPath);
    const normalized = {
      title: frontmatter.title.slice(0, 160) || titleFromBody(body, relPath),
      type: frontmatter.type,
      tags: uniqueStrings(frontmatter.tags).slice(0, 20),
      sources: uniqueStrings(frontmatter.sources).filter((id) => /^[a-f0-9]{32}$/.test(id)),
      schema_hash: frontmatter.schema_hash || "",
      updated_at: nowIso(),
    };
    const file = this.resolveWikiPath(relPath);
    atomicWriteText(file, matter.stringify(ensureTrailingNewline(body), normalized));
  }

  private readPageParsed(relPath: string): ParsedPage {
    validateWikiPath(relPath);
    const file = this.resolveWikiPath(relPath);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new Error("wiki page 不存在");
    }
    return parseMarkdownPage(relPath, readText(file, true));
  }

  private readPageRef(relPath: string): LlmWikiPageRef {
    return toPageRef(this.readPageParsed(relPath));
  }

  private listPagesParsed(): ParsedPage[] {
    this.ensureWikiDirsOnly();
    const files = walkMarkdownFiles(this.wikiRoot());
    return files
      .map((file) => normalizeSlash(path.relative(this.wikiRoot(), file)))
      .filter((relPath) => isWikiMarkdownPath(relPath))
      .map((relPath) => this.readPageParsed(relPath))
      .sort((a, b) => pageTypeOrder(a.type) - pageTypeOrder(b.type) || a.path.localeCompare(b.path));
  }

  private listPageRefsByPrefix(prefix: string): LlmWikiPageRef[] {
    return this.listPageRefs().filter((page) => page.path.startsWith(prefix));
  }

  private deletePageFile(relPath: string): void {
    fs.rmSync(this.resolveWikiPath(relPath), { force: true });
  }

  private deleteContribution(relPath: string): void {
    fs.rmSync(this.contributionPath(relPath), { force: true });
  }

  private removeContributionSource(relPath: string, sourceId: string): void {
    const current = this.readContribution(relPath);
    if (!current) return;
    const nextSources = { ...current.sources };
    delete nextSources[sourceId];
    if (!Object.keys(nextSources).length) {
      this.deleteContribution(relPath);
      return;
    }
    atomicWriteJson(this.contributionPath(relPath), {
      path: relPath,
      sources: nextSources,
    });
  }

  private removeTouchedPage(relPath: string): void {
    for (const source of this.listSources()) {
      if (!source.touched_pages.includes(relPath)) continue;
      this.updateSource(source.source_id, {
        touched_pages: source.touched_pages.filter((item) => item !== relPath),
      });
    }
  }

  private resolveWikiPath(relPath: string): string {
    validateWikiPath(relPath);
    const target = path.resolve(this.wikiRoot(), relPath);
    const base = path.resolve(this.wikiRoot());
    if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
      throw new Error("wiki page path 越权");
    }
    return target;
  }

  private normalizeMeta(
    meta: Partial<LlmWikiSourceMeta>,
    sourceId: string,
  ): LlmWikiSourceMeta {
    const status = VALID_STATUSES.has(meta.status as LlmWikiSourceStatus)
      ? (meta.status as LlmWikiSourceStatus)
      : "failed";
    const ext = meta.ext === ".txt" ? ".txt" : ".md";
    return {
      source_id: meta.source_id && /^[a-f0-9]{32}$/.test(meta.source_id) ? meta.source_id : safeSourceId(sourceId),
      filename: meta.filename || `source${ext}`,
      ext,
      size: Number(meta.size || 0),
      sha256: meta.sha256 || "",
      schema_hash: meta.schema_hash || "",
      status,
      uploaded_at: meta.uploaded_at || "",
      ingested_at: meta.ingested_at || "",
      error: meta.error || "",
      touched_pages: Array.isArray(meta.touched_pages)
        ? uniqueStrings(meta.touched_pages.map(String))
        : [],
    };
  }

  private sourcePath(sourceId: string, ext: ".md" | ".txt"): string {
    return path.join(this.sourceDir(sourceId), `source${ext}`);
  }

  private metaPath(sourceId: string): string {
    return path.join(this.sourceDir(sourceId), "meta.json");
  }

  private sourceDir(sourceId: string): string {
    return path.join(this.sourcesRoot(), safeSourceId(sourceId));
  }

  private sourcesRoot(): string {
    return path.join(llmWikiConfig.root, "sources");
  }

  private wikiRoot(): string {
    return path.join(llmWikiConfig.root, "wiki");
  }

  private schemaRoot(): string {
    return path.join(llmWikiConfig.root, "schema");
  }

  private logRoot(): string {
    return path.join(llmWikiConfig.root, "log");
  }

  private metaRoot(): string {
    return path.join(llmWikiConfig.root, "meta");
  }

  private contributionRoot(): string {
    return path.join(this.metaRoot(), "page-contributions");
  }

  private contributionPath(relPath: string): string {
    validateWikiPath(relPath);
    const hash = createHash("sha256").update(relPath).digest("hex").slice(0, 32);
    return path.join(this.contributionRoot(), `${hash}.json`);
  }

  private ensureWikiDirsOnly(): void {
    fs.mkdirSync(this.wikiRoot(), { recursive: true });
  }
}

function parseMarkdownPage(relPath: string, raw: string): ParsedPage {
  const parsed = matter(raw || "");
  const data = parsed.data || {};
  const type = normalizePageType(data.type, pageTypeForPath(relPath));
  const body = ensureTrailingNewline(parsed.content || "");
  return {
    path: relPath,
    raw: ensureTrailingNewline(raw || ""),
    body,
    title: stringField(data.title) || titleFromBody(body, relPath),
    type,
    tags: stringArray(data.tags),
    sources: stringArray(data.sources).filter((id) => /^[a-f0-9]{32}$/.test(id)),
    schema_hash: stringField(data.schema_hash),
    updated_at: stringField(data.updated_at),
    hasFrontmatter: raw.trimStart().startsWith("---") && Object.keys(data).length > 0,
  };
}

function toPageRef(page: ParsedPage): LlmWikiPageRef {
  return {
    path: page.path,
    title: page.title,
    type: page.type,
    tags: page.tags,
    sources: page.sources,
    schema_hash: page.schema_hash,
    updated_at: page.updated_at,
  };
}

function appendIndexSection(lines: string[], title: string, pages: LlmWikiPageRef[]): void {
  lines.push(`## ${title}`, "");
  if (!pages.length) {
    lines.push("暂无。", "");
    return;
  }
  for (const page of pages) {
    const tags = page.tags.length ? ` · ${page.tags.map((tag) => `#${tag}`).join(" ")}` : "";
    lines.push(`- [[${page.path}]]：${page.title}${tags}`);
  }
  lines.push("");
}

function safeFilename(filename: string): string {
  const name = path.basename((filename || "source.md").replace(/\\/g, "/")).trim();
  return (name || "source.md").slice(0, 180);
}

function safeExt(filename: string): ".md" | ".txt" {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".md" || ext === ".txt") return ext;
  throw new Error("只支持上传 .md 和 .txt 文件");
}

function safeSourceId(sourceId: string): string {
  const raw = (sourceId || "").trim();
  if (!/^[a-f0-9]{32}$/.test(raw)) throw new Error("source_id 非法");
  return raw;
}

function validateWikiPath(relPath: string): void {
  assertWikiMarkdownPath(relPath);
}

function pageTypeForPath(relPath: string): LlmWikiPageType {
  if (relPath === "index.md") return "index";
  if (relPath.startsWith("summaries/")) return "summary";
  if (relPath.startsWith("entities/")) return "entity";
  return "concept";
}

function normalizePageType(value: unknown, fallback: LlmWikiPageType): LlmWikiPageType {
  return value === "index" || value === "summary" || value === "concept" || value === "entity"
    ? value
    : fallback;
}

function pageTypeOrder(type: LlmWikiPageType): number {
  return { index: 0, summary: 1, concept: 2, entity: 3 }[type];
}

function titleFromBody(body: string, relPath: string): string {
  for (const line of String(body || "").split(/\r?\n/)) {
    const stripped = line.trim();
    if (stripped.startsWith("#")) {
      return stripped.replace(/^#+/, "").trim().slice(0, 160) || path.basename(relPath, ".md");
    }
  }
  return path.basename(relPath, ".md");
}

function ensureHeading(content: string, title: string): string {
  const text = String(content || "").trim();
  return ensureTrailingNewline(text.startsWith("#") ? text : `# ${title}\n\n${text}`);
}

function ensureTrailingNewline(content: string): string {
  const text = String(content || "").trim();
  return text ? `${text}\n` : "";
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const item = String(value || "").trim();
    if (item) seen.add(item);
  }
  return [...seen];
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return uniqueStrings(value);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

function atomicWriteJson(file: string, payload: unknown): void {
  atomicWriteText(file, JSON.stringify(payload, null, 2));
}

function atomicWriteText(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, text, "utf-8");
  fs.renameSync(tmp, file);
}

function readJson<T>(file: string): T | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

function readText(file: string, required: boolean): string {
  try {
    if (!fs.existsSync(file)) {
      if (required) throw new Error("文件不存在");
      return "";
    }
    return fs.readFileSync(file, "utf-8");
  } catch (err) {
    if (required) throw err;
    return "";
  }
}

function walkMarkdownFiles(root: string): string[] {
  const result: string[] = [];
  if (!fs.existsSync(root)) return result;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...walkMarkdownFiles(full));
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) result.push(full);
  }
  return result.sort();
}

function normalizeSlash(value: string): string {
  return value.replace(/\\/g, "/");
}

function nowIso(): string {
  return new Date().toISOString();
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
