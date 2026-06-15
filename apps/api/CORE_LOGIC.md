# API 核心代码逻辑

`apps/api` 当前由 LLM Wiki、独立 Agent、模型、Health 和 Debug 模块组成，不再包含 Session、WebSocket 或产品 Chat。

## 1. 启动与全局契约

```text
src/main.ts
  -> NestFactory.create(AppModule)
  -> enableCors("*")
  -> 开发环境注册 Swagger
  -> listen(PORT || KNOWLLM_API_PORT || 39247)
```

- `src/app.module.ts` 注册 `HealthModule`、`ModelModule`、`LlmWikiModule`、`AgentModule` 和 `DebugModule`。
- 成功响应由全局拦截器包装为 `{ code, msg, data }`。
- 当前异常仍返回 HTTP 200，真实错误码位于响应体 `code`。
- 默认数据根目录是 `<repo>/.knowllm`，可通过 `KNOWLLM_DATA_ROOT` 覆盖。

## 2. 模型模块

模型配置：

```text
OPENAI_BASE_URL
OPENAI_API_KEY
OPENAI_MODEL
MODEL
LLM_WIKI_MODEL
```

`ModelService.chat()` 调用 OpenAI-compatible `POST /chat/completions`，用于 LLM Wiki compiler、fusion 和 Agent 的 JSON 模型阶段。服务端不再实现流式 Chat、Session 默认模型或 SSE 解析。

## 3. LLM Wiki 模块

`src/modules/llmWiki` 负责：

- Source 上传、重命名、删除与异步 ingest。
- compiler 将 source 编译为 Wiki draft。
- fusion 决定页面 create、update、skip 或 conflict。
- Wiki 页面树、读取、保存、删除与索引重建。
- FlexSearch 检索、schema、lint 和 issue 生命周期。
- `LlmWikiRetrievalService` 提供 Agent 使用的只读检索契约。

主要数据结构：

```text
.knowllm/llm-wiki/default/
  schema/AGENTS.md
  issues/open/*.json
  issues/resolved/*.json
  meta/page-contributions/*.json
  log/YYYY-MM-DD.md
  sources/<sourceId>/
  wiki/
```

当前 ingest 仍是进程内异步任务，不具备事务、跨进程锁或队列保障。

## 4. Agent 模块

`src/modules/agent` 是独立闭合模块，当前只注册 `llmWiki` runner。

```text
POST /api/agents/llmWiki/runs
  -> AgentService.submit()
  -> AgentRunExecutionService.start()
  -> validateInput({ query, sourcePolicy, budget, models })
  -> 创建 run 与 AbortController
  -> LlmWikiAgentWorkflow
  -> 保存 events、result、meta
```

LLM Wiki Agent 流程：

```text
load_manifest
  -> plan_query
  -> collect_initial_candidates
  -> read_page_batch
  -> review_evidence
  -> execute_next_actions
  -> read_raw_sources
  -> review_sources
  -> build_final_snippets
  -> maybe_synthesize
  -> finish
```

- Agent 始终执行最终答案合成，不再支持只返回 snippets 的运行模式。
- `knowledgeSnippets` 仍保存在 `resultJson`，作为证据链组成部分。
- 旧前端字段 `limit`、`model` 继续映射到 `budget.maxEvidencePages` 和模型配置。
- 执行事件只写入 run 存储，不再向 Session Chat 回调。
- REST 取消仍通过每个 run 的独立 `AbortController` 生效。

Run 数据：

```text
.knowllm/agents/runs/llmWiki/<runId>/
  meta.json
  events.jsonl
  result.md
  result.json
```

## 5. 维护边界

- 产品面只保留 LLM Wiki 管理和独立 LLM Wiki Agent。
- `/chat/completions` 仅表示上游模型协议，不代表仓库仍存在 Chat 产品模块。
- Web/API 类型仍分别维护，修改公开契约时需要同步检查。
- Agent 和 LLM Wiki 的模型调用尚无统一超时、限流和并发控制。
