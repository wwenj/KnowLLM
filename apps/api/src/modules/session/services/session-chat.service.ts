import { Injectable } from "@nestjs/common";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { Runtime } from "@langchain/langgraph";
import type { AgentRunEvent } from "../../agent/agent.types";
import { AgentRunExecutionService } from "../../agent/services/agent-run-execution.service";
import { type ChatMessage, ModelService } from "../../model/model.service";
import type { SessionMessageRecord } from "./session-store.service";

export type SessionChatChunk =
  | { type: "thinking"; content: string }
  | { type: "stream"; content: string };

export type SessionChatRoute = "chat" | "llmWiki";

export interface SessionChatResult {
  content: string;
  thinking: string;
  steps: Array<{ node: string; ms: number; status: "success" | "error" | "skipped" }>;
}

interface SessionAgentStep {
  node: string;
  ms: number;
  status: "success" | "error" | "skipped";
}

interface LlmWikiKnowledgeSnippet {
  path: string;
  title: string;
  type: string;
  tags: string[];
  sources: string[];
  content: string;
  sourceSupport: string;
  whyKept: string;
}

interface SessionAgentStateShape {
  route: SessionChatRoute;
  rawContent: string;
  userContent: string;
  model: string;
  history: ChatMessage[];
  llmWikiStep: SessionAgentStep | null;
  llmWikiSnippets: LlmWikiKnowledgeSnippet[];
  chatStep: SessionAgentStep | null;
  finishStep: SessionAgentStep | null;
  answer: string;
  thinking: string;
  steps: SessionAgentStep[];
}

const State = Annotation.Root({
  route: Annotation<SessionChatRoute>(),
  rawContent: Annotation<string>(),
  userContent: Annotation<string>(),
  model: Annotation<string>(),
  history: Annotation<ChatMessage[]>(),
  llmWikiStep: Annotation<SessionAgentStep | null>(),
  llmWikiSnippets: Annotation<LlmWikiKnowledgeSnippet[]>(),
  chatStep: Annotation<SessionAgentStep | null>(),
  finishStep: Annotation<SessionAgentStep | null>(),
  answer: Annotation<string>(),
  thinking: Annotation<string>(),
  steps: Annotation<SessionAgentStep[]>()
});

type SessionAgentState = typeof State.State & SessionAgentStateShape;
type SessionAgentRuntime = Runtime<Record<string, unknown>, unknown, unknown> & {
  writer: (chunk: SessionChatChunk) => void;
};
type GraphStreamChunk =
  | ["custom", SessionChatChunk]
  | ["values", SessionAgentState]
  | SessionChatChunk
  | SessionAgentState;

@Injectable()
export class SessionChatService {
  private readonly graph: ReturnType<SessionChatService["buildGraph"]>;

  constructor(
    private readonly model: ModelService,
    private readonly agentRuns: AgentRunExecutionService
  ) {
    this.graph = this.buildGraph();
  }

  async *streamReply(args: {
    route: SessionChatRoute;
    content: string;
    history: SessionMessageRecord[];
    model: string;
    signal?: AbortSignal;
  }): AsyncGenerator<SessionChatChunk | { type: "done"; result: SessionChatResult }, void, void> {
    const initial: SessionAgentStateShape = {
      route: args.route,
      rawContent: args.content,
      userContent: args.content,
      model: this.model.resolveSessionModel(args.model),
      history: toModelHistory(args.history),
      llmWikiStep: null,
      llmWikiSnippets: [],
      chatStep: null,
      finishStep: null,
      answer: "",
      thinking: "",
      steps: []
    };

    let finalState: SessionAgentState | null = null;
    const stream = await this.graph.stream(initial, {
      streamMode: ["custom", "values"],
      signal: args.signal
    } as never);

    for await (const raw of stream as AsyncIterable<GraphStreamChunk>) {
      if (args.signal?.aborted) return;
      const parsed = parseGraphChunk(raw);
      if (parsed.kind === "custom") {
        yield parsed.chunk;
      } else {
        finalState = parsed.state;
      }
    }

    if (args.signal?.aborted) return;
    yield {
      type: "done",
      result: {
        content: finalState?.answer || "模型未返回任何内容，请重试。",
        thinking: finalState?.thinking || "",
        steps: finalState?.steps || []
      }
    };
  }

  private buildGraph() {
    return new StateGraph(State)
      .addNode("route_node", (state: SessionAgentState) => state)
      .addNode("llm_wiki_node", (state: SessionAgentState, runtime) =>
        this.llmWikiNode(state, runtime as SessionAgentRuntime)
      )
      .addNode("chat_node", (state: SessionAgentState, runtime) =>
        this.chatNode(state, runtime as SessionAgentRuntime)
      )
      .addNode("finish_node", (state: SessionAgentState, runtime) =>
        this.finishNode(state, runtime as SessionAgentRuntime)
      )
      .addEdge(START, "route_node")
      .addConditionalEdges(
        "route_node",
        (state: SessionAgentState) => state.route,
        {
          llmWiki: "llm_wiki_node",
          chat: "chat_node"
        }
      )
      .addConditionalEdges(
        "llm_wiki_node",
        (state: SessionAgentState) => (state.llmWikiStep?.status === "error" ? "finish" : "chat"),
        {
          finish: "finish_node",
          chat: "chat_node"
        }
      )
      .addEdge("chat_node", "finish_node")
      .addEdge("finish_node", END)
      .compile();
  }

  private async llmWikiNode(
    state: SessionAgentState,
    runtime: SessionAgentRuntime
  ): Promise<Partial<SessionAgentStateShape>> {
    const startedAt = Date.now();
    this.assertActive(runtime.signal);
    const thinkingParts: string[] = [
      this.emitThinking(runtime, "进入 LLM Wiki，开始检索知识片段。\n\n")
    ];
    const run = this.agentRuns.start(
      "llmWiki",
      {
        query: state.userContent,
        outputMode: "snippets"
      },
      {
        signal: runtime.signal,
        onEvent: (event) => {
          if (runtime.signal.aborted) return;
          const content = formatAgentEvent("LLM Wiki", event);
          if (!content) return;
          thinkingParts.push(this.emitThinking(runtime, content));
        }
      }
    );

    const detail = await run.done;
    this.assertActive(runtime.signal);
    if (isTerminalAgentFailure(detail.status)) {
      const answer = detail.resultMd || "LLM Wiki 执行失败，未生成可用结果。";
      return {
        answer,
        thinking: appendThinking(state.thinking, thinkingParts.join("")),
        llmWikiSnippets: [],
        llmWikiStep: buildStep("llm_wiki_node", startedAt, "error")
      };
    }

    const snippets = extractLlmWikiKnowledgeSnippets(detail.resultJson);
    thinkingParts.push(
      this.emitThinking(
        runtime,
        snippets.length
          ? `LLM Wiki 返回 ${snippets.length} 个知识片段，交给聊天模型回答。\n\n`
          : "LLM Wiki 未返回可用知识片段，交给聊天模型正常回答。\n\n"
      )
    );
    return {
      thinking: appendThinking(state.thinking, thinkingParts.join("")),
      llmWikiSnippets: snippets,
      llmWikiStep: buildStep("llm_wiki_node", startedAt)
    };
  }

  private async chatNode(
    state: SessionAgentState,
    runtime: SessionAgentRuntime
  ): Promise<Partial<SessionAgentStateShape>> {
    const startedAt = Date.now();
    this.assertActive(runtime.signal);

    if (!this.model.hasConfiguredModel() || state.model === "local-fallback") {
      const content =
        state.route === "llmWiki"
          ? "当前未配置外部模型，LLM Wiki 已完成检索但无法继续生成最终回答。"
          : "当前未配置外部模型。请在 `apps/api/env/.env.development` 配置模型环境变量。";
      runtime.writer({ type: "stream", content });
      return {
        answer: content,
        chatStep: buildStep("chat_node", startedAt)
      };
    }

    const thinkingParts: string[] = [
      this.emitThinking(runtime, `进入普通聊天，使用模型：${state.model}\n\n`)
    ];
    const contentParts: string[] = [];

    for await (const chunk of this.model.stream({
      model: state.model,
      temperature: 0.2,
      messages: buildChatMessages(state),
      signal: runtime.signal
    })) {
      this.assertActive(runtime.signal);
      if (chunk.type === "thinking") {
        thinkingParts.push(chunk.content);
      } else {
        contentParts.push(chunk.content);
      }
      runtime.writer(chunk);
    }

    const thinking = thinkingParts.join("");
    return {
      answer: normalizeFinalAnswer(contentParts.join(""), thinking),
      thinking: appendThinking(state.thinking, thinking),
      chatStep: buildStep("chat_node", startedAt)
    };
  }

  private finishNode(
    state: SessionAgentState,
    runtime: SessionAgentRuntime
  ): Partial<SessionAgentStateShape> {
    const startedAt = Date.now();
    this.assertActive(runtime.signal);
    const answer = normalizeFinalAnswer(state.answer, state.thinking);
    const finishStep = buildStep("finish_node", startedAt);
    return {
      answer,
      finishStep,
      steps: [state.llmWikiStep, state.chatStep, finishStep].filter(Boolean) as SessionAgentStep[]
    };
  }

  private assertActive(signal?: AbortSignal): void {
    if (signal?.aborted) throw new Error("aborted");
  }

  private emitThinking(runtime: SessionAgentRuntime, content: string): string {
    runtime.writer({ type: "thinking", content });
    return content;
  }
}

export function parseSessionRoute(content: string): { type: SessionChatRoute; content: string } {
  const parsed = parseSessionAgentPrefix(content, "assistant");
  if (parsed.selection?.id === "llmWiki") {
    return { type: "llmWiki", content: parsed.selection.content };
  }
  return { type: "chat", content: stripRoutePrefix(content) };
}

export function parseSessionAgentPrefix(
  rawContent: string,
  kind: "assistant"
): { selection: { id: string; content: string } | null; error: string | null } {
  const content = String(rawContent || "");
  const prefix = `[${kind}:`;
  if (!content.trimStart().startsWith(prefix)) return { selection: null, error: null };

  const leading = content.length - content.trimStart().length;
  const closeIndex = content.indexOf("]", leading);
  if (closeIndex < 0) return { selection: null, error: null };

  const id = content.slice(leading + prefix.length, closeIndex).trim();
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) return { selection: null, error: null };

  return {
    selection: {
      id,
      content: content.slice(closeIndex + 1).trimStart()
    },
    error: null
  };
}

function buildStep(
  node: string,
  startedAt: number,
  status: SessionAgentStep["status"] = "success"
): SessionAgentStep {
  return {
    node,
    ms: Math.max(0, Date.now() - startedAt),
    status
  };
}

function normalizeFinalAnswer(answer: string, thinking: string): string {
  if (answer) return answer;
  if (thinking) return "模型已完成推理，但未生成具体回复内容。";
  return "模型未返回任何内容，请重试。";
}

function appendThinking(current: string, next: string): string {
  return `${current || ""}${next || ""}`;
}

function formatAgentEvent(label: string, event: AgentRunEvent): string {
  const msg = typeof event.msg === "string" ? event.msg.trim() : "";
  if (!msg) return "";
  return `[${label}] ${msg}\n\n`;
}

function buildChatMessages(state: SessionAgentState): ChatMessage[] {
  const base = state.route === "llmWiki"
    ? [
        {
          role: "system",
          content: buildLlmWikiReferencePrompt(state.userContent, state.llmWikiSnippets)
        }
      ]
    : [{ role: "system", content: "你是 KnowLLM 的基础 Chat 助手。直接、准确、用中文回答。" }];
  return [...base, ...state.history];
}

function buildLlmWikiReferencePrompt(
  userContent: string,
  snippets: LlmWikiKnowledgeSnippet[]
): string {
  const lines = [
    "你是当前 Chat 的回答模型。请围绕用户问题直接回答，不要把回复写成 LLM Wiki 检索报告。",
    "下面的 LLM Wiki 知识片段只作为参考资料。优先吸收其中与问题相关的事实、定义、约束和结论，但最终回答必须按用户问题组织。",
    "不要展开解释检索过程，不要求输出固定的“依据”“未覆盖”“不确定点”等章节。",
    "如果使用了 LLM Wiki 片段中的信息，回复末尾用很短的“参考：...”列出相关页面标题或路径。",
    "如果没有足够相关知识，正常回答用户问题，并在末尾简短说明“当前 LLM Wiki 相关知识较少”。",
    "",
    `用户问题：${userContent}`,
    "",
    "LLM Wiki 知识片段："
  ];

  if (!snippets.length) {
    lines.push("当前 LLM Wiki 未返回可用知识片段。");
    return `${lines.join("\n")}\n`;
  }

  snippets.forEach((snippet, index) => {
    const title = snippet.title || snippet.path || `片段 ${index + 1}`;
    lines.push(
      "",
      `## 片段 ${index + 1}: ${title}`,
      `路径：${snippet.path || "-"}`,
      `类型：${snippet.type || "-"}`,
      `来源：${snippet.sources.length ? snippet.sources.join(", ") : "-"}`,
      `Source 支持：${snippet.sourceSupport || "-"}`,
      `保留原因：${snippet.whyKept || "-"}`,
      "内容：",
      snippet.content
    );
    if (snippet.tags.length) lines.push(`Tags：${snippet.tags.join(", ")}`);
  });

  return `${lines.join("\n")}\n`;
}

function extractLlmWikiKnowledgeSnippets(resultJson: Record<string, unknown> | null): LlmWikiKnowledgeSnippet[] {
  const raw = resultJson?.knowledgeSnippets;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => normalizeLlmWikiKnowledgeSnippet(item))
    .filter((item): item is LlmWikiKnowledgeSnippet => Boolean(item));
}

function normalizeLlmWikiKnowledgeSnippet(value: unknown): LlmWikiKnowledgeSnippet | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const path = textField(item.path);
  const title = textField(item.title);
  const content = textField(item.content);
  if (!path && !title && !content) return null;
  return {
    path,
    title,
    type: textField(item.type),
    tags: textArray(item.tags),
    sources: textArray(item.sources),
    content,
    sourceSupport: textField(item.sourceSupport),
    whyKept: textField(item.whyKept)
  };
}

function isTerminalAgentFailure(status: string): boolean {
  return status === "failed" || status === "cancelled";
}

function toModelHistory(messages: SessionMessageRecord[]): ChatMessage[] {
  return messages.map((message) => ({
    role: message.role === "agent" ? "assistant" : "user",
    content: stripRoutePrefix(message.content)
  }));
}

function stripRoutePrefix(content: string): string {
  return content.replace(/^\s*\[assistant:[^\]]+]\s*/, "").trim();
}

function textField(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function textArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => textField(item).trim()).filter(Boolean);
}

function parseGraphChunk(raw: GraphStreamChunk):
  | { kind: "custom"; chunk: SessionChatChunk }
  | { kind: "values"; state: SessionAgentState } {
  if (Array.isArray(raw)) {
    if (raw[0] === "custom") return { kind: "custom", chunk: raw[1] };
    return { kind: "values", state: raw[1] as SessionAgentState };
  }
  if (isSessionChatChunk(raw)) return { kind: "custom", chunk: raw };
  return { kind: "values", state: raw as SessionAgentState };
}

function isSessionChatChunk(value: unknown): value is SessionChatChunk {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return type === "thinking" || type === "stream";
}
