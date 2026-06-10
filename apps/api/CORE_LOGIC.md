# API 核心代码逻辑

`apps/api` 是 KnowLLM 的 NestJS 服务端，当前提供本地单用户版本的核心能力：

- LLM Wiki source 管理、编译、页面读写、搜索、诊断。
- Session Chat REST 与 WebSocket。
- LLM Wiki Agent run。
- OpenAI-compatible 模型调用封装。
- 本地 JSON / Markdown / JSONL 持久化。

## 1. 启动入口

启动链路：

```text
src/main.ts
  -> NestFactory.create(AppModule)
  -> enableCors("*")
  -> 开发环境注册 Swagger
  -> listen(PORT || KNOWLLM_API_PORT || 39247)
```

关键文件：

- `src/main.ts`：Nest 启动、CORS、Swagger、端口。
- `src/app.module.ts`：注册全局模块、响应拦截器、异常过滤器。
- `src/config/env.ts`：按顺序加载 `env/.env.<NODE_ENV>`、根目录 `.env` 等配置。
- `src/config/data-root.ts`：确定 `.knowllm/` 数据根目录。

默认数据根目录：

```text
<repo>/.knowllm
```

也可通过 `KNOWLLM_DATA_ROOT` 覆盖。

## 2. 全局响应与异常

全局响应拦截器：`src/common/api-response.interceptor.ts`

普通成功响应会包装为：

```json
{
  "code": 0,
  "msg": "ok",
  "data": {}
}
```

全局异常过滤器：`src/common/api-exception.filter.ts`

当前异常也返回 HTTP 200，真实错误码放在响应体 `code`：

```json
{
  "code": 400,
  "msg": "错误信息",
  "data": {}
}
```

这是当前客户端契约，但会影响监控、代理、Swagger 调试和通用 HTTP 客户端。

## 3. 文件与文本工具

通用文件工具：`src/common/fs-json.ts`

- `readJson()`：读取 JSON，失败时返回 fallback。
- `writeJson()`：先写 `.tmp` 再 rename。
- `readText()` / `writeText()`：文本读写。
- `randomId()`：生成无连字符 UUID。
- `sha256()`：计算 hash。

通用文本工具：`src/common/text.ts`

- `safeFilename()`：清理上传文件名。
- `safeMarkdownPath()`：限制 Wiki 相对路径，防止路径穿越。
- `slugify()`：生成 ASCII slug。
- `stripFrontmatter()`：去掉 Markdown frontmatter。
- `snippet()`：搜索片段。

## 4. 模型模块

目录：`src/modules/model`

关键文件：

- `model.controller.ts`：`GET /api/models`。
- `model.service.ts`：模型列表、普通完成、SSE 流式解析。

模型配置读取：

```text
OPENAI_BASE_URL
OPENAI_API_KEY
OPENAI_MODEL
MODEL
LLM_WIKI_MODEL
SESSION_DEFAULT_MODEL
```

核心方法：

- `listModels()`：从环境变量生成前端可选模型列表；未配置时返回 `local-fallback`。
- `complete()`：调用 OpenAI-compatible 非流式 `/chat/completions`。
- `stream()`：调用 OpenAI-compatible SSE，并产出 `stream` / `thinking` chunk。
- `resolveLlmWikiModel()`：LLM Wiki 编译与 Agent 默认模型。
- `resolveSessionModel()`：Session Chat 默认模型。

当前没有模型白名单、超时、重试、限流和 usage 统计。

## 5. LLM Wiki 模块

目录：`src/modules/llmWiki`

### 5.1 模块结构

- `llm-wiki.controller.ts`：REST 接口。
- `llm-wiki.service.ts`：业务编排。
- `llm-wiki-store.service.ts`：本地文件存储和 Wiki 页面读写。
- `llm-wiki-compiler.service.ts`：source 到 Wiki draft 的编译。
- `llm-wiki-search.service.ts`：Wiki 搜索。
- `llm-wiki-issue.service.ts`：lint issue 生成、保存、解决。
- `llm-wiki.types.ts`：服务端内部类型。
- `llm-wiki.config.ts`：数据目录和大小限制。

### 5.2 数据结构

```text
.knowllm/llm-wiki/default/
  schema.md
  issues.json
  sources/<sourceId>/
    meta.json
    source.md|txt|html
  wiki/
    index.md
    summaries/*.md
    concepts/*.md
    entities/*.md
    comparisons/*.md
```

### 5.3 Source 上传

入口：

```text
POST /api/llm-wiki/sources/upload
```

处理逻辑：

```text
FileInterceptor 接收 file
  -> 校验扩展名 .md/.txt/.html
  -> 校验非空、最大 10MB、简单二进制特征
  -> 写入 sources/<sourceId>/source.ext
  -> 写入 meta.json，状态 uploaded
```

### 5.4 Source 编译

入口：

```text
POST /api/llm-wiki/sources/:sourceId/ingest
```

业务编排在 `LlmWikiService.ingestSource()`：

```text
读取 source meta
  -> 如果同 source 已在 jobs Map 中则拒绝
  -> 状态改为 ingesting
  -> 后台 runIngest(sourceId)
```

后台编译流程：

```text
读取原文和 schema
  -> LlmWikiCompilerService.compileSource()
  -> detachSourceFromWiki(sourceId)
  -> saveCompiledPage() 逐页写入
  -> rebuildWikiIndex()
  -> source 标记 ready
```

编译器逻辑：

- 有模型时调用 `ModelService.complete()`，要求模型返回 JSON。
- 任意模型异常或 JSON 解析异常都会 fallback。
- fallback 会生成 summary，并从二三级标题生成最多 5 个 concept。
- 模型输入最多取前 120,000 字符。

当前重要边界：

- 编译不是事务操作。
- 共享页面会用新正文覆盖旧正文，同时合并 source。
- fallback 中文标题可能退化为 `concept-1.md` 等路径并互相覆盖。
- 服务端没有阻止删除正在 ingest 的 source。

### 5.5 Wiki 页面

`LlmWikiStoreService` 负责：

- `tree()`：按目录分组返回页面树。
- `getPage()`：读取页面并解析 frontmatter。
- `savePage()`：保存完整 Markdown，重新渲染 frontmatter。
- `deletePage()`：删除非 `index.md` 页面。
- `rebuildWikiIndex()`：扫描所有页面生成索引。

页面格式：

```markdown
---
title: "页面标题"
type: concept
tags:
  - "tag"
sources:
  - "sourceId"
schema_hash: "..."
updated_at: "..."
---

# 页面正文
```

### 5.6 搜索

`LlmWikiSearchService.search()` 当前是轻量 substring scan：

```text
query trim
  -> 按空白切 term
  -> 遍历所有 Wiki 页面
  -> title/path/body 命中加权
  -> 按 score 排序
```

它适合最小原型，不适合复杂中文检索、同义词、模糊匹配和大规模知识库。

### 5.7 Lint 与 Issue

`LlmWikiIssueService.runLint()` 当前检查：

- index 缺失。
- 页面缺少更新时间。
- 页面引用不存在的 source。
- 非 manual 页面没有 source。

Source 删除时，`LlmWikiService.deleteSource()` 会为剩余共享页面生成 `needs_reconcile` issue。

当前 issue 生命周期限制：

- 本轮 lint 不再出现的问题不会自动 resolve。
- 已 resolved 的问题再次出现时不会自动 reopen。

## 6. Session 模块

目录：`src/modules/session`

### 6.1 模块结构

- `controllers/session.controller.ts`：Session REST。
- `services/session-store.service.ts`：会话和消息持久化。
- `services/session-chat.service.ts`：Chat 路由、Wiki 问答、模型流式响应。
- `session.gateway.ts`：原生 `ws` WebSocket 接入。

### 6.2 Session REST

主要接口：

- `POST /api/session/add`：创建会话。
- `GET /api/session/list`：分页列出活跃会话。
- `GET /api/session/detail`：读取会话和全部消息。
- `POST /api/session/:session_id/delete`：软删除会话。
- `GET /api/session/tools`：返回当前可用 Tool，现只有 `llmWiki`。

数据文件：

```text
.knowllm/sessions/sessions.json
```

Session 采用软删除，消息仍保留在同一个 JSON 中。

### 6.3 Session WebSocket

地址：

```text
/api/session/ws/session/:sessionId
```

`SessionGateway` 在模块初始化时监听 HTTP server 的 `upgrade` 事件，匹配路径后接管为 WebSocket。

消息类型：

- `ping`：返回 `pong`。
- `cancel`：取消当前 session 任务。
- `message`：执行 Chat。

执行流程：

```text
收到 message
  -> cancel(sessionId) 取消旧任务
  -> 保存 user message
  -> maybeUpdateDefaultTitle()
  -> 读取当前 session 全部消息作为 history
  -> SessionChatService.streamReply()
  -> 转发 thinking / stream
  -> 保存 agent message
  -> 发送 done
```

当前每个 session 只有一个进程内 `AbortController`。任意连接关闭也会取消该 session 当前任务。

### 6.4 Chat 路由

`SessionChatService.parseSessionRoute()` 识别：

```text
[assistant:llmWiki] 用户问题
```

识别成功走 LLM Wiki 模式，否则走基础 Chat。

基础 Chat：

```text
system prompt
  -> 全量历史消息
  -> ModelService.stream()
```

LLM Wiki Chat：

```text
检索 Wiki
  -> 读取命中页面作为 evidence
  -> system prompt + evidence + 全量历史
  -> ModelService.stream()
```

未配置模型或选择 `local-fallback` 时返回本地 fallback 文本。

## 7. Agent 模块

目录：`src/modules/agent`

### 7.1 模块结构

- `controllers/agent.controller.ts`：Agent REST。
- `services/agent.service.ts`：runner 注册、run 提交、取消、查询。
- `services/agent-run-store.service.ts`：run 文件持久化。
- `runners/llm-wiki-agent.runner.ts`：当前唯一 runner。
- `agent.types.ts`：runner 和 run 类型。

### 7.2 Run 数据

```text
.knowllm/agents/runs/llmWiki/<runId>/
  meta.json
  events.jsonl
  result.md
  result.json
```

### 7.3 LLM Wiki Agent 流程

```text
POST /api/agents/llmWiki/runs
  -> validateInput({ query, limit, model })
  -> createPending()
  -> jobs Map 保存 AbortController
  -> runner.start()
  -> 搜索 Wiki
  -> 读取页面 evidence
  -> 调用模型 complete()
  -> 失败时 fallback 摘录
  -> finish() 写入 result 和 meta
```

当前 runner 只支持 `llmWiki`。取消任务只对当前进程内的 job 有效，服务重启后无法恢复 controller。

## 8. Debug 与 Health

Health：

```text
GET /api/health
```

返回 API 存活状态。

Debug：

```text
GET /api/debug/llm-wiki/summary
GET /api/debug/llm-wiki/search
```

Debug 模块当前始终注册，会暴露本地数据根目录。进入部署前应只在开发环境启用。

## 9. 维护注意事项

- 当前所有业务逻辑都在 `apps/api`，不是 `packages/core`。
- Web/API 类型没有共享，改 DTO 时要同步更新 `apps/web/src/api/*`。
- 本地 JSON 存储没有事务和跨进程锁，避免多 API 实例同时写同一数据目录。
- Chat 和 Agent 的 LLM Wiki 查询逻辑重复，后续应抽成统一 `LlmWikiQueryService`。
- 不要在服务端返回前端尚未消费的复杂占位字段，避免再次形成无效契约。
