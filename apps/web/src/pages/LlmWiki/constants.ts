import type { LlmWikiPageType, LlmWikiSource, LlmWikiStats } from "@/api/llmWiki";

export const emptyStats: LlmWikiStats = {
  total: 0,
  uploaded: 0,
  ingesting: 0,
  ready: 0,
  failed: 0,
  page_count: 0,
};

export const statusStats = [
  {
    key: "uploaded",
    label: "待解析",
    dotClassName: "bg-amber-500",
  },
  {
    key: "ingesting",
    label: "解析中",
    dotClassName: "bg-indigo-500",
  },
  {
    key: "ready",
    label: "已解析",
    dotClassName: "bg-emerald-500",
  },
  {
    key: "failed",
    label: "失败",
    dotClassName: "bg-rose-500",
  },
] as const;

export const wikiStatusLabels: Record<LlmWikiSource["status"], string> = {
  uploaded: "待解析",
  ingesting: "解析中",
  ready: "已解析",
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
  publish_gate: "门禁",
  publishing: "发布",
  published: "完成",
  failed: "失败",
};

export const sourcePageSizeOptions = [10, 20, 50];
export const defaultSourcePageSize = 20;
