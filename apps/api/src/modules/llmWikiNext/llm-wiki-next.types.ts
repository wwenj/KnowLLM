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

export interface CompileUnit {
  unitId: string;
  sourceId: string;
  content: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  contentHash: string;
}

export interface CompileRequest {
  sourceIds: string[];
  model: string;
  sourceConcurrency?: number;
  chunkChars?: number;
  plannerMaxOutputTokens?: number;
  writerMaxOutputTokens?: number;
  confirmHash?: string;
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

export interface CompileUnitEstimate {
  sourceId: string;
  unitId: string;
  charCount: number;
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
  stage:
    | "model_request"
    | "json_parse"
    | "planner_validation"
    | "writer_validation"
    | "page_lock"
    | "staging_commit"
    | "cancelled"
    | "server_restart"
    | "report_persist"
    | "source";
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
  request: {
    systemPrompt: CompileDebugText;
    payload: CompileDebugText;
  };
  response: CompileDebugText | null;
  error: CompileReportError | null;
  validation: {
    status: "pending" | "succeeded" | "failed";
    error: CompileReportError | null;
  };
}

export interface CompileReportWriterPage {
  pageKey: string;
  bodyCharCount: number;
  bodyHash: string;
  keyFacts: KeyFact[];
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
  writerPages: CompileReportWriterPage[];
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
  model: {
    id: string;
    name: string;
    provider: string;
    providerName: string;
  };
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

export interface KeyFact {
  fact: string;
  sourceId: string;
  sourceLine: number | null;
}

export interface MultiPageWriterPageOutput {
  pageKey: string;
  bodyMarkdown: string;
  keyFacts: KeyFact[];
}

export interface MultiPageWriterOutput {
  pages: MultiPageWriterPageOutput[];
}

export interface ManifestPage {
  pageKey: string;
  title: string;
  goal: string;
  relatedPageKeys: string[];
  sourceIds: string[];
}

export interface WikiManifest {
  revisionId: string;
  generatedAt: string;
  pages: ManifestPage[];
}

export interface WikiFacts {
  byPage: Record<string, KeyFact[]>;
}

export interface WikiSourceMap {
  sourceToPages: Record<string, string[]>;
  pageToSources: Record<string, string[]>;
}

export interface SearchDocument {
  pageKey: string;
  title: string;
  goal: string;
  bodyMarkdown: string;
  facts: string[];
  sourceIds: string[];
}

export interface WikiSearchIndex {
  documents: SearchDocument[];
}

export interface WikiSnapshot {
  pages: Record<string, string>;
  manifest: WikiManifest;
  facts: WikiFacts;
  sourceMap: WikiSourceMap;
  searchIndex: WikiSearchIndex;
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

export interface ToolsSourceFactRef {
  pageKey: string;
  fact: string;
  sourceLine: number;
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
  factRefs: ToolsSourceFactRef[];
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

export interface StagingState {
  workspaceId: string;
  status: "open" | "publishing";
  generation: string;
  completedSourceIds: string[];
  reservedPageKeys: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SourceOverlayPage {
  pageKey: string;
  title: string;
  goal: string;
  relatedPageKeys: string[];
  bodyMarkdown: string;
  facts: KeyFact[];
}

export interface SourceOverlay {
  sourceId: string;
  pages: SourceOverlayPage[];
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
