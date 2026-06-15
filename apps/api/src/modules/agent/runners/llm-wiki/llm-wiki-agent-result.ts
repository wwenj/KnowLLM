import type {
  KnowledgeSnippet,
  LlmWikiAgentState,
  RetrievedPage,
  SourceReview,
} from "./llm-wiki-agent.types";

export function pagesForKept(state: LlmWikiAgentState): RetrievedPage[] {
  const kept = new Set(state.keptPages.map((page) => page.path));
  return state.pages.filter((page) => kept.has(page.path));
}

export function defaultSourceReviewForPath(state: LlmWikiAgentState, path: string): SourceReview {
  return {
    path,
    sourceSupport: state.sourcePolicy === "wiki-only" ? "wiki-only" : "unknown",
    supportSummary:
      state.sourcePolicy === "wiki-only"
        ? "本次策略只读取 Wiki 页面，未核验 raw source。"
        : "未获得 reviewer 的 raw source 支持判断。",
  };
}

export function buildKnowledgeSnippets(state: LlmWikiAgentState): KnowledgeSnippet[] {
  return state.keptPages
    .map((kept) => {
      const page = state.pages.find((item) => item.path === kept.path);
      if (!page) return null;
      const sourceReview =
        state.sourceReviews.find((review) => review.path === page.path) ||
        defaultSourceReviewForPath(state, page.path);
      return {
        path: page.path,
        title: page.title,
        type: normalizePageType(page.type),
        tags: page.tags,
        sources: page.sources,
        content: stripFrontmatter(page.content),
        taskGoals: kept.taskGoals.length ? kept.taskGoals : [page.taskGoal].filter(Boolean),
        relevanceScore: kept.relevanceScore,
        evidenceScore: kept.evidenceScore,
        selectedInRound: kept.selectedInRound,
        whyKept: kept.whyKept,
        sourceSupport: sourceReview.sourceSupport,
      };
    })
    .filter((item): item is KnowledgeSnippet => Boolean(item));
}

export function resultJsonFromState(
  state: LlmWikiAgentState,
  answerMarkdown: string,
  knowledgeSnippets: KnowledgeSnippet[],
): Record<string, unknown> {
  const keptPages = pagesForKept(state);
  return {
    outputMode: state.outputMode,
    answerMarkdown,
    knowledgeSnippets,
    discardedPages: state.discardedPages,
    retrievalRounds: state.retrievalRounds,
    rawSources: state.sources.map((source) => ({
      source_id: source.source_id,
      filename: source.filename,
      pagePaths: source.pagePaths,
      supportSummary: source.supportSummary,
    })),
    citations: citationsFromPages(keptPages),
    gaps: state.gaps.length ? state.gaps : keptPages.length ? [] : ["未在当前 LLM Wiki 中检索到足够证据。"],
    coverageSummary: state.coverageSummary || coverageSummaryFromState(state),
    stopReason: state.stopReason || "complete",
    plan: state.plan,
    sourcePolicy: state.sourcePolicy,
    pageCount: state.pages.length,
    keptPageCount: keptPages.length,
    sourceCount: state.sources.length,
  };
}

export function normalizeSynthesis(value: Record<string, unknown>, state: LlmWikiAgentState): Record<string, unknown> {
  const answerMarkdown = stringField(value.answerMarkdown) || fallbackMarkdown(state);
  const base = resultJsonFromState(state, answerMarkdown, state.knowledgeSnippets);
  return {
    ...base,
    citations: Array.isArray(value.citations) ? value.citations : base.citations,
    gaps: Array.isArray(value.gaps) ? value.gaps : base.gaps,
    coverageSummary: stringField(value.coverageSummary) || base.coverageSummary,
  };
}

export function renderSnippetsMarkdown(state: LlmWikiAgentState, snippets: KnowledgeSnippet[]): string {
  if (!snippets.length) return "# LLM Wiki 知识片段\n\n未在当前 LLM Wiki 中检索到足够证据。\n";
  const lines = [
    "# LLM Wiki 知识片段",
    "",
    `- 查询：${state.query}`,
    `- 片段数：${snippets.length}`,
    `- 停止原因：${state.stopReason || "complete"}`,
    `- 检索轮次：${state.round}`,
    "",
  ];
  for (const snippet of snippets) {
    lines.push(`## ${snippet.title}`, "");
    lines.push(`- 路径：${snippet.path}`);
    lines.push(`- Source 支持：${snippet.sourceSupport}`);
    lines.push(`- 保留原因：${snippet.whyKept}`);
    if (snippet.taskGoals.length) lines.push(`- 任务：${snippet.taskGoals.join("；")}`);
    if (snippet.sources.length) lines.push(`- Sources：${snippet.sources.join(", ")}`);
    if (snippet.tags.length) lines.push(`- Tags：${snippet.tags.join(", ")}`);
    lines.push("", truncate(snippet.content, 12000).trim(), "");
  }
  lines.push("## 检索轨迹");
  for (const round of state.retrievalRounds) {
    lines.push(
      `- Round ${round.round}: read=${round.readPages.length}, keep=${round.keptPages.length}, drop=${round.droppedPages.length}, stop=${round.stopReason || "-"}`,
    );
  }
  lines.push("", "## 未覆盖/不确定点");
  if (state.gaps.length) {
    for (const gap of state.gaps.slice(0, 12)) lines.push(`- ${gap}`);
  } else {
    lines.push("- 当前 reviewer 未报告额外缺口。");
  }
  return `${lines.join("\n")}\n`;
}

export function fallbackMarkdown(state: LlmWikiAgentState): string {
  const lines = ["# LLM Wiki 检索结果", ""];
  if (state.knowledgeSnippets.length) {
    for (const snippet of state.knowledgeSnippets) lines.push(`- ${snippet.title} (${snippet.path})`);
  } else {
    lines.push("未在当前 LLM Wiki 中检索到足够证据。");
  }
  lines.push("", "## 未覆盖/不确定点");
  for (const gap of state.gaps.length ? state.gaps : ["证据不足，未生成汇总答案。"]) lines.push(`- ${gap}`);
  return `${lines.join("\n")}\n`;
}

export function ensureAnswerMarkdownSections(
  markdown: string,
  resultJson: Record<string, unknown>,
  state: LlmWikiAgentState,
): string {
  const lines = [markdown.trim()];
  if (!/##\s*依据/.test(markdown)) {
    const citations = Array.isArray(resultJson.citations) ? resultJson.citations : citationsFromPages(pagesForKept(state));
    lines.push("", "## 依据");
    for (const citation of citations.slice(0, 12)) {
      const item = citation && typeof citation === "object" ? (citation as Record<string, unknown>) : {};
      const title = stringField(item.title) || stringField(item.path) || "未命名页面";
      const path = stringField(item.path);
      lines.push(`- ${path ? `${title} (${path})` : title}`);
    }
  }
  if (!/未覆盖|不确定点/.test(markdown)) {
    const gaps = Array.isArray(resultJson.gaps) ? stringArray(resultJson.gaps) : state.gaps;
    lines.push("", "## 未覆盖/不确定点");
    if (gaps.length > 0) {
      for (const gap of gaps.slice(0, 8)) lines.push(`- ${gap}`);
    } else {
      lines.push("- 当前检索证据未报告额外缺口。");
    }
  }
  return `${lines.join("\n")}\n`;
}

export function coverageSummaryFromState(state: LlmWikiAgentState): string {
  const plan = state.plan;
  if (!plan) return "未生成检索计划。";
  const keptTaskGoals = new Set(state.keptPages.flatMap((page) => page.taskGoals));
  return `完成 ${state.round} 轮证据审查，保留 ${state.keptPages.length} 个 Wiki 页面，读取 ${state.sources.length} 个 raw source，覆盖 ${keptTaskGoals.size}/${plan.tasks.length} 个规划任务。`;
}

function normalizePageType(value: string): KnowledgeSnippet["type"] {
  return value === "summary" || value === "concept" || value === "entity" || value === "index" ? value : "concept";
}

function citationsFromPages(pages: RetrievedPage[]) {
  return pages.map((page) => ({ path: page.path, title: page.title, sources: page.sources }));
}

function stripFrontmatter(content: string): string {
  return String(content || "").replace(/^---[\s\S]*?---\s*/m, "").trim();
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringField).filter(Boolean) : [];
}

function truncate(value: string, limit: number): string {
  const text = String(value || "");
  return text.length <= limit ? text : `${text.slice(0, limit)}\n...[truncated]`;
}
