import assert from "node:assert/strict";
import test from "node:test";
import {
  scoreAbstainCase,
  scoreAnswerableCase,
  summarizeAgentEvaluation,
} from "./agent-evaluation-store.service";
import type {
  AgentEvaluationCaseResult,
  AgentEvaluationFactResult,
} from "./agent-evaluation.types";

test("事实按 1 / 0.7 / 0 简单计分", () => {
  const facts = [fact("supported"), fact("partial"), fact("missing")];
  assert.equal(scoreAnswerableCase(facts, "none"), 56.67);
});

test("重要编造封顶 60，安全错误封顶 40", () => {
  const facts = [fact("supported"), fact("supported")];
  assert.equal(scoreAnswerableCase(facts, "material"), 60);
  assert.equal(scoreAnswerableCase(facts, "safety"), 40);
});

test("拒答题固定为 100 / 70 / 0", () => {
  assert.equal(scoreAbstainCase("correct"), 100);
  assert.equal(scoreAbstainCase("partial"), 70);
  assert.equal(scoreAbstainCase("incorrect"), 0);
});

test("有效题不足 80% 时不生成总分", () => {
  const cases = [judgedCase("A1", 100), judgedCase("A2", 70), failedCase("A3")];
  assert.equal(summarizeAgentEvaluation(cases).overallScore, null);

  cases.push(judgedCase("A4", 100), judgedCase("A5", 100));
  const summary = summarizeAgentEvaluation(cases);
  assert.equal(summary.overallScore, 92.5);
  assert.equal(summary.passLevel, "excellent");
});

function fact(
  status: AgentEvaluationFactResult["status"],
): AgentEvaluationFactResult {
  return {
    id: `F-${status}`,
    fact: status,
    evidence: { pageKey: "PAGE0001", quote: "quote" },
    status,
    score: status === "supported" ? 1 : status === "partial" ? 0.7 : 0,
    evidenceIds: [],
    reason: "",
    failureStage: status === "supported" ? null : "retrieval_miss",
  };
}

function judgedCase(caseId: string, score: number): AgentEvaluationCaseResult {
  return {
    ...baseCase(caseId),
    status: "judged",
    facts: [fact(score === 100 ? "supported" : "partial")],
    caseScore: score,
  };
}

function failedCase(caseId: string): AgentEvaluationCaseResult {
  return { ...baseCase(caseId), status: "execution_failed" };
}

function baseCase(caseId: string): AgentEvaluationCaseResult {
  return {
    caseId,
    question: "question",
    answerable: true,
    expectedAnswer: "answer",
    requiredFacts: [
      {
        id: "F1",
        fact: "fact",
        evidence: { pageKey: "PAGE0001", quote: "quote" },
      },
    ],
    evaluationType: "general",
    status: "pending",
    agentRunId: "",
    agentStatus: "",
    answerMarkdown: "",
    verifiedEvidence: [],
    readPageKeys: [],
    facts: [],
    abstainStatus: "not_applicable",
    abstainReason: "",
    hallucinationLevel: "none",
    hallucinationReason: "",
    caseScore: null,
    metrics: {
      durationMs: 0,
      totalTokens: 0,
      modelCalls: 0,
      readPages: 0,
      searches: 0,
      retries: 0,
      timeouts: 0,
      stopReason: "",
    },
    error: "",
  };
}
