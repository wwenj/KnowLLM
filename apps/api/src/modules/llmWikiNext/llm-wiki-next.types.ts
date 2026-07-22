export type SourceCompileStatus =
  | "pending"
  | "planning"
  | "writing"
  | "completed"
  | "failed"
  | "cancelled";

export type CompileJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "cancelled"
  | "failed";

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

export interface NormalizedCompileOptions {
  sourceIds: string[];
  model: string;
  sourceConcurrency: number;
  chunkChars: number;
  plannerMaxOutputTokens: number;
  writerMaxOutputTokens: number;
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
  stagingGeneration: string;
  options: NormalizedCompileOptions;
  confirmHash: string;
}

export interface CompileSourceState {
  sourceId: string;
  status: SourceCompileStatus;
  compileUnitCount: number;
  plannerCalls: number;
  writerCalls: number;
  pageKeys: string[];
  error: string;
  startedAt: string;
  finishedAt: string;
}

export interface CompileJob {
  jobId: string;
  status: CompileJobStatus;
  options: NormalizedCompileOptions;
  estimate: CompileEstimate;
  sources: CompileSourceState[];
  modelCalls: number;
  writeToken: string;
  error: string;
  createdAt: string;
  startedAt: string;
  finishedAt: string;
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
  activeJob: CompileJob | null;
}

export interface PublishResult {
  revisionId: string;
  pageCount: number;
  factCount: number;
  publishedAt: string;
  cleanupWarnings: string[];
}
