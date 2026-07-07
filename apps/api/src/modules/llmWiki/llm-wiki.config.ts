import * as path from "node:path";
import { getDataRoot } from "../../config/data-root";

export const llmWikiConfig = {
  root: path.join(getDataRoot(), "llm-wiki", "default"),
  maxUploadBytes: 10 * 1024 * 1024,
  maxSourceChars: 120_000,
  maxWikiFileBytes: 1024 * 1024,
  maxSearchResults: 20,
  ingestConcurrency: positiveInt(process.env.LLM_WIKI_INGEST_CONCURRENCY, 2),
  model:
    process.env.LLM_WIKI_MODEL ||
    process.env.KNOWLEDGE_MODEL ||
    process.env.MODEL ||
    process.env.OPENAI_MODEL ||
    ""
};

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
