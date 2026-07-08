import type { LlmWikiPageType, LlmWikiSource, LlmWikiStats } from "@/api/llmWiki";

export const emptyStats: LlmWikiStats = {
  total: 0,
  raw_uploaded: 0,
  compile_planned: 0,
  candidate_ready: 0,
  published: 0,
  uploaded: 0,
  ingesting: 0,
  ready: 0,
  failed: 0,
  page_count: 0,
};

export const statusStats = [
  {
    key: "raw_uploaded",
    label: "待编译",
    dotClassName: "bg-amber-500",
  },
  {
    key: "compile_planned",
    label: "编译中",
    dotClassName: "bg-indigo-500",
  },
  {
    key: "candidate_ready",
    label: "需检查",
    dotClassName: "bg-sky-500",
  },
  {
    key: "published",
    label: "已发布",
    dotClassName: "bg-emerald-500",
  },
  {
    key: "failed",
    label: "失败",
    dotClassName: "bg-rose-500",
  },
] as const;

export const wikiStatusLabels: Record<LlmWikiSource["status"], string> = {
  raw_uploaded: "待编译",
  compile_planned: "编译中",
  candidate_ready: "需检查",
  published: "已发布",
  uploaded: "待编译",
  ingesting: "编译中",
  ready: "已发布",
  failed: "失败",
};

export const pageTypeLabels: Record<LlmWikiPageType, string> = {
  index: "Index",
  summary: "Summary",
  concept: "Concept",
  entity: "Entity",
  reference: "Reference",
  procedure: "Procedure",
  changelog: "Changelog",
  troubleshooting: "Troubleshooting",
};

export const ingestStageLabels: Record<string, string> = {
  queued: "排队",
  compiling: "编译",
  candidate_ready: "检查通过",
  needs_review: "需要 Review",
  skipped: "跳过",
  stopped: "已停止",
  publish_gate: "门禁",
  publishing: "发布",
  published: "完成",
  failed: "失败",
};

export const sourcePageSizeOptions = [10, 20, 50];
export const defaultSourcePageSize = 20;
