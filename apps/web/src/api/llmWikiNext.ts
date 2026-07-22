import { http } from "./http";

const ROOT = "/api/llm-wiki-next";

export type SourceCompileStatus =
  | "queued"
  | "planning"
  | "writing"
  | "completed"
  | "failed"
  | "cancelled";

export interface SourceRecord {
  sourceId: string;
  filename: string;
  contentHash: string;
  charCount: number;
  lineCount: number;
  createdAt: string;
}

export interface SourceSnapshot extends SourceRecord {
  content: string;
}

export interface DeleteSourcesResult {
  deletedSourceIds: string[];
}

export interface CompileExecutionOptions {
  model: string;
  sourceConcurrency: number;
  chunkChars: number;
  plannerMaxOutputTokens: number;
  writerMaxOutputTokens: number;
}

export interface NormalizedCompileOptions extends CompileExecutionOptions {
  sourceIds: string[];
}

export interface CompileRequest extends Partial<NormalizedCompileOptions> {
  sourceIds: string[];
  model: string;
  confirmHash?: string;
}

export interface CompileUnitEstimate {
  sourceId: string;
  unitId: string;
  charCount: number;
  // 页面预算由服务端按 Unit 内容动态计算，不是用户可配置的固定页面上限。
  maxPages: number;
}

export interface CompileEstimate {
  sourceIds: string[];
  sourceCount: number;
  compileUnitCount: number;
  units: CompileUnitEstimate[];
  maxPlannedPages: number;
  maxPlannerCalls: number;
  maxWriterCalls: number;
  maxModelCalls: number;
  maxOutputTokens: number;
  workspaceMarker: string;
  options: NormalizedCompileOptions;
  confirmHash: string;
}

export interface CompilePoolItem {
  sourceId: string;
  contentHash: string;
  status: SourceCompileStatus;
  compileUnitCount: number;
  maxModelCalls: number;
  maxOutputTokens: number;
  modelCalls: number;
  plannerCalls: number;
  writerCalls: number;
  pageKeys: string[];
  error: string;
  queuedAt: string;
  startedAt: string;
  finishedAt: string;
  startedOptions: CompileExecutionOptions | null;
}

export interface CompilePool {
  poolId: string;
  workspaceId: string;
  configVersion: number;
  options: CompileExecutionOptions;
  items: CompilePoolItem[];
  createdAt: string;
  updatedAt: string;
}

export interface CompilePoolCancelResult {
  cancelled: true;
  queuedCount: number;
  runningCount: number;
}

export interface KeyFact {
  fact: string;
  sourceId: string;
  sourceLine: number | null;
}

export interface ManifestPage {
  pageKey: string;
  title: string;
  goal: string;
  relatedPageKeys: string[];
  sourceIds: string[];
}

export interface WikiPageDetail extends ManifestPage {
  bodyMarkdown: string;
  keyFacts: KeyFact[];
}

export interface StagingState {
  workspaceId: string;
  status: "open" | "publishing";
  generation: string;
  completedSourceIds: string[];
  reservedPageKeys: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StagingSummary {
  state: StagingState;
  pageCount: number;
  factCount: number;
  pages: ManifestPage[];
  compilePool: CompilePool | null;
}

export interface PublishResult {
  revisionId: string;
  pageCount: number;
  factCount: number;
  publishedAt: string;
  cleanupWarnings: string[];
  cancelledQueuedCount: number;
  cancelledRunningCount: number;
}

export interface WikiManifest {
  revisionId: string;
  generatedAt: string;
  pages: ManifestPage[];
}

export interface SearchDocument {
  pageKey: string;
  title: string;
  goal: string;
  bodyMarkdown: string;
  facts: string[];
  sourceIds: string[];
  score: number;
}

export interface SearchResult {
  query: string;
  items: SearchDocument[];
}

function pathId(value: string): string {
  return encodeURIComponent(value);
}

export const llmWikiNextApi = {
  uploadSource: (file: File) => {
    const data = new FormData();
    data.append("file", file);
    return http.postForm<SourceRecord>(`${ROOT}/sources/upload`, data);
  },
  listSources: () => http.get<{ items: SourceRecord[] }>(`${ROOT}/sources`),
  getSource: (sourceId: string) =>
    http.get<SourceSnapshot>(`${ROOT}/sources/${pathId(sourceId)}`),
  deleteSources: (sourceIds: string[]) =>
    http.post<DeleteSourcesResult>(`${ROOT}/sources/delete`, { sourceIds }),
  estimateCompile: (request: CompileRequest) =>
    http.post<CompileEstimate>(`${ROOT}/compile/estimate`, request),
  compile: (request: CompileRequest) =>
    http.post<CompilePool>(`${ROOT}/compile`, request),
  getCompilePool: async () => {
    const value = await http.get<CompilePool | Record<string, never>>(
      `${ROOT}/compile`,
    );
    return "poolId" in value ? (value as CompilePool) : null;
  },
  cancelCompilePool: () =>
    http.post<CompilePoolCancelResult>(`${ROOT}/compile/cancel`),
  getStaging: async () => {
    // Nest 的全局响应层会把 controller 返回的 null 转为 {}，统一还原为空 Staging。
    const value = await http.get<StagingSummary | Record<string, never>>(
      `${ROOT}/staging`,
    );
    return "state" in value ? (value as StagingSummary) : null;
  },
  getStagingPage: (pageKey: string) =>
    http.get<WikiPageDetail>(`${ROOT}/staging/pages/${pathId(pageKey)}`),
  publishStaging: () => http.post<PublishResult>(`${ROOT}/staging/publish`),
  discardStaging: () =>
    http.post<{ discarded: true }>(`${ROOT}/staging/discard`),
  getPublishedManifest: () => http.get<WikiManifest>(`${ROOT}/wiki/manifest`),
  getPublishedPage: (pageKey: string) =>
    http.get<WikiPageDetail>(`${ROOT}/wiki/pages/${pathId(pageKey)}`),
  searchPublished: (query: string, limit = 20) =>
    http.get<SearchResult>(`${ROOT}/wiki/search`, { q: query, limit }),
};
