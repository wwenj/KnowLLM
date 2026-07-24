import type {
  ToolsPageDetail,
  ToolsSourceDetail,
} from "../../../llmWikiNext/llm-wiki-next.types";
import type {
  FinalAnswer,
  LlmWikiAgentState,
  TaskState,
  VerifiedEvidence,
} from "./llm-wiki-agent.types";

export function buildResultJson(
  state: LlmWikiAgentState,
  final: FinalAnswer,
): Record<string, unknown> {
  const evidenceById = new Map(
    state.evidence.map((item) => [item.evidenceId, item]),
  );
  const citations = final.citations
    .map((id) => evidenceById.get(id))
    .filter((item): item is VerifiedEvidence => Boolean(item))
    .map(toCitation);
  const gaps = unique(final.gaps.length ? final.gaps : taskGaps(state));
  return {
    answerMarkdown: final.answerMarkdown,
    answerStatus: final.answerStatus,
    answerable: final.answerable,
    knowledgeSnippets: [...state.pages.values()].map(toKnowledgeSnippet),
    rawSources: [...state.sources.values()].map(toRawSource),
    citations,
    gaps,
    coverageSummary: coverageSummaryFromState(state),
    stopReason: state.stopReason || "insufficient_evidence",
    retrievalRounds: state.retrievalRounds,
    plan: state.plan,
    taskResults: [...state.tasks.values()].map(toTaskResult),
    sourceTraces: state.sourceTraces,
    verifiedEvidence: state.evidence.map(toCitation),
    catalogFingerprint: state.catalogFingerprint,
  };
}

export function fallbackMarkdown(state: LlmWikiAgentState): string {
  const lines = ["# LLM Wiki 检索结果", ""];
  if (state.stopReason === "wiki_changed") {
    lines.push(
      "检索期间 Published Wiki 已变化。为避免混合两个版本的证据，本次结果已丢弃，请重新执行。",
    );
  } else {
    lines.push("最终汇总未能生成，不能输出未经完整汇总的答案。");
  }
  const gaps = taskGaps(state);
  if (gaps.length) {
    lines.push("", "## 未覆盖/不确定点");
    for (const gap of gaps.slice(0, 12)) lines.push(`- ${gap}`);
  }
  return `${lines.join("\n")}\n`;
}

export function appendVerifiedCitations(
  markdown: string,
  state: LlmWikiAgentState,
  citationIds: string[],
): string {
  const evidenceById = new Map(
    state.evidence.map((item) => [item.evidenceId, item]),
  );
  const citations = citationIds
    .map((id) => evidenceById.get(id))
    .filter((item): item is VerifiedEvidence => Boolean(item));
  if (!citations.length) return markdown.trim();
  const lines = [markdown.trim(), "", "## 已验证依据"];
  for (const citation of citations) {
    const location =
      citation.kind === "source"
        ? `${citation.sourceFilename || citation.sourceId || "Source"} L${citation.range?.startLine ?? "?"}-L${citation.range?.endLine ?? "?"}`
        : citation.pageKey || "Wiki 页面";
    lines.push(
      `- [${citation.evidenceId}] ${location}：${truncate(citation.quote, 360)}`,
    );
  }
  return lines.join("\n");
}

export function coverageSummaryFromState(state: LlmWikiAgentState): string {
  const tasks = [...state.tasks.values()];
  const completed = tasks.filter((task) => task.status === "completed").length;
  const insufficient = tasks.filter(
    (task) => task.status === "insufficient",
  ).length;
  return `已完成 ${state.round} 轮主 ReAct，验证 ${state.evidence.length} 条证据；Task 完成 ${completed}/${tasks.length}，证据不足 ${insufficient}/${tasks.length}。`;
}

function toTaskResult(task: TaskState) {
  return {
    taskId: task.taskId,
    question: task.question,
    status: task.status,
    conclusion: task.conclusion,
    evidenceIds: task.evidenceIds,
    insufficientReason: task.insufficientReason,
    gaps: task.gaps,
  };
}

function toKnowledgeSnippet(detail: ToolsPageDetail) {
  return {
    path: detail.page.pageKey,
    pageKey: detail.page.pageKey,
    title: detail.page.title,
    type: "concept",
    tags: [],
    sources: detail.page.sourceIds,
    content: detail.page.bodyMarkdown,
    taskGoals: [],
    relevanceScore: 0,
    evidenceScore: detail.page.keyFacts.length,
    selectedInRound: 0,
    whyKept: "由 Planner/ReAct 调用 readPage 并进入 Task 检索链。",
    sourceSupport: "verified",
  };
}

function toRawSource(detail: ToolsSourceDetail) {
  return {
    source_id: detail.source.sourceId,
    sourceId: detail.source.sourceId,
    filename: detail.source.filename,
    pagePaths: detail.source.pageKeys,
    startLine: detail.range.startLine,
    endLine: detail.range.endLine,
    supportSummary: "由 traceSource 内部循环读取并校验证据。",
  };
}

function toCitation(evidence: VerifiedEvidence) {
  return {
    evidenceId: evidence.evidenceId,
    taskId: evidence.taskId,
    kind: evidence.kind,
    pageKey: evidence.pageKey,
    path: evidence.pageKey,
    sourceId: evidence.sourceId,
    filename: evidence.sourceFilename,
    sources: evidence.sourceId ? [evidence.sourceId] : [],
    quote: evidence.quote,
    claim: evidence.claim,
    sourceLine: evidence.sourceLine,
    startLine: evidence.range?.startLine,
    endLine: evidence.range?.endLine,
  };
}

function taskGaps(state: LlmWikiAgentState): string[] {
  return unique(
    [...state.tasks.values()].flatMap((task) => {
      if (task.status === "insufficient" && task.insufficientReason) {
        return [task.insufficientReason];
      }
      return task.gaps;
    }),
  );
}

function unique(values: string[]): string[] {
  return [
    ...new Set(values.map((item) => String(item || "").trim()).filter(Boolean)),
  ];
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}
