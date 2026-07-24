import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { ToolsCatalog } from "../../../llmWikiNext/llm-wiki-next.types";
import {
  ModelService,
  type RawChatResponseFormat,
} from "../../../model/model.service";
import type {
  AgentRunTokens,
  AgentRunnerContext,
  AgentRunnerResult,
} from "../../agent.types";
import { LlmWikiAgentTools } from "./llm-wiki-agent.tools";
import {
  appendVerifiedCitations,
  buildResultJson,
  fallbackMarkdown,
} from "./llm-wiki-agent-result";
import {
  DEFAULT_FAST_MODEL,
  DEFAULT_LIMIT,
  DEFAULT_QUALITY_MODEL,
  FINAL_TOKEN_RESERVE,
  MAX_ACTIONS_PER_ROUND,
  MAX_LIMIT,
  MAX_MODEL_ATTEMPTS,
  MAX_MODEL_CALLS,
  MAX_MODEL_RETRIES,
  MAX_PLAN_TASKS,
  MAX_REACT_ROUNDS,
  MAX_SEARCHES,
  TOKEN_LIMIT,
  type EvidenceSelection,
  type FinalAnswer,
  type FinishAction,
  type LlmWikiAgentInput,
  type LlmWikiAgentState,
  type PlannerAction,
  type PlannerCatalogPage,
  type QueryPlan,
  type QueryTask,
  type ReactAction,
  type ReactDecision,
  type RetrievalRound,
  type VerifiedEvidence,
} from "./llm-wiki-agent.types";

const PLANNER_SCHEMA = jsonSchema("wiki_query_plan", {
  type: "object",
  additionalProperties: false,
  required: ["relevant", "tasks", "actions"],
  properties: {
    relevant: { type: "boolean" },
    tasks: {
      type: "array",
      minItems: 0,
      maxItems: MAX_PLAN_TASKS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "question"],
        properties: {
          id: { type: "string", pattern: "^[A-Za-z0-9_-]{1,32}$" },
          question: { type: "string", minLength: 1, maxLength: 300 },
        },
      },
    },
    actions: {
      type: "array",
      minItems: 0,
      maxItems: MAX_ACTIONS_PER_ROUND,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tool", "value"],
        properties: {
          tool: { type: "string", enum: ["searchWiki", "readPage"] },
          value: { type: "string", minLength: 1, maxLength: 300 },
        },
      },
    },
  },
});

const REACT_SCHEMA = jsonSchema("wiki_react_decision", {
  type: "object",
  additionalProperties: false,
  required: ["evidence", "missing", "actions", "finish"],
  properties: {
    evidence: {
      type: "array",
      maxItems: 16,
      items: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["taskId", "pageKey", "quote", "claim"],
            properties: {
              taskId: { type: "string", minLength: 1, maxLength: 48 },
              pageKey: { type: "string", minLength: 1, maxLength: 200 },
              quote: { type: "string", minLength: 1, maxLength: 1500 },
              claim: { type: "string", minLength: 1, maxLength: 1500 },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["taskId", "sourceId", "sourceLine", "quote", "claim"],
            properties: {
              taskId: { type: "string", minLength: 1, maxLength: 48 },
              sourceId: { type: "string", minLength: 1, maxLength: 64 },
              sourceLine: { type: "integer", minimum: 1 },
              quote: { type: "string", minLength: 1, maxLength: 1500 },
              claim: { type: "string", minLength: 1, maxLength: 1500 },
            },
          },
        ],
      },
    },
    missing: {
      type: "array",
      maxItems: 12,
      items: { type: "string", maxLength: 500 },
    },
    actions: {
      type: "array",
      maxItems: MAX_ACTIONS_PER_ROUND,
      items: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["tool", "query"],
            properties: {
              tool: { type: "string", const: "searchWiki" },
              query: { type: "string", minLength: 1, maxLength: 300 },
              reason: { type: "string", maxLength: 500 },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["tool", "pageKey"],
            properties: {
              tool: { type: "string", const: "readPage" },
              pageKey: { type: "string", minLength: 1, maxLength: 200 },
              reason: { type: "string", maxLength: 500 },
            },
          },
        ],
      },
    },
    finish: { type: "boolean" },
  },
});

const FINAL_SCHEMA = jsonSchema("wiki_final_answer", {
  type: "object",
  additionalProperties: false,
  required: ["answerable", "answerMarkdown", "citations", "gaps"],
  properties: {
    answerable: { type: "boolean" },
    answerMarkdown: { type: "string", minLength: 1, maxLength: 30_000 },
    citations: {
      type: "array",
      maxItems: 24,
      items: { type: "string", maxLength: 80 },
    },
    gaps: {
      type: "array",
      maxItems: 12,
      items: { type: "string", maxLength: 500 },
    },
  },
});

@Injectable()
export class LlmWikiAgentWorkflow {
  readonly agentType = "llmWiki";

  constructor(
    private readonly tools: LlmWikiAgentTools,
    private readonly model: ModelService,
  ) {}

  getProfile() {
    return {
      agentType: this.agentType,
      label: "LLM Wiki Agent",
      description: "基于 Published LLM Wiki 的 Planner + ReAct 证据查询 Agent",
    };
  }

  getDefaults(): Record<string, unknown> {
    return {
      limit: DEFAULT_LIMIT,
      fastModel: DEFAULT_FAST_MODEL,
      qualityModel: DEFAULT_QUALITY_MODEL,
      modelOptions: this.model.listModels(),
    };
  }

  validateInput(input: unknown): LlmWikiAgentInput {
    if (!isRecord(input)) throw new Error("请求体必须是对象");
    const allowed = new Set(["query", "limit", "fastModel", "qualityModel"]);
    const unknown = Object.keys(input).filter((key) => !allowed.has(key));
    if (unknown.length)
      throw new Error(`不支持旧 Agent 输入字段: ${unknown.join(", ")}`);
    const query = string(input.query);
    const fastModel = string(input.fastModel);
    const qualityModel = string(input.qualityModel);
    const limit = Number(input.limit);
    if (!query) throw new Error("query 不能为空");
    if (!fastModel || !qualityModel)
      throw new Error("fastModel 和 qualityModel 不能为空");
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new Error(`limit 必须是 1 到 ${MAX_LIMIT} 的整数`);
    }
    if (!this.model.findModel(fastModel))
      throw new Error(`fastModel 不存在或未配置: ${fastModel}`);
    if (!this.model.findModel(qualityModel))
      throw new Error(`qualityModel 不存在或未配置: ${qualityModel}`);
    return { query, limit, fastModel, qualityModel };
  }

  title(input: LlmWikiAgentInput): string {
    return input.query.slice(0, 120);
  }

  async start(
    ctx: AgentRunnerContext<LlmWikiAgentInput>,
  ): Promise<AgentRunnerResult> {
    const state = emptyState(ctx.input);
    ctx.appendEvent({
      type: "start",
      msg: "开始执行新版 LLM Wiki Planner + ReAct",
      query: ctx.input.query,
      limit: ctx.input.limit,
      fastModel: ctx.input.fastModel,
      qualityModel: ctx.input.qualityModel,
    });

    this.assertActive(ctx);
    const catalog = this.tools.getCatalog();
    state.catalog = catalog;
    state.catalogFingerprint = catalogFingerprint(catalog);
    state.plannerCatalog = plannerCatalog(catalog);
    ctx.appendEvent({
      type: "catalog_loaded",
      msg: "已加载 Published Wiki 目录",
      stats: catalog.stats,
    });

    state.plan = await this.createPlan(ctx, state);
    ctx.appendEvent({
      type: "plan_created",
      msg: state.plan.relevant
        ? "查询计划已生成"
        : "Planner 判定当前 Wiki 无相关信息",
      plan: state.plan,
      model: ctx.input.fastModel,
    });

    if (!state.stopReason && !state.plan.relevant) {
      state.stopReason = "no_relevant_wiki";
      state.gaps = ["用户问题与当前 Published Wiki 目录完全无关。"];
      ctx.appendEvent({
        type: "planner_no_match",
        msg: "当前 Wiki 无相关信息，已跳过 Tool、ReAct 和 Final",
        model: ctx.input.fastModel,
      });
      return this.finishResult(ctx, state, {
        answerable: false,
        answerMarkdown: "当前 Wiki 无相关信息。",
        citations: [],
        gaps: state.gaps,
      });
    }

    const initialActions = state.plan.actions.map(toReactAction);
    const initial = await this.executeActions(ctx, state, initialActions, 0);
    state.newObservations = observationPayload(state, initial.observations);
    ctx.appendEvent({
      type: "initial_tools_completed",
      msg: "已执行 Planner 初始 Tool 调用",
      observations: initial.observations,
      rejectedActions: initial.rejected,
    });

    for (
      let round = 1;
      round <= MAX_REACT_ROUNDS && !state.stopReason;
      round += 1
    ) {
      this.assertActive(ctx);
      state.round = round;
      const useQuality =
        state.qualityReactNext ||
        state.conflicts.length > 0 ||
        !state.lastRoundProgress;
      const decision = await this.react(
        ctx,
        state,
        useQuality ? "quality" : "fast",
      );
      if (!decision) {
        state.lastRoundProgress = false;
        state.qualityReactNext = true;
        state.gaps.push("本轮 ReAct 未返回可解析 JSON，下一轮已升级质量模型。");
        continue;
      }

      const acceptedEvidence = this.acceptEvidence(state, decision.evidence);
      const actionResult = await this.executeActions(
        ctx,
        state,
        decision.actions,
        round,
      );
      state.newObservations = observationPayload(
        state,
        actionResult.observations,
      );
      state.coverage = coverageFromEvidence(state);
      // conflicts 是当前仍未解决的冲突；质量轮可通过返回空数组明确关闭已核验的冲突。
      state.conflicts = unique(decision.conflicts);
      state.gaps = unique([
        ...state.gaps,
        ...decision.gaps,
        ...actionResult.rejected,
      ]);
      state.lastRoundProgress = acceptedEvidence > 0 || actionResult.fresh > 0;
      state.qualityReactNext =
        decision.escalateToQuality ||
        state.conflicts.length > 0 ||
        !state.lastRoundProgress;

      const record: RetrievalRound = {
        round,
        model: useQuality ? ctx.input.qualityModel : ctx.input.fastModel,
        actions: decision.actions,
        observations: actionResult.observations,
        evidenceIds: state.evidence
          .slice(-acceptedEvidence)
          .map((item) => item.evidenceId),
        coverage: state.coverage,
        conflicts: decision.conflicts,
        gaps: decision.gaps,
        finish:
          decision.finish ||
          decision.actions.some((item) => item.tool === "finish"),
      };
      state.retrievalRounds.push(record);
      ctx.appendEvent({
        type: "react_round",
        msg: `完成 ReAct 第 ${round} 轮`,
        round,
        model: record.model,
        observations: record.observations,
        evidenceCount: state.evidence.length,
        rejectedActions: actionResult.rejected,
      });

      if (record.finish) {
        const gate = this.evidenceGate(state);
        if (gate.ok) {
          state.stopReason = "complete";
        } else {
          state.gaps = unique([...state.gaps, ...gate.gaps]);
          state.qualityReactNext = true;
        }
      }
    }

    if (!state.stopReason) {
      const gate = this.evidenceGate(state);
      if (gate.ok) state.stopReason = "complete";
      else {
        state.stopReason =
          state.tokens.totalTokens >= TOKEN_LIMIT - FINAL_TOKEN_RESERVE
            ? "token_limit"
            : state.lastRoundProgress
              ? "max_rounds"
              : "no_new_evidence";
        state.gaps = unique([...state.gaps, ...gate.gaps]);
      }
    }

    this.assertActive(ctx);
    const finalCatalog = this.tools.getCatalog();
    if (catalogFingerprint(finalCatalog) !== state.catalogFingerprint) {
      state.stopReason = "wiki_changed";
      state.gaps = unique([
        ...state.gaps,
        "检索期间 Published Wiki 已变化，不能混合版本证据。",
      ]);
      state.evidence = [];
    }

    let final: FinalAnswer;
    if (state.stopReason === "complete") {
      final = await this.summarize(ctx, state);
      if (!final.answerable) {
        state.stopReason = "insufficient_evidence";
        state.gaps = unique([
          ...state.gaps,
          ...final.gaps,
          "质量模型判断当前证据不足以作答。",
        ]);
        final = { ...final, answerMarkdown: fallbackMarkdown(state) };
      } else {
        final = {
          ...final,
          answerMarkdown: appendVerifiedCitations(
            final.answerMarkdown,
            state,
            final.citations,
          ),
        };
      }
    } else {
      final = {
        answerable: false,
        answerMarkdown: fallbackMarkdown(state),
        citations: [],
        gaps: state.gaps,
      };
    }

    return this.finishResult(ctx, state, final);
  }
  private async createPlan(
    ctx: AgentRunnerContext<LlmWikiAgentInput>,
    state: LlmWikiAgentState,
  ): Promise<QueryPlan> {
    const value = await this.callJson(ctx, state, {
      stage: "planner",
      model: ctx.input.fastModel,
      system: [
        `你是 Wiki 查询规划器，核心任务是判断问题相关性并规划信息检索路径，禁止直接回答知识问题。
输入 \`query\` 为用户问题；\`pages\` 为候选文档目录（每项为 [pageKey, title, goal]）。
注意：传入的 \`pages\` 仅为目录索引，不能作为回答的事实证据，必须通过 action 获取真实文档内容。

【判定与规划逻辑】
1. 判定相关性：
   - 若 query 与所有 pages 的 title/goal 完全无语义关联：返回 {"relevant":false, "tasks":[], "actions":[]}。
   - 只要存在可能相关的页面或属于系统知识域：必须 relevant=true，并继续规划。
2. 拆分任务 (tasks)：
   - 若 relevant=true，将 query 拆分为 1-6 个必须回答且互不重复的子问题 (question)。
3. 制定动作 (actions)：
   - 给出 1-6 个首轮检索动作（非必需）。
   - 若能明确匹配到 pages 中的具体页面：使用 readPage，value 为对应的 pageKey（支持多个 readPage 并行）。
   - 若属于该知识域但在 pages 中无明确匹配：使用 searchWiki，value 为提取的 2-4 个核心检索词（空格分隔）。

【输出严格约束】
- 唯一合法输出结构：{"relevant":true, "tasks":[{"id":"t1","question":"必须回答的问题"}], "actions":[{"tool":"readPage","value":"页面ID"}]}。
- 任务字段限 id/question，动作字段限 tool/value。禁止编造 pageKey，禁止输出解答、解释、Markdown 格式或任何额外字段，仅输出 JSON。`,
      ].join("\n"),
      payload: { query: state.query, pages: state.plannerCatalog },
      format: PLANNER_SCHEMA,
      maxTokens: 1200,
      final: false,
      retry: true,
      parse: (raw) => normalizePlan(raw, state.catalog),
    });
    if (!value) {
      if (state.stopReason) return emptyPlan();
      throw new Error("Planner 未返回有效 JSON 计划");
    }
    return value;
  }
  private async react(
    ctx: AgentRunnerContext<LlmWikiAgentInput>,
    state: LlmWikiAgentState,
    kind: "fast" | "quality",
  ): Promise<ReactDecision | null> {
    return this.callJson<ReactDecision>(ctx, state, {
      stage: `react_${state.round}`,
      model: kind === "fast" ? ctx.input.fastModel : ctx.input.qualityModel,
      system: [
        "你负责从已读取的资料 (materials) 中为任务 (tasks) 提取事实证据，并决策是否需要继续补充读取资料。请勿直接回答用户的知识问题。",
        "",
        "【工作流程】",
        "1. 证据提取：",
        "   - 检查 materials (包含 pages, sources) 和 acceptedEvidence。",
        "   - 对每个 task 提取能回答该问题的原句。quote 必须从资料中【逐字复制】，不可改动。",
        "   - acceptedEvidence 是已经通过校验的证据，不要重复提取。",
        "   - 页面正文中能够直接回答 task 的必要事实属于 page 证据，不单独标记为 fact。",
        "   - 必要事实包括回答 task 不可缺少的数字、默认值、配置值、前置条件、适用范围、限制、例外和因果关系。",
        "   - 提取 page 证据时，应完整保留这些必要事实，避免只提取概括性描述而遗漏关键条件。",
        "   - 若证据来自页面正文，填写 taskId, pageKey, quote, claim。",
        "   - 若证据来自带行号的原始文档 (sources)，填写 taskId, sourceId, sourceLine, quote, claim。",
        "",
        "2. 缺失信息判断 (missing)：",
        "   - 记录当前资料中仍未能解答 tasks 的具体疑问点。若已完整解答，missing 留空。",
        "",
        "3. 决策下一步动作 (actions) 与 结束状态 (finish)：",
        "   - 当【所有 tasks】在现有 materials 中均已获得充分证据时，设 finish = true，actions 留空。",
        "   - 当资料不足时，设 finish = false，并在 actions 中提出补充检索（严禁重复读取 materials 中已有的 pageKey）：",
        "     * searchWiki: 缺乏相关页面时使用，提供核心关键词 query。",
        "     * readPage: 知道 pageKey 但缺失正文时使用。",
        "",
        "【输出严格约束】",
        "仅输出符合规范的 JSON，格式如下：",
        '{"evidence":[],"missing":[],"actions":[],"finish":false}',
      ].join("\n"),
      payload: reactPayload(state),
      format: REACT_SCHEMA,
      maxTokens: 1500,
      final: false,
      retry: true,
      parse: normalizeReact,
    });
  }

  private async summarize(
    ctx: AgentRunnerContext<LlmWikiAgentInput>,
    state: LlmWikiAgentState,
  ): Promise<FinalAnswer> {
    const value = await this.callJson(ctx, state, {
      stage: "final",
      model: ctx.input.qualityModel,
      system: [
        "你是 LLM Wiki 最终汇总模型。你的核心任务是根据给定的已验证证据 (evidence)，为用户问题生成准确、严谨的 Markdown 答案。",
        "",
        "【生成原则】",
        "1. 严格基于事实：只能基于输入 `evidence` 中的 quote 与 claim 进行回答。严禁引入任何外部知识、推测或未列出的信息。",
        "   - 回答必须保留完成各项 tasks 所必需的事实，包括关键数字、默认值、配置值、前置条件、适用范围、限制、例外和因果关系。",
        "   - 不得为了缩短回答而删除会改变结论含义的条件，也不得将只在特定条件下成立的事实概括为普遍结论。",
        "2. 答案可回答性 (answerable)：",
        "   - 若 `evidence` 足以回答 query，设 answerable = true。",
        "   - 若证据不足以完整回答核心问题，设 answerable = false；answerMarkdown 固定填写“证据不足，无法完整回答。”；citations 留空；gaps 具体列出缺失信息。",
        "3. 正文与行内引用 (answerMarkdown)：",
        "   - 答案使用中文，结构清晰，语言简洁、直接。",
        '   - 正文中凡是引用证据的地方，必须在句末紧跟行内角标（如 "[E1]" 或 "[E1][E2]"）。',
        "   - 包含的命令、配置项、数值必须与 evidence 中的原文保持完全一致。",
        "4. 引用收集 (citations)：",
        "   - 将 `answerMarkdown` 中实际使用到的所有 evidenceId 收集到 citations 数组中，确保不重不漏。",
        "",
        "【输出结构】",
        "只返回 JSON 对象，不得在 JSON 外输出任何解释或 Markdown 标记。结构如下：",
        '{"answerable":true,"answerMarkdown":"答案正文...[E1]","citations":["E1"],"gaps":[]}',
      ].join("\n"),
      payload: {
        query: state.query,
        tasks: state.plan?.tasks || [],
        evidence: state.evidence,
        coverage: state.coverage,
        conflicts: state.conflicts,
        gaps: state.gaps,
      },
      format: FINAL_SCHEMA,
      maxTokens: 4000,
      final: true,
      retry: true,
    });
    if (!value)
      return {
        answerable: false,
        answerMarkdown: fallbackMarkdown(state),
        citations: [],
        gaps: ["最终汇总模型未返回有效 JSON。"],
      };
    const parsed = normalizeFinal(value);
    const validIds = new Set(state.evidence.map((item) => item.evidenceId));
    return {
      ...parsed,
      citations: parsed.citations.filter((id) => validIds.has(id)),
    };
  }

  private async executeActions(
    ctx: AgentRunnerContext<LlmWikiAgentInput>,
    state: LlmWikiAgentState,
    actions: ReactAction[],
    round: number,
  ): Promise<{
    observations: RetrievalRound["observations"];
    rejected: string[];
    fresh: number;
  }> {
    const observations: RetrievalRound["observations"] = [];
    const rejected: string[] = [];
    let fresh = 0;
    const usable = actions.slice(0, MAX_ACTIONS_PER_ROUND);
    const pageReadLimit = 4;
    let pageReads = 0;
    for (const action of usable) {
      this.assertActive(ctx);
      const request = toolRequest(action);
      ctx.appendEvent({
        type: "tool_request",
        msg: `调用 Tool：${action.tool}`,
        round,
        tool: action.tool,
        request,
      });
      if (action.tool === "finish") {
        ctx.appendEvent({
          type: "tool_response",
          msg: "Tool 返回：finish",
          round,
          tool: action.tool,
          status: "success",
          response: { finished: true, reason: action.reason || "" },
        });
        continue;
      }
      const result = this.executeAction(
        state,
        action,
        pageReads,
        pageReadLimit,
      );
      if ("reject" in result) {
        rejected.push(result.reject);
        ctx.appendEvent({
          type: "tool_response",
          msg: `Tool 拒绝：${action.tool}`,
          round,
          tool: action.tool,
          status: "rejected",
          error: result.reject,
        });
        continue;
      }
      if (action.tool === "readPage") pageReads += 1;
      observations.push(result.observation);
      if (!result.observation.cached) fresh += 1;
      ctx.appendEvent({
        type: "tool_response",
        msg: `Tool 返回：${action.tool}`,
        round,
        tool: action.tool,
        status: "success",
        cached: result.observation.cached,
        response: result.response,
      });
    }
    return { observations, rejected: unique(rejected), fresh };
  }

  private executeAction(
    state: LlmWikiAgentState,
    action: Exclude<ReactAction, FinishAction>,
    pageReads: number,
    pageReadLimit: number,
  ):
    | { observation: RetrievalRound["observations"][number]; response: unknown }
    | { reject: string } {
    const catalog = state.catalog;
    if (!catalog) return { reject: "Catalog 尚未加载。" };
    const pageKeys = new Set(catalog.pages.map((item) => item.pageKey));
    try {
      if (action.tool === "searchWiki") {
        const query = string(action.query);
        if (!query) return { reject: "searchWiki.query 不能为空。" };
        const cached = state.searches.get(query);
        if (cached)
          return {
            observation: {
              tool: "searchWiki",
              key: query,
              cached: true,
              summary: `缓存命中 ${cached.items.length} 个结果`,
            },
            response: cached,
          };
        if (state.searches.size >= MAX_SEARCHES)
          return { reject: `已达到 ${MAX_SEARCHES} 次 searchWiki 上限。` };
        const result = this.tools.searchWiki(query);
        state.searches.set(query, result);
        return {
          observation: {
            tool: "searchWiki",
            key: query,
            cached: false,
            summary: `返回 ${result.items.length} 个结果`,
          },
          response: result,
        };
      }
      if (action.tool === "readPage") {
        const pageKey = string(action.pageKey);
        if (!pageKey || !pageKeys.has(pageKey))
          return {
            reject: `readPage.pageKey 不在当前 Catalog: ${pageKey || "(空)"}`,
          };
        const cached = state.pages.get(pageKey);
        if (cached)
          return {
            observation: {
              tool: "readPage",
              key: pageKey,
              cached: true,
              summary: `缓存命中：${cached.page.title}`,
            },
            response: cached,
          };
        if (pageReads >= pageReadLimit)
          return { reject: `本轮 readPage 最多 ${pageReadLimit} 次。` };
        if (state.pages.size >= state.input.limit)
          return {
            reject: `已达到 limit=${state.input.limit} 的页面读取上限。`,
          };
        const result = this.tools.readPage(pageKey);
        state.pages.set(pageKey, result);
        return {
          observation: {
            tool: "readPage",
            key: pageKey,
            cached: false,
            summary: `读取 ${result.page.title}，含 ${result.page.keyFacts.length} 条 Facts`,
          },
          response: result,
        };
      }
      return { reject: `未知 Tool：${(action as { tool?: unknown }).tool}` };
    } catch (error) {
      return { reject: `${action.tool} 执行失败: ${errorMessage(error)}` };
    }
  }

  private acceptEvidence(
    state: LlmWikiAgentState,
    selected: EvidenceSelection[],
  ): number {
    const tasks = new Map(
      (state.plan?.tasks || []).map((task) => [task.taskId, task]),
    );
    let accepted = 0;
    for (const candidate of selected) {
      const task = tasks.get(string(candidate.taskId));
      const evidence = validateEvidence(state, task, candidate);
      if (!evidence) continue;
      const exists = state.evidence.some((item) =>
        sameEvidence(item, evidence),
      );
      if (!exists) {
        state.evidence.push({
          ...evidence,
          evidenceId: `E${state.evidence.length + 1}`,
        });
        accepted += 1;
      }
    }
    return accepted;
  }

  private evidenceGate(state: LlmWikiAgentState): {
    ok: boolean;
    gaps: string[];
  } {
    const gaps: string[] = [];
    if (state.conflicts.length)
      gaps.push(...state.conflicts.map((item) => `未解决冲突：${item}`));
    for (const task of state.plan?.tasks || []) {
      const evidence = state.evidence.filter(
        (item) => item.taskId === task.taskId,
      );
      if (!evidence.length) {
        gaps.push(`必答任务未覆盖：${task.question}`);
      }
    }
    return { ok: gaps.length === 0, gaps: unique(gaps) };
  }

  private async callJson<T = Record<string, unknown>>(
    ctx: AgentRunnerContext<LlmWikiAgentInput>,
    state: LlmWikiAgentState,
    args: {
      stage: string;
      model: string;
      system: string;
      payload: unknown;
      format: RawChatResponseFormat;
      maxTokens: number;
      final: boolean;
      retry: boolean;
      parse?: (value: Record<string, unknown>) => T;
    },
  ): Promise<T | null> {
    const prompt = JSON.stringify(args.payload);
    const estimatedInput = estimateTokens(args.system) + estimateTokens(prompt);
    const available = args.final
      ? TOKEN_LIMIT
      : TOKEN_LIMIT - FINAL_TOKEN_RESERVE;
    if (
      state.tokens.totalTokens + estimatedInput + args.maxTokens >
      available
    ) {
      state.stopReason = "token_limit";
      state.gaps.push("已达到 Agent Token 预算，保留最终汇总额度。");
      return null;
    }
    if (state.baseModelCalls >= MAX_MODEL_CALLS) {
      state.stopReason = "token_limit";
      state.gaps.push("已达到 6 个模型逻辑阶段上限。");
      return null;
    }
    state.baseModelCalls += 1;
    const attempts = args.retry ? 2 : 1;
    let lastError = "";
    let lastContent = "";
    for (let index = 0; index < attempts; index += 1) {
      this.assertActive(ctx);
      if (state.modelAttempts >= MAX_MODEL_ATTEMPTS) {
        state.stopReason = "token_limit";
        state.gaps.push("已达到模型调用上限。");
        return null;
      }
      if (index > 0 && state.retries >= MAX_MODEL_RETRIES) break;
      const messages: Array<{ role: string; content: string }> = [
        { role: "system", content: args.system },
        { role: "user", content: prompt },
      ];
      if (index > 0) {
        if (lastContent)
          messages.push({ role: "assistant", content: lastContent });
        messages.push({
          role: "user",
          content: `上次输出未通过校验：${truncate(lastError.replace(/\s+/g, " "), 300)}。请严格按 system 指定的 JSON 字段修正，只返回 JSON。`,
        });
      }
      const attemptInput = messages.reduce(
        (sum, message) => sum + estimateTokens(message.content),
        0,
      );
      if (
        state.tokens.totalTokens + attemptInput + args.maxTokens >
        available
      ) {
        state.stopReason = "token_limit";
        state.gaps.push("模型调用会超过 Agent Token 预算。");
        return null;
      }
      if (index > 0) {
        ctx.appendEvent({
          type: "model_json_retry",
          msg: `${args.stage} 正在纠正无效 JSON`,
          model: args.model,
          error: lastError,
        });
      }
      state.modelAttempts += 1;
      state.tokens.modelCalls += 1;
      state.tokens.rounds = state.tokens.modelCalls;
      let responseReceived = false;
      try {
        const response = await this.model.chat({
          model: args.model,
          messages,
          temperature: 0,
          response_format: args.format,
          maxTokens: args.maxTokens,
          signal: ctx.signal,
          onRequest: (request) =>
            ctx.appendEvent({
              type: "model_request",
              msg: `请求模型：${args.stage}`,
              stage: args.stage,
              attempt: index + 1,
              model: args.model,
              request,
            }),
          onResponse: (modelResponse) => {
            responseReceived = true;
            ctx.appendEvent({
              type: "model_response",
              msg: `模型返回：${args.stage}`,
              stage: args.stage,
              attempt: index + 1,
              model: args.model,
              response: modelResponse,
            });
          },
        });
        const content = responseContent(response);
        lastContent = content;
        state.tokens.inputTokens += attemptInput;
        state.tokens.outputTokens += estimateTokens(content);
        state.tokens.totalTokens =
          state.tokens.inputTokens + state.tokens.outputTokens;
        const value = parseJsonObject(content);
        return args.parse ? args.parse(value) : (value as T);
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        lastError = errorMessage(error);
        ctx.appendEvent({
          type: responseReceived ? "model_validation_error" : "model_error",
          msg: responseReceived
            ? `模型返回校验失败：${args.stage}`
            : `模型请求失败：${args.stage}`,
          stage: args.stage,
          attempt: index + 1,
          model: args.model,
          error: lastError,
        });
      }
      if (index + 1 < attempts && state.retries < MAX_MODEL_RETRIES)
        state.retries += 1;
    }
    ctx.appendEvent({
      type: "model_json_error",
      msg: `${args.stage} 未返回有效 JSON`,
      model: args.model,
      error: lastError,
    });
    return null;
  }

  private runnerMeta(state: LlmWikiAgentState): Record<string, unknown> {
    return {
      models: {
        fastModel: state.input.fastModel,
        qualityModel: state.input.qualityModel,
      },
      catalogFingerprint: state.catalogFingerprint,
      rounds: state.round,
      modelAttempts: state.modelAttempts,
      baseModelCalls: state.baseModelCalls,
      retries: state.retries,
      searches: state.searches.size,
      pages: state.pages.size,
      sourceReads: state.sources.size,
      evidenceCount: state.evidence.length,
      stopReason: state.stopReason,
    };
  }

  private finishResult(
    ctx: AgentRunnerContext<LlmWikiAgentInput>,
    state: LlmWikiAgentState,
    final: FinalAnswer,
  ): AgentRunnerResult {
    const runnerMeta = this.runnerMeta(state);
    ctx.updateRunnerMeta(runnerMeta);
    return {
      status: state.stopReason === "complete" ? "success" : "insufficient",
      content: final.answerMarkdown,
      resultJson: buildResultJson(state, final),
      runnerMeta,
      tokens: state.tokens,
      stats: {
        modelCalls: state.tokens.modelCalls,
        toolRounds: state.retrievalRounds.length,
        searches: state.searches.size,
        pages: state.pages.size,
        sourceReads: state.sources.size,
      },
    };
  }

  private assertActive(ctx: AgentRunnerContext<LlmWikiAgentInput>): void {
    if (ctx.signal.aborted) throw new Error("任务被用户取消");
  }
}

function emptyState(input: LlmWikiAgentInput): LlmWikiAgentState {
  return {
    query: input.query,
    input,
    catalog: null,
    plannerCatalog: null,
    catalogFingerprint: "",
    plan: null,
    round: 0,
    pages: new Map(),
    searches: new Map(),
    sources: new Map(),
    evidence: [],
    coverage: [],
    gaps: [],
    conflicts: [],
    retrievalRounds: [],
    stopReason: null,
    tokens: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      rounds: 0,
      modelCalls: 0,
      tokenLimit: TOKEN_LIMIT,
    },
    modelAttempts: 0,
    retries: 0,
    baseModelCalls: 0,
    lastRoundProgress: true,
    qualityReactNext: false,
    newObservations: {},
  };
}

function emptyPlan(): QueryPlan {
  return { relevant: true, tasks: [], actions: [] };
}

function plannerCatalog(catalog: ToolsCatalog): PlannerCatalogPage[] {
  return catalog.pages
    .map((page): PlannerCatalogPage => [page.pageKey, page.title, page.goal])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

function catalogFingerprint(catalog: ToolsCatalog): string {
  const value = {
    stats: catalog.stats,
    pages: catalog.pages
      .map((page) => ({
        ...page,
        sourceIds: [...page.sourceIds].sort(),
        relatedPageKeys: [...page.relatedPageKeys].sort(),
      }))
      .sort((a, b) => a.pageKey.localeCompare(b.pageKey)),
    sources: catalog.sources
      .map((source) => ({ ...source, pageKeys: [...source.pageKeys].sort() }))
      .sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
  };
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function toReactAction(action: PlannerAction): ReactAction {
  return action.tool === "searchWiki"
    ? { tool: "searchWiki", query: action.value }
    : { tool: "readPage", pageKey: action.value };
}

function toolRequest(action: ReactAction): Record<string, unknown> {
  if (action.tool === "searchWiki")
    return { query: action.query, reason: action.reason || undefined };
  if (action.tool === "readPage")
    return { pageKey: action.pageKey, reason: action.reason || undefined };
  return { reason: action.reason || undefined };
}

function normalizePlan(
  value: Record<string, unknown>,
  catalog: ToolsCatalog | null,
): QueryPlan {
  assertOnlyKeys(value, ["relevant", "tasks", "actions"], "Planner 输出");
  if (!catalog) throw new Error("Planner 校验失败：Catalog 未加载");
  const rawTasks = array(value.tasks);
  const rawActions = array(value.actions);
  if (typeof value.relevant !== "boolean") {
    throw new Error("Planner 校验失败：relevant 必须是 boolean");
  }
  if (!value.relevant) {
    if (rawTasks.length || rawActions.length) {
      throw new Error(
        "Planner 校验失败：relevant=false 时 tasks/actions 必须为空数组",
      );
    }
    return { relevant: false, tasks: [], actions: [] };
  }
  if (rawTasks.length < 1 || rawTasks.length > MAX_PLAN_TASKS) {
    throw new Error(`Planner 校验失败：tasks 必须为 1-${MAX_PLAN_TASKS} 项`);
  }
  const taskIds = new Set<string>();
  const taskQuestions = new Set<string>();
  const tasks = rawTasks.map((item): QueryTask => {
    const raw = record(item);
    assertOnlyKeys(raw, ["id", "question"], "Planner task");
    const taskId = string(raw.id);
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(taskId)) {
      throw new Error("Planner 校验失败：task.id 非法");
    }
    if (taskIds.has(taskId))
      throw new Error(`Planner 校验失败：task.id 重复 ${taskId}`);
    taskIds.add(taskId);
    const question = string(raw.question);
    if (!question || question.length > 300)
      throw new Error(`Planner 校验失败：task ${taskId} 的 question 非法`);
    const questionKey = question.toLocaleLowerCase().replace(/\s+/g, " ");
    if (taskQuestions.has(questionKey))
      throw new Error(`Planner 校验失败：task 问题重复 ${question}`);
    taskQuestions.add(questionKey);
    return {
      taskId,
      question,
    };
  });

  if (rawActions.length < 1 || rawActions.length > MAX_ACTIONS_PER_ROUND) {
    throw new Error(
      `Planner 校验失败：actions 必须为 1-${MAX_ACTIONS_PER_ROUND} 项`,
    );
  }
  const pageKeys = new Set(catalog.pages.map((page) => page.pageKey));
  const seenActions = new Set<string>();
  const actions = rawActions
    .map((item): PlannerAction | null => {
      const raw = record(item);
      assertOnlyKeys(raw, ["tool", "value"], "Planner action");
      const tool = string(raw.tool);
      const actionValue = string(raw.value).replace(/\s+/g, " ");
      if (!actionValue || actionValue.length > 300)
        throw new Error("Planner 校验失败：action.value 非法");
      if (tool !== "searchWiki" && tool !== "readPage")
        throw new Error(`Planner 校验失败：未知 action ${tool}`);
      if (tool === "readPage" && !pageKeys.has(actionValue)) {
        throw new Error(
          `Planner 校验失败：pageKey 不在 Catalog ${actionValue}`,
        );
      }
      const key = `${tool}:${actionValue}`;
      if (seenActions.has(key)) return null;
      seenActions.add(key);
      return { tool, value: actionValue };
    })
    .filter((item): item is PlannerAction => Boolean(item));
  if (!actions.length) throw new Error("Planner 校验失败：没有可执行 action");
  return { relevant: true, tasks, actions };
}

function normalizeReact(value: Record<string, unknown>): ReactDecision {
  const evidence = array(value.evidence)
    .map((item): EvidenceSelection | null => {
      const raw = record(item);
      const quote = string(raw.quote);
      const claim = string(raw.claim);
      const taskId = string(raw.taskId);
      if (!taskId || !quote || !claim) return null;
      const pageKey = string(raw.pageKey);
      const sourceId = string(raw.sourceId);
      const sourceLine = integer(raw.sourceLine);
      if (!pageKey && (!sourceId || !sourceLine))
        throw new Error(
          `evidence ${taskId} 缺少 pageKey 或 sourceId/sourceLine`,
        );
      return {
        taskId,
        kind: sourceId ? "source" : "page",
        pageKey: pageKey || undefined,
        sourceId: sourceId || undefined,
        quote,
        claim,
        sourceLine,
      };
    })
    .filter((item): item is EvidenceSelection => Boolean(item));
  const actions = array(value.actions)
    .map(normalizeAction)
    .filter((item): item is ReactAction => Boolean(item))
    .slice(0, MAX_ACTIONS_PER_ROUND);
  return {
    coverage: [],
    evidence,
    actions,
    conflicts: [],
    gaps: stringArray(value.missing),
    finish: value.finish === true,
    finishReason: "",
    escalateToQuality: false,
  };
}

function normalizeAction(value: unknown): ReactAction | null {
  const raw = record(value);
  const tool = string(raw.tool);
  const reason = string(raw.reason) || undefined;
  if (tool === "searchWiki") {
    const query = string(raw.query);
    if (!query) throw new Error("actions.searchWiki 缺少 query");
    return { tool, query, reason };
  }
  if (tool === "readPage") {
    const pageKey = string(raw.pageKey);
    if (!pageKey) throw new Error("actions.readPage 缺少 pageKey");
    return { tool, pageKey, reason };
  }
  if (tool === "finish") return { tool, reason };
  return null;
}

function normalizeFinal(value: Record<string, unknown>): FinalAnswer {
  return {
    answerable: value.answerable === true,
    answerMarkdown: string(value.answerMarkdown),
    citations: stringArray(value.citations),
    gaps: stringArray(value.gaps),
  };
}

function reactPayload(state: LlmWikiAgentState) {
  return {
    question: state.query,
    tasks: (state.plan?.tasks || []).map((task) => ({
      taskId: task.taskId,
      question: task.question,
    })),
    materials: {
      searches: [...state.searches.values()].map((result) => ({
        query: result.query,
        pages: result.items.map((item) => ({
          pageKey: item.pageKey,
          title: item.title,
          snippet: item.snippet,
        })),
      })),
      pages: [...state.pages.values()].map((detail) => ({
        pageKey: detail.page.pageKey,
        title: detail.page.title,
        content: truncate(detail.page.bodyMarkdown, 16_000),
        sourceIds: detail.sources.map((source) => source.sourceId),
      })),
      sources: [...state.sources.values()].map((detail) => ({
        sourceId: detail.source.sourceId,
        filename: detail.source.filename,
        startLine: detail.range.startLine,
        endLine: detail.range.endLine,
        content: truncate(detail.content, 16_000),
      })),
    },
    acceptedEvidence: state.evidence.map((item) =>
      item.kind === "source"
        ? {
            evidenceId: item.evidenceId,
            taskId: item.taskId,
            sourceId: item.sourceId,
            sourceLine: item.sourceLine,
            quote: item.quote,
            claim: item.claim,
          }
        : {
            evidenceId: item.evidenceId,
            taskId: item.taskId,
            pageKey: item.pageKey,
            quote: item.quote,
            claim: item.claim,
          },
    ),
  };
}

function observationPayload(
  state: LlmWikiAgentState,
  observations: RetrievalRound["observations"],
): Record<string, unknown> {
  const searches: unknown[] = [];
  const pages: unknown[] = [];
  const sources: unknown[] = [];
  for (const observation of observations) {
    if (observation.cached) continue;
    if (observation.tool === "searchWiki") {
      const result = state.searches.get(observation.key);
      if (result)
        searches.push({
          query: result.query,
          items: result.items.map((item) => ({
            pageKey: item.pageKey,
            title: item.title,
            goal: item.goal,
            matchedFacts: item.matchedFacts,
            snippet: item.snippet,
          })),
        });
      continue;
    }
    if (observation.tool === "readPage") {
      const detail = state.pages.get(observation.key);
      if (detail)
        pages.push({
          page: {
            pageKey: detail.page.pageKey,
            title: detail.page.title,
            goal: detail.page.goal,
            bodyMarkdown: truncate(detail.page.bodyMarkdown, 16_000),
            keyFacts: detail.page.keyFacts,
          },
          relations: detail.relations,
          sources: detail.sources,
        });
      continue;
    }
    if (observation.tool === "readSource") {
      const detail = state.sources.get(observation.key);
      if (detail)
        sources.push({
          source: detail.source,
          range: detail.range,
          content: truncate(detail.content, 16_000),
          factRefs: detail.factRefs,
        });
    }
  }
  return { searches, pages, sources };
}

function coverageFromEvidence(
  state: LlmWikiAgentState,
): ReactDecision["coverage"] {
  return (state.plan?.tasks || []).map((task) => {
    const count = state.evidence.filter(
      (item) => item.taskId === task.taskId,
    ).length;
    return {
      taskId: task.taskId,
      status: count > 0 ? "covered" : "missing",
      note: count > 0 ? `已有 ${count} 条已验证证据。` : "尚无已验证证据。",
    };
  });
}

function validateEvidence(
  state: LlmWikiAgentState,
  task: QueryTask | undefined,
  candidate: EvidenceSelection,
): Omit<VerifiedEvidence, "evidenceId"> | null {
  if (!task || !candidate.quote || candidate.quote.length > 1500) return null;
  if (candidate.kind === "page") {
    const page = state.pages.get(string(candidate.pageKey));
    if (!page) return null;
    if (!containsQuote(page.page.bodyMarkdown, candidate.quote)) return null;
    return {
      ...candidate,
      pageKey: page.page.pageKey,
    };
  }
  const sourceId = string(candidate.sourceId);
  const source = [...state.sources.values()].find(
    (item) =>
      item.source.sourceId === sourceId &&
      containsQuote(item.content, candidate.quote),
  );
  if (!source) return null;
  const sourceLine = candidate.sourceLine;
  if (
    sourceLine &&
    (sourceLine < source.range.startLine || sourceLine > source.range.endLine)
  )
    return null;
  return {
    ...candidate,
    sourceId,
    pageKey: candidate.pageKey,
    sourceFilename: source.source.filename,
    range: { startLine: source.range.startLine, endLine: source.range.endLine },
  };
}

function sameEvidence(
  a: Omit<VerifiedEvidence, "evidenceId"> | VerifiedEvidence,
  b: Omit<VerifiedEvidence, "evidenceId">,
): boolean {
  return (
    a.taskId === b.taskId &&
    a.kind === b.kind &&
    a.pageKey === b.pageKey &&
    a.sourceId === b.sourceId &&
    a.quote === b.quote
  );
}

function jsonSchema(
  name: string,
  schema: Record<string, unknown>,
): RawChatResponseFormat {
  return { type: "json_schema", json_schema: { name, strict: true, schema } };
}

function responseContent(response: unknown): string {
  const raw = response as {
    choices?: Array<{ message?: { content?: unknown }; text?: unknown }>;
  };
  const choice = raw.choices?.[0];
  const content = choice?.message?.content ?? choice?.text;
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((item) => (typeof item === "string" ? item : record(item).text))
      .join("");
  return "";
}

function parseJsonObject(value: string): Record<string, unknown> {
  const text = String(value || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/\s*```$/, "");
  if (!text) throw new Error("模型返回内容为空");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("模型返回不是合法 JSON");
  }
  if (!isRecord(parsed)) {
    const actual = Array.isArray(parsed)
      ? "array"
      : parsed === null
        ? "null"
        : typeof parsed;
    throw new Error(`模型返回 JSON 顶层必须是对象，实际为 ${actual}`);
  }
  return parsed;
}

function containsQuote(body: string, quote: string): boolean {
  const normalizedQuote = String(quote || "").trim();
  return (
    normalizedQuote.length > 0 && String(body || "").includes(normalizedQuote)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknown.length)
    throw new Error(`${label}包含未知字段: ${unknown.join(", ")}`);
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function stringArray(value: unknown): string[] {
  return array(value).map(string).filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(string).filter(Boolean))];
}

function estimateTokens(value: string): number {
  return Math.ceil(String(value || "").length / 4);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n...[truncated]`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
