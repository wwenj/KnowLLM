import { Injectable, OnModuleInit } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { llmWikiConfig } from "../llm-wiki.config";
import {
  LlmWikiIssue,
  LlmWikiIssueKind,
  LlmWikiIssueSeverity,
} from "../contracts/llm-wiki.types";

export interface LlmWikiIssueInput {
  kind: LlmWikiIssueKind;
  severity?: LlmWikiIssueSeverity | "low" | "medium" | "high";
  target: string;
  message: string;
  details?: string;
  source_ids?: string[];
}

@Injectable()
export class LlmWikiIssueService implements OnModuleInit {
  onModuleInit(): void {
    this.ensureDirs();
  }

  list(status: "open" | "resolved" | "all" = "open"): { items: LlmWikiIssue[] } {
    this.ensureDirs();
    const items = [
      ...(status === "resolved" ? [] : this.readFromDir(this.openRoot())),
      ...(status === "open" ? [] : this.readFromDir(this.resolvedRoot())),
    ].sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
    return { items };
  }

  upsertMany(inputs: LlmWikiIssueInput[]): LlmWikiIssue[] {
    const issues = inputs.map((input) => this.normalizeInput(input));
    return issues.map((issue) => this.upsert(issue));
  }

  resolveMissingOpenIssues(
    kinds: LlmWikiIssueKind[],
    activeIssueIds: string[],
  ): LlmWikiIssue[] {
    this.ensureDirs();
    const kindSet = new Set(kinds);
    const activeIds = new Set(activeIssueIds);
    return this.readFromDir(this.openRoot())
      .filter((issue) => kindSet.has(issue.kind) && !activeIds.has(issue.id))
      .map((issue) => this.moveToResolved(issue));
  }

  resolve(issueId: string): LlmWikiIssue {
    this.ensureDirs();
    const id = safeIssueId(issueId);
    const file = path.join(this.openRoot(), `${id}.json`);
    const issue = readJson<LlmWikiIssue>(file);
    if (!issue) throw new Error("issue 不存在");
    return this.moveToResolved(issue);
  }

  normalizeInput(input: LlmWikiIssueInput): LlmWikiIssue {
    const now = nowIso();
    return {
      id: issueFingerprint(input),
      kind: input.kind,
      severity: normalizeSeverity(input.severity),
      status: "open",
      target: String(input.target || "wiki").trim() || "wiki",
      message: String(input.message || input.kind).trim().slice(0, 500),
      details: String(input.details || "").trim().slice(0, 4000),
      source_ids: uniqueStrings(input.source_ids || []).filter((id) => /^[a-f0-9]{32}$/.test(id)),
      created_at: now,
      updated_at: now,
    };
  }

  private upsert(issue: LlmWikiIssue): LlmWikiIssue {
    this.ensureDirs();
    const openFile = path.join(this.openRoot(), `${issue.id}.json`);
    const resolvedFile = path.join(this.resolvedRoot(), `${issue.id}.json`);
    const existing = readJson<LlmWikiIssue>(openFile) || readJson<LlmWikiIssue>(resolvedFile);
    const next: LlmWikiIssue = existing
      ? {
          ...existing,
          status: "open",
          severity: issue.severity,
          message: issue.message,
          details: issue.details,
          source_ids: issue.source_ids,
          updated_at: nowIso(),
        }
      : issue;
    fs.rmSync(resolvedFile, { force: true });
    atomicWriteJson(openFile, next);
    return next;
  }

  private readFromDir(root: string): LlmWikiIssue[] {
    if (!fs.existsSync(root)) return [];
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => readJson<LlmWikiIssue>(path.join(root, entry.name)))
      .filter((item): item is LlmWikiIssue => !!item);
  }

  private moveToResolved(issue: LlmWikiIssue): LlmWikiIssue {
    const next: LlmWikiIssue = {
      ...issue,
      status: "resolved",
      updated_at: nowIso(),
    };
    fs.rmSync(path.join(this.openRoot(), `${issue.id}.json`), { force: true });
    atomicWriteJson(path.join(this.resolvedRoot(), `${next.id}.json`), next);
    return next;
  }

  private ensureDirs(): void {
    fs.mkdirSync(this.openRoot(), { recursive: true });
    fs.mkdirSync(this.resolvedRoot(), { recursive: true });
  }

  private openRoot(): string {
    return path.join(llmWikiConfig.root, "issues", "open");
  }

  private resolvedRoot(): string {
    return path.join(llmWikiConfig.root, "issues", "resolved");
  }
}

function issueFingerprint(input: LlmWikiIssueInput): string {
  const text = [
    input.kind,
    String(input.target || "").trim(),
    String(input.message || "").trim(),
  ].join("\n");
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

function normalizeSeverity(value: LlmWikiIssueInput["severity"]): LlmWikiIssueSeverity {
  if (value === "error" || value === "high") return "error";
  if (value === "info" || value === "low") return "info";
  return "warning";
}

function safeIssueId(issueId: string): string {
  const text = String(issueId || "").trim();
  if (!/^[a-f0-9]{32}$/.test(text)) throw new Error("issue id 非法");
  return text;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function nowIso(): string {
  return new Date().toISOString();
}

function readJson<T>(file: string): T | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

function atomicWriteJson(file: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  fs.renameSync(tmp, file);
}
