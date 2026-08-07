import { http } from "./http";

const ROOT = "/api/llm-wiki-next";

export interface KnowledgeBase {
  id: string;
  name: string;
}

export type SourceStatus =
  | "pending"
  | "compiling"
  | "staged"
  | "published"
  | "failed";

export type CompilePoolPhase =
  | "queued"
  | "planning"
  | "writing"
  | "committing"
  | "finished";

export interface SourceRecord {
  sourceId: string;
  filename: string;
  contentHash: string;
  charCount: number;
  lineCount: number;
  createdAt: string;
  status: SourceStatus;
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
  runId: string;
  sourceId: string;
  contentHash: string;
  phase: CompilePoolPhase;
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

export type CompileReportStage = CompilePoolPhase;

export type CompileReportCallStage = "planner" | "writer";

export type CompileReportCallStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface CompileDebugText {
  text: string;
  charCount: number;
  contentHash: string;
  truncated: boolean;
}

export interface CompileReportError {
  stage: string;
  category: string;
  message: string;
}

export interface CompileReportEvent {
  sequence: number;
  at: string;
  type: string;
  message: string;
  unitId?: string;
  callId?: string;
}

export interface CompileReportUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageSource: "provider" | "estimated";
}

export interface CompileReportCall {
  callId: string;
  stage: CompileReportCallStage;
  unitId: string;
  status: CompileReportCallStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  maxOutputTokens: number;
  model: string;
  responseId: string;
  responseModel: string;
  finishReason: string;
  usage: CompileReportUsage;
  request: { systemPrompt: CompileDebugText; payload: CompileDebugText };
  response: CompileDebugText | null;
  error: CompileReportError | null;
  validation: {
    status: "pending" | "succeeded" | "failed";
    error: CompileReportError | null;
  };
}

export interface WikiPagePlanItem {
  pageKey: string;
  operation: "create" | "update";
  title: string;
  goal: string;
  scope: string;
  outline: Array<{
    heading: string;
    writingPoints: string[];
    sourceAnchors: string[];
  }>;
  relatedPageKeys: string[];
}

export interface WikiPagePlan {
  sourceId: string;
  unitId: string;
  partitionIntent: string;
  pages: WikiPagePlanItem[];
}

export interface CompileReportUnit {
  unitId: string;
  index: number;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  charCount: number;
  contentHash: string;
  maxPages: number;
  reservedPageKeys: string[];
  plannerCallId: string;
  writerCallId: string;
  plan: WikiPagePlan | null;
  writerPages: Array<{
    pageKey: string;
    bodyCharCount: number;
    bodyHash: string;
    keyFacts: KeyFact[];
  }>;
  error: CompileReportError | null;
}

export interface SourceCompileReport {
  version: 1 | 2;
  legacy: boolean;
  runId: string;
  poolId: string;
  workspaceId: string;
  sourceId: string;
  contentHash: string;
  stage: CompileReportStage;
  model: { id: string; name: string; provider: string; providerName: string };
  options: CompileExecutionOptions;
  compiler: {
    promptVersion: string;
    pageLimitPolicyVersion: string;
    modelTimeoutMs: number;
    maxFactsPerPlan: number;
  };
  queuedAt: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  updatedAt: string;
  events: CompileReportEvent[];
  units: CompileReportUnit[];
  calls: CompileReportCall[];
  summary: {
    compileUnitCount: number;
    modelCalls: number;
    succeededCalls: number;
    failedCalls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    pageKeys: string[];
    factCount: number;
  };
  error: CompileReportError | null;
}

export interface SourceCompileDetailResponse {
  source: SourceRecord;
  report: SourceCompileReport | null;
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
  factCount?: number;
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

export interface DeletePublishedPageResult {
  revisionId: string;
  publishedAt: string;
  deletedPageKey: string;
  deletedFactCount: number;
  affectedPageKeys: string[];
  pageCount: number;
  factCount: number;
  stagingRetainsPage: boolean;
  cleanupWarnings: string[];
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

export interface ToolsPageSummary {
  pageKey: string;
  title: string;
  goal: string;
  sourceIds: string[];
  factCount: number;
}

export interface ToolsCatalogPage extends ToolsPageSummary {
  relatedPageKeys: string[];
}

export interface ToolsSourceSummary {
  sourceId: string;
  filename: string;
  contentHash: string;
  charCount: number;
  lineCount: number;
  pageKeys: string[];
}

export interface ToolsCatalog {
  stats: {
    pageCount: number;
    factCount: number;
    sourceCount: number;
  };
  pages: ToolsCatalogPage[];
  sources: ToolsSourceSummary[];
}

export interface ToolsPageDetail {
  page: ToolsCatalogPage & {
    bodyMarkdown: string;
    keyFacts: KeyFact[];
  };
  relations: {
    outgoing: ToolsPageSummary[];
    incoming: ToolsPageSummary[];
    sameSource: ToolsPageSummary[];
  };
  sources: ToolsSourceSummary[];
}

export interface ToolsSourceDetail {
  source: ToolsSourceSummary;
  range: {
    startLine: number;
    endLine: number;
    totalLines: number;
    hasMore: boolean;
    nextStartLine: number | null;
  };
  content: string;
  pages: ToolsPageSummary[];
  factRefs: Array<{
    pageKey: string;
    fact: string;
    sourceLine: number;
  }>;
}

export type ToolsSearchMatchedField = "title" | "goal" | "fact" | "body";

export interface ToolsSearchItem extends ToolsPageSummary {
  score: number;
  matchedFields: ToolsSearchMatchedField[];
  matchedFacts: string[];
  snippet: string;
}

export interface ToolsSearchResult {
  query: string;
  items: ToolsSearchItem[];
}

function pathId(value: string): string {
  return encodeURIComponent(value);
}

function workspaceRoot(knowledgeBaseId: string): string {
  return `${ROOT}/knowledge-bases/${pathId(knowledgeBaseId)}`;
}

export const llmWikiNextApi = {
  listKnowledgeBases: () => http.get<{ items: KnowledgeBase[] }>(`${ROOT}/knowledge-bases`),
  createKnowledgeBase: (name: string) => http.post<KnowledgeBase>(`${ROOT}/knowledge-bases`, { name }),
  renameKnowledgeBase: (knowledgeBaseId: string, name: string) =>
    http.post<KnowledgeBase>(`${workspaceRoot(knowledgeBaseId)}/rename`, { name }),
  deleteKnowledgeBase: (knowledgeBaseId: string) =>
    http.delete<KnowledgeBase>(workspaceRoot(knowledgeBaseId)),
  uploadSource: (knowledgeBaseId: string, file: File) => {
    const data = new FormData();
    data.append("file", file);
    return http.postForm<SourceRecord>(`${workspaceRoot(knowledgeBaseId)}/sources/upload`, data);
  },
  listSources: (knowledgeBaseId: string) => http.get<{ items: SourceRecord[] }>(`${workspaceRoot(knowledgeBaseId)}/sources`),
  getSource: (knowledgeBaseId: string, sourceId: string) =>
    http.get<SourceSnapshot>(`${workspaceRoot(knowledgeBaseId)}/sources/${pathId(sourceId)}`),
  getSourceCompileDetail: (knowledgeBaseId: string, sourceId: string) =>
    http.get<SourceCompileDetailResponse>(
      `${workspaceRoot(knowledgeBaseId)}/sources/${pathId(sourceId)}/compile-detail`,
    ),
  deleteSources: (knowledgeBaseId: string, sourceIds: string[]) =>
    http.post<DeleteSourcesResult>(`${workspaceRoot(knowledgeBaseId)}/sources/delete`, { sourceIds }),
  estimateCompile: (knowledgeBaseId: string, request: CompileRequest) =>
    http.post<CompileEstimate>(`${workspaceRoot(knowledgeBaseId)}/compile/estimate`, request),
  compile: (knowledgeBaseId: string, request: CompileRequest) =>
    http.post<CompilePool>(`${workspaceRoot(knowledgeBaseId)}/compile`, request),
  getCompilePool: async (knowledgeBaseId: string) => {
    const value = await http.get<CompilePool | Record<string, never>>(
      `${workspaceRoot(knowledgeBaseId)}/compile`,
    );
    return "poolId" in value ? (value as CompilePool) : null;
  },
  cancelCompilePool: (knowledgeBaseId: string) =>
    http.post<CompilePoolCancelResult>(`${workspaceRoot(knowledgeBaseId)}/compile/cancel`),
  getStaging: async (knowledgeBaseId: string) => {
    // Nest 的全局响应层会把 controller 返回的 null 转为 {}，统一还原为空 Staging。
    const value = await http.get<StagingSummary | Record<string, never>>(
      `${workspaceRoot(knowledgeBaseId)}/staging`,
    );
    return "state" in value ? (value as StagingSummary) : null;
  },
  getStagingPage: (knowledgeBaseId: string, pageKey: string) =>
    http.get<WikiPageDetail>(`${workspaceRoot(knowledgeBaseId)}/staging/pages/${pathId(pageKey)}`),
  publishStaging: (knowledgeBaseId: string) => http.post<PublishResult>(`${workspaceRoot(knowledgeBaseId)}/staging/publish`),
  discardStaging: (knowledgeBaseId: string) =>
    http.post<{ discarded: true }>(`${workspaceRoot(knowledgeBaseId)}/staging/discard`),
  getPublishedManifest: (knowledgeBaseId: string) => http.get<WikiManifest>(`${workspaceRoot(knowledgeBaseId)}/wiki/manifest`),
  getPublishedPage: (knowledgeBaseId: string, pageKey: string) =>
    http.get<WikiPageDetail>(`${workspaceRoot(knowledgeBaseId)}/wiki/pages/${pathId(pageKey)}`),
  deletePublishedPage: (knowledgeBaseId: string, pageKey: string, revisionId: string) =>
    http.delete<DeletePublishedPageResult>(
      `${workspaceRoot(knowledgeBaseId)}/wiki/pages/${pathId(pageKey)}`,
      { params: { revisionId } },
    ),
  searchPublished: (knowledgeBaseId: string, query: string, limit = 20) =>
    http.get<SearchResult>(`${workspaceRoot(knowledgeBaseId)}/wiki/search`, { q: query, limit }),
  getToolsCatalog: (knowledgeBaseId: string) =>
    http.get<ToolsCatalog>(`${workspaceRoot(knowledgeBaseId)}/tools/catalog`, undefined, {
      silent: true,
    }),
  readToolsPage: (knowledgeBaseId: string, pageKey: string) =>
    http.get<ToolsPageDetail>(
      `${workspaceRoot(knowledgeBaseId)}/tools/pages/${pathId(pageKey)}`,
      undefined,
      { silent: true },
    ),
  readToolsSource: (knowledgeBaseId: string, sourceId: string, startLine?: number, endLine?: number) =>
    http.get<ToolsSourceDetail>(
      `${workspaceRoot(knowledgeBaseId)}/tools/sources/${pathId(sourceId)}`,
      { startLine, endLine },
      { silent: true },
    ),
  searchToolsWiki: (knowledgeBaseId: string, query: string) =>
    http.get<ToolsSearchResult>(
      `${workspaceRoot(knowledgeBaseId)}/tools/search`,
      { q: query },
      { silent: true },
    ),
};
