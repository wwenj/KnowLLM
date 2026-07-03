import { Injectable } from "@nestjs/common";
import { ModelService } from "../../model/model.service";
import { llmWikiConfig } from "../llm-wiki.config";
import {
  LlmWikiDraftPage,
  LlmWikiFusionResult,
  LlmWikiIssue,
  LlmWikiIssueKind,
  LlmWikiNormalizedPage,
  LlmWikiPage,
  LlmWikiPageType,
  LlmWikiSchema,
  LlmWikiSourceMeta,
} from "../contracts/llm-wiki.types";
import { LlmWikiIssueService } from "./llm-wiki-issue.service";
import { LlmWikiSearchService } from "./llm-wiki-search.service";
import { LlmWikiStoreService } from "./llm-wiki-store.service";

interface ChatChoice {
  message?: { content?: unknown };
  text?: unknown;
}

interface ChatCompletionLike {
  choices?: ChatChoice[];
}

interface MergeOutput {
  action?: unknown;
  targetPath?: unknown;
  title?: unknown;
  type?: unknown;
  tags?: unknown;
  content?: unknown;
  sources?: unknown;
  changeSummary?: unknown;
  issues?: unknown;
}

@Injectable()
export class LlmWikiFusionService {
  constructor(
    private readonly model: ModelService,
    private readonly store: LlmWikiStoreService,
    private readonly search: LlmWikiSearchService,
    private readonly issues: LlmWikiIssueService,
  ) {}

  async mergeDraft(args: {
    schema: LlmWikiSchema;
    source: LlmWikiSourceMeta;
    sourceContent: string;
    draft: LlmWikiDraftPage;
    model: string;
  }): Promise<LlmWikiFusionResult> {
    if (args.draft.type === "summary") {
      return {
        action: "create",
        page: args.draft,
        sources: [args.source.source_id],
        change_summary: `生成 source ${args.source.source_id} 摘要`,
        issues: [],
      };
    }

    const candidates = this.resolveCandidates(args.draft);
    if (!candidates.length) {
      return {
        action: "create",
        page: args.draft,
        sources: [args.source.source_id],
        change_summary: `创建 ${args.draft.path}`,
        issues: [],
      };
    }

    try {
      const res = await this.model.chat({
        model: args.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: mergeInstructions() },
          {
            role: "user",
            content: JSON.stringify(
              {
                schema: args.schema.content,
                newSource: {
                  source_id: args.source.source_id,
                  filename: args.source.filename,
                  content: truncate(args.sourceContent, llmWikiConfig.maxSourceChars),
                },
                draftPage: args.draft,
                existingPages: candidates.map((page) => ({
                  path: page.path,
                  title: page.title,
                  type: page.type,
                  tags: page.tags,
                  sources: page.sources,
                  content: truncate(page.content, 20000),
                })),
              },
              null,
              2,
            ),
          },
        ],
      });
      return normalizeMergeOutput({
        raw: parseJsonObject(extractContent(res)),
        draft: args.draft,
        candidates,
        sourceId: args.source.source_id,
        issueService: this.issues,
      });
    } catch (err) {
      return fallbackMerge({
        draft: args.draft,
        candidates,
        sourceId: args.source.source_id,
        error: err instanceof Error ? err.message : String(err),
        issueService: this.issues,
      });
    }
  }

  private resolveCandidates(draft: LlmWikiDraftPage): LlmWikiPage[] {
    const byPath = new Map<string, LlmWikiPage>();
    const addPath = (path: string) => {
      if (byPath.size >= 3 || byPath.has(path)) return;
      try {
        const page = this.store.getPage(path);
        if (page.type === draft.type) byPath.set(page.path, page);
      } catch {
        // ignore invalid or missing candidates
      }
    };

    addPath(draft.path);
    const titleKey = normalizeTitle(draft.title);
    for (const ref of this.store.listPageRefs()) {
      if (byPath.size >= 3) break;
      if (ref.type !== draft.type || ref.path === "index.md") continue;
      if (normalizeTitle(ref.title) === titleKey) addPath(ref.path);
    }
    for (const hit of this.search.search(draft.title, 5).hits) {
      if (byPath.size >= 3) break;
      if (hit.type === draft.type) addPath(hit.path);
    }
    return [...byPath.values()];
  }
}

function mergeInstructions(): string {
  return `
你是 LLM Wiki 页面融合器。你需要把新 draft 与已有 wiki 页面合并成一个长期可维护页面。

硬性要求：
1. 只基于输入 schema、source、draftPage、existingPages，不引入外部知识。
2. 只输出 JSON，不输出 Markdown 代码块。
3. action 只能是 create/update/skip/conflict。
4. targetPath 必须来自 draftPage.path 或 existingPages.path。
5. 如果新旧信息可互补，输出 update 并保留双方仍有 source 支撑的内容。
6. 如果新旧结论冲突，输出 conflict，正文必须包含“冲突/未确认项”章节，同时 issues 至少包含一个 conflict。
7. 关键结论必须标注 source id。
8. 不要把旧页面整段丢弃，除非旧内容已无来源支撑。
`.trim();
}

function normalizeMergeOutput(args: {
  raw: MergeOutput;
  draft: LlmWikiDraftPage;
  candidates: LlmWikiPage[];
  sourceId: string;
  issueService: LlmWikiIssueService;
}): LlmWikiFusionResult {
  const action = normalizeAction(args.raw.action);
  const targetPath = normalizeTargetPath(args.raw.targetPath, args.draft, args.candidates);
  if (action === "skip") {
    return {
      action,
      page: null,
      sources: [args.sourceId],
      change_summary: stringField(args.raw.changeSummary) || `跳过 ${args.draft.path}`,
      issues: normalizeIssues(args.raw.issues, targetPath, args.sourceId, args.issueService),
    };
  }
  const type = normalizePageType(args.raw.type, args.draft.type);
  const title = stringField(args.raw.title).slice(0, 160) || args.draft.title;
  const body = ensureHeading(stringField(args.raw.content) || args.draft.body, title);
  const sources = uniqueStrings([
    ...args.candidates.flatMap((page) => page.sources),
    ...stringArray(args.raw.sources),
    args.sourceId,
  ]).filter((id) => /^[a-f0-9]{32}$/.test(id));
  const page: LlmWikiNormalizedPage = {
    path: targetPath,
    title,
    type,
    tags: uniqueStrings([...args.draft.tags, ...stringArray(args.raw.tags)]).slice(0, 20),
    body,
  };
  return {
    action,
    page,
    sources,
    change_summary: stringField(args.raw.changeSummary) || `${action} ${targetPath}`,
    issues: normalizeIssues(args.raw.issues, targetPath, args.sourceId, args.issueService),
  };
}

function fallbackMerge(args: {
  draft: LlmWikiDraftPage;
  candidates: LlmWikiPage[];
  sourceId: string;
  error: string;
  issueService: LlmWikiIssueService;
}): LlmWikiFusionResult {
  const target = args.candidates[0];
  const targetPath = target?.path || args.draft.path;
  const title = target?.title || args.draft.title;
  const body = target
    ? `${stripFrontmatter(target.content)}\n\n## 新增来源待复核\n\n${stripFrontmatter(args.draft.body)}`
    : args.draft.body;
  const page: LlmWikiNormalizedPage = {
    path: targetPath,
    title,
    type: args.draft.type,
    tags: uniqueStrings([...(target?.tags || []), ...args.draft.tags]).slice(0, 20),
    body: ensureHeading(body, title),
  };
  const issue = args.issueService.normalizeInput({
    kind: "weak_evidence",
    severity: "warning",
    target: targetPath,
    message: "页面融合模型失败，已使用待复核合并结果",
    details: args.error,
    source_ids: uniqueStrings([...(target?.sources || []), args.sourceId]),
  });
  return {
    action: "update",
    page,
    sources: uniqueStrings([...(target?.sources || []), args.sourceId]),
    change_summary: `fallback merge ${targetPath}`,
    issues: [issue],
  };
}

function normalizeIssues(
  value: unknown,
  target: string,
  sourceId: string,
  issueService: LlmWikiIssueService,
): LlmWikiIssue[] {
  const raw = Array.isArray(value) ? value : [];
  return raw
    .map((item) => {
      const input = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const kind = normalizeIssueKind(input.kind);
      if (!kind) return null;
      return issueService.normalizeInput({
        kind,
        severity: normalizeIssueSeverity(input.severity),
        target: stringField(input.target) || target,
        message: stringField(input.message) || kind,
        details: stringField(input.details),
        source_ids: uniqueStrings([...stringArray(input.source_ids), sourceId]),
      });
    })
    .filter((item): item is LlmWikiIssue => !!item);
}

function normalizeIssueKind(value: unknown): LlmWikiIssueKind | null {
  const text = String(value || "");
  const valid: LlmWikiIssueKind[] = [
    "conflict",
    "weak_evidence",
    "duplicate",
    "needs_review",
    "needs_reconcile",
  ];
  return valid.includes(text as LlmWikiIssueKind) ? (text as LlmWikiIssueKind) : null;
}

function normalizeIssueSeverity(
  value: unknown,
): "info" | "warning" | "error" | "low" | "medium" | "high" | undefined {
  return value === "info" ||
    value === "warning" ||
    value === "error" ||
    value === "low" ||
    value === "medium" ||
    value === "high"
    ? value
    : undefined;
}

function normalizeAction(value: unknown): LlmWikiFusionResult["action"] {
  return value === "create" || value === "skip" || value === "conflict" ? value : "update";
}

function normalizeTargetPath(
  value: unknown,
  draft: LlmWikiDraftPage,
  candidates: LlmWikiPage[],
): string {
  const path = stringField(value);
  if (path === draft.path || candidates.some((page) => page.path === path)) return path;
  return candidates[0]?.path || draft.path;
}

function normalizePageType(value: unknown, fallback: LlmWikiPageType): LlmWikiPageType {
  return value === "concept" || value === "entity" ? value : fallback;
}

function extractContent(res: unknown): string {
  const body = res as ChatCompletionLike;
  const content = body.choices?.[0]?.message?.content ?? body.choices?.[0]?.text;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === "string" ? part : "")).join("");
  throw new Error("模型未返回可解析内容");
}

function parseJsonObject(content: string): MergeOutput {
  const raw = String(content || "").trim();
  const candidates = [
    raw,
    raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim(),
    raw.slice(Math.max(0, raw.indexOf("{")), raw.lastIndexOf("}") + 1),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as MergeOutput)
        : {};
    } catch {
      // try next
    }
  }
  throw new Error("模型输出不是合法 JSON");
}

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function stripFrontmatter(content: string): string {
  return String(content || "").replace(/^---[\s\S]*?---\s*/m, "").trim();
}

function ensureHeading(content: string, title: string): string {
  const text = String(content || "").trim();
  return `${text.startsWith("#") ? text : `# ${title}\n\n${text || "未生成有效内容。"}`}\n`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function stringArray(value: unknown): string[] {
  const arr = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return uniqueStrings(arr.map((item) => String(item || "")));
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function truncate(text: string, limit: number): string {
  const value = String(text || "");
  return value.length <= limit ? value : `${value.slice(0, limit)}\n\n[内容已截断 ${value.length - limit} 字符]`;
}
