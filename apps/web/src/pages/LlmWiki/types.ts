import type { LlmWikiSource } from "@/api/llmWiki";

export type StatusFilter = "all" | LlmWikiSource["status"];
export type BulkAction = "ingest" | "delete" | null;

export interface RawSource {
  source_id: string;
  filename: string;
  content: string;
}
