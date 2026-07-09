import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { llmWikiConfig } from "../llm-wiki.config";
import { LlmWikiIssueService } from "./llm-wiki-issue.service";
import { LlmWikiLintService } from "./llm-wiki-lint.service";
import { LlmWikiStoreService } from "./llm-wiki-store.service";

const sourceId = "a".repeat(32);

test("lint keeps current dead links open and resolves them after they disappear", () => {
  withTempLint(({ store, issues, lint }) => {
    store.savePage("concepts/a.md", page("A", "[[concepts/missing.md]]"));
    store.savePageClaims(claims("concepts/a.md"));

    lint.run("structural");
    let open = issues.list("open").items;
    const deadLink = open.find((issue) => issue.kind === "dead_link");
    assert.ok(deadLink);
    assert.equal(deadLink.target, "concepts/a.md");

    store.savePage("concepts/a.md", page("A", "No links."));
    store.savePageClaims(claims("concepts/a.md"));
    lint.run("structural");

    open = issues.list("open").items;
    assert.equal(open.some((issue) => issue.id === deadLink.id), false);
    assert.equal(issues.list("resolved").items.some((issue) => issue.id === deadLink.id), true);
  });
});

test("lint reopens a resolved issue when the problem appears again", () => {
  withTempLint(({ store, issues, lint }) => {
    store.savePage("concepts/a.md", page("A", "[[concepts/missing.md]]"));
    store.savePageClaims(claims("concepts/a.md"));

    lint.run("structural");
    const first = issues.list("open").items.find((issue) => issue.kind === "dead_link");
    assert.ok(first);
    issues.resolve(first.id);
    assert.equal(issues.list("open").items.some((issue) => issue.id === first.id), false);

    lint.run("structural");

    assert.equal(issues.list("open").items.some((issue) => issue.id === first.id), true);
    assert.equal(issues.list("resolved").items.some((issue) => issue.id === first.id), false);
  });
});

test("lint does not auto-resolve issue kinds it did not check", () => {
  withTempLint(({ store, issues, lint }) => {
    store.savePage("concepts/a.md", page("A", "No links."));
    store.savePageClaims(claims("concepts/a.md"));
    const [weak] = issues.upsertMany([
      {
        kind: "weak_evidence",
        severity: "warning",
        target: "concepts/a.md",
        message: "页面融合模型失败，已使用待复核合并结果",
      },
    ]);

    lint.run("structural");

    assert.equal(issues.list("open").items.some((issue) => issue.id === weak.id), true);
    assert.equal(issues.list("resolved").items.some((issue) => issue.id === weak.id), false);
  });
});

test("lint does not report orphan pages as actionable structural issues", () => {
  withTempLint(({ store, issues, lint }) => {
    store.savePage(`summaries/${sourceId}.md`, page("Summary", "Summary only."));
    store.savePage("concepts/a.md", page("A", "Important concept."));
    store.savePageClaims(claims(`summaries/${sourceId}.md`));
    store.savePageClaims(claims("concepts/a.md"));

    lint.run("structural");

    const open = issues.list("open").items;
    assert.equal(open.some((issue) => issue.kind === "orphan_page" && issue.target === `summaries/${sourceId}.md`), false);
    assert.equal(open.some((issue) => issue.kind === "orphan_page" && issue.target === "concepts/a.md"), false);
  });
});

function withTempLint(
  fn: (ctx: {
    store: LlmWikiStoreService;
    issues: LlmWikiIssueService;
    lint: LlmWikiLintService;
  }) => void,
): void {
  const previousRoot = llmWikiConfig.root;
  const root = mkdtempSync(path.join(tmpdir(), "llm-wiki-lint-"));
  llmWikiConfig.root = root;
  try {
    const store = new LlmWikiStoreService();
    store.onModuleInit();
    const issues = new LlmWikiIssueService();
    issues.onModuleInit();
    const lint = new LlmWikiLintService(store, issues);
    fn({ store, issues, lint });
  } finally {
    llmWikiConfig.root = previousRoot;
    rmSync(root, { recursive: true, force: true });
  }
}

function page(title: string, body: string): string {
  return `---\ntitle: ${title}\ntype: concept\ntags: []\nsources:\n  - ${sourceId}\nschema_hash: schema\n---\n# ${title}\n\n${body}\n`;
}

function claims(pagePath: string) {
  return {
    path: pagePath,
    factIds: ["fact-a"],
    sourceIds: [sourceId],
    claims: [
      {
        claimId: "b".repeat(32),
        path: pagePath,
        text: "A fact",
        sourceId,
      },
    ],
  };
}
