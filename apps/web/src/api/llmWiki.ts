import { http } from "./http";

export type LlmWikiSourceStatus = "uploaded" | "ingesting" | "ready" | "failed";
export type LlmWikiPageType = "index" | "summary" | "concept" | "entity";

export interface LlmWikiSource {
  source_id: string;
  filename: string;
  ext: ".md" | ".txt";
  size: number;
  sha256: string;
  schema_hash: string;
  status: LlmWikiSourceStatus;
  uploaded_at: string;
  ingested_at: string;
  error: string;
  touched_pages: string[];
}

export interface LlmWikiStats {
  total: number;
  uploaded: number;
  ingesting: number;
  ready: number;
  failed: number;
  page_count: number;
}

export interface LlmWikiPageRef {
  path: string;
  title: string;
  type: LlmWikiPageType;
  tags: string[];
  sources: string[];
  schema_hash: string;
  updated_at: string;
}

export interface LlmWikiPage extends LlmWikiPageRef {
  content: string;
  links?: string[];
}

export interface LlmWikiTreeGroup {
  group: string;
  pages: LlmWikiPageRef[];
}

export interface LlmWikiTree {
  groups: LlmWikiTreeGroup[];
}

export interface LlmWikiSearchHit {
  path: string;
  title: string;
  type: LlmWikiPageType;
  tags: string[];
  sources: string[];
  snippet: string;
  score: number;
}

export interface LlmWikiSchema {
  content: string;
  sha256: string;
  updated_at: string;
}

export interface LlmWikiManifest {
  stats: {
    sourceCount: number;
    readySources: number;
    pageCount: number;
  };
  schema: LlmWikiSchema;
  index: string;
  pages: LlmWikiPageRef[];
  sources: Array<Pick<LlmWikiSource, "source_id" | "filename" | "status" | "touched_pages">>;
}

export type LlmWikiLintMode = "structural" | "evidence" | "all";

export interface LlmWikiIssue {
  id: string;
  kind: string;
  severity: "info" | "warning" | "error";
  status: "open" | "resolved";
  target: string;
  message: string;
  details: string;
  source_ids: string[];
  created_at: string;
  updated_at: string;
}

export const llmWikiApi = {
  overview: (silent = false) =>
    http.get<{ stats: LlmWikiStats; recent: LlmWikiSource[] }>(
      "/api/llm-wiki/manage/overview",
      undefined,
      silent ? { silent: true } : undefined,
    ),
  listSources: (silent = false) =>
    http.get<{ items: LlmWikiSource[]; stats: LlmWikiStats }>(
      "/api/llm-wiki/manage/sources",
      undefined,
      silent ? { silent: true } : undefined,
    ),
  uploadSource: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return http.postForm<LlmWikiSource>("/api/llm-wiki/manage/sources/upload", form);
  },
  schema: () => http.get<LlmWikiSchema>("/api/llm-wiki/manage/schema"),
  saveSchema: (content: string) =>
    http.post<LlmWikiSchema>("/api/llm-wiki/manage/schema/save", { content }),
  ingestSource: (sourceId: string) =>
    http.post<LlmWikiSource>(
      `/api/llm-wiki/manage/sources/${encodeURIComponent(sourceId)}/ingest`,
    ),
  renameSource: (sourceId: string, filename: string) =>
    http.post<LlmWikiSource>(
      `/api/llm-wiki/manage/sources/${encodeURIComponent(sourceId)}/rename`,
      { filename },
    ),
  deleteSource: (sourceId: string) =>
    http.post<{ ok: boolean; source_id: string }>(
      `/api/llm-wiki/manage/sources/${encodeURIComponent(sourceId)}/delete`,
    ),
  rawSource: (sourceId: string) =>
    http.get<{ source_id: string; filename: string; content: string }>(
      `/api/llm-wiki/retrieval/source/${encodeURIComponent(sourceId)}`,
    ),
  manifest: () => http.get<LlmWikiManifest>("/api/llm-wiki/retrieval/manifest"),
  tree: async (): Promise<LlmWikiTree> => {
    const manifest = await http.get<LlmWikiManifest>("/api/llm-wiki/retrieval/manifest");
    const groups = [
      { group: "Root", pages: manifest.pages.filter((page) => page.path === "index.md") },
      { group: "Summaries", pages: manifest.pages.filter((page) => page.path.startsWith("summaries/")) },
      { group: "Concepts", pages: manifest.pages.filter((page) => page.path.startsWith("concepts/")) },
      { group: "Entities", pages: manifest.pages.filter((page) => page.path.startsWith("entities/")) },
    ].filter((group) => group.pages.length > 0);
    return { groups };
  },
  page: (path: string) =>
    http.get<LlmWikiPage>("/api/llm-wiki/retrieval/page", { path }),
  savePage: (path: string, content: string) =>
    http.post<LlmWikiPage>("/api/llm-wiki/manage/pages/save", { path, content }),
  deletePage: (path: string) =>
    http.post<{ ok: boolean; path: string }>("/api/llm-wiki/manage/pages/delete", { path }),
  search: (q: string, limit = 20) =>
    http.get<{ query: string; hits: LlmWikiSearchHit[]; returned: number }>(
      "/api/llm-wiki/retrieval/search",
      { q, limit },
    ),
  lint: (mode: LlmWikiLintMode = "all") =>
    http.post<{ issues: LlmWikiIssue[]; total: number }>("/api/llm-wiki/manage/lint", { mode }),
  issues: (status: "open" | "resolved" | "all" = "open") =>
    http.get<{ items: LlmWikiIssue[] }>("/api/llm-wiki/manage/issues", { status }),
  resolveIssue: (issueId: string) =>
    http.post<LlmWikiIssue>(`/api/llm-wiki/manage/issues/${encodeURIComponent(issueId)}/resolve`),
};
