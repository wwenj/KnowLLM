import * as path from "node:path";
import { getDataRoot } from "../../config/data-root";

export const llmWikiConfig = {
  root: path.join(getDataRoot(), "llm-wiki", "default"),
  maxUploadBytes: 10 * 1024 * 1024,
  maxSourceChars: 120_000,
  maxWikiFileBytes: 1024 * 1024,
  maxSearchResults: 20,
  ingestConcurrency: positiveInt(process.env.LLM_WIKI_INGEST_CONCURRENCY, 1),
  compilerVersion: "fact-page-v3",
  promptVersion: "fact-page-v3",
  // The request ceiling is for source + prompt + schema, not source text alone.
  // It deliberately leaves room for the audit's compact fact list.
  maxAnalyzeInputTokens: positiveInt(process.env.LLM_WIKI_MAX_ANALYZE_INPUT_TOKENS, 8_000),
  chunkTargetChars: positiveInt(process.env.LLM_WIKI_CHUNK_TARGET_CHARS, 12_000),
  chunkOverlapChars: positiveInt(process.env.LLM_WIKI_CHUNK_OVERLAP_CHARS, 1_200),
  chunkOverlapTokens: positiveInt(process.env.LLM_WIKI_CHUNK_OVERLAP_TOKENS, 300),
  maxFactsPerPage: positiveInt(process.env.LLM_WIKI_MAX_FACTS_PER_PAGE, 80),
  maxPageFactInputTokens: positiveInt(process.env.LLM_WIKI_MAX_PAGE_FACT_INPUT_TOKENS, 4_000),
  maxPageSourceSpanChars: positiveInt(process.env.LLM_WIKI_MAX_PAGE_SOURCE_SPAN_CHARS, 12_000),
  maxComposeInputTokens: positiveInt(process.env.LLM_WIKI_MAX_COMPOSE_INPUT_TOKENS, 12_000),
  extractOutputTokens: positiveInt(process.env.LLM_WIKI_EXTRACT_OUTPUT_TOKENS, 8_000),
  auditOutputTokens: positiveInt(process.env.LLM_WIKI_AUDIT_OUTPUT_TOKENS, 6_000),
  maxAffectedPages: positiveInt(process.env.LLM_WIKI_MAX_AFFECTED_PAGES, 32),
  maxOutputTokensPerCall: positiveInt(process.env.LLM_WIKI_MAX_OUTPUT_TOKENS_PER_CALL, 8_000),
  // Some compatible gateways report a small amount of internal/reasoning usage
  // above the requested completion cap. Keep the declared hard cap strict.
  providerOutputUsageMarginTokens: positiveInt(process.env.LLM_WIKI_OUTPUT_USAGE_MARGIN_TOKENS, 512),
  modelCallTimeoutMs: positiveInt(process.env.LLM_WIKI_MODEL_CALL_TIMEOUT_MS, 90_000),
  maxFactTextChars: positiveInt(process.env.LLM_WIKI_MAX_FACT_TEXT_CHARS, 600),
  maxFactEvidenceChars: positiveInt(process.env.LLM_WIKI_MAX_FACT_EVIDENCE_CHARS, 1_200),
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
