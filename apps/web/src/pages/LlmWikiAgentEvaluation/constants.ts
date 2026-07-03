import type {
  AgentEvaluationPassLevel,
  AgentEvaluationSourcePolicy,
} from "@/api/evaluation";

export const sourcePolicyLabels: Record<AgentEvaluationSourcePolicy, string> = {
  "key-sources": "关键原文",
  auto: "自动",
  exhaustive: "尽量核验",
  "wiki-only": "只读 Wiki",
};

export const passLevelText: Record<AgentEvaluationPassLevel, string> = {
  excellent: "优秀",
  pass: "合格",
  needs_improvement: "待优化",
  failed: "不合格",
};
