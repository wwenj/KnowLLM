import { Injectable } from "@nestjs/common";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { ModelService } from "../../../model/model.service";
import { LlmWikiPage, LlmWikiPageRef } from "../../../llmWiki/contracts/llm-wiki.types";
import { agentConfig } from "../../agent.config";
import {
  AgentRunTokens,
  AgentRunnerContext,
  AgentRunnerResult,
} from "../../agent.types";
import { LlmWikiAgentTools } from "./llm-wiki-agent.tools";
import {
  buildKnowledgeSnippets,
  coverageSummaryFromState,
  defaultSourceReviewForPath,
  ensureAnswerMarkdownSections,
  fallbackMarkdown,
  normalizeSynthesis,
  pagesForKept,
  renderSnippetsMarkdown,
  resultJsonFromState,
} from "./llm-wiki-agent-result";
import {
  LlmWikiAgentInput,
  LlmWikiAgentState,
  LlmWikiBudget,
  DiscardedPage,
  KeptPage,
  KnowledgeSnippet,
  LlmWikiModels,
  LlmWikiSourcePolicy,
  PageHitReason,
  PlannedPageHit,
  QueryCoverage,
  QueryIntent,
  QueryPlan,
  QueryTask,
  RetrievalAction,
  RetrievedPage,
  RetrievalRound,
  SourceEvidence,
  SourceReview,
  SourceSupport,
  StopReason,
  WikiManifest,
} from "./llm-wiki-agent.types";

const State = Annotation.Root({
  query: Annotation<string>(),
  sourcePolicy: Annotation<LlmWikiSourcePolicy>(),
  budget: Annotation<LlmWikiBudget>(),
  models: Annotation<LlmWikiModels>(),
  manifest: Annotation<WikiManifest | null>(),
  plan: Annotation<QueryPlan | null>(),
  round: Annotation<number>(),
  candidatePages: Annotation<PlannedPageHit[]>(),
  pendingActions: Annotation<RetrievalAction[]>(),
  requestedSourceIds: Annotation<string[]>(),
  pages: Annotation<RetrievedPage[]>(),
  lastReadPages: Annotation<string[]>(),
  keptPages: Annotation<KeptPage[]>(),
  discardedPages: Annotation<DiscardedPage[]>(),
  retrievalRounds: Annotation<RetrievalRound[]>(),
  sources: Annotation<SourceEvidence[]>(),
  sourceReviews: Annotation<SourceReview[]>(),
  knowledgeSnippets: Annotation<KnowledgeSnippet[]>(),
  answerMarkdown: Annotation<string>(),
  resultJson: Annotation<Record<string, unknown>>(),
  stopReason: Annotation<StopReason | null>(),
  gaps: Annotation<string[]>(),
  coverageSummary: Annotation<string>(),
  tokens: Annotation<AgentRunTokens>(),
});

const DEFAULT_MAX_ROUNDS = 4;
const DEFAULT_MAX_EVIDENCE_PAGES = 48;
const DEFAULT_MAX_RAW_SOURCES = 12;

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
      description: "基于 LLM Wiki 的多轮证据驱动研究型查询 Agent",
    };
  }

  getDefaults(): Record<string, unknown> {
    return {
      sourcePolicy: "auto",
      budget: defaultBudget(),
      models: this.defaultModels(),
      modelOptions: this.model.listModels(),
    };
  }

  validateInput(input: unknown): LlmWikiAgentInput {
    const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const query = stringField(raw.query);
    if (!query) throw new Error("query 不能为空");
    const sourcePolicy = normalizeInputSourcePolicy(raw.sourcePolicy);
    const legacyLimit = Number(raw.limit);
    const budgetInput =
      Number.isFinite(legacyLimit) && legacyLimit > 0
        ? { ...(isRecord(raw.budget) ? raw.budget : {}), maxEvidencePages: legacyLimit }
        : raw.budget;
    const budget = resolveBudget(budgetInput);
    const modelsInput =
      !raw.models && typeof raw.model === "string"
        ? {
            plannerModel: raw.model,
            reviewerModel: raw.model,
            synthesizerModel: raw.model,
          }
        : raw.models;
    const models = resolveModels(modelsInput, this.defaultModels());
    this.assertModelsAvailable(models);
    return { query, sourcePolicy, budget, models };
  }

  title(input: LlmWikiAgentInput): string {
    return input.query.slice(0, 120);
  }

  async start(ctx: AgentRunnerContext<LlmWikiAgentInput>): Promise<AgentRunnerResult> {
    const tokens = emptyTokens(ctx.input.budget.tokenLimit);
    const graph = this.buildGraph(ctx);
    const initial: LlmWikiAgentState = {
      query: ctx.input.query,
      sourcePolicy: ctx.input.sourcePolicy,
      budget: ctx.input.budget,
      models: ctx.input.models,
      manifest: null,
      plan: null,
      round: 0,
      candidatePages: [],
      pendingActions: [],
      requestedSourceIds: [],
      pages: [],
      lastReadPages: [],
      keptPages: [],
      discardedPages: [],
      retrievalRounds: [],
      sources: [],
      sourceReviews: [],
      knowledgeSnippets: [],
      answerMarkdown: "",
      resultJson: {},
      stopReason: null,
      gaps: [],
      coverageSummary: "",
      tokens,
    };
    ctx.appendEvent({
      type: "start",
      msg: "开始执行 LLM Wiki Agent",
      query: ctx.input.query,
      sourcePolicy: ctx.input.sourcePolicy,
      budget: ctx.input.budget,
      models: ctx.input.models,
    });
    const finalState = (await graph.invoke(initial)) as LlmWikiAgentState;
    const status = finalState.stopReason === "insufficient_evidence" ? "insufficient" : "success";
    return {
      status,
      content: finalState.answerMarkdown || "未生成有效结果。",
      resultJson: finalState.resultJson,
      runnerMeta: {
        sourcePolicy: ctx.input.sourcePolicy,
        budget: ctx.input.budget,
        pageCount: finalState.pages.length,
        keptPageCount: finalState.keptPages.length,
        sourceCount: finalState.sources.length,
        rounds: finalState.round,
        stopReason: finalState.stopReason,
        models: ctx.input.models,
      },
      tokens: finalState.tokens,
      stats: {
        modelCalls: finalState.tokens.modelCalls,
        toolRounds: finalState.pages.length + finalState.sources.length + finalState.retrievalRounds.length,
      },
    };
  }

  private buildGraph(ctx: AgentRunnerContext<LlmWikiAgentInput>) {
    return new StateGraph(State)
      .addNode("load_manifest", async (state) => this.loadManifest(ctx, state))
      .addNode("plan_query", async (state) => this.planQuery(ctx, state))
      .addNode("collect_initial_candidates", async (state) => this.collectInitialCandidates(ctx, state))
      .addNode("read_page_batch", async (state) => this.readPageBatch(ctx, state))
      .addNode("review_evidence", async (state) => this.reviewEvidence(ctx, state))
      .addNode("execute_next_actions", async (state) => this.executeNextActions(ctx, state))
      .addNode("read_raw_sources", async (state) => this.readRawSources(ctx, state))
      .addNode("review_sources", async (state) => this.reviewSources(ctx, state))
      .addNode("build_final_snippets", async (state) => this.buildFinalSnippets(ctx, state))
      .addNode("maybe_synthesize", async (state) => this.maybeSynthesize(ctx, state))
      .addNode("finish", async (state) => this.finish(ctx, state))
      .addEdge(START, "load_manifest")
      .addEdge("load_manifest", "plan_query")
      .addConditionalEdges(
        "plan_query",
        (state: LlmWikiAgentState) => (state.stopReason ? "finalize" : "collect"),
        {
          collect: "collect_initial_candidates",
          finalize: "read_raw_sources",
        },
      )
      .addEdge("collect_initial_candidates", "read_page_batch")
      .addEdge("read_page_batch", "review_evidence")
      .addConditionalEdges(
        "review_evidence",
        (state: LlmWikiAgentState) => (state.stopReason ? "finalize" : "continue"),
        {
          continue: "execute_next_actions",
          finalize: "read_raw_sources",
        },
      )
      .addConditionalEdges(
        "execute_next_actions",
        (state: LlmWikiAgentState) => (state.stopReason ? "finalize" : "read"),
        {
          read: "read_page_batch",
          finalize: "read_raw_sources",
        },
      )
      .addEdge("read_raw_sources", "review_sources")
      .addEdge("review_sources", "build_final_snippets")
      .addEdge("build_final_snippets", "maybe_synthesize")
      .addEdge("maybe_synthesize", "finish")
      .addEdge("finish", END)
      .compile();
  }

  private async loadManifest(
    ctx: AgentRunnerContext<LlmWikiAgentInput>,
    state: LlmWikiAgentState,
  ): Promise<Partial<LlmWikiAgentState>> {
    this.assertActive(ctx);
    const loaded = this.tools.getManifest();
    const manifest: WikiManifest = { ...loaded, index: truncate(loaded.index, 8000) };
    ctx.appendEvent({
      type: "manifest_loaded",
      msg: "已加载 LLM Wiki 导航索引",
      stats: manifest.stats,
      pages: manifest.pages.slice(0, 80),
    });
    return { manifest };
  }

  private async planQuery(
    ctx: AgentRunnerContext<LlmWikiAgentInput>,
    state: LlmWikiAgentState,
  ): Promise<Partial<LlmWikiAgentState>> {
    this.assertActive(ctx);
    const payload = compactPayloadForBudget(state, {
      output_schema: {
        queryIntent: "overview | specific | compare | howto | debug",
        keywords: "string[]",
        entities: "string[]",
        tasks:
          "array of {goal:string, requiredPaths:string[], optionalPaths:string[], searchQueries:string[], expectedContribution:string}",
        coverage: "{coreTopics:string[], optionalTopics:string[], excludedTopics:string[]}",
        candidatePaths: "string[]",
        searchQueries: "string[]",
        reason: "string",
      },
      query: state.query,
      sourcePolicy: state.sourcePolicy,
      budget: state.budget,
      manifest: manifestForPrompt(state.manifest),
    });
    if (!payload) {
      ctx.appendEvent({
        type: "plan_skipped",
        msg: "Token 预算不足，无法构造初始检索计划输入",
        status: "failed",
      });
      return {
        stopReason: "token_limit",
        gaps: uniqueStrings([...state.gaps, "Token 预算不足，无法构造初始检索计划输入。"]),
      };
    }
    const { value, tokens } = await this.callJsonWithRetry(ctx, state, {
      model: state.models.plannerModel,
      phase: "plan_query",
      temperature: 0,
      system: [
        "你是 LLM Wiki 查询规划器。只输出 JSON,不要输出 Markdown。",
        "你只负责初始任务拆解和第一批候选页面,不是最终裁判。",
        "requiredPaths 代表第一轮必须读取的候选页面,后续 reviewer 可以移除。",
        "optionalPaths 和 searchQueries 用来扩大第一轮召回。",
        "不要编造 wiki path; path 必须来自 manifest.pages 或 index 中明确出现的页面。",
      ].join("\n"),
      payload,
    });
    const plan = normalizePlan(value, state.query);
    ctx.appendEvent({ type: "plan_created", msg: "已生成初始检索计划", plan });
    return { plan, tokens };
  }

  private async collectInitialCandidates(
    ctx: AgentRunnerContext<LlmWikiAgentInput>,
    state: LlmWikiAgentState,
  ): Promise<Partial<LlmWikiAgentState>> {
    this.assertActive(ctx);
    const plan = state.plan || fallbackPlan(state.query);
    const byPath = new Map<string, PlannedPageHit>();
    const queries: string[] = [];
    let order = 0;

    const upsert = (hit: PlannedPageHit) => {
      const prev = byPath.get(hit.path);
      if (!prev || compareHits(hit, prev) < 0) byPath.set(hit.path, hit);
    };

    const addPath = (task: QueryTask, taskIndex: number, path: string, why: PageHitReason) => {
      if (!isKnownWikiPath(state.manifest, path)) {
        ctx.appendEvent({
          type: "candidate_skipped",
          msg: `跳过非法或不存在的 wiki 页面: ${path}`,
          status: "failed",
          path,
          taskGoal: task.goal,
        });
        return;
      }
      const ref = pageRef(state.manifest, path);
      upsert({
        path,
        title: ref?.title || path,
        type: ref?.type || "concept",
        tags: ref?.tags || [],
        sources: ref?.sources || [],
        snippet: "",
        score: scorePlannedPage({ baseScore: 0, pageType: ref?.type || "", reason: why, taskIndex }),
        taskIndex,
        taskGoal: task.goal,
        taskContribution: task.expectedContribution,
        why,
        required: why === "required_path",
        order: order++,
      });
    };

    plan.tasks.forEach((task, taskIndex) => {
      for (const path of task.requiredPaths) addPath(task, taskIndex, path, "required_path");
      for (const query of task.searchQueries.slice(0, 4)) {
        queries.push(query);
        const res = this.tools.searchWiki(query, Math.min(Math.max(state.budget.maxEvidencePages, 12), 60));
        for (const hit of res.hits) {
          if (!isKnownWikiPath(state.manifest, hit.path)) continue;
          upsert({
            ...hit,
            score: scorePlannedPage({
              baseScore: hit.score,
              pageType: hit.type,
              reason: "search_hit",
              taskIndex,
            }),
            taskIndex,
            taskGoal: task.goal,
            taskContribution: task.expectedContribution,
            why: "search_hit",
            required: false,
            order: order++,
          });
        }
      }
    });

    plan.tasks.forEach((task, taskIndex) => {
      for (const path of task.optionalPaths) addPath(task, taskIndex, path, "optional_path");
    });
    const defaultTask = plan.tasks[0] || fallbackPlan(state.query).tasks[0];
    for (const path of plan.candidatePaths) {
      addPath(defaultTask, 0, path, "optional_path");
    }

    const candidatePages = [...byPath.values()]
      .sort(compareHits)
      .slice(0, state.budget.maxEvidencePages);
    const pendingActions = candidatePages.map(pageHitToAction);
    ctx.appendEvent({
      type: "candidates_collected",
      msg: `已收集第一轮候选页面 ${candidatePages.length} 个`,
      queries: uniqueStrings(queries.length ? queries : plan.searchQueries),
      hits: candidatePages,
    });
    return { candidatePages, pendingActions };
  }

  private async readPageBatch(
    ctx: AgentRunnerContext<LlmWikiAgentInput>,
    state: LlmWikiAgentState,
  ): Promise<Partial<LlmWikiAgentState>> {
    this.assertActive(ctx);
    const pages = [...state.pages];
    const seen = new Set(pages.map((page) => page.path));
    const lastReadPages: string[] = [];
    const remaining = Math.max(0, state.budget.maxEvidencePages - pages.length);
    const readActions = state.pendingActions
      .filter((action) => action.type === "read_page" || action.type === "follow_link")
      .filter((action) => action.path && !seen.has(action.path))
      .slice(0, remaining);

    for (const action of readActions) {
      const path = String(action.path || "");
      if (!isKnownWikiPath(state.manifest, path)) {
        ctx.appendEvent({
          type: "page_read",
          msg: `跳过非法或不存在的 wiki 页面: ${path}`,
          status: "failed",
          path,
        });
        continue;
      }
      try {
        const page = this.tools.readWikiPage(path);
        const retrieved = toRetrievedPage(page, action, state.round + 1);
        pages.push(retrieved);
        seen.add(page.path);
        lastReadPages.push(page.path);
        ctx.appendEvent({
          type: "page_read",
          msg: `读取 wiki 页面: ${page.path}`,
          path: page.path,
          title: page.title,
          sources: page.sources,
          taskGoal: retrieved.taskGoal,
          why: retrieved.why,
          round: state.round + 1,
        });
      } catch (err) {
        ctx.appendEvent({
          type: "page_read",
          msg: `读取 wiki 页面失败: ${path}`,
          status: "failed",
          path,
          error: formatError(err),
        });
      }
    }
    return { pages, lastReadPages, pendingActions: [] };
  }

  private async reviewEvidence(
    ctx: AgentRunnerContext<LlmWikiAgentInput>,
    state: LlmWikiAgentState,
  ): Promise<Partial<LlmWikiAgentState>> {
    this.assertActive(ctx);
    const round = state.round + 1;
    if (!hasRemainingTokenBudget(state.tokens, 256)) {
      const retrievalRound = makeRetrievalRound(round, state.lastReadPages, state.keptPages, [], [], null, "token_limit");
      return {
        round,
        retrievalRounds: [...state.retrievalRounds, retrievalRound],
        stopReason: "token_limit",
        gaps: uniqueStrings([...state.gaps, "Token 预算已用尽，无法继续证据审查。"]),
      };
    }

    const payload = compactPayloadForBudget(state, {
      output_schema: {
        keepPages:
          "array of {path:string, taskGoals:string[], relevanceScore:number, evidenceScore:number, whyKept:string}",
        dropPages: "array of {path:string, reason:string}",
        coverage: "object describing per-task coverage and missing evidence",
        gaps: "string[]",
        nextActions:
          "array of {type:'read_page'|'search_wiki'|'follow_link'|'read_source'|'stop', path?:string, query?:string, fromPath?:string, sourceId?:string, reason?:string}",
        stop: "boolean",
        stopReason: "complete | insufficient_evidence | null",
      },
      query: state.query,
      round,
      maxRounds: state.budget.maxRounds,
      plan: state.plan,
      schema: schemaForPrompt(state.manifest),
      readPages: state.pages.map((page) => pageForReviewPrompt(page)),
      previousKeptPages: state.keptPages,
      previousRounds: state.retrievalRounds,
      allowedActions: ["read_page", "search_wiki", "follow_link", "read_source", "stop"],
    });

    if (!payload) {
      const retrievalRound = makeRetrievalRound(round, state.lastReadPages, state.keptPages, [], [], null, "token_limit");
      return {
        round,
        retrievalRounds: [...state.retrievalRounds, retrievalRound],
        stopReason: "token_limit",
        gaps: uniqueStrings([...state.gaps, "Token 预算不足，无法构造 evidence review 输入。"]),
      };
    }

    const { value, tokens } = await this.callJsonWithRetry(ctx, state, {
      model: state.models.reviewerModel,
      phase: "review_evidence",
      temperature: 0,
      system: [
        "你是 LLM Wiki evidence reviewer。只输出 JSON,不要输出 Markdown。",
        "你必须基于已读取 Wiki 页面判断 keep/drop、覆盖度、缺口和下一步动作。",
        "planner 的 requiredPaths 只是初始候选,你可以丢弃无关页面。",
        "如果证据足够,输出 stop=true 和 stopReason=complete。",
        "如果还缺证据,只能使用允许动作继续检索; 不要编造 path/sourceId。",
        "如果 Wiki 没有足够材料,输出 stop=true 和 stopReason=insufficient_evidence。",
      ].join("\n"),
      payload,
    });

    const review = normalizeEvidenceReview(value, state, round);
    const nextActions = review.stop ? [] : review.nextActions;
    const stopReason = decideStopReason(review, round, state.budget.maxRounds);
    const requestedSourceIds = mergeRequestedSourceIds(state.requestedSourceIds, review.nextActions, state.manifest);
    const retrievalRound = makeRetrievalRound(
      round,
      state.lastReadPages,
      review.keepPages,
      review.dropPages,
      nextActions,
      review.coverage,
      stopReason,
    );
    ctx.appendEvent({
      type: "evidence_reviewed",
      msg: `第 ${round} 轮证据审查完成`,
      round,
      keptPages: review.keepPages.map((page) => page.path),
      droppedPages: review.dropPages.map((page) => page.path),
      nextActions,
      stopReason,
      coverage: review.coverage,
    });
    return {
      round,
      keptPages: review.keepPages,
      discardedPages: mergeDiscardedPages(state.discardedPages, review.dropPages),
      retrievalRounds: [...state.retrievalRounds, retrievalRound],
      pendingActions: nextActions,
      requestedSourceIds,
      stopReason,
      gaps: uniqueStrings([...state.gaps, ...review.gaps]),
      tokens,
    };
  }

  private async executeNextActions(
    ctx: AgentRunnerContext<LlmWikiAgentInput>,
    state: LlmWikiAgentState,
  ): Promise<Partial<LlmWikiAgentState>> {
    this.assertActive(ctx);
    const nextPageActions: RetrievalAction[] = [];
    const requestedSourceIds = new Set(state.requestedSourceIds);
    const seen = new Set(state.pages.map((page) => page.path));
    const remaining = Math.max(0, state.budget.maxEvidencePages - state.pages.length);

    for (const action of state.pendingActions) {
      if (action.type === "stop") {
        return { stopReason: "complete", pendingActions: [] };
      }
      if (action.type === "read_source") {
        if (isKnownSourceId(state.manifest, action.sourceId)) requestedSourceIds.add(String(action.sourceId));
        continue;
      }
      if (nextPageActions.length >= remaining) break;
      if (action.type === "search_wiki") {
        const query = stringField(action.query);
        if (!query) continue;
        const res = this.tools.searchWiki(query, Math.min(remaining + 8, 24));
        ctx.appendEvent({
          type: "action_search_done",
          msg: `执行 reviewer 检索: ${query}`,
          query,
          hitCount: res.hits.length,
          round: state.round,
        });
        for (const hit of res.hits) {
          if (nextPageActions.length >= remaining) break;
          if (seen.has(hit.path) || !isKnownWikiPath(state.manifest, hit.path)) continue;
          nextPageActions.push({
            type: "read_page",
            path: hit.path,
            reason: action.reason,
            taskIndex: action.taskIndex ?? inferTaskIndexForPath(hit.path, state.plan),
            taskGoal: action.taskGoal || inferTaskGoalForPath(hit.path, state.plan),
            taskContribution: inferTaskContributionForPath(hit.path, state.plan),
            why: "search_hit",
            score: scorePlannedPage({
              baseScore: hit.score,
              pageType: hit.type,
              reason: "search_hit",
              taskIndex: action.taskIndex ?? inferTaskIndexForPath(hit.path, state.plan),
            }),
            required: false,
          });
          seen.add(hit.path);
        }
        continue;
      }
      if (action.type === "follow_link") {
        const fromPath = stringField(action.fromPath);
        const path = stringField(action.path);
        const fromPage = state.pages.find((page) => page.path === fromPath);
        if (!fromPage || !path || seen.has(path) || !isKnownWikiPath(state.manifest, path)) continue;
        if (!fromPage.links.includes(path)) continue;
        nextPageActions.push({
          ...action,
          type: "read_page",
          taskIndex: fromPage.taskIndex,
          taskGoal: fromPage.taskGoal,
          taskContribution: fromPage.taskContribution,
          why: "linked_page",
          score: scorePlannedPage({
            baseScore: Number(action.score || 0),
            pageType: pageRef(state.manifest, path)?.type || "",
            reason: "linked_page",
            taskIndex: fromPage.taskIndex,
          }),
          required: false,
        });
        seen.add(path);
        continue;
      }
      if (action.type === "read_page") {
        const path = stringField(action.path);
        if (!path || seen.has(path) || !isKnownWikiPath(state.manifest, path)) continue;
        nextPageActions.push({
          ...action,
          taskIndex: action.taskIndex ?? inferTaskIndexForPath(path, state.plan),
          taskGoal: action.taskGoal || inferTaskGoalForPath(path, state.plan),
          taskContribution: action.taskContribution || inferTaskContributionForPath(path, state.plan),
          why: action.why || "search_hit",
          score:
            typeof action.score === "number"
              ? action.score
              : scorePlannedPage({
                  baseScore: 0,
                  pageType: pageRef(state.manifest, path)?.type || "",
                  reason: action.why || "search_hit",
                  taskIndex: action.taskIndex ?? inferTaskIndexForPath(path, state.plan),
                }),
          required: Boolean(action.required),
        });
        seen.add(path);
      }
    }

    if (nextPageActions.length === 0) {
      ctx.appendEvent({
        type: "next_actions_executed",
        msg: "没有可继续执行的检索动作，进入最终核验",
        requestedSourceIds: [...requestedSourceIds],
        round: state.round,
      });
      return {
        pendingActions: [],
        requestedSourceIds: [...requestedSourceIds],
        stopReason: state.keptPages.length ? "no_new_actions" : "insufficient_evidence",
      };
    }

    ctx.appendEvent({
      type: "next_actions_executed",
      msg: `已生成下一轮读取动作 ${nextPageActions.length} 个`,
      actions: nextPageActions,
      requestedSourceIds: [...requestedSourceIds],
      round: state.round,
    });
    return {
      pendingActions: nextPageActions,
      requestedSourceIds: [...requestedSourceIds],
      stopReason: null,
    };
  }

  private async readRawSources(
    ctx: AgentRunnerContext<LlmWikiAgentInput>,
    state: LlmWikiAgentState,
  ): Promise<Partial<LlmWikiAgentState>> {
    this.assertActive(ctx);
    if (state.sourcePolicy === "wiki-only" || state.budget.maxRawSources <= 0) {
      ctx.appendEvent({
        type: "sources_skipped",
        msg:
          state.sourcePolicy === "wiki-only"
            ? "sourcePolicy=wiki-only，跳过 raw source 读取"
            : "maxRawSources=0，跳过 raw source 读取",
        sourcePolicy: state.sourcePolicy,
        maxRawSources: state.budget.maxRawSources,
      });
      return { sources: [] };
    }
    const keptPages = pagesForKept(state);
    const selected = selectSourceRefs(
      keptPages,
      state.sourcePolicy,
      state.requestedSourceIds,
      state.budget.maxRawSources,
    );
    const sources: SourceEvidence[] = [];
    for (const source of selected) {
      try {
        const raw = this.tools.readRawSource(source.source_id);
        sources.push({
          source_id: raw.source_id,
          filename: raw.filename,
          content: truncate(raw.content, 10000),
          taskGoals: source.taskGoals,
          pagePaths: source.pagePaths,
          supportSummary: "",
        });
        ctx.appendEvent({
          type: "source_verified",
          msg: `读取 raw source: ${raw.filename}`,
          source_id: raw.source_id,
          filename: raw.filename,
          taskGoals: source.taskGoals,
          pagePaths: source.pagePaths,
        });
      } catch (err) {
        ctx.appendEvent({
          type: "source_verified",
          msg: `读取 raw source 失败: ${source.source_id}`,
          status: "failed",
          source_id: source.source_id,
          error: formatError(err),
        });
      }
    }
    return { sources };
  }

  private async reviewSources(
    ctx: AgentRunnerContext<LlmWikiAgentInput>,
    state: LlmWikiAgentState,
  ): Promise<Partial<LlmWikiAgentState>> {
    this.assertActive(ctx);
    if (!state.keptPages.length) {
      return {
        sourceReviews: [],
        coverageSummary: "未保留足够 Wiki 页面，无法完成 source 核验。",
        stopReason: state.stopReason || "insufficient_evidence",
      };
    }
    if (!hasRemainingTokenBudget(state.tokens, 256)) {
      return {
        sourceReviews: defaultSourceReviews(state),
        coverageSummary: "Token 预算已用尽，source support 使用未核验状态。",
        stopReason: state.stopReason || "token_limit",
        gaps: uniqueStrings([...state.gaps, "Token 预算已用尽，无法完成 raw source 核验。"]),
      };
    }
    const payload = compactPayloadForBudget(state, {
      output_schema: {
        sourceReviews: "array of {path:string, sourceSupport:'verified'|'wiki-only'|'partial'|'conflict'|'unknown', supportSummary:string}",
        gaps: "string[]",
        coverageSummary: "string",
      },
      query: state.query,
      sourcePolicy: state.sourcePolicy,
      keptPages: pagesForKept(state).map((page) => pageForReviewPrompt(page)),
      rawSources: state.sources.map((source) => ({
        source_id: source.source_id,
        filename: source.filename,
        pagePaths: source.pagePaths,
        content: truncate(source.content, 5000),
      })),
    });
    if (!payload) {
      return {
        sourceReviews: defaultSourceReviews(state),
        coverageSummary: "Token 预算不足，source support 使用未核验状态。",
        stopReason: state.stopReason || "token_limit",
        gaps: uniqueStrings([...state.gaps, "Token 预算不足，无法构造 source review 输入。"]),
      };
    }
    const { value, tokens } = await this.callJsonWithRetry(ctx, state, {
      model: state.models.reviewerModel,
      phase: "review_sources",
      temperature: 0,
      system: [
        "你是 LLM Wiki source reviewer。只输出 JSON,不要输出 Markdown。",
        "你必须判断最终保留的 Wiki 页面是否被 raw source 支撑。",
        "wiki-only 策略下 sourceSupport 必须是 wiki-only。",
        "发现冲突或证据不足时必须明确写入 gaps。",
      ].join("\n"),
      payload,
    });
    const normalized = normalizeSourceReview(value, state);
    ctx.appendEvent({
      type: "sources_reviewed",
      msg: "raw source 核验完成",
      sourceReviews: normalized.sourceReviews,
      coverageSummary: normalized.coverageSummary,
    });
    return {
      sourceReviews: normalized.sourceReviews,
      coverageSummary: normalized.coverageSummary,
      gaps: uniqueStrings([...state.gaps, ...normalized.gaps]),
      sources: state.sources.map((source) => ({
        ...source,
        supportSummary: normalized.sourceReviews
          .filter((review) => source.pagePaths.includes(review.path))
          .map((review) => review.supportSummary)
          .filter(Boolean)
          .join("\n"),
      })),
      tokens,
    };
  }

  private async buildFinalSnippets(
    ctx: AgentRunnerContext<LlmWikiAgentInput>,
    state: LlmWikiAgentState,
  ): Promise<Partial<LlmWikiAgentState>> {
    this.assertActive(ctx);
    const knowledgeSnippets = buildKnowledgeSnippets(state);
    const answerMarkdown = renderSnippetsMarkdown(state, knowledgeSnippets);
    const resultJson = resultJsonFromState(state, answerMarkdown, knowledgeSnippets);
    ctx.appendEvent({
      type: "snippets_built",
      msg: `已生成最终知识片段 ${knowledgeSnippets.length} 个`,
      snippets: knowledgeSnippets.map((snippet) => ({
        path: snippet.path,
        title: snippet.title,
        sourceSupport: snippet.sourceSupport,
        selectedInRound: snippet.selectedInRound,
      })),
    });
    return { knowledgeSnippets, answerMarkdown, resultJson };
  }

  private async maybeSynthesize(
    ctx: AgentRunnerContext<LlmWikiAgentInput>,
    state: LlmWikiAgentState,
  ): Promise<Partial<LlmWikiAgentState>> {
    this.assertActive(ctx);
    if (!state.knowledgeSnippets.length) {
      const answerMarkdown = fallbackMarkdown(state);
      return {
        answerMarkdown,
        resultJson: resultJsonFromState(state, answerMarkdown, state.knowledgeSnippets),
        stopReason: state.stopReason || "insufficient_evidence",
      };
    }
    if (!hasRemainingTokenBudget(state.tokens, 512)) {
      const answerMarkdown = renderSnippetsMarkdown(state, state.knowledgeSnippets);
      return {
        answerMarkdown,
        resultJson: resultJsonFromState(state, answerMarkdown, state.knowledgeSnippets),
        stopReason: state.stopReason || "token_limit",
        gaps: uniqueStrings([...state.gaps, "Token 预算已用尽，未执行自然语言合成。"]),
      };
    }
    const payload = compactPayloadForBudget(state, {
      output_schema: {
        answerMarkdown: "string",
        citations: "array of {path,title,sources}",
        gaps: "string[]",
        coverageSummary: "string",
      },
      query: state.query,
      plan: state.plan,
      retrievalRounds: state.retrievalRounds,
      knowledgeSnippets: state.knowledgeSnippets.map((snippet) => ({
        ...snippet,
        content: truncate(snippet.content, 5000),
      })),
      rawSources: state.sources.map((source) => ({
        source_id: source.source_id,
        filename: source.filename,
        pagePaths: source.pagePaths,
        supportSummary: source.supportSummary,
      })),
      gaps: state.gaps,
      coverageSummary: state.coverageSummary,
      stopReason: state.stopReason,
    });
    if (!payload) {
      const answerMarkdown = renderSnippetsMarkdown(state, state.knowledgeSnippets);
      return {
        answerMarkdown,
        resultJson: resultJsonFromState(state, answerMarkdown, state.knowledgeSnippets),
        stopReason: state.stopReason || "token_limit",
        gaps: uniqueStrings([...state.gaps, "Token 预算不足，未执行自然语言合成。"]),
      };
    }
    const { value, tokens } = await this.callJsonWithRetry(ctx, state, {
      model: state.models.synthesizerModel,
      phase: "synthesize",
      temperature: 0.2,
      system: [
        "你是 LLM Wiki Knowledge Agent。只基于最终知识片段和 source review 生成答案。",
        "不能使用未保留页面或外部常识补事实。",
        "answerMarkdown 必须包含“依据”和“未覆盖/不确定点”。",
        "只输出 JSON,不要输出 Markdown 代码块。",
      ].join("\n"),
      payload,
    });
    const resultJson = normalizeSynthesis(value, state);
    const answerMarkdown = ensureAnswerMarkdownSections(
      String(resultJson.answerMarkdown || fallbackMarkdown(state)),
      resultJson,
      state,
    );
    resultJson.answerMarkdown = answerMarkdown;
    return { answerMarkdown, resultJson, tokens };
  }

  private async finish(
    ctx: AgentRunnerContext<LlmWikiAgentInput>,
    state: LlmWikiAgentState,
  ): Promise<Partial<LlmWikiAgentState>> {
    ctx.appendEvent({
      type: "result",
      msg: "LLM Wiki Agent 多轮证据检索完成",
      status: "success",
      stopReason: state.stopReason,
      rounds: state.round,
      pageCount: state.pages.length,
      keptPageCount: state.keptPages.length,
      sourceCount: state.sources.length,
    });
    return {};
  }

  private async callJsonWithRetry(
    ctx: AgentRunnerContext<LlmWikiAgentInput>,
    state: LlmWikiAgentState,
    args: {
      model: string;
      phase: string;
      temperature: number;
      system: string;
      payload: unknown;
    },
  ): Promise<{ value: Record<string, unknown>; tokens: AgentRunTokens }> {
    let tokens = state.tokens;
    let lastError = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      this.assertActive(ctx);
      ctx.appendEvent({
        type: "model_start",
        msg: `模型调用开始: ${args.phase}`,
        model: args.model,
        phase: args.phase,
        attempt,
      });
      try {
        const res = await this.model.chat({
          model: args.model,
          temperature: args.temperature,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: args.system },
            { role: "user", content: JSON.stringify(args.payload, null, 2) },
          ],
        });
        const usage = extractUsage(res);
        tokens = accumulateUsage(tokens, usage);
        const parsed = parseJsonObject(extractContent(res));
        if (!parsed) throw new Error("模型未返回合法 JSON");
        ctx.appendEvent({
          type: "model_end",
          msg: `模型调用完成: ${args.phase}`,
          status: "success",
          model: args.model,
          phase: args.phase,
          attempt,
          usage,
          tokens,
        });
        return { value: parsed, tokens };
      } catch (err) {
        lastError = formatError(err);
        ctx.appendEvent({
          type: "model_end",
          msg: `模型调用失败: ${args.phase}`,
          status: "failed",
          model: args.model,
          phase: args.phase,
          attempt,
          error: lastError,
        });
      }
    }
    throw new Error(`${args.phase} 失败: ${lastError}`);
  }

  private assertModelsAvailable(models: LlmWikiModels): void {
    const missing = [models.plannerModel, models.reviewerModel, models.synthesizerModel]
      .filter((model, index, all) => all.indexOf(model) === index)
      .filter((model) => !this.model.findModel(model));
    if (missing.length > 0 || !this.model.hasConfiguredModel()) {
      throw new Error(`未配置可用模型: ${missing.join(", ") || "OPENAI_API_KEY / 模型名称"}`);
    }
  }

  private assertActive(ctx: AgentRunnerContext<LlmWikiAgentInput>): void {
    if (ctx.signal.aborted) throw new Error("aborted");
  }

  private defaultModels(): LlmWikiModels {
    const fastModel = this.model.resolveModel(agentConfig.defaultFastModel);
    const mainModel = this.model.resolveModel(agentConfig.defaultMainModel || agentConfig.defaultFastModel);
    return {
      plannerModel: fastModel,
      reviewerModel: fastModel,
      synthesizerModel: mainModel || fastModel,
    };
  }
}

function defaultBudget(): LlmWikiBudget {
  return {
    maxRounds: DEFAULT_MAX_ROUNDS,
    maxEvidencePages: DEFAULT_MAX_EVIDENCE_PAGES,
    maxRawSources: DEFAULT_MAX_RAW_SOURCES,
    tokenLimit: null,
  };
}

function resolveBudget(value: unknown): LlmWikiBudget {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    maxRounds: clampInt(raw.maxRounds, 1, 8, DEFAULT_MAX_ROUNDS),
    maxEvidencePages: clampInt(raw.maxEvidencePages, 8, 96, DEFAULT_MAX_EVIDENCE_PAGES),
    maxRawSources: clampInt(raw.maxRawSources, 0, 24, DEFAULT_MAX_RAW_SOURCES),
    tokenLimit: positiveIntOrNull(raw.tokenLimit),
  };
}

function resolveModels(value: unknown, defaults: LlmWikiModels): LlmWikiModels {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    plannerModel: stringField(raw.plannerModel) || defaults.plannerModel,
    reviewerModel: stringField(raw.reviewerModel) || defaults.reviewerModel,
    synthesizerModel: stringField(raw.synthesizerModel) || defaults.synthesizerModel,
  };
}

function normalizeInputSourcePolicy(value: unknown): LlmWikiSourcePolicy {
  if (value === "wiki-only" || value === "key-sources" || value === "exhaustive" || value === "auto") {
    return value;
  }
  return "auto";
}

function manifestForPrompt(manifest: WikiManifest | null) {
  if (!manifest) return null;
  return {
    stats: manifest.stats,
    schema: schemaForPrompt(manifest),
    index: truncate(manifest.index, 7000),
    pages: manifest.pages.slice(0, 260).map((page) => ({
      path: page.path,
      title: page.title,
      type: page.type,
      tags: page.tags,
      sources: page.sources,
    })),
    sources: manifest.sources.slice(0, 120),
  };
}

function schemaForPrompt(manifest: WikiManifest | null) {
  if (!manifest) return null;
  return {
    sha256: manifest.schema.sha256,
    content: truncate(manifest.schema.content, 4000),
  };
}

function normalizePlan(value: Record<string, unknown> | null, query: string): QueryPlan {
  const tasks = normalizeTasks(value?.tasks, query);
  const searchQueries = uniqueStrings([...tasks.flatMap((task) => task.searchQueries), ...stringArray(value?.searchQueries), query]).slice(
    0,
    16,
  );
  const candidatePaths = uniqueStrings([
    ...tasks.flatMap((task) => [...task.requiredPaths, ...task.optionalPaths]),
    ...stringArray(value?.candidatePaths),
  ]).slice(0, 64);
  return {
    queryIntent: normalizeQueryIntent(value?.queryIntent),
    keywords: stringArray(value?.keywords).slice(0, 16),
    entities: stringArray(value?.entities).slice(0, 16),
    tasks,
    coverage: normalizeCoverage(value?.coverage),
    candidatePaths,
    searchQueries,
    reason: stringField(value?.reason).slice(0, 800),
  };
}

function fallbackPlan(query: string): QueryPlan {
  return {
    queryIntent: "overview",
    keywords: splitSearchTerms(query).slice(0, 8),
    entities: [],
    tasks: [
      {
        goal: query,
        requiredPaths: [],
        optionalPaths: [],
        searchQueries: [query],
        expectedContribution: "围绕用户问题检索 Wiki 页面，并由 reviewer 判断证据是否足够。",
      },
    ],
    coverage: {
      coreTopics: [],
      optionalTopics: [],
      excludedTopics: [],
    },
    candidatePaths: [],
    searchQueries: [query],
    reason: "fallback plan",
  };
}

function normalizeTasks(value: unknown, query: string): QueryTask[] {
  const rawTasks = Array.isArray(value) ? value : [];
  const tasks = rawTasks
    .map((item): QueryTask | null => {
      const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const goal = stringField(raw.goal);
      const requiredPaths = stringArray(raw.requiredPaths).slice(0, 16);
      const optionalPaths = stringArray(raw.optionalPaths)
        .filter((path) => !requiredPaths.includes(path))
        .slice(0, 16);
      const searchQueries = uniqueStrings([...stringArray(raw.searchQueries), goal || query]).slice(0, 8);
      if (!goal && requiredPaths.length === 0 && optionalPaths.length === 0 && searchQueries.length === 0) {
        return null;
      }
      return {
        goal: goal || query,
        requiredPaths,
        optionalPaths,
        searchQueries,
        expectedContribution: stringField(raw.expectedContribution) || "补充回答所需的 Wiki 证据。",
      };
    })
    .filter((item): item is QueryTask => Boolean(item))
    .slice(0, 8);
  return tasks.length ? tasks : fallbackPlan(query).tasks;
}

function normalizeCoverage(value: unknown): QueryCoverage {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    coreTopics: stringArray(raw.coreTopics).slice(0, 16),
    optionalTopics: stringArray(raw.optionalTopics).slice(0, 16),
    excludedTopics: stringArray(raw.excludedTopics).slice(0, 16),
  };
}

function normalizeQueryIntent(value: unknown): QueryIntent {
  return ["overview", "specific", "compare", "howto", "debug"].includes(String(value))
    ? (value as QueryIntent)
    : "overview";
}

function normalizeEvidenceReview(value: Record<string, unknown>, state: LlmWikiAgentState, round: number) {
  const readPaths = new Set(state.pages.map((page) => page.path));
  const keepPages = normalizeKeptPages(value.keepPages, state, round).filter((item) => readPaths.has(item.path));
  const dropped = normalizeDroppedPages(value.dropPages, state, round).filter((item) => readPaths.has(item.path));
  const keepPaths = new Set(keepPages.map((page) => page.path));
  const dropPages = dropped.filter((page) => !keepPaths.has(page.path));
  return {
    keepPages,
    dropPages,
    coverage: value.coverage && typeof value.coverage === "object" ? value.coverage : {},
    gaps: stringArray(value.gaps).slice(0, 16),
    nextActions: normalizeActions(value.nextActions, state).slice(0, 24),
    stop: value.stop === true,
    stopReason: normalizeRequestedStopReason(value.stopReason),
  };
}

function normalizeKeptPages(value: unknown, state: LlmWikiAgentState, round: number): KeptPage[] {
  const rawItems = Array.isArray(value) ? value : [];
  return rawItems
    .map((item): KeptPage | null => {
      const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const path = stringField(raw.path);
      if (!path) return null;
      const page = state.pages.find((candidate) => candidate.path === path);
      return {
        path,
        taskGoals: stringArray(raw.taskGoals).length ? stringArray(raw.taskGoals).slice(0, 8) : page ? [page.taskGoal] : [],
        relevanceScore: clampNumber(raw.relevanceScore, 0, 100, page ? Math.min(Math.max(page.score / 4, 0), 100) : 0),
        evidenceScore: clampNumber(raw.evidenceScore, 0, 100, page ? Math.min(Math.max(page.score / 4, 0), 100) : 0),
        selectedInRound: round,
        whyKept: stringField(raw.whyKept) || "reviewer 保留该页面作为相关证据。",
      };
    })
    .filter((item): item is KeptPage => Boolean(item));
}

function normalizeDroppedPages(value: unknown, state: LlmWikiAgentState, round: number): DiscardedPage[] {
  const rawItems = Array.isArray(value) ? value : [];
  return rawItems
    .map((item): DiscardedPage | null => {
      const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const path = stringField(raw.path);
      if (!path) return null;
      const page = state.pages.find((candidate) => candidate.path === path);
      return {
        path,
        title: page?.title || path,
        reason: stringField(raw.reason) || "reviewer 判定该页面不进入最终证据集。",
        round,
      };
    })
    .filter((item): item is DiscardedPage => Boolean(item));
}

function normalizeActions(value: unknown, state: LlmWikiAgentState): RetrievalAction[] {
  const rawItems = Array.isArray(value) ? value : [];
  return rawItems
    .map((item): RetrievalAction | null => {
      const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const type = normalizeActionType(raw.type || raw.kind);
      if (!type) return null;
      if (type === "stop") return { type, reason: stringField(raw.reason) };
      if (type === "read_source") {
        const sourceId = stringField(raw.sourceId || raw.source_id);
        return sourceId ? { type, sourceId, reason: stringField(raw.reason) } : null;
      }
      if (type === "search_wiki") {
        const query = stringField(raw.query);
        return query ? { type, query, reason: stringField(raw.reason) } : null;
      }
      const path = stringField(raw.path);
      if (!path) return null;
      return {
        type,
        path,
        fromPath: stringField(raw.fromPath),
        reason: stringField(raw.reason),
        taskIndex: inferTaskIndexForPath(path, state.plan),
        taskGoal: inferTaskGoalForPath(path, state.plan),
        taskContribution: inferTaskContributionForPath(path, state.plan),
        why: type === "follow_link" ? "linked_page" : "search_hit",
      };
    })
    .filter((item): item is RetrievalAction => Boolean(item));
}

function normalizeActionType(value: unknown): RetrievalAction["type"] | null {
  if (
    value === "read_page" ||
    value === "search_wiki" ||
    value === "follow_link" ||
    value === "read_source" ||
    value === "stop"
  ) {
    return value;
  }
  return null;
}

function normalizeRequestedStopReason(value: unknown): StopReason | null {
  return value === "complete" || value === "insufficient_evidence" ? value : null;
}

function decideStopReason(
  review: ReturnType<typeof normalizeEvidenceReview>,
  round: number,
  maxRounds: number,
): StopReason | null {
  if (review.stop) return review.stopReason || (review.keepPages.length ? "complete" : "insufficient_evidence");
  if (round >= maxRounds) return "max_rounds";
  if (!review.nextActions.length) return review.keepPages.length ? "no_new_actions" : "insufficient_evidence";
  return null;
}

function normalizeSourceReview(value: Record<string, unknown>, state: LlmWikiAgentState) {
  const keptPaths = new Set(state.keptPages.map((page) => page.path));
  const rawItems = Array.isArray(value.sourceReviews) ? value.sourceReviews : [];
  const fromModel = rawItems
    .map((item): SourceReview | null => {
      const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const path = stringField(raw.path);
      if (!path || !keptPaths.has(path)) return null;
      return {
        path,
        sourceSupport: state.sourcePolicy === "wiki-only" ? "wiki-only" : normalizeSourceSupport(raw.sourceSupport),
        supportSummary: stringField(raw.supportSummary).slice(0, 1000),
      };
    })
    .filter((item): item is SourceReview => Boolean(item));
  const byPath = new Map(fromModel.map((item) => [item.path, item]));
  const sourceReviews = state.keptPages.map((kept) => byPath.get(kept.path) || defaultSourceReviewForPath(state, kept.path));
  return {
    sourceReviews,
    gaps: stringArray(value.gaps).slice(0, 16),
    coverageSummary: stringField(value.coverageSummary) || coverageSummaryFromState(state),
  };
}

function mergeRequestedSourceIds(
  prev: string[],
  actions: RetrievalAction[],
  manifest: WikiManifest | null,
): string[] {
  const requested = new Set(prev);
  for (const action of actions) {
    if (action.type === "read_source" && isKnownSourceId(manifest, action.sourceId)) {
      requested.add(String(action.sourceId));
    }
  }
  return [...requested];
}

function normalizeSourceSupport(value: unknown): SourceSupport {
  if (value === "verified" || value === "wiki-only" || value === "partial" || value === "conflict" || value === "unknown") {
    return value;
  }
  return "unknown";
}

function makeRetrievalRound(
  round: number,
  readPages: string[],
  keptPages: KeptPage[],
  droppedPages: DiscardedPage[],
  nextActions: RetrievalAction[],
  coverage: unknown,
  stopReason: string | null,
): RetrievalRound {
  return {
    round,
    readPages,
    keptPages: keptPages.map((page) => page.path),
    droppedPages: droppedPages.map((page) => page.path),
    nextActions,
    coverage,
    stopReason,
  };
}

function mergeDiscardedPages(prev: DiscardedPage[], next: DiscardedPage[]): DiscardedPage[] {
  const byKey = new Map(prev.map((page) => [`${page.round}:${page.path}`, page]));
  for (const page of next) byKey.set(`${page.round}:${page.path}`, page);
  return [...byKey.values()];
}

function pageHitToAction(hit: PlannedPageHit): RetrievalAction {
  return {
    type: "read_page",
    path: hit.path,
    taskIndex: hit.taskIndex,
    taskGoal: hit.taskGoal,
    taskContribution: hit.taskContribution,
    why: hit.why,
    score: hit.score,
    required: hit.required,
  };
}

function toRetrievedPage(page: LlmWikiPage & { links: string[] }, action: RetrievalAction, readInRound: number): RetrievedPage {
  return {
    path: page.path,
    title: page.title,
    type: page.type,
    tags: page.tags,
    sources: page.sources,
    content: page.content,
    score: typeof action.score === "number" ? action.score : 0,
    why: action.why || "search_hit",
    taskIndex: action.taskIndex || 0,
    taskGoal: action.taskGoal || "",
    taskContribution: action.taskContribution || "",
    required: Boolean(action.required),
    readInRound,
    links: page.links,
  };
}

function scorePlannedPage(args: {
  baseScore: number;
  pageType: string;
  reason: PageHitReason;
  taskIndex: number;
}): number {
  const reasonScore: Record<PageHitReason, number> = {
    required_path: 320,
    linked_page: 240,
    search_hit: 190,
    optional_path: 120,
  };
  const pageTypeScore =
    args.pageType === "summary" ? 35 : args.pageType === "concept" ? 25 : args.pageType === "entity" ? 15 : 0;
  return reasonScore[args.reason] + Math.min(Math.max(args.baseScore, 0), 140) + pageTypeScore - args.taskIndex * 8;
}

function compareHits(a: PlannedPageHit, b: PlannedPageHit): number {
  return b.score - a.score || a.order - b.order || a.path.localeCompare(b.path);
}

function isKnownWikiPath(manifest: WikiManifest | null, path: unknown): path is string {
  const value = stringField(path);
  return Boolean(value && manifest?.pages.some((page) => page.path === value));
}

function isKnownSourceId(manifest: WikiManifest | null, sourceId: unknown): sourceId is string {
  const value = stringField(sourceId);
  return Boolean(value && manifest?.sources.some((source) => source.source_id === value));
}

function pageRef(manifest: WikiManifest | null, path: string): LlmWikiPageRef | undefined {
  return manifest?.pages.find((page) => page.path === path);
}

function inferTaskIndexForPath(path: string, plan: QueryPlan | null): number {
  const tasks = plan?.tasks || [];
  const index = tasks.findIndex((task) => task.requiredPaths.includes(path) || task.optionalPaths.includes(path));
  return index >= 0 ? index : 0;
}

function inferTaskGoalForPath(path: string, plan: QueryPlan | null): string {
  const task = plan?.tasks[inferTaskIndexForPath(path, plan)];
  return task?.goal || plan?.tasks[0]?.goal || "";
}

function inferTaskContributionForPath(path: string, plan: QueryPlan | null): string {
  const task = plan?.tasks[inferTaskIndexForPath(path, plan)];
  return task?.expectedContribution || plan?.tasks[0]?.expectedContribution || "";
}

function pageForReviewPrompt(page: RetrievedPage) {
  return {
    path: page.path,
    title: page.title,
    type: page.type,
    tags: page.tags,
    sources: page.sources,
    why: page.why,
    taskGoal: page.taskGoal,
    taskContribution: page.taskContribution,
    score: page.score,
    readInRound: page.readInRound,
    links: page.links.slice(0, 24),
    content: truncate(stripFrontmatter(page.content), 4500),
  };
}

function rankSourceRefs(pages: RetrievedPage[]): Array<{
  source_id: string;
  taskGoals: string[];
  pagePaths: string[];
  score: number;
}> {
  const bySource = new Map<string, { source_id: string; taskGoals: string[]; pagePaths: string[]; score: number }>();
  for (const page of pages) {
    for (const sourceId of page.sources) {
      const prev = bySource.get(sourceId) || { source_id: sourceId, taskGoals: [], pagePaths: [], score: 0 };
      prev.score += 1 + (page.required ? 4 : 0) + Math.max(page.score, 0) / 100;
      prev.taskGoals = uniqueStrings([...prev.taskGoals, page.taskGoal]);
      prev.pagePaths = uniqueStrings([...prev.pagePaths, page.path]);
      bySource.set(sourceId, prev);
    }
  }
  return [...bySource.values()].sort(
    (a, b) => b.score - a.score || b.pagePaths.length - a.pagePaths.length || a.source_id.localeCompare(b.source_id),
  );
}

function selectSourceRefs(
  keptPages: RetrievedPage[],
  policy: LlmWikiSourcePolicy,
  requestedSourceIds: string[],
  maxRawSources: number,
): Array<{
  source_id: string;
  taskGoals: string[];
  pagePaths: string[];
  score: number;
}> {
  const ranked = rankSourceRefs(keptPages);
  const requested = new Set(requestedSourceIds);
  const requestedRefs = ranked.filter((source) => requested.has(source.source_id));
  if (policy === "exhaustive") return uniqueSourceRefs([...requestedRefs, ...ranked]).slice(0, maxRawSources);
  if (policy === "auto" && requestedRefs.length) return requestedRefs.slice(0, maxRawSources);
  const keyPagePaths = selectKeySourcePagePaths(keptPages);
  const keyRefs = ranked
    .map((source) => ({
      ...source,
      pagePaths: source.pagePaths.filter((path) => keyPagePaths.has(path)),
    }))
    .filter((source) => source.pagePaths.length > 0);
  return uniqueSourceRefs([...requestedRefs, ...keyRefs, ...ranked.slice(0, 1)]).slice(0, maxRawSources);
}

function uniqueSourceRefs<T extends { source_id: string }>(refs: T[]): T[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.source_id)) return false;
    seen.add(ref.source_id);
    return true;
  });
}

function selectKeySourcePagePaths(pages: RetrievedPage[]): Set<string> {
  const topScore = Math.max(0, ...pages.map((page) => page.score));
  const threshold = topScore * 0.75;
  return new Set(
    pages
      .filter((page) => page.required || page.score >= threshold)
      .map((page) => page.path),
  );
}

function defaultSourceReviews(state: LlmWikiAgentState): SourceReview[] {
  return state.keptPages.map((kept) => defaultSourceReviewForPath(state, kept.path));
}

function compactPayloadForBudget(state: LlmWikiAgentState, payload: Record<string, unknown>): Record<string, unknown> | null {
  if (!state.tokens.tokenLimit) return payload;
  const remaining = state.tokens.tokenLimit - state.tokens.totalTokens;
  if (remaining <= 256) return null;
  if (estimateTokens(payload) <= remaining) return payload;
  const compacted = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  compactPageCollections(compacted, 1600);
  if (estimateTokens(compacted) <= remaining) return compacted;
  compactPageCollections(compacted, 600);
  return estimateTokens(compacted) <= remaining ? compacted : null;
}

function compactPageCollections(value: unknown, contentLimit: number): void {
  if (Array.isArray(value)) {
    for (const item of value) compactPageCollections(item, contentLimit);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (typeof record.content === "string") record.content = truncate(record.content, contentLimit);
  for (const child of Object.values(record)) compactPageCollections(child, contentLimit);
}

function hasRemainingTokenBudget(tokens: AgentRunTokens, reserve: number): boolean {
  return !tokens.tokenLimit || tokens.totalTokens + reserve < tokens.tokenLimit;
}

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function extractContent(res: unknown): string {
  const body = res as { choices?: Array<{ message?: { content?: unknown }; text?: unknown }> };
  const content = body.choices?.[0]?.message?.content ?? body.choices?.[0]?.text;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === "string" ? part : "")).join("");
  return "";
}

function parseJsonObject(content: string): Record<string, unknown> | null {
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
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      // try next
    }
  }
  return null;
}

function extractUsage(res: unknown): unknown {
  return res && typeof res === "object" ? (res as { usage?: unknown }).usage : null;
}

function accumulateUsage(tokens: AgentRunTokens, usage: unknown): AgentRunTokens {
  const u = usage && typeof usage === "object" ? (usage as Record<string, unknown>) : {};
  const input = pickNumber(u.input_tokens) ?? pickNumber(u.prompt_tokens) ?? 0;
  const output = pickNumber(u.output_tokens) ?? pickNumber(u.completion_tokens) ?? 0;
  const total = pickNumber(u.total_tokens) ?? input + output;
  return {
    inputTokens: tokens.inputTokens + input,
    outputTokens: tokens.outputTokens + output,
    totalTokens: tokens.totalTokens + total,
    rounds: tokens.rounds + (input || output || total ? 1 : 0),
    modelCalls: tokens.modelCalls + 1,
    tokenLimit: tokens.tokenLimit,
  };
}

function emptyTokens(tokenLimit: number | null): AgentRunTokens {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    rounds: 0,
    modelCalls: 0,
    tokenLimit,
  };
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringArray(value: unknown): string[] {
  const arr = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return arr.map((item) => String(item || "").trim()).filter(Boolean);
}

function splitSearchTerms(value: string): string[] {
  return value
    .split(/[\s,，。；;:：、/\\|()[\]{}"'“”‘’<>《》]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

function positiveIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function pickNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function truncate(text: string, limit: number): string {
  const value = String(text || "");
  return value.length <= limit ? value : `${value.slice(0, limit)}\n\n[内容已截断 ${value.length - limit} 字符]`;
}

function stripFrontmatter(content: string): string {
  return String(content || "").replace(/^---\n[\s\S]*?\n---\n?/, "");
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
