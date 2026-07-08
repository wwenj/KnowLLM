import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { LlmWikiCompileCandidate, LlmWikiCompilePlan } from "../contracts/llm-wiki.types";
import { llmWikiConfig } from "../llm-wiki.config";
import { LlmWikiStoreService } from "./llm-wiki-store.service";

test("publishing a candidate writes wiki pages, claims, receipt, and published source state", () => {
  withTempWiki((store) => {
    const source = store.createSource("source.md", Buffer.from("# Source\n\nM112 triggers emergency stop\n"));
    const candidate = candidateFor(source.source_id);

    store.saveCompileCandidate(candidate);
    const receipt = store.publishCandidate(candidate.candidateId);

    const updated = store.getSource(source.source_id);
    const page = store.getPage(`summaries/${source.source_id}.md`);
    const claims = store.readPageClaims(page.path);
    const savedCandidate = store.readCompileCandidate(candidate.candidateId);

    assert.equal(updated.status, "published");
    assert.equal(updated.latest_candidate_id, candidate.candidateId);
    assert.equal(receipt.publishedPages.includes(page.path), true);
    assert.equal(page.content.includes("# Source Summary"), true);
    assert.equal(claims?.claims?.length, 1);
    assert.equal(savedCandidate.status, "published");
    assert.equal(store.pageExists("index.md"), true);
  });
});

test("deleting a source marks affected pages stale without deleting published wiki pages", () => {
  withTempWiki((store) => {
    const source = store.createSource("source.md", Buffer.from("# Source\n\nM112 triggers emergency stop\n"));
    const candidate = candidateFor(source.source_id);
    store.saveCompileCandidate(candidate);
    store.publishCandidate(candidate.candidateId);

    const result = store.deleteSourceCascade(source.source_id);

    assert.equal(store.pageExists(`summaries/${source.source_id}.md`), true);
    assert.equal(result.touched_pages.includes(`summaries/${source.source_id}.md`), true);
    assert.equal(store.listStaleMarkers(source.source_id).some((marker) => marker.reason === "source_deleted"), true);
  });
});

function withTempWiki(fn: (store: LlmWikiStoreService) => void): void {
  const previousRoot = llmWikiConfig.root;
  const root = mkdtempSync(path.join(tmpdir(), "llm-wiki-store-"));
  llmWikiConfig.root = root;
  try {
    const store = new LlmWikiStoreService();
    store.onModuleInit();
    fn(store);
  } finally {
    llmWikiConfig.root = previousRoot;
    rmSync(root, { recursive: true, force: true });
  }
}

function candidateFor(sourceId: string): LlmWikiCompileCandidate {
  const plan = planFor(sourceId);
  return {
    candidateId: "d".repeat(32),
    sourceId,
    plan,
    status: "candidate_ready",
    model: "provider:model",
    schemaHash: "schema",
    compilerVersion: "source-integration-v1",
    promptVersion: "integration-patch-v1",
    sourceHash: "source-hash",
    sourceTitle: "Source",
    pages: [
      {
        path: `summaries/${sourceId}.md`,
        title: "Source Summary",
        type: "summary",
        tags: ["summary"],
        body: "# Source Summary\n\n`M112` triggers emergency stop.",
        sourceIds: [sourceId],
        action: "create",
      },
    ],
    claims: [
      {
        claimId: "e".repeat(32),
        path: `summaries/${sourceId}.md`,
        text: "M112 triggers emergency stop",
        sourceId,
      },
    ],
    affectedPages: [`summaries/${sourceId}.md`],
    issues: [],
    modelUsage: { modelCalls: 1, inputTokens: 100, outputTokens: 50, estimatedCostUsd: 0.001 },
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
  };
}

function planFor(sourceId: string): LlmWikiCompilePlan {
  return {
    planId: "plan",
    sourceIds: [sourceId],
    hash: "plan-hash",
    schemaHash: "schema",
    compilerVersion: "source-integration-v1",
    promptVersion: "integration-patch-v1",
    estimatedInputTokens: 100,
    estimatedOutputTokens: 50,
    estimatedCostUsd: 0.001,
    maxModelCalls: 1,
    affectedPageCandidates: [`summaries/${sourceId}.md`],
    requiresDigest: false,
    blocked: false,
    reason: "",
    createdAt: "2026-07-08T00:00:00.000Z",
  };
}
