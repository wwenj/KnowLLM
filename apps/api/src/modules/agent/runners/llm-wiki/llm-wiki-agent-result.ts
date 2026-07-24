import type { ToolsPageDetail, ToolsSourceDetail } from "../../../llmWikiNext/llm-wiki-next.types";
import type { FinalAnswer, LlmWikiAgentState, VerifiedEvidence } from "./llm-wiki-agent.types";

export function buildResultJson(
  state: LlmWikiAgentState,
  final: FinalAnswer,
): Record<string, unknown> {
  const evidenceById = new Map(state.evidence.map((item) => [item.evidenceId, item]));
  const citations = final.citations
    .map((id) => evidenceById.get(id))
    .filter((item): item is VerifiedEvidence => Boolean(item))
    .map(toCitation);
  const pages = [...state.pages.values()];
  const sources = [...state.sources.values()];
  const gaps = unique(final.gaps.length ? final.gaps : state.gaps);
  const coverageSummary = coverageSummaryFromState(state);

  // 保留旧结果面板、历史和导出已消费的字段；新字段均为补充。
  return {
    answerMarkdown: final.answerMarkdown,
    knowledgeSnippets: pages.map(toKnowledgeSnippet),
    rawSources: sources.map(toRawSource),
    citations,
    gaps: gaps.length ? gaps : state.stopReason === "complete" ? [] : ["未获得足够可核验证据。"],
    coverageSummary,
    stopReason: state.stopReason || "insufficient_evidence",
    retrievalRounds: state.retrievalRounds,
    plan: state.plan,
    verifiedEvidence: state.evidence.map(toCitation),
    catalogFingerprint: state.catalogFingerprint,
  };
}

export function fallbackMarkdown(state: LlmWikiAgentState): string {
  const lines = ["# LLM Wiki 检索结果", ""];
  if (state.stopReason === "wiki_changed") {
    lines.push("检索期间 Published Wiki 已变化。为避免混合两个版本的证据，本次结果已丢弃，请重新执行。\n");
  } else {
    lines.push("当前 Published Wiki 中未获得覆盖全部必答任务的可核验证据。\n");
  }
  lines.push("## 未覆盖/不确定点");
  for (const gap of unique(state.gaps).slice(0, 12)) lines.push(`- ${gap}`);
  return `${lines.join("\n")}\n`;
}

export function appendVerifiedCitations(
  markdown: string,
  state: LlmWikiAgentState,
  citationIds: string[],
): string {
  const evidenceById = new Map(state.evidence.map((item) => [item.evidenceId, item]));
  const citations = citationIds
    .map((id) => evidenceById.get(id))
    .filter((item): item is VerifiedEvidence => Boolean(item));
  if (!citations.length) return markdown.trim();
  const lines = [markdown.trim(), "", "## 已验证依据"];
  for (const citation of citations) {
    const location = citation.kind === "source"
      ? `${citation.sourceFilename || citation.sourceId || "Source"} L${citation.range?.startLine ?? "?"}-L${citation.range?.endLine ?? "?"}`
      : citation.pageKey || "Wiki 页面";
    lines.push(`- [${citation.evidenceId}] ${location}：${truncate(citation.quote, 360)}`);
  }
  return lines.join("\n");
}

export function coverageSummaryFromState(state: LlmWikiAgentState): string {
  const tasks = state.plan?.tasks || [];
  const covered = tasks.filter((task) => hasEvidenceForTask(state, task.taskId));
  return `已完成 ${state.round} 轮 ReAct，已验证 ${state.evidence.length} 条证据，覆盖 ${covered.length}/${tasks.length} 个必答任务。`;
}

export function hasEvidenceForTask(state: LlmWikiAgentState, taskId: string): boolean {
  return state.evidence.some((item) => item.taskId === taskId);
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
    whyKept: "由 Planner/ReAct 调用 readPage 并进入已验证证据链。",
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
    supportSummary: "由 ReAct 读取并用于 Source 证据核验。",
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
    quote: evidence.quote,
    claim: evidence.claim,
    sourceLine: evidence.sourceLine,
    startLine: evidence.range?.startLine,
    endLine: evidence.range?.endLine,
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}
