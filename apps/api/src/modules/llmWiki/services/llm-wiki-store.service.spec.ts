import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

test("publish rollback leaves formal wiki and metadata unchanged after a staging write failure", () => {
  withTempWiki((store) => {
    const source = store.createSource("source.md", Buffer.from("# Source\n\nM112 triggers emergency stop\n"));
    const candidate = candidateFor(source.source_id);
    const pagePath = `summaries/${source.source_id}.md`;
    store.saveCompileCandidate(candidate);
    const mutableStore = store as unknown as { updateContribution: () => never };
    mutableStore.updateContribution = () => {
      throw new Error("injected contribution failure");
    };

    assert.throws(() => store.publishCandidate(candidate.candidateId), /injected contribution failure/);

    assert.equal(store.pageExists(pagePath), false);
    assert.equal(store.readPageClaims(pagePath), null);
    assert.equal(store.getSource(source.source_id).status, "raw_uploaded");
    assert.equal(store.readCompileCandidate(candidate.candidateId).status, "candidate_ready");
  });
});

test("analysis cache persists page plan and usage as independently inspectable artifacts", () => {
  withTempWiki((store) => {
    const source = store.createSource("source.md", Buffer.from("# Source\n\nFact one.\n"));
    store.saveAnalysisArtifact({
      sourceId: source.source_id,
      sourceHash: source.sha256,
      schemaHash: "schema",
      model: "provider:model",
      compilerVersion: "fact-page-v2",
      promptVersion: "fact-page-v2.0",
      analysisHash: "analysis-hash",
      planHash: "plan-hash",
      sourceMap: { sourceId: source.source_id, filename: source.filename, sha256: source.sha256, title: "Source", sections: [] },
      factLedger: { sourceId: source.source_id, schemaHash: "schema", model: "provider:model", generatedAt: "", facts: [] },
      pagePlan: [],
      usage: { modelCalls: 2, inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0, retries: 0, calls: [] },
      createdAt: "2026-07-13T00:00:00.000Z",
    });

    const planFile = path.join(store.root(), "meta", "page-plans", `${source.source_id}.json`);
    const usageFile = path.join(store.root(), "meta", "analysis-usage", `${source.source_id}.json`);
    assert.equal(existsSync(planFile), true);
    assert.equal(existsSync(usageFile), true);
    assert.equal(JSON.parse(readFileSync(usageFile, "utf8")).usage.modelCalls, 2);
  });
});

test("republishing atomically removes obsolete compiler-owned source pages", () => {
  withTempWiki((store) => {
    const source = store.createSource("source.md", Buffer.from("# Source\n\nFact one.\n"));
    const first = candidateFor(source.source_id);
    store.saveCompileCandidate(first);
    store.publishCandidate(first.candidateId);
    const oldPath = first.pages[0].path;
    const nextPath = `concepts/${source.source_id.slice(0, 8)}-replacement.md`;
    const second: LlmWikiCompileCandidate = {
      ...candidateFor(source.source_id),
      candidateId: "f".repeat(32),
      pages: [{ ...candidateFor(source.source_id).pages[0], path: nextPath, type: "concept" }],
      claims: [],
      pageClaims: [{ path: nextPath, factIds: [], sourceIds: [source.source_id] }],
      affectedPages: [oldPath, nextPath],
    };
    store.saveCompileCandidate(second);

    store.publishCandidate(second.candidateId);

    assert.equal(store.pageExists(oldPath), false);
    assert.equal(store.pageExists(nextPath), true);
    assert.deepEqual(store.getSource(source.source_id).touched_pages, [nextPath]);
  });
});

test("publishing blocks obsolete manual pages instead of silently deleting them", () => {
  withTempWiki((store) => {
    const source = store.createSource("source.md", Buffer.from("# Source\n\nFact one.\n"));
    const manualPath = "concepts/manual-page.md";
    store.savePage(
      manualPath,
      `---\ntitle: Manual\ntype: concept\ntags: []\nsources:\n  - ${source.source_id}\nschema_hash: schema\n---\n# Manual\n\nHuman content.\n`,
    );
    const candidate = candidateFor(source.source_id);
    store.saveCompileCandidate(candidate);

    assert.throws(() => store.publishCandidate(candidate.candidateId), /不能安全替换/);
    assert.equal(store.pageExists(manualPath), true);
    assert.equal(store.pageExists(candidate.pages[0].path), false);
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
    modelUsage: { modelCalls: 1, inputTokens: 100, outputTokens: 50, estimatedCostUsd: 0.001, retries: 0, calls: [] },
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
  };
}

function planFor(sourceId: string): LlmWikiCompilePlan {
  return {
    phase: "analyze",
    planId: "plan",
    planHash: "plan-hash",
    sourceIds: [sourceId],
    hash: "plan-hash",
    schemaHash: "schema",
    compilerVersion: "source-integration-v1",
    promptVersion: "integration-patch-v1",
    sourceHash: "source-hash",
    model: "provider:model",
    estimatedCalls: 1,
    estimatedTokens: 150,
    maxTokens: 300,
    callPlan: [{ stage: "analyze", expectedCalls: 1, maxCalls: 1 }],
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
