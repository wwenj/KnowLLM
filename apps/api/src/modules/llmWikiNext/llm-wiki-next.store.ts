import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDataRoot } from "../../config/data-root";
import {
  CompilePool,
  ManifestPage,
  PublishResult,
  SourceOverlay,
  SourceRecord,
  SourceSnapshot,
  StagingState,
  WikiManifest,
  WikiSearchIndex,
  WikiSnapshot,
} from "./llm-wiki-next.types";

interface PublishedPointer {
  revisionId: string;
  publishedAt: string;
}

@Injectable()
export class LlmWikiNextStore {
  readonly root: string;

  constructor() {
    this.root = path.join(getDataRoot(), "llm-wiki-next", "default");
    fs.mkdirSync(this.sourcesRoot(), { recursive: true });
    fs.mkdirSync(this.publishedRevisionsRoot(), { recursive: true });
  }

  saveSource(filename: string, buffer: Buffer): SourceRecord {
    const normalizedName = normalizeSourceFilename(filename);
    const content = decodeUtf8(buffer);
    const now = new Date().toISOString();
    const sourceId = uniqueId(16, (id) =>
      fs.existsSync(this.sourceMetaPath(id)),
    );
    const record: SourceRecord = {
      sourceId,
      filename: normalizedName,
      contentHash: sha256(content),
      charCount: content.length,
      lineCount: countLines(content),
      createdAt: now,
    };
    atomicWriteText(this.sourceContentPath(sourceId), content);
    atomicWriteJson(this.sourceMetaPath(sourceId), record);
    return record;
  }

  listSources(): SourceRecord[] {
    return listJsonFiles(this.sourcesRoot())
      .map((file) => readJson<SourceRecord>(file))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getSource(sourceId: string): SourceSnapshot {
    const id = safeId(sourceId, 16, "sourceId");
    const record = readJson<SourceRecord>(this.sourceMetaPath(id));
    const content = fs.readFileSync(this.sourceContentPath(id), "utf8");
    if (sha256(content) !== record.contentHash)
      throw new Error(`Source 内容校验失败: ${id}`);
    return { ...record, content };
  }

  deleteSources(sourceIds: string[]): void {
    for (const sourceId of sourceIds) this.getSource(sourceId);
    for (const sourceId of sourceIds) {
      const id = safeId(sourceId, 16, "sourceId");
      fs.unlinkSync(this.sourceContentPath(id));
      fs.unlinkSync(this.sourceMetaPath(id));
    }
  }

  sourceCompileArtifactLocations(
    sourceId: string,
  ): Array<"staging" | "published"> {
    const locations: Array<"staging" | "published"> = [];
    const staging = this.readStagingState();
    if (
      staging &&
      snapshotHasSourceCompileArtifact(this.readStagingSnapshot(), sourceId)
    ) {
      locations.push("staging");
    }
    if (
      snapshotHasSourceCompileArtifact(this.readPublishedSnapshot(), sourceId)
    ) {
      locations.push("published");
    }
    return locations;
  }

  readStagingState(): StagingState | null {
    const file = this.stagingStatePath();
    return fs.existsSync(file) ? readJson<StagingState>(file) : null;
  }

  updateStagingState(next: StagingState): void {
    if (!this.readStagingState()) throw new Error("当前没有 Staging");
    atomicWriteJson(this.stagingStatePath(), {
      ...next,
      updatedAt: new Date().toISOString(),
    });
  }

  ensureStaging(): StagingState {
    const existing = this.readStagingState();
    if (existing) return existing;
    const now = new Date().toISOString();
    const snapshot = this.readPublishedSnapshot();
    const generation = createId(16);
    const state: StagingState = {
      workspaceId: createId(16),
      status: "open",
      generation,
      completedSourceIds: [],
      reservedPageKeys: [],
      createdAt: now,
      updatedAt: now,
    };
    this.writeSnapshot(this.stagingGenerationRoot(generation), snapshot);
    fs.mkdirSync(this.stagingRoot(), { recursive: true });
    atomicWriteJson(this.stagingStatePath(), state);
    return state;
  }

  readStagingSnapshot(): WikiSnapshot {
    const state = this.readStagingState();
    if (!state) throw new Error("当前没有 Staging");
    return this.readSnapshot(this.stagingGenerationRoot(state.generation));
  }

  readCompilePool(): CompilePool | null {
    const file = this.compilePoolPath();
    return fs.existsSync(file) ? readJson<CompilePool>(file) : null;
  }

  saveCompilePool(pool: CompilePool): CompilePool {
    const state = this.readStagingState();
    if (
      !state ||
      state.workspaceId !== pool.workspaceId ||
      state.status !== "open"
    ) {
      throw new Error("当前 Staging 不可写入编译池");
    }
    atomicWriteJson(this.compilePoolPath(), {
      ...pool,
      updatedAt: new Date().toISOString(),
    });
    return pool;
  }

  deleteCompilePool(): void {
    const file = this.compilePoolPath();
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  clearInterruptedCompileState(): void {
    this.deleteCompilePool();
    if (fs.existsSync(this.jobsRoot())) removeDir(this.jobsRoot());
    const state = this.readStagingState();
    if (state && state.reservedPageKeys.length) {
      this.updateStagingState({ ...state, reservedPageKeys: [] });
    }
  }

  commitSourceOverlay(overlay: SourceOverlay): StagingState {
    const state = this.readStagingState();
    if (!state || state.status !== "open")
      throw new Error("Staging 当前不可写");
    if (state.completedSourceIds.includes(overlay.sourceId)) {
      throw new Error(`Source 已合并到当前 Staging: ${overlay.sourceId}`);
    }

    const snapshot = this.readStagingSnapshot();
    applyOverlay(snapshot, overlay);
    rebuildDerivedArtifacts(snapshot);

    const previousGeneration = state.generation;
    const generation = createId(16);
    this.writeSnapshot(this.stagingGenerationRoot(generation), snapshot);
    const next: StagingState = {
      ...state,
      generation,
      completedSourceIds: unique([
        ...state.completedSourceIds,
        overlay.sourceId,
      ]),
      reservedPageKeys: state.reservedPageKeys.filter(
        (id) => !snapshot.pages[id],
      ),
      updatedAt: new Date().toISOString(),
    };
    atomicWriteJson(this.stagingStatePath(), next);
    removeDir(this.stagingGenerationRoot(previousGeneration));
    return next;
  }

  discardStaging(): void {
    removeDir(this.stagingRoot());
  }

  publishStaging(): PublishResult {
    const state = this.readStagingState();
    if (!state) throw new Error("当前没有可发布的 Staging");
    const snapshot = this.readStagingSnapshot();
    const revisionId = createId(16);
    const publishedAt = new Date().toISOString();
    snapshot.manifest = {
      ...snapshot.manifest,
      revisionId,
      generatedAt: publishedAt,
    };
    this.writeSnapshot(this.publishedRevisionRoot(revisionId), snapshot);

    // current.json 是唯一正式提交点：切换前所有读取仍指向旧 Wiki。
    const previous = this.readPublishedPointer();
    atomicWriteJson(this.publishedPointerPath(), { revisionId, publishedAt });
    this.readSnapshot(this.publishedRevisionRoot(revisionId));

    // 指针切换后发布已经成功；清理失败只能记录，不能把已提交结果误报成失败。
    const cleanupWarnings: string[] = [];
    if (previous?.revisionId && previous.revisionId !== revisionId) {
      try {
        removeDir(this.publishedRevisionRoot(previous.revisionId));
      } catch (error) {
        cleanupWarnings.push(`旧 revision 清理失败: ${formatError(error)}`);
      }
    }
    try {
      this.retireStaging(revisionId);
    } catch (error) {
      cleanupWarnings.push(`Staging 清理失败: ${formatError(error)}`);
    }
    return {
      revisionId,
      pageCount: snapshot.manifest.pages.length,
      factCount: countFacts(snapshot),
      publishedAt,
      cleanupWarnings,
      cancelledQueuedCount: 0,
      cancelledRunningCount: 0,
    };
  }

  readPublishedPointer(): PublishedPointer | null {
    const file = this.publishedPointerPath();
    return fs.existsSync(file) ? readJson<PublishedPointer>(file) : null;
  }

  readPublishedSnapshot(): WikiSnapshot {
    const pointer = this.readPublishedPointer();
    return pointer
      ? this.readSnapshot(this.publishedRevisionRoot(pointer.revisionId))
      : emptySnapshot();
  }

  workspaceMarker(): string {
    const staging = this.readStagingState();
    if (staging) return `staging:${staging.workspaceId}`;
    const published = this.readPublishedPointer();
    return published ? `published:${published.revisionId}` : "empty";
  }

  private writeSnapshot(root: string, snapshot: WikiSnapshot): void {
    if (fs.existsSync(root))
      throw new Error(`目标 Wiki revision 已存在: ${root}`);
    fs.mkdirSync(path.join(root, "pages"), { recursive: true });
    for (const [pageKey, body] of Object.entries(snapshot.pages)) {
      atomicWriteText(
        path.join(root, "pages", `${safePageKey(pageKey)}.md`),
        body,
      );
    }
    atomicWriteJson(path.join(root, "facts.json"), snapshot.facts);
    atomicWriteJson(path.join(root, "source-map.json"), snapshot.sourceMap);
    atomicWriteJson(path.join(root, "manifest.json"), snapshot.manifest);
    atomicWriteJson(path.join(root, "search-index.json"), snapshot.searchIndex);
    this.readSnapshot(root);
  }

  private readSnapshot(root: string): WikiSnapshot {
    const manifest = readJson<WikiManifest>(path.join(root, "manifest.json"));
    const facts = readJson<WikiSnapshot["facts"]>(
      path.join(root, "facts.json"),
    );
    const sourceMap = readJson<WikiSnapshot["sourceMap"]>(
      path.join(root, "source-map.json"),
    );
    const searchIndex = readJson<WikiSearchIndex>(
      path.join(root, "search-index.json"),
    );
    const pages: Record<string, string> = {};
    for (const page of manifest.pages) {
      pages[page.pageKey] = fs.readFileSync(
        path.join(root, "pages", `${safePageKey(page.pageKey)}.md`),
        "utf8",
      );
    }
    return { pages, manifest, facts, sourceMap, searchIndex };
  }

  private sourcesRoot(): string {
    return path.join(this.root, "sources");
  }

  private sourceContentPath(sourceId: string): string {
    return path.join(this.sourcesRoot(), `${sourceId}.md`);
  }

  private sourceMetaPath(sourceId: string): string {
    return path.join(this.sourcesRoot(), `${sourceId}.json`);
  }

  private jobsRoot(): string {
    return path.join(this.root, "jobs");
  }

  private stagingRoot(): string {
    return path.join(this.root, "staging");
  }

  private stagingStatePath(): string {
    return path.join(this.stagingRoot(), "state.json");
  }

  private compilePoolPath(): string {
    return path.join(this.stagingRoot(), "compile-pool.json");
  }

  private stagingGenerationRoot(generation: string): string {
    return path.join(
      this.stagingRoot(),
      "generations",
      safeId(generation, 16, "generation"),
    );
  }

  private publishedRoot(): string {
    return path.join(this.root, "published");
  }

  private publishedPointerPath(): string {
    return path.join(this.publishedRoot(), "current.json");
  }

  private publishedRevisionsRoot(): string {
    return path.join(this.publishedRoot(), "revisions");
  }

  private publishedRevisionRoot(revisionId: string): string {
    return path.join(
      this.publishedRevisionsRoot(),
      safeId(revisionId, 16, "revisionId"),
    );
  }

  private retireStaging(revisionId: string): void {
    if (!fs.existsSync(this.stagingRoot())) return;
    const cleanupRoot = path.join(this.root, "cleanup");
    const retired = path.join(
      cleanupRoot,
      `staging-${safeId(revisionId, 16, "revisionId")}`,
    );
    fs.mkdirSync(cleanupRoot, { recursive: true });
    fs.renameSync(this.stagingRoot(), retired);
    removeDir(retired);
  }
}

export function emptySnapshot(): WikiSnapshot {
  return {
    pages: {},
    manifest: {
      revisionId: "",
      generatedAt: new Date(0).toISOString(),
      pages: [],
    },
    facts: { byPage: {} },
    sourceMap: { sourceToPages: {}, pageToSources: {} },
    searchIndex: { documents: [] },
  };
}

function applyOverlay(snapshot: WikiSnapshot, overlay: SourceOverlay): void {
  const manifestByKey = new Map(
    snapshot.manifest.pages.map((page) => [page.pageKey, page]),
  );
  for (const page of overlay.pages) {
    snapshot.pages[page.pageKey] = page.bodyMarkdown;
    const existing = manifestByKey.get(page.pageKey);
    manifestByKey.set(page.pageKey, {
      pageKey: page.pageKey,
      title: page.title,
      goal: page.goal,
      relatedPageKeys: unique([
        ...(existing?.relatedPageKeys || []),
        ...page.relatedPageKeys,
      ]),
      sourceIds: unique([...(existing?.sourceIds || []), overlay.sourceId]),
    });
    snapshot.facts.byPage[page.pageKey] = [
      ...(snapshot.facts.byPage[page.pageKey] || []),
      ...page.facts,
    ];
    snapshot.sourceMap.pageToSources[page.pageKey] = unique([
      ...(snapshot.sourceMap.pageToSources[page.pageKey] || []),
      overlay.sourceId,
    ]);
  }
  snapshot.sourceMap.sourceToPages[overlay.sourceId] = unique([
    ...(snapshot.sourceMap.sourceToPages[overlay.sourceId] || []),
    ...overlay.pages.map((page) => page.pageKey),
  ]);
  snapshot.manifest.pages = [...manifestByKey.values()];
}

function rebuildDerivedArtifacts(snapshot: WikiSnapshot): void {
  snapshot.manifest = {
    ...snapshot.manifest,
    generatedAt: new Date().toISOString(),
    pages: snapshot.manifest.pages
      .map(
        (page): ManifestPage => ({
          ...page,
          sourceIds: unique(
            snapshot.sourceMap.pageToSources[page.pageKey] || page.sourceIds,
          ),
          relatedPageKeys: unique(page.relatedPageKeys).filter(
            (id) => id !== page.pageKey,
          ),
        }),
      )
      .sort(
        (a, b) =>
          a.title.localeCompare(b.title) || a.pageKey.localeCompare(b.pageKey),
      ),
  };
  snapshot.searchIndex = {
    documents: snapshot.manifest.pages.map((page) => ({
      pageKey: page.pageKey,
      title: page.title,
      goal: page.goal,
      bodyMarkdown: snapshot.pages[page.pageKey] || "",
      facts: (snapshot.facts.byPage[page.pageKey] || []).map(
        (fact) => fact.fact,
      ),
      sourceIds: page.sourceIds,
    })),
  };
}

function countFacts(snapshot: WikiSnapshot): number {
  return Object.values(snapshot.facts.byPage).reduce(
    (sum, facts) => sum + facts.length,
    0,
  );
}

function snapshotHasSourceCompileArtifact(
  snapshot: WikiSnapshot,
  sourceId: string,
): boolean {
  return (
    Boolean(snapshot.sourceMap.sourceToPages[sourceId]?.length) ||
    Object.values(snapshot.sourceMap.pageToSources).some((sourceIds) =>
      sourceIds.includes(sourceId),
    ) ||
    snapshot.manifest.pages.some((page) =>
      page.sourceIds.includes(sourceId),
    ) ||
    Object.values(snapshot.facts.byPage).some((facts) =>
      facts.some((fact) => fact.sourceId === sourceId),
    ) ||
    snapshot.searchIndex.documents.some((document) =>
      document.sourceIds.includes(sourceId),
    )
  );
}

function normalizeSourceFilename(filename: string): string {
  const raw = path.basename(String(filename || "").trim());
  if (!raw) throw new Error("Source 文件名为空");
  if (!/\.(?:md|markdown|txt)$/i.test(raw))
    throw new Error("只支持 Markdown 或 Text Source");
  return raw;
}

function decodeUtf8(buffer: Buffer): string {
  if (!buffer.length) throw new Error("Source 内容为空");
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("Source 必须是合法 UTF-8 文本");
  }
  if (!content.trim()) throw new Error("Source 内容为空");
  return content;
}

function countLines(content: string): number {
  return content.length ? (content.match(/\n/g)?.length || 0) + 1 : 0;
}

function safePageKey(value: string): string {
  return safeId(value, 8, "pageKey");
}

function safeId(value: string, length: number, field: string): string {
  const raw = String(value || "").trim();
  const pattern = new RegExp(`^[A-Za-z0-9]{${length}}$`);
  if (!pattern.test(raw)) throw new Error(`${field} 非法`);
  return raw;
}

function uniqueId(length: number, exists: (id: string) => boolean): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = createId(length);
    if (!exists(id)) return id;
  }
  throw new Error("无法生成唯一 ID");
}

function createId(length: number): string {
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function listJsonFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(root, name));
}

function readJson<T>(file: string): T {
  if (!fs.existsSync(file)) throw new Error(`文件不存在: ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function atomicWriteJson(file: string, payload: unknown): void {
  atomicWriteText(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function atomicWriteText(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, content, "utf8");
  fs.renameSync(temporary, file);
}

function removeDir(root: string): void {
  if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
