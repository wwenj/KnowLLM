export type SourceStatus = "uploaded" | "parsed" | "compiling" | "ready" | "failed";

export type WikiPageType = "index" | "summary" | "concept" | "entity" | "comparison" | "manual";

export interface ApiHealthResponse {
  ok: boolean;
  service: string;
}

export interface WorkspaceOverview {
  workspaceId: string;
  sourceCount: number;
  wikiPageCount: number;
  openIssueCount: number;
  lastUpdatedAt: string | null;
}

export interface QuerySnippet {
  path: string;
  title: string;
  type: WikiPageType;
  content: string;
  sources: string[];
}
