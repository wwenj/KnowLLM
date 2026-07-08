import * as path from "node:path";
import { getDataRoot } from "../../config/data-root";

export const llmWikiConfig = {
  root: path.join(getDataRoot(), "llm-wiki", "default"),
  maxUploadBytes: 10 * 1024 * 1024,
  maxSourceChars: 120_000,
  maxWikiFileBytes: 1024 * 1024,
  maxSearchResults: 20,
  ingestConcurrency: positiveInt(process.env.LLM_WIKI_INGEST_CONCURRENCY, 1),
  compilerVersion: "source-integration-v1",
  promptVersion: "integration-patch-v1",
  maxCompileSourceChars: positiveInt(process.env.LLM_WIKI_MAX_COMPILE_SOURCE_CHARS, 80_000),
  maxDigestSourceChars: positiveInt(process.env.LLM_WIKI_MAX_DIGEST_SOURCE_CHARS, 200_000),
  maxAffectedPages: positiveInt(process.env.LLM_WIKI_MAX_AFFECTED_PAGES, 6),
  defaultMaxModelCalls: positiveInt(process.env.LLM_WIKI_MAX_MODEL_CALLS, 1),
  digestMaxModelCalls: positiveInt(process.env.LLM_WIKI_DIGEST_MAX_MODEL_CALLS, 2),
  tokenPriceInputPerMillion: positiveNumber(process.env.LLM_WIKI_INPUT_PRICE_PER_MTOK, 5),
  tokenPriceOutputPerMillion: positiveNumber(process.env.LLM_WIKI_OUTPUT_PRICE_PER_MTOK, 30),
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

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
