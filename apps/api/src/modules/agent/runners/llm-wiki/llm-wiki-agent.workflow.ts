import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { ToolsCatalog } from "../../../llmWikiNext/llm-wiki-next.types";
import { ModelService, type RawChatResponseFormat } from "../../../model/model.service";
import type { AgentRunTokens, AgentRunnerContext, AgentRunnerResult } from "../../agent.types";
import { LlmWikiAgentTools } from "./llm-wiki-agent.tools";
import { appendVerifiedCitations, buildResultJson, fallbackMarkdown } from "./llm-wiki-agent-result";
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
  MAX_SOURCE_READS,
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
        required: ["id", "question", "evidence"],
        properties: {
          id: { type: "string", pattern: "^[A-Za-z0-9_-]{1,32}$" },
          question: { type: "string", minLength: 1, maxLength: 300 },
          evidence: { type: "string", enum: ["page", "fact", "source"] },
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
  required: ["coverage", "evidence", "actions", "conflicts", "gaps", "finish", "finishReason", "escalateToQuality"],
  properties: {
    coverage: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "status", "note"],
        properties: {
          taskId: { type: "string", maxLength: 48 },
          status: { type: "string", enum: ["covered", "partial", "missing"] },
          note: { type: "string", maxLength: 500 },
        },
      },
    },
    evidence: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "kind", "quote", "claim"],
        properties: {
          taskId: { type: "string", maxLength: 48 },
          kind: { type: "string", enum: ["page", "fact", "source"] },
          pageKey: { type: "string", maxLength: 200 },
          sourceId: { type: "string", maxLength: 64 },
          quote: { type: "string", minLength: 1, maxLength: 1500 },
          claim: { type: "string", minLength: 1, maxLength: 1500 },
          sourceLine: { type: "integer", minimum: 1 },
        },
      },
    },
    actions: {
      type: "array",
      maxItems: MAX_ACTIONS_PER_ROUND,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tool"],
        properties: {
          tool: { type: "string", enum: ["searchWiki", "readPage", "readSource", "finish"] },
          query: { type: "string", maxLength: 300 },
          pageKey: { type: "string", maxLength: 200 },
          sourceId: { type: "string", maxLength: 64 },
          startLine: { type: "integer", minimum: 1 },
          endLine: { type: "integer", minimum: 1 },
          reason: { type: "string", maxLength: 500 },
        },
      },
    },
    conflicts: { type: "array", maxItems: 12, items: { type: "string", maxLength: 500 } },
    gaps: { type: "array", maxItems: 12, items: { type: "string", maxLength: 500 } },
    finish: { type: "boolean" },
    finishReason: { type: "string", maxLength: 500 },
    escalateToQuality: { type: "boolean" },
  },
});

const FINAL_SCHEMA = jsonSchema("wiki_final_answer", {
  type: "object",
  additionalProperties: false,
  required: ["answerable", "answerMarkdown", "citations", "gaps"],
  properties: {
    answerable: { type: "boolean" },
    answerMarkdown: { type: "string", minLength: 1, maxLength: 30_000 },
    citations: { type: "array", maxItems: 24, items: { type: "string", maxLength: 80 } },
    gaps: { type: "array", maxItems: 12, items: { type: "string", maxLength: 500 } },
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
    if (unknown.length) throw new Error(`不支持旧 Agent 输入字段: ${unknown.join(", ")}`);
    const query = string(input.query);
    const fastModel = string(input.fastModel);
    const qualityModel = string(input.qualityModel);
    const limit = Number(input.limit);
    if (!query) throw new Error("query 不能为空");
    if (!fastModel || !qualityModel) throw new Error("fastModel 和 qualityModel 不能为空");
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new Error(`limit 必须是 1 到 ${MAX_LIMIT} 的整数`);
    }
    if (!this.model.findModel(fastModel)) throw new Error(`fastModel 不存在或未配置: ${fastModel}`);
    if (!this.model.findModel(qualityModel)) throw new Error(`qualityModel 不存在或未配置: ${qualityModel}`);
    return { query, limit, fastModel, qualityModel };
  }

  title(input: LlmWikiAgentInput): string {
    return input.query.slice(0, 120);
  }

  async start(ctx: AgentRunnerContext<LlmWikiAgentInput>): Promise<AgentRunnerResult> {
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
    ctx.appendEvent({ type: "catalog_loaded", msg: "已加载 Published Wiki 目录", stats: catalog.stats });

    state.plan = await this.createPlan(ctx, state);
    ctx.appendEvent({
      type: "plan_created",
      msg: state.plan.relevant ? "查询计划已生成" : "Planner 判定当前 Wiki 无相关信息",
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

    for (let round = 1; round <= MAX_REACT_ROUNDS && !state.stopReason; round += 1) {
      this.assertActive(ctx);
      state.round = round;
      const useQuality = state.qualityReactNext || state.conflicts.length > 0 || !state.lastRoundProgress;
      const decision = await this.react(ctx, state, useQuality ? "quality" : "fast");
      if (!decision) {
        state.lastRoundProgress = false;
        state.qualityReactNext = true;
        state.gaps.push("本轮 ReAct 未返回可解析 JSON，下一轮已升级质量模型。");
        continue;
      }

      const acceptedEvidence = this.acceptEvidence(state, decision.evidence);
      const actionResult = await this.executeActions(ctx, state, decision.actions, round);
      state.newObservations = observationPayload(state, actionResult.observations);
      state.coverage = decision.coverage;
      // conflicts 是当前仍未解决的冲突；质量轮可通过返回空数组明确关闭已核验的冲突。
      state.conflicts = unique(decision.conflicts);
      state.gaps = unique([...state.gaps, ...decision.gaps, ...actionResult.rejected]);
      state.lastRoundProgress = acceptedEvidence > 0 || actionResult.fresh > 0;
      state.qualityReactNext = decision.escalateToQuality || state.conflicts.length > 0 || !state.lastRoundProgress;

      const record: RetrievalRound = {
        round,
        model: useQuality ? ctx.input.qualityModel : ctx.input.fastModel,
        actions: decision.actions,
        observations: actionResult.observations,
        evidenceIds: state.evidence.slice(-acceptedEvidence).map((item) => item.evidenceId),
        coverage: decision.coverage,
        conflicts: decision.conflicts,
        gaps: decision.gaps,
        finish: decision.finish || decision.actions.some((item) => item.tool === "finish"),
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
        state.stopReason = state.tokens.totalTokens >= TOKEN_LIMIT - FINAL_TOKEN_RESERVE
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
      state.gaps = unique([...state.gaps, "检索期间 Published Wiki 已变化，不能混合版本证据。"]);
      state.evidence = [];
    }

    let final: FinalAnswer;
    if (state.stopReason === "complete") {
      final = await this.summarize(ctx, state);
      if (!final.answerable) {
        state.stopReason = "insufficient_evidence";
        state.gaps = unique([...state.gaps, ...final.gaps, "质量模型判断当前证据不足以作答。"]);
        final = { ...final, answerMarkdown: fallbackMarkdown(state) };
      } else {
        final = {
          ...final,
          answerMarkdown: appendVerifiedCitations(final.answerMarkdown, state, final.citations),
        };
      }
    } else {
      final = { answerable: false, answerMarkdown: fallbackMarkdown(state), citations: [], gaps: state.gaps };
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
        "你是 Wiki 查询规划器，只判断相关性并规划检索，不回答知识问题。",
        "输入 query 是用户问题；pages 每项为 [pageKey,title,goal]，分别表示页面ID、标题、内容目标。目录不是事实证据。",
        "仅当 query 与所有 pages 的 title/goal 完全没有语义关联时，返回 {\"relevant\":false,\"tasks\":[],\"actions\":[]}；只要存在可能相关页面，就必须 relevant=true 并继续规划。",
        "relevant=true 时，将 query 拆成 1-6 个必须回答且互不重复的 tasks，并给出 1-6 个首轮 actions。",
        "evidence：page=页面正文；fact=页面 keyFacts；source=带行号的原文。命令、配置、数字、安全或精确步骤必须用 source。",
        "首轮调用：可确定页面时使用 readPage，value 必须是目录中的 pageKey；否则使用 searchWiki，value 使用 2-4 个空格分隔的核心词。",
        "相关时唯一输出结构：{\"relevant\":true,\"tasks\":[{\"id\":\"t1\",\"question\":\"必须回答的问题\",\"evidence\":\"page\"}],\"actions\":[{\"tool\":\"readPage\",\"value\":\"页面ID\"}]}。",
        "tasks 每项只能有 id/question/evidence；actions 每项只能有 tool/value。不得使用 task、mustAnswer、priority、action 等字段名。",
        "禁止编造 pageKey，禁止输出答案、解释、Markdown 或额外字段；只返回 JSON。",
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
    const system = [
      "你是 LLM Wiki ReAct 决策器，只决定证据与下一步 Tool，不直接回答用户问题。",
      "只返回 JSON 对象，不得返回答案、解释、Markdown 或代码块。唯一顶层结构：{\"coverage\":[],\"evidence\":[],\"actions\":[],\"conflicts\":[],\"gaps\":[],\"finish\":false,\"finishReason\":\"\",\"escalateToQuality\":false}。",
      "coverage 项只能有 taskId/status/note，status 为 covered|partial|missing。evidence 项必须有 taskId/kind/quote/claim；page/fact 使用 pageKey，source 使用 sourceId/sourceLine。",
      "actions 项按 Tool 只使用对应字段：searchWiki(tool/query/reason)、readPage(tool/pageKey/reason)、readSource(tool/sourceId/startLine/endLine/reason)、finish(tool/reason)。",
      "只能从 Observation 中选择证据，禁止根据常识补充。所有数组无内容时返回 []，所有布尔值必须明确返回。",
      "每轮最多 6 个 Action。searchWiki/readPage/readSource 会由服务端校验、去重和限额；需要结束时设置 finish=true 或加入 finish Action。",
      "证据 quote 必须是 Observation 中逐字可查的片段。source 证据必须来自已读取 Source 的范围；fact 证据必须来自 page.keyFacts。",
      "若任务还缺精确命令、配置、数字或安全信息，先 readSource 对应行号窗口。",
      "不要重复请求已读内容；有冲突要报告 conflicts；无法推进时报告 gaps 并请求质量升级。",
      kind === "fast" ? "你是快速模型，遇到冲突、多源交叉或本轮无进展应设置 escalateToQuality=true。" : "你是质量模型，负责解决冲突、补齐多源证据并作出结束判断。",
    ].join("\n");
    const value = await this.callJson(ctx, state, {
      stage: `react_${state.round}`,
      model: kind === "fast" ? ctx.input.fastModel : ctx.input.qualityModel,
      system,
      payload: reactPayload(state),
      format: REACT_SCHEMA,
      maxTokens: 1500,
      final: false,
      retry: true,
    });
    return value ? normalizeReact(value) : null;
  }

  private async summarize(
    ctx: AgentRunnerContext<LlmWikiAgentInput>,
    state: LlmWikiAgentState,
  ): Promise<FinalAnswer> {
    const value = await this.callJson(ctx, state, {
      stage: "final",
      model: ctx.input.qualityModel,
      system: [
        "你是 LLM Wiki 最终汇总模型。只能基于输入中的已验证证据回答；不能引用未列出的页面、目录或搜索结果。",
        "引用只使用 evidenceId，写入 citations 数组；若证据无法回答问题，answerable=false，并明确 gaps。",
        "答案用中文，简洁、直接。对命令、配置、数字和安全结论仅在 Source 证据存在时陈述。",
        "只返回 JSON 对象，不得在 JSON 外输出解释或 Markdown。唯一结构：{\"answerable\":true,\"answerMarkdown\":\"答案正文\",\"citations\":[\"E1\"],\"gaps\":[]}。",
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
    if (!value) return { answerable: false, answerMarkdown: fallbackMarkdown(state), citations: [], gaps: ["最终汇总模型未返回有效 JSON。"] };
    const parsed = normalizeFinal(value);
    const validIds = new Set(state.evidence.map((item) => item.evidenceId));
    return { ...parsed, citations: parsed.citations.filter((id) => validIds.has(id)) };
  }

  private async executeActions(
    ctx: AgentRunnerContext<LlmWikiAgentInput>,
    state: LlmWikiAgentState,
    actions: ReactAction[],
    round: number,
  ): Promise<{ observations: RetrievalRound["observations"]; rejected: string[]; fresh: number }> {
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
      const result = this.executeAction(state, action, pageReads, pageReadLimit);
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
  ): { observation: RetrievalRound["observations"][number]; response: unknown } | { reject: string } {
    const catalog = state.catalog;
    if (!catalog) return { reject: "Catalog 尚未加载。" };
    const pageKeys = new Set(catalog.pages.map((item) => item.pageKey));
    const sourceById = new Map(catalog.sources.map((item) => [item.sourceId, item]));
    try {
      if (action.tool === "searchWiki") {
        const query = string(action.query);
        if (!query) return { reject: "searchWiki.query 不能为空。" };
        const cached = state.searches.get(query);
        if (cached) return { observation: { tool: "searchWiki", key: query, cached: true, summary: `缓存命中 ${cached.items.length} 个结果` }, response: cached };
        if (state.searches.size >= MAX_SEARCHES) return { reject: `已达到 ${MAX_SEARCHES} 次 searchWiki 上限。` };
        const result = this.tools.searchWiki(query);
        state.searches.set(query, result);
        return { observation: { tool: "searchWiki", key: query, cached: false, summary: `返回 ${result.items.length} 个结果` }, response: result };
      }
      if (action.tool === "readPage") {
        const pageKey = string(action.pageKey);
        if (!pageKey || !pageKeys.has(pageKey)) return { reject: `readPage.pageKey 不在当前 Catalog: ${pageKey || "(空)"}` };
        const cached = state.pages.get(pageKey);
        if (cached) return { observation: { tool: "readPage", key: pageKey, cached: true, summary: `缓存命中：${cached.page.title}` }, response: cached };
        if (pageReads >= pageReadLimit) return { reject: `本轮 readPage 最多 ${pageReadLimit} 次。` };
        if (state.pages.size >= state.input.limit) return { reject: `已达到 limit=${state.input.limit} 的页面读取上限。` };
        const result = this.tools.readPage(pageKey);
        state.pages.set(pageKey, result);
        return { observation: { tool: "readPage", key: pageKey, cached: false, summary: `读取 ${result.page.title}，含 ${result.page.keyFacts.length} 条 Facts` }, response: result };
      }
      const sourceId = string(action.sourceId);
      const source = sourceById.get(sourceId);
      if (!source) return { reject: `readSource.sourceId 不在当前 Catalog: ${sourceId || "(空)"}` };
      const range = resolveSourceRange(state, sourceId, source.lineCount, action.startLine, action.endLine);
      if (!range) return { reject: `readSource 需要已知 Fact 行号；仅行数不超过 200 的 Source 可不带行号整篇读取。` };
      const cacheKey = `${sourceId}:${range.startLine}-${range.endLine}`;
      const cached = state.sources.get(cacheKey);
      if (cached) return { observation: { tool: "readSource", key: cacheKey, cached: true, summary: `缓存命中 ${source.filename} L${range.startLine}-L${range.endLine}` }, response: cached };
      if (state.sources.size >= MAX_SOURCE_READS) return { reject: `已达到 ${MAX_SOURCE_READS} 次 readSource 上限。` };
      const result = this.tools.readSource(sourceId, range.startLine, range.endLine);
      state.sources.set(cacheKey, result);
      return { observation: { tool: "readSource", key: cacheKey, cached: false, summary: `读取 ${result.source.filename} L${result.range.startLine}-L${result.range.endLine}` }, response: result };
    } catch (error) {
      return { reject: `${action.tool} 执行失败: ${errorMessage(error)}` };
    }
  }

  private acceptEvidence(state: LlmWikiAgentState, selected: EvidenceSelection[]): number {
    const tasks = new Map((state.plan?.tasks || []).map((task) => [task.taskId, task]));
    let accepted = 0;
    for (const candidate of selected) {
      const task = tasks.get(string(candidate.taskId));
      const evidence = validateEvidence(state, task, candidate);
      if (!evidence) continue;
      const exists = state.evidence.some((item) => sameEvidence(item, evidence));
      if (!exists) {
        state.evidence.push({ ...evidence, evidenceId: `E${state.evidence.length + 1}` });
        accepted += 1;
      }
    }
    return accepted;
  }

  private evidenceGate(state: LlmWikiAgentState): { ok: boolean; gaps: string[] } {
    const gaps: string[] = [];
    if (state.conflicts.length) gaps.push(...state.conflicts.map((item) => `未解决冲突：${item}`));
    for (const task of state.plan?.tasks || []) {
      const evidence = state.evidence.filter((item) => item.taskId === task.taskId);
      if (!evidence.length) {
        gaps.push(`必答任务未覆盖：${task.question}`);
        continue;
      }
      if (task.evidenceRequirement === "fact" && !evidence.some((item) => item.kind === "fact")) {
        gaps.push(`任务需要 Page Fact 证据：${task.question}`);
      }
      if (task.evidenceRequirement === "source" && !evidence.some((item) => item.kind === "source" && item.range)) {
        gaps.push(`任务需要 Source 行号证据：${task.question}`);
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
    const available = args.final ? TOKEN_LIMIT : TOKEN_LIMIT - FINAL_TOKEN_RESERVE;
    if (state.tokens.totalTokens + estimatedInput + args.maxTokens > available) {
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
        if (lastContent) messages.push({ role: "assistant", content: lastContent });
        messages.push({
          role: "user",
          content: `上次输出未通过校验：${truncate(lastError.replace(/\s+/g, " "), 300)}。请严格按 system 指定的 JSON 字段修正，只返回 JSON。`,
        });
      }
      const attemptInput = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
      if (state.tokens.totalTokens + attemptInput + args.maxTokens > available) {
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
          onRequest: (request) => ctx.appendEvent({
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
        state.tokens.totalTokens = state.tokens.inputTokens + state.tokens.outputTokens;
        const value = parseJsonObject(content);
        return args.parse ? args.parse(value) : value as T;
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        lastError = errorMessage(error);
        ctx.appendEvent({
          type: responseReceived ? "model_validation_error" : "model_error",
          msg: responseReceived ? `模型返回校验失败：${args.stage}` : `模型请求失败：${args.stage}`,
          stage: args.stage,
          attempt: index + 1,
          model: args.model,
          error: lastError,
        });
      }
      if (index + 1 < attempts && state.retries < MAX_MODEL_RETRIES) state.retries += 1;
    }
    ctx.appendEvent({ type: "model_json_error", msg: `${args.stage} 未返回有效 JSON`, model: args.model, error: lastError });
    return null;
  }

  private runnerMeta(state: LlmWikiAgentState): Record<string, unknown> {
    return {
      models: { fastModel: state.input.fastModel, qualityModel: state.input.qualityModel },
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
    tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0, rounds: 0, modelCalls: 0, tokenLimit: TOKEN_LIMIT },
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
  if (action.tool === "searchWiki") return { query: action.query, reason: action.reason || undefined };
  if (action.tool === "readPage") return { pageKey: action.pageKey, reason: action.reason || undefined };
  if (action.tool === "readSource") {
    return {
      sourceId: action.sourceId,
      startLine: action.startLine,
      endLine: action.endLine,
      reason: action.reason || undefined,
    };
  }
  return { reason: action.reason || undefined };
}

function normalizePlan(value: Record<string, unknown>, catalog: ToolsCatalog | null): QueryPlan {
  assertOnlyKeys(value, ["relevant", "tasks", "actions"], "Planner 输出");
  if (!catalog) throw new Error("Planner 校验失败：Catalog 未加载");
  const rawTasks = array(value.tasks);
  const rawActions = array(value.actions);
  if (typeof value.relevant !== "boolean") {
    throw new Error("Planner 校验失败：relevant 必须是 boolean");
  }
  if (!value.relevant) {
    if (rawTasks.length || rawActions.length) {
      throw new Error("Planner 校验失败：relevant=false 时 tasks/actions 必须为空数组");
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
    assertOnlyKeys(raw, ["id", "question", "evidence"], "Planner task");
    const taskId = string(raw.id);
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(taskId)) {
      throw new Error("Planner 校验失败：task.id 非法");
    }
    if (taskIds.has(taskId)) throw new Error(`Planner 校验失败：task.id 重复 ${taskId}`);
    taskIds.add(taskId);
    const question = string(raw.question);
    if (!question || question.length > 300) throw new Error(`Planner 校验失败：task ${taskId} 的 question 非法`);
    const questionKey = question.toLocaleLowerCase().replace(/\s+/g, " ");
    if (taskQuestions.has(questionKey)) throw new Error(`Planner 校验失败：task 问题重复 ${question}`);
    taskQuestions.add(questionKey);
    const evidence = raw.evidence;
    if (evidence !== "page" && evidence !== "fact" && evidence !== "source") {
      throw new Error(`Planner 校验失败：task ${taskId} 的 evidence 非法`);
    }
    return {
      taskId,
      question,
      evidenceRequirement: evidence,
    };
  });

  if (rawActions.length < 1 || rawActions.length > MAX_ACTIONS_PER_ROUND) {
    throw new Error(`Planner 校验失败：actions 必须为 1-${MAX_ACTIONS_PER_ROUND} 项`);
  }
  const pageKeys = new Set(catalog.pages.map((page) => page.pageKey));
  const seenActions = new Set<string>();
  const actions = rawActions.map((item): PlannerAction | null => {
    const raw = record(item);
    assertOnlyKeys(raw, ["tool", "value"], "Planner action");
    const tool = string(raw.tool);
    const actionValue = string(raw.value).replace(/\s+/g, " ");
    if (!actionValue || actionValue.length > 300) throw new Error("Planner 校验失败：action.value 非法");
    if (tool !== "searchWiki" && tool !== "readPage") throw new Error(`Planner 校验失败：未知 action ${tool}`);
    if (tool === "readPage" && !pageKeys.has(actionValue)) {
      throw new Error(`Planner 校验失败：pageKey 不在 Catalog ${actionValue}`);
    }
    const key = `${tool}:${actionValue}`;
    if (seenActions.has(key)) return null;
    seenActions.add(key);
    return { tool, value: actionValue };
  }).filter((item): item is PlannerAction => Boolean(item));
  if (!actions.length) throw new Error("Planner 校验失败：没有可执行 action");
  return { relevant: true, tasks, actions };
}

function normalizeReact(value: Record<string, unknown>): ReactDecision {
  const coverage = array(value.coverage).map((item): ReactDecision["coverage"][number] => {
    const raw = record(item);
    const status: "covered" | "partial" | "missing" = raw.status === "covered" || raw.status === "partial" ? raw.status : "missing";
    return { taskId: string(raw.taskId), status, note: string(raw.note) };
  }).filter((item) => item.taskId);
  const evidence = array(value.evidence).map((item): EvidenceSelection | null => {
    const raw = record(item);
    const kind = raw.kind;
    if (kind !== "page" && kind !== "fact" && kind !== "source") return null;
    const quote = string(raw.quote);
    const claim = string(raw.claim);
    const taskId = string(raw.taskId);
    if (!taskId || !quote || !claim) return null;
    return {
      taskId,
      kind,
      pageKey: string(raw.pageKey) || undefined,
      sourceId: string(raw.sourceId) || undefined,
      quote,
      claim,
      sourceLine: integer(raw.sourceLine),
    };
  }).filter((item): item is EvidenceSelection => Boolean(item));
  const actions = array(value.actions).map(normalizeAction).filter((item): item is ReactAction => Boolean(item)).slice(0, MAX_ACTIONS_PER_ROUND);
  return {
    coverage,
    evidence,
    actions,
    conflicts: stringArray(value.conflicts),
    gaps: stringArray(value.gaps),
    finish: value.finish === true,
    finishReason: string(value.finishReason),
    escalateToQuality: value.escalateToQuality === true,
  };
}

function normalizeAction(value: unknown): ReactAction | null {
  const raw = record(value);
  const tool = string(raw.tool);
  const reason = string(raw.reason) || undefined;
  if (tool === "searchWiki") return { tool, query: string(raw.query), reason };
  if (tool === "readPage") return { tool, pageKey: string(raw.pageKey), reason };
  if (tool === "readSource") return { tool, sourceId: string(raw.sourceId), startLine: integer(raw.startLine), endLine: integer(raw.endLine), reason };
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
    query: state.query,
    plan: state.plan,
    round: state.round,
    budget: {
      maxRounds: MAX_REACT_ROUNDS,
      searchesRemaining: MAX_SEARCHES - state.searches.size,
      pageReadsRemaining: state.input.limit - state.pages.size,
      sourceReadsRemaining: MAX_SOURCE_READS - state.sources.size,
      actionsPerRound: MAX_ACTIONS_PER_ROUND,
    },
    previousCoverage: state.coverage,
    verifiedEvidence: state.evidence,
    gaps: state.gaps,
    conflicts: state.conflicts,
    observations: state.newObservations,
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
      if (result) searches.push({
        query: result.query,
        items: result.items.map((item) => ({ pageKey: item.pageKey, title: item.title, goal: item.goal, matchedFacts: item.matchedFacts, snippet: item.snippet })),
      });
      continue;
    }
    if (observation.tool === "readPage") {
      const detail = state.pages.get(observation.key);
      if (detail) pages.push({
        page: { pageKey: detail.page.pageKey, title: detail.page.title, goal: detail.page.goal, bodyMarkdown: truncate(detail.page.bodyMarkdown, 16_000), keyFacts: detail.page.keyFacts },
        relations: detail.relations,
        sources: detail.sources,
      });
      continue;
    }
    if (observation.tool === "readSource") {
      const detail = state.sources.get(observation.key);
      if (detail) sources.push({
        source: detail.source,
        range: detail.range,
        content: truncate(detail.content, 16_000),
        factRefs: detail.factRefs,
      });
    }
  }
  return { searches, pages, sources };
}

function validateEvidence(state: LlmWikiAgentState, task: QueryTask | undefined, candidate: EvidenceSelection): Omit<VerifiedEvidence, "evidenceId"> | null {
  if (!task || !candidate.quote || candidate.quote.length > 1500) return null;
  if (candidate.kind === "page") {
    const page = state.pages.get(string(candidate.pageKey));
    if (!page || !containsQuote(page.page.bodyMarkdown, candidate.quote)) return null;
    return { ...candidate, pageKey: page.page.pageKey, sourceId: candidate.sourceId, sourceFilename: sourceFilename(state, candidate.sourceId) };
  }
  if (candidate.kind === "fact") {
    const page = state.pages.get(string(candidate.pageKey));
    const fact = page?.page.keyFacts.find((item) => containsQuote(item.fact, candidate.quote));
    if (!page || !fact) return null;
    return {
      ...candidate,
      pageKey: page.page.pageKey,
      sourceId: fact.sourceId,
      sourceLine: fact.sourceLine ?? undefined,
      sourceFilename: sourceFilename(state, fact.sourceId),
    };
  }
  const sourceId = string(candidate.sourceId);
  const source = [...state.sources.values()].find((item) => item.source.sourceId === sourceId && containsQuote(item.content, candidate.quote));
  if (!source) return null;
  const sourceLine = candidate.sourceLine;
  if (sourceLine && (sourceLine < source.range.startLine || sourceLine > source.range.endLine)) return null;
  return {
    ...candidate,
    sourceId,
    pageKey: candidate.pageKey,
    sourceFilename: source.source.filename,
    range: { startLine: source.range.startLine, endLine: source.range.endLine },
  };
}

function resolveSourceRange(
  state: LlmWikiAgentState,
  sourceId: string,
  lineCount: number,
  startLine?: number,
  endLine?: number,
): { startLine: number; endLine: number } | null {
  if (Number.isInteger(startLine) || Number.isInteger(endLine)) {
    const start = Number.isInteger(startLine) ? Number(startLine) : 1;
    const end = Number.isInteger(endLine) ? Number(endLine) : Math.min(lineCount, start + 20);
    if (start < 1 || end < start || end > lineCount || end - start + 1 > 80) return null;
    return { startLine: start, endLine: end };
  }
  const facts = [...state.pages.values()].flatMap((page) => page.page.keyFacts).filter((fact) => fact.sourceId === sourceId && Number.isInteger(fact.sourceLine));
  const sourceLine = facts[0]?.sourceLine;
  if (sourceLine) return { startLine: Math.max(1, sourceLine - 10), endLine: Math.min(lineCount, sourceLine + 10) };
  if (lineCount <= 200) return { startLine: 1, endLine: lineCount };
  return null;
}

function sourceFilename(state: LlmWikiAgentState, sourceId?: string): string | undefined {
  return state.catalog?.sources.find((item) => item.sourceId === sourceId)?.filename;
}

function sameEvidence(a: Omit<VerifiedEvidence, "evidenceId"> | VerifiedEvidence, b: Omit<VerifiedEvidence, "evidenceId">): boolean {
  return a.taskId === b.taskId && a.kind === b.kind && a.pageKey === b.pageKey && a.sourceId === b.sourceId && a.quote === b.quote;
}

function jsonSchema(name: string, schema: Record<string, unknown>): RawChatResponseFormat {
  return { type: "json_schema", json_schema: { name, strict: true, schema } };
}

function responseContent(response: unknown): string {
  const raw = response as { choices?: Array<{ message?: { content?: unknown }; text?: unknown }> };
  const choice = raw.choices?.[0];
  const content = choice?.message?.content ?? choice?.text;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => typeof item === "string" ? item : record(item).text).join("");
  return "";
}

function parseJsonObject(value: string): Record<string, unknown> {
  const text = String(value || "").trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  if (!text) throw new Error("模型返回内容为空");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("模型返回不是合法 JSON");
  }
  if (!isRecord(parsed)) {
    const actual = Array.isArray(parsed) ? "array" : parsed === null ? "null" : typeof parsed;
    throw new Error(`模型返回 JSON 顶层必须是对象，实际为 ${actual}`);
  }
  return parsed;
}

function containsQuote(body: string, quote: string): boolean {
  const normalizedQuote = String(quote || "").trim();
  return normalizedQuote.length > 0 && String(body || "").includes(normalizedQuote);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknown.length) throw new Error(`${label}包含未知字段: ${unknown.join(", ")}`);
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
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
