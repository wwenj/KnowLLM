# 前后端执行流程与残留逻辑审计（第三轮）

审计日期：2026-06-10

审计范围：

- 前端：`apps/web/src`
- 服务端：`apps/api/src`
- 共享与规划模块：`packages/core`、`packages/protocol`、`packages/cli`、`packages/mcp-server`
- 当前本地数据：`.knowllm/`
- 仓库状态、TypeScript、ESLint
- 未执行复杂 UI 自动化测试
- 本轮已按 `server_copy` / 原始 `llmWiki实现说明.md` 对齐服务端核心代码

## 1. 本轮结论

第三轮已完成核心链路对齐：

- Chat 已从单轮请求改为携带历史消息。
- Chat 已接入 `ModelService.stream()`，不再是模型完成后模拟切块。
- Session Chat 内部改为 LangGraph 路由；`[assistant:llmWiki]` 不再直接做一次 Wiki search，而是先跑 `llmWiki` Agent snippets，再把 snippets 注入聊天模型。
- 服务端 Agent 仍只注册 `llmWiki`，但 runner 已恢复为原始多轮流程：`load_manifest -> plan_query -> collect_initial_candidates -> read_page_batch -> review_evidence -> execute_next_actions -> read_raw_sources -> review_sources -> build_final_snippets -> maybe_synthesize`。
- LLM Wiki ingest 已恢复 compiler + fusion：共享页不再简单“覆盖正文 + 合并 source”，会按同 path、同标题、搜索候选交给 fusion 决定 create/update/skip/conflict。
- 搜索已恢复 `FlexSearch` 内存索引和 title/tag/path/body 加权。
- Schema / issue / contribution 结构已恢复为 `schema/AGENTS.md`、`issues/open|resolved`、`meta/page-contributions`、`log/YYYY-MM-DD.md`。
- Lint 已恢复 structural/evidence 全量检查和消失 issue 自动 resolve。
- 前端 Skills、附件、Gateway 管理 API 已删除。
- 模型列表已从旧 `/api/gateway/models` 改为 `/api/models`。
- `pnpm check` 和 `pnpm lint` 当前都能通过。

当前前后端主流程已经基本对齐，真实产品边界为：

```text
LLM Wiki Source 管理与编译
+ Wiki 浏览、编辑、搜索、诊断
+ 基础 Chat / LLM Wiki Chat
+ LLM Wiki Agent 调试
+ 本地文件持久化
```

当前仍需关注的问题：

1. Source 重解析仍不是事务操作，保存中途失败可能留下部分新页面、部分旧页面和错误 source 关联。
2. `LlmWikiSearchService.search()` 对「如何设计 llmwiki」这类中文整句直接搜索仍可能为 0；Agent 路径依赖 planner 拆 query 才能改善召回。
3. HTTP 异常仍统一返回 200，真实错误码在响应体 `code`。

本轮还发现两个重要执行风险：

- Chat 虽已支持多轮，但会把整个会话历史无上限传给模型，长会话最终会超出模型上下文。
- 服务端没有禁止删除正在 ingest 的 source；前端按钮虽然禁用，但直接调用 API 仍会触发删除与后台任务竞态。

此外，当前整个实现目录仍未进入 Git：

- `apps/`、`packages/`、`docs/`、`package.json`、lockfile、配置文件均显示为未跟踪。
- 当前 Git 实际只跟踪 8 个旧文件。
- 这不会影响本地运行，但会导致当前实现无法被正常提交、回滚和发布。

## 2. 与上一轮审计的变化

| 上一轮问题                       | 当前状态                                                        | 结论                                 |
| -------------------------------- | --------------------------------------------------------------- | ------------------------------------ |
| Chat 没有多轮上下文              | 已读取当前 session 全部历史消息                                 | 已修复，但缺少上下文长度限制         |
| Chat 使用模拟流式                | 已接入模型 SSE 流式输出                                         | 已修复                               |
| Chat Skill 选择无效              | Skill picker 和 Skills API 已删除                               | 已修复                               |
| Chat 附件只保存不理解            | 附件功能已整体删除                                              | 已收敛                               |
| Agent UI 大量配置不生效          | 前端仍传 query/limit/model，服务端兼容映射到 budget/models      | 已修复                               |
| DeepAgent / KG / 企业投研残留    | 已删除相关配置与展示分支                                        | 已修复                               |
| 服务端存在孤立 `chat` runner     | 已删除，只保留 `llmWiki`                                        | 已修复                               |
| Gateway 管理 API 残留            | 已删除，只保留 `/api/models`                                    | 已修复                               |
| 前端 Skills CRUD 残留            | 已删除                                                          | 已修复                               |
| Health 前端路径错误              | 前端 Health API 已删除                                          | 路径错位消失，但顶部状态仍是静态文案 |
| Wiki 共享页证据归属错误          | 已恢复 fusion + contribution                                    | 已修复主链路，仍需事务保障           |
| Wiki lint issue 生命周期错误     | 已恢复 open/resolved 目录和自动 resolve                         | 已修复                               |
| 编译静默 fallback / 静默截断     | compiler 失败会标记 source failed；fusion 失败才 fallback issue | 已修复主链路                         |
| Agent run 重启恢复缺失           | execution service 启动时取消 running run                        | 已修复基础恢复                       |
| HTTP 异常统一返回 200            | 未修复                                                          | 仍存在                               |
| Web/API 类型重复并漂移           | 未修复                                                          | 仍存在                               |
| CLI / MCP / core / protocol 骨架 | 未修复                                                          | 仍存在                               |

## 3. 当前真实架构

### 3.1 运行入口

| 模块   | 技术                                  |    默认端口 | 当前行为                                    |
| ------ | ------------------------------------- | ----------: | ------------------------------------------- |
| Web    | React 19 + Vite + React Router        |     `43127` | REST 和 WS 地址仍写死为 `localhost:39247`   |
| API    | NestJS 11                             |     `39247` | REST、Swagger、原生 `ws` WebSocket          |
| 模型   | OpenAI-compatible `/chat/completions` |    环境变量 | Agent/Compiler 用普通完成，Chat 用 SSE 流式 |
| 持久化 | JSON / Markdown / JSONL               | `.knowllm/` | 无数据库、事务、队列、多进程锁              |

### 3.2 当前接口数量

当前共有 34 个 REST 接口和 1 个 Session WebSocket：

| 模块              | REST 数量 | 前端是否使用                       |
| ----------------- | --------: | ---------------------------------- |
| Health            |         1 | 否                                 |
| Models            |         1 | 是                                 |
| LLM Wiki          |        17 | 16 个使用，`overview` 未使用       |
| Agent             |         6 | 是                                 |
| Session           |         7 | 5 个使用，更新标题和消息状态未使用 |
| Debug             |         2 | 否                                 |
| Session WebSocket |         1 | 是                                 |

### 3.3 当前数据目录

```text
.knowllm/
  llm-wiki/default/
    schema/AGENTS.md
    issues/open/*.json
    issues/resolved/*.json
    meta/page-contributions/*.json
    log/YYYY-MM-DD.md
    sources/<sourceId>/
      meta.json
      source.md|txt
    wiki/
      index.md
      summaries/*.md
      concepts/*.md
      entities/*.md
  sessions/
    sessions.json
  agents/runs/llmWiki/<runId>/
    meta.json
    events.jsonl
    result.md
    result.json
```

上一轮文档中的 `attachments/` 已不再存在。

## 4. 当前端到端执行流程

### 4.1 Source 上传与编译

```text
Web 选择 .md/.txt 文件
  -> POST /api/llm-wiki/manage/sources/upload
  -> 校验扩展名、大小、空文件、简单二进制特征
  -> 保存原文与 meta.json，状态 uploaded
  -> Web 调用 POST /sources/:sourceId/ingest
  -> 服务端状态改为 ingesting，启动进程内 Promise
  -> compiler 模型编译 JSON；失败则 source failed
  -> detachSourceFromWiki 移除该 source 的旧关联
  -> fusion 对 concept/entity 做 create/update/skip/conflict
  -> saveFusionPage 写入页面和 contribution
  -> 重建 index.md
  -> source 标记 ready
  -> Web 每 1.5 秒轮询 source 列表
```

执行边界：

- 同一个 source 不能同时 ingest。
- 不同 source 可以同时 ingest，但没有全局写锁。
- 服务重启会把遗留 `ingesting` source 标记为 `failed`。
- 前端不允许删除 `ingesting` source，但服务端 API 没有同样校验。
- 编译只读取 source 前 120,000 字符，并在 prompt 中标记是否截断。

### 4.2 Wiki 浏览、编辑与删除

```text
Web 读取 tree
  -> 打开页面
  -> 用户直接编辑完整 Markdown 和 frontmatter
  -> POST /wiki/page/save
  -> 服务端重新解析 frontmatter 并写回
  -> 非 index 页面保存后重建 index.md
```

删除页面后会重建 index，但不会同步清理 source `meta.json` 中的 `touched_pages`，因此 Source 列表的“生成页面数”可能继续包含已删除页面。

### 4.3 Wiki 搜索

```text
query
  -> FlexSearch full token 搜索
  -> 整句 substring fallback
  -> title/tag/path/body 加权
  -> 返回前 N 个结果
```

当前搜索不是语义检索，不做中文分词、同义词或向量召回。

当前本地数据已经体现该问题：

- Wiki 中存在 `LLM Wiki`、`llm-wiki.md` 等页面。
- 直接搜索“如何设计 llmwiki”仍可能返回 0。
- Agent 查询不再直接使用这一条 search 结果，而是先由 planner 生成候选 path 和 searchQueries。

### 4.4 Wiki Lint 与 Issue

```text
Web 选择 structural / evidence / all
  -> POST /api/llm-wiki/manage/lint
  -> 服务端生成 structural / evidence issue
  -> 按 kind + target + message upsert 到 issues/open
  -> 本轮消失的结构/证据 issue 移到 issues/resolved
  -> Web 再读取 open issue
```

当前检查：

- structural：missing frontmatter、oversized page、dead link、orphan page、index missing、duplicate title。
- evidence：missing source、deleted source ref、missing claim source、schema drift、needs reconcile、stale source digest。

Source 删除时额外生成 `needs_reconcile`。

Fusion 产生的 conflict、weak_evidence、needs_review 等 issue 也会进入同一 issue 生命周期。

### 4.5 Chat

```text
Web 初始化
  -> 并行读取最近 50 个 session、模型、Tool
  -> 没有 session 时自动创建
  -> 读取 session 全部消息
  -> 建立 /api/session/ws/session/:sessionId

发送消息
  -> 可选增加 [assistant:llmWiki] 前缀
  -> Web 先插入本地 user / assistant 占位消息
  -> 服务端解析 route，保存去掉 route 前缀后的 user message
  -> 读取该 session 全部历史消息
  -> basic chat 或 LangGraph llmWiki node
  -> llmWiki node 运行 Agent snippets
  -> snippets 注入 system prompt
  -> 调用模型 SSE 并实时转发 thinking / stream
  -> 完成后保存 agent message
  -> 发送 done 和 session_title
```

当前已是真多轮、真流式，但有以下边界：

- 历史消息没有数量、字符或 token 上限。
- route 前缀被去掉后才持久化，历史记录无法审计该消息当时使用了哪个 Tool。
- 每个 session 只维护一个 `AbortController`。
- 任意一个连接关闭都会取消该 session 当前任务。
- 切换会话会断开旧 WS，因此会同时取消旧会话正在执行的回复。
- 取消后只保留本地部分流式文本，服务端不会保存该部分回复，刷新后会消失。
- 前端只读取最近 50 个 session，超过 50 个的旧会话无法从 UI 访问。

### 4.6 LLM Wiki Agent

```text
Web 提交 query + limit + model
  -> POST /api/agents/llmWiki/runs
  -> 校验并规范化为 outputMode/sourcePolicy/budget/models
  -> 创建 run 目录与 running meta
  -> load_manifest
  -> plan_query
  -> collect_initial_candidates
  -> read_page_batch / review_evidence 多轮循环
  -> read_raw_sources / review_sources
  -> build_final_snippets
  -> maybe_synthesize
  -> 保存 result.md / result.json / events.jsonl / meta.json
  -> Web 每 1.5 秒轮询详情
```

当前 Agent 前端字段保持旧的 query/limit/model；服务端兼容映射到原始 runner 的 budget/models。

仍存在：

- 模型错误会导致当前 Agent run failed，Session llmWiki 分支会把失败结果作为最终回复。
- 服务重启会把遗留 `running` run 标记为 cancelled。
- 只保留进程内取消控制器，没有队列、超时、并发限制和保留策略。
- Session Wiki Chat 已复用 Agent snippets，不再重复实现单次检索链路。

## 5. 当前前后端对齐矩阵

| 能力                                 | 前端              | 服务端                           | 结论                 |
| ------------------------------------ | ----------------- | -------------------------------- | -------------------- |
| Source 上传 / 重命名 / 删除 / ingest | 已实现            | 已实现                           | 基本对齐             |
| `.html` Source                       | 文件选择器不允许  | 服务端不允许                     | 已收敛               |
| Wiki tree / page / save / delete     | 已实现            | 已实现                           | 基本对齐             |
| Wiki `comparison/manual` 类型        | 类型未声明        | 服务端不支持                     | 已收敛到原始类型     |
| Wiki 搜索                            | 已实现            | 已实现                           | 对齐，但检索能力不足 |
| Wiki lint / issue                    | 已实现            | structural/evidence 全量规则     | 对齐                 |
| 基础 Chat                            | 已实现            | 已实现                           | 对齐                 |
| Chat 多轮上下文                      | 已实现            | 已实现                           | 对齐，但无长度限制   |
| Chat 真流式                          | 已实现            | 已实现                           | 对齐                 |
| Chat LLM Wiki Tool                   | 已实现            | 已实现                           | 对齐                 |
| Chat 附件 / Skill                    | 已删除            | 已删除                           | 已收敛               |
| LLM Wiki Agent                       | query/limit/model | 兼容旧字段，内部为 budget/models | 对齐                 |
| Agent 运行历史 / 取消                | 已实现            | 已实现                           | 基本对齐             |
| 模型列表                             | `/api/models`     | `/api/models`                    | 对齐                 |
| Health                               | 静态“服务正常”    | `/api/health`                    | 未接入               |
| shared protocol                      | Web/API 各自声明  | `packages/protocol` 未接入       | 缺失                 |
| CLI / MCP                            | 无真实入口        | placeholder                      | 未实现               |

## 6. 高优先级问题

### P0：发布或继续扩展前必须处理

#### 1. 当前实现没有进入 Git

当前 `git status` 显示实现目录与工程配置均为未跟踪文件，Git 只跟踪 8 个旧文件。

影响：

- 本轮和上一轮修改没有可靠版本基线。
- 无法通过 diff 审查改动。
- 无法安全回滚。
- push 当前分支不会包含主要实现。

#### 2. 共享 Wiki 页面证据归属已修复主链路

第三轮已恢复原始 `LlmWikiFusionService` 和 `page-contributions`：

- concept/entity 不再直接覆盖写入。
- fusion 会基于同 path、同标题、搜索候选决定 create/update/skip/conflict。
- 页面写入时同步 contribution 记录。
- source 删除后会移除 contribution 并为剩余共享页面生成 `needs_reconcile`。

剩余风险是 fusion 输出质量仍依赖模型；fusion 模型失败时会使用“新增来源待复核”fallback，并生成 `weak_evidence` issue。

#### 3. ingest 不是事务操作

当前顺序是：

```text
compile 完成
  -> detach 旧 source 关联
  -> 逐页写入
  -> rebuild index
  -> source ready
```

如果逐页保存或重建 index 中途失败：

- 旧关联已经被移除。
- 部分新页面已经写入。
- 部分旧页面可能仍保留。
- source 最终只会标记 `failed`，没有回滚。

此外，服务端允许在 ingest 期间删除 source。删除后后台任务继续运行，会在读取、detach、更新状态时遇到 source 不存在，形成竞态。

### P1：核心体验与可维护性问题

#### 4. Chat 多轮历史无上限

`SessionGateway` 保存当前 user message 后，直接读取 `detail(sessionId).messages` 的全部消息传给模型。

没有：

- 最近 N 轮限制。
- 字符或 token 预算。
- 历史摘要。
- 超限降级策略。

长会话会越来越慢，并最终触发模型上下文超限。

#### 5. 搜索不足以直接支撑自然语言查询

当前搜索已恢复 FlexSearch，但仍不是语义检索。中文自然语言、空格差异、连字符差异、同义词仍会导致漏召回。

直接 `GET /api/llm-wiki/retrieval/search?q=如何设计 llmwiki` 仍返回 0；Agent 路径已改为 planner 拆 query，因此不再等同于这次直接搜索。

至少应补：

- 中文 n-gram 或分词。
- 空格与连字符归一化。
- 查询词权重与命中覆盖率。
- 标题、标签、正文的明确分层计分。

#### 6. Lint issue 生命周期已修复主链路

第三轮已恢复：

- `issues/open/*.json` 与 `issues/resolved/*.json`。
- structural/evidence 分模式 active issue 集合。
- 本轮消失的结构/证据 issue 自动 move 到 resolved。

剩余风险：`needs_reconcile` 仍是人工处理型 issue，不应自动关闭。

#### 7. fallback 与截断状态

Compiler 模型异常不再静默 fallback，source 会标记 `failed`。Fusion 模型异常仍会 fallback merge，并生成 `weak_evidence` issue。

仍建议继续补充：

- 在 source meta 或 ingest log 中记录 `input_chars` / `compiled_chars`。
- 在 UI 上提示 source 是否被截断。
- 在 issue 列表里突出 fusion fallback。

#### 8. Session / WS 存在任务生命周期竞态

- 任意 WS 连接关闭都会取消 session 当前任务，多标签页会互相影响。
- 删除正在回复的 session 时，REST 会先软删除 session；后台 WS 随后保存 agent message 会失败。
- 切换会话会主动关闭旧连接并取消旧任务。
- 取消后的部分回复只存在前端内存，不会持久化。

应明确任务属于：

1. session；
2. WebSocket connection；
3. 独立 message/run。

当前实现混合了这三种生命周期。

#### 9. Agent run 恢复和状态语义

- 服务重启后遗留 `running` run 会标记 `cancelled`。
- 模型错误会导致 run `failed`。
- 没有超时、重试、并发限制、运行清理。
- 前端只读取最近 50 个 run。

### P2：部署和扩展前处理

#### 10. HTTP 异常仍全部返回 200

`ApiExceptionFilter` 对所有异常执行：

```text
response.status(200).json(...)
```

这会影响监控、代理、Swagger、缓存和通用客户端行为。

#### 11. 配置和安全边界未收敛

- REST Base 固定为 `http://localhost:39247`。
- WS Base 固定为 `ws://localhost:39247`。
- Vite 没有 proxy。
- CORS 为 `*`。
- 无认证、权限、workspace 隔离。
- Debug 模块生产环境也会加载，并暴露本地绝对数据路径。
- 模型参数允许 API 调用方传任意 model 字符串，没有白名单。
- 模型调用没有 timeout、retry、usage、限流。

#### 12. Web/API 类型仍漂移

例如：

- Agent defaults 返回原始 runner 配置，但前端仍只展示 query/limit/model。
- `packages/protocol` 的 source 状态与当前 API 不一致。
- Web/API 没有真正依赖 `@knowllm/protocol`。

#### 13. 文件持久化缺少数据治理

- Session 软删除后消息永久保留。
- Source、run、issue 没有保留与清理策略。
- 删除 Wiki 页面不会同步 source `touched_pages`。
- JSON 读取失败会静默返回 fallback，可能掩盖文件损坏。
- 无跨进程锁，不支持多 API 实例。

## 7. 当前残留冗余与孤立逻辑

### 7.1 前端未使用

- `llmWikiApi.overview()`。
- `sessionApi.update()`。
- `sessionApi.updateMessageOpStatus()`。
- `components/StatusTag.tsx`。
- `components/ui/pagination.tsx`。
- Chat 仍使用 `zspace.chat.*` localStorage key。
- `zspace-*` 全局 CSS class 与变量。
- `apps/web/index.html` 标题仍是 `ZSpace`。
- 404 页仍使用 `ZSpace` alt，且“回到主页”跳转不存在的 `/overview`。
- 404 与 Chat 空状态仍依赖外部图片 URL。

`pagination.tsx` 当前虽未使用，但 Chat 和 Agent 历史都只显示最近 50 条；如果要补历史分页可以复用，否则应删除。

### 7.2 服务端未被前端使用

- `GET /api/health`。
- `GET /api/llm-wiki/manage/overview`。
- `POST /api/session/update`。
- `POST /api/session/message/:message_id/op_status`。
- `GET /api/debug/llm-wiki/summary`。
- `GET /api/llm-wiki/retrieval/search`。
- Agent defaults 返回的 `modelOptions`，前端另外调用 `/api/models`，没有使用该字段。

这些接口可以作为正式 API 保留，但需要明确是“外部 API”还是“当前孤立代码”，避免继续双重维护。

### 7.3 LLM Wiki 查询链路

Session LLM Wiki Chat 已复用 `LlmWikiAgentRunner` 的 `outputMode=snippets`，不再重复实现一次搜索和 evidence 组装。当前需要继续关注的是 Agent runner 逻辑较长，后续可再拆出 planner/reviewer/source review 的内部 helper service。

### 7.4 骨架与文档残留

- `packages/core` 仍只有固定 overview 和目录列表。
- `packages/protocol` 未被 Web/API 使用。
- `packages/cli` 除 help 和打印目录外均为 TODO。
- `packages/mcp-server` 仍是 placeholder。
- `docs/development.md` 仍写“当前仓库处于骨架阶段，逻辑会优先进入 packages/core”，与真实实现不一致。
- README 宣称页面合并、死链、冲突检查、MCP、Skill 等能力，当前实现尚未达到。

## 8. 推荐整改顺序

### 第一阶段：保证知识正确性

1. 设计 contribution 或 claim/source 数据结构，禁止共享页面直接覆盖正文后合并 sources。
2. 修复 fallback 中文路径冲突。
3. 把 ingest 改成 staging + 原子提交，失败时保留旧 Wiki。
4. 服务端禁止删除/重命名正在 ingest 的 source，或实现明确取消流程。
5. 给 compiler fallback、错误和截断增加可见状态。

### 第二阶段：保证查询与运行稳定

1. 改进中文搜索和路径归一化。
2. 抽取统一 `LlmWikiQueryService`。
3. 给 Chat 历史增加 token/字符预算。
4. 明确 WS、session、message task 的生命周期。
5. 启动时恢复 stale Agent run，并增加超时。
6. 修复 lint issue 生命周期和 schema drift。

### 第三阶段：收敛工程边界

1. 把当前实现纳入 Git，建立真实版本基线。
2. 统一 Web/API/shared protocol 类型。
3. 清理或正式定义孤立 API 和未使用组件。
4. 修复品牌、404、静态服务状态与 API Base。
5. Debug 模块只在开发环境加载。
6. 增加最小单元测试和 API 集成测试。

## 9. 验证结果

- `git status --short`：当前实现与工程配置均为未跟踪文件。
- `pnpm check`：通过，6 个 package 的 TypeScript 检查成功。
- `pnpm lint`：通过，无 error；仍有 2 个 Fast Refresh warning：
  - `apps/web/src/components/ui/button.tsx`
  - `apps/web/src/components/ui/tabs.tsx`
- 测试文件：未发现 `*.test.*` 或 `*.spec.*`。
- 当前本地数据：
  - 2 个 ready source。
  - 4 个活跃 session、2 个已软删除 session、14 条消息。
  - 5 个 LLM Wiki Agent run，当前均为 `insufficient`。
  - 0 个 issue。
- 未执行复杂 UI 自动化测试。
