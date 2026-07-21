# LLM Wiki 开源实现方案

本文记录 KnowLLM 当前 llmWiki 的核心设计和实现边界。它已经从早期的 `section -> facts -> planner -> writer` 多阶段链路，调整为有界、显式、可估算的 **Source Integration Compiler**。

## 1. 核心原则

llmWiki 是一个编译型语义 Wiki 系统。

它的核心不是运行时 RAG，也不是把原文切块后临时拼答案，而是在 source 进入系统后，通过一次有界 LLM 编译，把原始资料整合成稳定、可读、可被 Agent 消费的 Markdown Wiki。

当前原则：

- LLM 编译仍是 source 进入可用 Wiki 的核心路径。
- 编译必须有成本估算、预算确认、hash 幂等和 job checkpoint。
- 模型负责编写语义 Wiki，不负责生成精确证据坐标。
- 发布 gate 只防止写坏 Wiki，不做过度证据核验。
- Agent 默认读取 Wiki 页面，必要时按 `sourceId` 回读 raw source。

一句话：

```text
source 是原始资料，compiler 生成语义 Wiki，gate 只拦结构性错误，Agent 读已发布页面。
```

## 2. 数据状态

source 状态分为四段：

```text
raw_uploaded
  原文已上传，尚未编译。

compile_planned
  已创建编译计划或 job，等待/正在编译。

candidate_ready
  编译 candidate 可发布。正常路径会自动继续发布；该状态主要用于兼容和诊断。

published
  已写入正式 Wiki，可被 Agent 使用。
```

兼容旧状态：

```text
uploaded  -> raw_uploaded
ingesting -> compile_planned
ready     -> published
failed    -> failed
```

source 的核心字段：

```ts
{
  source_id: string;
  filename: string;
  sha256: string;
  schema_hash: string;
  status: LlmWikiSourceStatus;
  touched_pages: string[];
  latest_candidate_id?: string;
  latest_compile_hash?: string;
}
```

## 3. 编译链路

当前主链路：

```text
source
  -> deterministic estimate
  -> explicit compile confirmation
  -> Source Integration Compiler
  -> compile candidate
  -> local structure gate
  -> publish
```

普通 source 默认最多 1 次模型调用。

超长 source：

```text
source
  -> bounded digest
  -> integration patch
```

超出 `maxDigestSourceChars` 的 source 会被计划阻断，需要人工拆分后显式编译，不会自动无限展开。

### SourceMap

当前仍保留 `meta/source-maps/<sourceId>.json`，但它不再代表多 section 编译计划，只作为 source 元信息和兼容层。

当前 `sectionSource` 输出一个 full-source section：

```text
s0001
startOffset = 0
endOffset = source.length
content = full source
```

## 4. 模型输出契约

模型输出最小 Wiki patch。

必填：

```ts
{
  sourceTitle: string;
  pages: Array<{
    path: string;
    title: string;
    type: "summary" | "concept" | "entity" | "reference" | "procedure" | "changelog" | "troubleshooting";
    tags: string[];
    action: "create" | "update" | "delete" | "unchanged";
    body: string;
  }>;
  claims?: Array<{
    path: string;
    text: string;
  }>;
}
```

明确不让模型输出：

```text
citations
evidence
quote
sourceSpan
原文字符坐标
```

`claims[]` 只是页面关键结论摘要，用于调试、统计和轻量 page-claims 记录。它不是证据账本，也不是发布前置条件。

`affectedPages` 不信模型输出，由本地根据 `pages.map(path)` 生成。

## 5. Candidate 与发布

LLM 编译先生成 `CompileCandidate`：

```ts
{
  candidateId: string;
  sourceId: string;
  plan: CompilePlan;
  status: "candidate_ready" | "published" | "failed" | "needs_review";
  sourceTitle: string;
  pages: LlmWikiCompileCandidatePage[];
  claims: LlmWikiClaim[];
  affectedPages: string[];
  issues: LlmWikiPublishGateIssue[];
  modelUsage: {
    modelCalls: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
}
```

正常行为：

- gate 通过后自动发布，不要求人工批准。
- candidate 主要用于 checkpoint、诊断、复用和历史审计。
- hash 未变化时，复用已有 candidate 并以 0 次模型调用发布。

发布写入：

```text
wiki/
meta/source-maps/
meta/page-claims/
meta/page-contributions/
meta/compile-candidates/
meta/publish-receipts/
ingest-jobs/<jobId>/report.json
```

## 6. Publish Gate

当前 gate 是结构安全门禁，不是证据坐标审计。

会阻断发布的问题：

- 模型返回不是合法 JSON。
- 没有可发布页面。
- 页面数量超过 `maxAffectedPages`。
- page path 非法且无法本地归一化。
- page type 非法。
- page body 为空。
- `action=delete`。

不会阻断发布的问题：

- 没有 claims。
- claims 数量少。
- 没有 citations/evidence/sourceSpan。
- 旧 candidate 中存在废弃的 quote/sourceSpan issue。
- 模型返回 affectedPages 错误。

当前废弃的旧 gate issue：

```text
candidate 没有 claims 账本，不能发布
claim sourceSpan 不在 source 范围内
claim quote 与 sourceSpan 内容不完全匹配
```

这些 issue 读取时会被过滤，只有这类旧问题的 candidate 可按新 gate 视为可发布。

## 7. Page 与 PageClaims

正式页面仍使用 Markdown + YAML frontmatter：

```yaml
---
title: "页面标题"
type: reference
tags:
  - g-code
sources:
  - <sourceId>
schema_hash: "<sha256>"
updated_at: "<ISO time>"
---
```

页面类型：

| type | 用途 |
| --- | --- |
| `index` | 全局入口页 |
| `summary` | source 的整体理解、边界、主题结构和入口链接 |
| `concept` | 概念解释、适用范围、关键关系 |
| `entity` | 对象、组件、模块、接口、实体关系 |
| `reference` | 命令、配置、参数、字段、默认值、API 示例 |
| `procedure` | 安装、校准、操作、迁移等连续流程 |
| `changelog` | 版本、日期、行为变化、兼容影响 |
| `troubleshooting` | 现象、原因、处理方式、注意事项 |

page-claims 当前是轻量内部账本：

```ts
{
  path: string;
  factIds: string[];      // 新 source-integration 链路通常为空
  sourceIds: string[];
  claims?: Array<{
    claimId: string;
    path: string;
    text: string;
    sourceId: string;
  }>;
  updatedAt: string;
}
```

作用：

- 记录页面与 source 的关系。
- 支持 source 删除后的 stale 标记。
- 保存可选 key claims。
- 给管理端展示页面贡献关系。

它不再承担“每句话有精确原文坐标”的职责。

## 8. 成本、估算与幂等

编译前必须先做确定性估算：

```text
POST /api/llm-wiki/manage/compile/estimate
```

估算产物 `CompilePlan` 包含：

```ts
{
  sourceIds: string[];
  hash: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  maxModelCalls: number;
  affectedPageCandidates: string[];
  requiresDigest: boolean;
  blocked: boolean;
  reason: string;
}
```

正式编译必须带 `confirmHash`：

```text
POST /api/llm-wiki/manage/compile
```

如果没有 `confirmHash` 或 hash 不匹配，只返回估算，不调用模型。

hash 由这些因素决定：

```text
source hash
schema hash
compiler version
prompt version
affected page candidates
max model calls
```

source/schema/prompt/compiler 未变化时，重复编译复用已有 candidate，模型调用数为 0。

## 9. Job 与失败处理

ingest job 记录：

```ts
{
  jobId: string;
  sourceId: string;
  status: "running" | "success" | "failed";
  stage: string;
  model: string;
  pages: string[];
  factCount: number;        // 当前表示 key claims 数
  coverage: LlmWikiCoverageReport; // 新链路不使用 must coverage
  issues: LlmWikiPublishGateIssue[];
  error: string;
  candidateId?: string;
  planHash?: string;
  estimatedCostUsd?: number;
  modelCalls?: number;
}
```

失败策略：

- provider 429 / quota / rate-limit 后停止未开始的队列。
- 服务重启后遗留 `running` job 会被收尾为 failed。
- 已完成 candidate 会保留，可按 hash 复用，不从头烧模型。
- gate 失败不会自动重试模型。

## 10. 删除、Stale 与重建

删除 source 不再触发全库重编译。

行为：

```text
删除 source
  -> 删除 source/sourceMap/factLedger
  -> 保留已发布 Wiki 页面
  -> 标记受影响页面 stale
  -> 需要时显式 repair
```

schema 或 prompt/compiler version 变化：

```text
标记相关 source/page stale
不自动全量 LLM 编译
```

全量 rebuild：

```text
POST /api/llm-wiki/manage/rebuild
```

当前只重建 index/manifest，不默认跑 LLM。

stale 修复：

```text
POST /api/llm-wiki/manage/stale/repair
```

需要显式传入 sourceIds 和 confirmHash。

source 删除产生的 `source_deleted` stale 页面属于维护对象，不是长期保留的正常 Wiki 内容。当前实践是：

- 删除 source 时先保留受影响页面并打 stale marker，避免误删用户仍可能需要的内容。
- 后续可按 stale marker 清理确认无源页面及其 `page-claims`、`page-contributions`。
- 清理后重建 `index.md`，再运行 lint 得到当前真实 structural issue。

## 11. 诊断与 Issue 生命周期

诊断分成两层，不能混用：

```text
compile candidate issues
  单次编译/发布过程里的 gate 结果。

global wiki issues
  对已发布 Wiki 当前状态做 lint 扫描得到的结构问题。
```

candidate issue 只用于编译候选：

```text
auto_fixed
blocked_publish
human_review
```

global lint 只检测真正需要处理的结构问题：

```text
dead_link
  页面里有 [[xxx.md]] 双链，但目标 Wiki 页面不存在。

duplicate_title
  多个非 index.md 页面标题重复，会影响阅读、检索和页面选择。

missing_claim_source
  page-claims 指向不存在页面，或正式页面缺少对应 page-claims。

oversized_page
  页面接近单文件大小上限，建议拆分。
```

当前明确不作为 open issue 的内容：

```text
orphan_page
  页面只从 index.md 进入并不一定是问题。llmWiki 的主入口就是 index，
  把 summary 或普通页面没有非 index 入链当 warning 会产生大量噪音。

needs_reconcile
weak_evidence
  旧链路遗留诊断类型。没有明确当前检测规则时，不自动生成，也不作为当前待处理问题。
```

issue 生命周期：

- lint 本次检测到的问题写入 `issues/open`。
- 同一类已不存在的问题移动到 `issues/resolved`。
- resolved 只是历史归档，不代表一定人工修复。
- 如果 resolved issue 下次又被检测到，会重新打开为 open。
- 前端默认看 Open；Resolved/All 只用于审计历史。
- 前端可按当前 tab 清空 Open、Resolved 或 All 记录；清空只删除 issue 记录，不修改 Wiki 内容。

因此，当前“重新检测为空”的含义是：

```text
没有发现 dead link、重复标题、page-claims 不一致或超大页面。
```

它不代表事实覆盖率完美；事实覆盖仍需要 compile evaluation 判断。

## 12. API 边界

管理接口负责写入、编译、发布和维护：

```text
GET  /api/llm-wiki/manage/overview
GET  /api/llm-wiki/manage/sources
POST /api/llm-wiki/manage/sources/upload
POST /api/llm-wiki/manage/compile/estimate
POST /api/llm-wiki/manage/compile
GET  /api/llm-wiki/manage/candidates
POST /api/llm-wiki/manage/candidates/:candidateId/publish
GET  /api/llm-wiki/manage/stale
POST /api/llm-wiki/manage/stale/repair
POST /api/llm-wiki/manage/rebuild
POST /api/llm-wiki/manage/lint
GET  /api/llm-wiki/manage/issues?status=open|resolved|all
POST /api/llm-wiki/manage/issues/clear
POST /api/llm-wiki/manage/issues/:issueId/resolve
```

只读检索接口供 Agent 使用：

```text
GET /api/llm-wiki/retrieval/manifest
GET /api/llm-wiki/retrieval/search
GET /api/llm-wiki/retrieval/page
GET /api/llm-wiki/retrieval/source/:sourceId
```

Agent 不允许触发编译，不允许在回答过程中修改 Wiki。

## 13. 检索与 Agent

Agent 默认路径：

```text
manifest
  -> searchWiki
  -> readWikiPage
  -> follow links
  -> optional readRawSource
```

原则：

- Agent 以 published Wiki 页面为主知识入口。
- `sourceId` 只用于必要时回读 raw source。
- 不把 claims/facts 当主知识入口。
- 不引入 GBrain 的 MCP、daemon、Postgres、pgvector、graph 平台化架构。

## 14. Evaluation

当前编译链路不再依赖 fact ledger 覆盖率作为发布条件。

评测重点应调整为：

- 是否生成了正确页面类型。
- 页面是否覆盖用户期望主题。
- 页面正文是否可读、结构清晰、适合 Agent 使用。
- 关键命令、配置、参数、版本、错误码是否保留。
- 是否存在明显 hallucination 或 source 外知识。
- 编译成本是否符合计划。
- 重复编译是否 0 模型调用复用。

旧的 fact/page-claims 覆盖率评测可以保留为 legacy benchmark，但不能再作为新编译发布 gate 的默认依据。

## 15. 模块边界

核心模块：

```text
llm-wiki-compiler.service.ts
  估算、digest、Source Integration Compiler、candidate gate。

llm-wiki-ingest.service.ts
  compile estimate / confirmHash / job 队列 / 自动发布 / provider backoff。

llm-wiki-store.service.ts
  source、wiki、sourceMap、candidate、receipt、pageClaims、stale、job report 持久化。

llm-wiki-management.service.ts
  manage API 编排、source artifacts、schema/prompt version drift stale 标记。

llm-wiki-retrieval.service.ts
  Agent 只读访问。

llm-wiki-search.service.ts
  页面搜索索引。

llm-wiki-lint.service.ts
  当前 Wiki 结构诊断，只生成 dead_link、duplicate_title、missing_claim_source、oversized_page 等 actionable issue。
```

历史/兼容模块：

```text
llm-wiki-fact.utils.ts
llm-wiki-publish-gate.ts
meta/facts/
```

这些仍可能被旧数据、旧测试或 legacy evaluation 使用，但不是当前 source-integration 编译主路径。

## 16. 代码阅读入口

如果要从头盘当前编译逻辑，建议按下面文件顺序看。主线是：

```text
前端触发
  -> manage controller
  -> management service
  -> ingest service
  -> compiler service
  -> store publish
  -> retrieval/search 只读消费
```

一条正常“单个 source 编译”的执行链大概是：

```text
用户在前端点编译
  -> 前端先请求 estimate
  -> 后端返回 plan.hash / cost / blocked / affected pages
  -> 前端再带 confirmHash 请求 compile
  -> ingest service 创建 job 并入队
  -> compiler service 调模型生成 candidate
  -> store 保存 candidate
  -> candidate 通过本地 gate 后自动 publish
  -> source 状态变成 published
  -> wiki 页面、page claims、publish receipt、index.md 写入磁盘
  -> 前端轮询 source/job 状态并展示结果
```

这里最重要的边界是：前端只负责触发和展示，controller 只负责 HTTP 参数，management 只负责编排，ingest 负责执行流程，compiler 负责模型编译，store 负责落盘和发布。

### 16.1 前端触发编译

```text
apps/web/src/api/llmWiki.ts
```

这个文件是前端访问 llmWiki 后端的 API 封装。它不保存状态，也不判断编译逻辑，只把页面动作转换成 REST 请求。

编译相关看点：

- `estimateCompile(...)` 调 `POST /api/llm-wiki/manage/compile/estimate`。
- `compileSources(...)` 调 `POST /api/llm-wiki/manage/compile`。
- `ingestSource(...)` 调 `POST /api/llm-wiki/manage/sources/:sourceId/ingest`。
- 前端传入的是 `sourceIds`、`model`、`confirmHash`，不会直接调用 compiler。

怎么执行：

```text
llmWikiApi.estimateCompile([sourceId])
  -> 后端只估算，不调用模型
  -> 返回 plan.hash

llmWikiApi.compileSources([sourceId], model, plan.hash)
  -> 后端校验 confirmHash
  -> hash 正确才创建编译 job
```

所以你看这个文件时，重点确认“前端传了什么参数”，不要在这里找真正的编译逻辑。

```text
apps/web/src/pages/LlmWiki/index.tsx
apps/web/src/pages/LlmWiki/components/SourceCompilePanel.tsx
```

`index.tsx` 是 llmWiki 管理页面的状态中心，负责 source 列表、模型选择、上传、单条编译、批量编译、轮询和各种弹窗状态。

编译触发重点看：

- `handleIngest(source)`：单个 source 编译入口。
- `handleBulkIngest()`：批量 source 编译入口。
- `handleModelChange(model)`：切换解析模型并写入 localStorage。
- `refresh(true)`：静默刷新 source 状态。

- `knowllm.llmWiki.ingestModel` 是解析模型的本地持久化 key。
- source 列表轮询 `compile_planned` / `ingesting` 状态。
- 详情面板展示 latest job、latest candidate、source map、pages、claims。
- UI 只展示编译状态和工件，不实现编译逻辑。

`SourceCompilePanel.tsx` 是右侧详情面板。它辅助理解编译结果，因为它把后端工件按用户能读懂的方式展示出来：

- Compile 区展示 job model、stage、started、ended。
- Pages 区展示本次 source 关联到哪些 Wiki 页面。
- 编译结果区展示 latest candidate id、status、model calls、cost。
- Source Map 区展示 source map 当前只有 `s0001` full-source section。

所以读前端时可以按这个顺序：

```text
index.tsx 找触发动作
  -> api/llmWiki.ts 看请求路径和参数
  -> SourceCompilePanel.tsx 看后端返回的工件如何展示
```

### 16.2 后端管理入口

```text
apps/api/src/modules/llmWiki/controllers/llm-wiki-management.controller.ts
```

这个文件是写操作 HTTP 入口。它的职责是把 REST 请求映射到 `LlmWikiManagementService`，并把普通 Error 包成 `BadRequestException`。

重点路由：

- `POST /sources/upload` -> `wiki.uploadSource(...)`
- `POST /compile/estimate` -> `wiki.estimateCompile(sourceIds)`
- `POST /compile` -> `wiki.compileSources(sourceIds, model, confirmHash)`
- `POST /sources/:sourceId/ingest` -> `wiki.ingestSource(sourceId, model, confirmHash)`
- `GET /ingest-jobs/:jobId` -> `wiki.getIngestJob(jobId)`
- `GET /candidates` -> `wiki.listCandidates(...)`
- `POST /candidates/:candidateId/publish` -> `wiki.publishCandidate(candidateId)`

这个文件只做 HTTP 参数接入和错误包装，不做业务判断。

怎么执行：

```text
前端 POST /api/llm-wiki/manage/compile/estimate
  -> controller.estimateCompile(...)
  -> management.estimateCompile(...)

前端 POST /api/llm-wiki/manage/compile
  -> controller.compileSources(...)
  -> management.compileSources(...)
```

这里可以确认 API 合同，但不要在 controller 里找队列、hash、模型调用。

```text
apps/api/src/modules/llmWiki/services/llm-wiki-management.service.ts
```

这个文件是管理编排层。它把 controller 的请求分发给 store、ingest、lint、issue、schema、search 等 service。它自己通常不做重逻辑，也不直接调用模型。

重点方法：

- `uploadSource(...)`：转给 store 创建 source。
- `estimateCompile(...)`：转给 ingest 做确定性估算。
- `compileSources(...)` / `ingestSource(...)`：转给 ingest 进入正式编译。
- `sourceArtifacts(...)`：把 source map、旧 fact ledger、candidate、page claims、pages、job 聚合给前端。
- `publishCandidate(...)`：手动发布 candidate，正常编译路径会自动发布。
- `onModuleInit()`：启动时标记 compiler/prompt version drift stale。

这个 service 是管理编排层，不直接调用模型。

怎么执行：

```text
management.compileSources(...)
  -> ingest.compileSources(...)

management.sourceArtifacts(...)
  -> store.getSource(...)
  -> store.readSourceMap(...)
  -> store.getLatestCompileCandidateForSource(...)
  -> store.listPageClaims(...)
  -> store.listPageRefs(...)
```

这里适合看“前端详情页的数据从哪里聚合”，不适合看模型 prompt。

### 16.3 编译确认、队列和 job

```text
apps/api/src/modules/llmWiki/services/llm-wiki-ingest.service.ts
```

这个文件是当前编译执行流程的核心调度器。它不写 prompt，但决定什么时候能烧模型、是否复用 candidate、job 怎么入队、失败怎么处理。

主线方法：

- `estimateCompile(sourceIds)`
  - 读取 schema、source、existing pages。
  - 对每个 source 调 `compiler.estimateCompilePlan(...)`。
  - 聚合成总 plan，返回 `requiresConfirmation: true`。

- `compileSources(sourceIds, requestedModel, confirmHash)`
  - 先重新 estimate。
  - `confirmHash` 为空或不匹配时直接返回 estimate，不烧模型。
  - plan 被 blocked 时抛错。
  - `resolveIngestModel(...)` 校验模型。
  - 如果找到相同 `plan.hash` 的 reusable candidate，直接 0 模型调用复用并发布。
  - 否则 `enqueueCompileSource(...)` 创建 job，进入队列。

- `enqueueCompileSource(sourceId, model, plan)`
  - 创建 ingest job。
  - `store.prepareIngest(...)` 把 source 改为 `compile_planned`。
  - 放入 FIFO queue。
  - `schedule()` 按 `llmWikiConfig.ingestConcurrency` 执行；默认并发是 1。

- `runIngest(sourceId, model, jobId, signal)`
  - job stage 改为 `compiling`。
  - 重新计算 plan 和 reusable candidate。
  - `store.saveSourceMap(compiler.sectionSource(...))`。
  - `compiler.compileSource(...)` 真正调模型生成 candidate。
  - `store.saveCompileCandidate(...)` 保存 candidate。
  - candidate 通过 gate 后 `store.publishCandidate(...)` 自动发布。
  - provider quota/rate-limit 类错误会停止后续队列。

这一层负责成本确认、幂等复用、队列、停止、job report 和错误处理。

最关键的执行语义：

```text
第一次请求 compile/estimate
  -> 只返回估算
  -> 不调用模型

第二次请求 compile，且 confirmHash == estimate.plan.hash
  -> 才会进入模型编译
```

`confirmHash` 的作用是锁定“用户确认的是哪一次估算”。如果 source、schema、prompt version、compiler version 或 affected page candidates 变了，hash 会变，后端不会继续烧模型。

批量编译也走同一个逻辑：

```text
compileSources([sourceA, sourceB, sourceC], model, confirmHash)
  -> aggregateCompilePlans(...)
  -> 每个 source 独立生成 sourcePlan
  -> 每个 source 独立查 reusable candidate
  -> 未命中的 source 入队
```

注意：批量提交不等于默认并发执行。实际并发由 `llmWikiConfig.ingestConcurrency` 控制，默认是 1。

### 16.4 模型编译器

```text
apps/api/src/modules/llmWiki/services/llm-wiki-compiler.service.ts
```

这个文件是真正的 “Source Integration Compiler”。它负责估算、构造 prompt、调用模型、解析模型 JSON、归一化 candidate，并做本地结构 gate。

主线方法：

- `estimateCompilePlan(...)`
  - 计算 source hash。
  - 判断是否需要 digest。
  - 构造 `affectedPageCandidates`。
  - 估算 input/output tokens 和 cost。
  - 生成 compile `hash`。
  - 超过 `maxDigestSourceChars` 时 blocked。

- `sectionSource(...)`
  - 当前只生成一个 full-source section：`s0001`。
  - 这是兼容 source map，不是旧的多 section 编译计划。

- `compileSource(...)`
  - 重新生成 plan。
  - 超长但未 blocked 的 source 先 `callDigest(...)`。
  - 再 `callIntegrationPatch(...)` 生成 Wiki patch。
  - `normalizeCandidatePages(...)` 归一化页面、路径、标题、tags、sourceIds。
  - `normalizeClaims(...)` 只保留 `{path,text,sourceId}` 轻量 claim。
  - `validateCandidate(...)` 做本地结构 gate。
  - 返回 `LlmWikiCompileCandidate`。

模型调用集中在：

```text
callDigest(...)
callIntegrationPatch(...)
```

prompt 集中在：

```text
digestInstructions()
integrationPatchInstructions()
```

当前关键约束在 `integrationPatchInstructions()`：

- 页面必须是可读 Markdown 知识单元。
- 不允许 fact dump、chunk dump、evidence dump。
- 不输出 `citations`、`evidence`、`quote`、`sourceSpan`。
- summary 固定落到 `summaries/{sourceId}.md`。
- 默认不超过 `compilePlan.maxAffectedPages`。

本地 gate 主要看：

- 页面数量是否超过 `maxAffectedPages`。
- path 是否合法。
- path 与 type 是否匹配。
- body 是否有一级标题。
- 是否包含 `delete` 动作。

怎么执行：

```text
compileSource(...)
  -> estimateCompilePlan(...)
  -> source 太长则 callDigest(...)
  -> callIntegrationPatch(...)
  -> parseJsonObject(...)
  -> normalizeCandidatePages(...)
  -> normalizeClaims(...)
  -> validateCandidate(...)
  -> return candidate
```

如果你要调编译质量，优先看这几个地方：

- `integrationPatchInstructions()`：决定模型应该怎么写 Wiki 页面。
- `INTEGRATION_PATCH_RESPONSE_FORMAT`：决定模型 JSON 输出结构。
- `candidateAffectedPages(...)`：决定 estimate hash 里预期影响哪些页面。
- `normalizeCandidatePages(...)`：决定模型输出页面如何被本地修正。
- `validateCandidate(...)`：决定哪些问题会阻断发布。

当前版本刻意不让模型输出精确证据坐标，原因是这类坐标稳定性差。现在只要求模型产出可读 Wiki 页面和可选 key claims。

### 16.5 持久化与发布

```text
apps/api/src/modules/llmWiki/services/llm-wiki-store.service.ts
```

这个文件是文件系统数据库。source、meta、wiki 页面、candidate、page claims、publish receipt、job report、stale marker 都由它读写。

source 写入：

- `createSource(...)`
  - 校验文件名、扩展、大小、二进制内容和空内容。
  - 写入 `sources/<sourceId>/source.md|txt`。
  - 写入 `sources/<sourceId>/meta.json`。
  - 初始状态是 `raw_uploaded`。

编译状态：

- `prepareIngest(...)` -> `compile_planned`
- `markIngestFailed(...)` -> `failed`
- `resetIngestToUploaded(...)` -> 停止编译后恢复到可回退状态
- `markStaleIngestingFailed(...)` -> 服务重启后把遗留 running job 收尾为 failed

candidate：

- `saveCompileCandidate(...)`
  - 写入 `meta/compile-candidates/<candidateId>.json`。

- `readCompileCandidate(...)`
  - 读取并 sanitize candidate。

- `listCompileCandidates(...)`
  - 给管理端展示历史 candidate。

发布：

- `publishCandidate(candidateId)`
  - 只允许 `candidate_ready` 发布。
  - 有 `blocked_publish` issue 时拒绝发布。
  - 遍历 candidate pages。
  - `writePageFromBody(...)` 写正式 Wiki Markdown + frontmatter。
  - `savePageClaims(...)` 写轻量 page claims。
  - `updateContribution(...)` 写 page contribution。
  - `resolveStaleMarkersForPages(...)` 解除相关 stale marker。
  - 写 `meta/publish-receipts/<receiptId>.json`。
  - candidate 状态改为 `published`。
  - source 状态改为 `published`，记录 `touched_pages`、`latest_candidate_id`、`latest_compile_hash`。
  - `rebuildIndex()` 重建 `index.md`。

发布执行链：

```text
store.publishCandidate(candidateId)
  -> readCompileCandidate(candidateId)
  -> 检查 candidate_ready 和 blocked_publish
  -> 遍历 candidate.pages
  -> writePageFromBody(...)
  -> savePageClaims(...)
  -> updateContribution(...)
  -> 写 publish receipt
  -> saveCompileCandidate(status=published)
  -> updateSource(status=published)
  -> rebuildIndex()
```

你看这个文件时，重点看“结果最终写到哪里”：

```text
sources/<sourceId>/meta.json
sources/<sourceId>/source.md|txt
wiki/**/*.md
meta/source-maps/<sourceId>.json
meta/page-claims/*.json
meta/page-contributions/*.json
meta/compile-candidates/<candidateId>.json
meta/publish-receipts/<receiptId>.json
ingest-jobs/<jobId>/report.json
```

这里也能看出一个重要事实：发布不是调用模型后的临时内存状态，而是把 candidate 正式写成 Markdown Wiki 页面。

### 16.6 类型、配置和边界文件

```text
apps/api/src/modules/llmWiki/contracts/llm-wiki.types.ts
```

这个文件定义后端内部主要数据结构。读主链路时优先看 compile candidate 相关类型，不要被旧 fact/fusion 类型带偏。

优先看这些类型：

- `LlmWikiSourceStatus`
- `LlmWikiSourceMeta`
- `LlmWikiCompilePlan`
- `LlmWikiCompileCandidate`
- `LlmWikiCompileCandidatePage`
- `LlmWikiClaim`
- `LlmWikiPublishReceipt`
- `LlmWikiIngestJobReport`
- `LlmWikiPublishGateIssue`

文件里仍保留 `LlmWikiFact*`、`LlmWikiCompileResult`、`LlmWikiFusionResult` 等旧链路类型。看当前主链路时先不要从这些类型进入。

几个类型之间的关系：

```text
LlmWikiSourceMeta
  记录 source 当前状态和 latest candidate/hash

LlmWikiCompilePlan
  记录本次编译估算、hash、预算和 blocked 原因

LlmWikiCompileCandidate
  记录模型生成的候选 pages/claims/issues/modelUsage

LlmWikiPublishReceipt
  记录 candidate 发布后实际写入了哪些页面和成本账本

LlmWikiIngestJobReport
  记录执行过程，供前端轮询展示 stage/events/error
```

```text
apps/api/src/modules/llmWiki/llm-wiki.config.ts
```

这个文件是当前编译行为的运行时开关，尤其影响成本、并发和编译边界。

关键配置：

- `root`：默认数据根 `<dataRoot>/llm-wiki/default`。
- `ingestConcurrency`：默认 1。
- `compilerVersion`：`source-integration-v1`。
- `promptVersion`：`integration-patch-v1`。
- `maxCompileSourceChars`：普通 source 编译上限。
- `maxDigestSourceChars`：digest 允许的最大 source 长度。
- `maxAffectedPages`：默认 6。
- `defaultMaxModelCalls`：默认 1。
- `digestMaxModelCalls`：默认 2。

这些配置会进入 plan 或执行路径。特别是 `compilerVersion`、`promptVersion`、`maxAffectedPages`、`defaultMaxModelCalls` 会影响 compile hash 或模型调用边界。

```text
apps/api/src/modules/llmWiki/llm-wiki.module.ts
```

看模块边界：

- controller 暴露 manage/retrieval 两套 API。
- provider 注册 store、compiler、ingest、management、retrieval、search、lint 等 service。
- 只导出 `LlmWikiRetrievalService`，给 Agent 只读使用。

这个模块文件体现了读写边界：

```text
manage controller
  给前端管理页使用，可以上传、编译、删除、lint、publish。

retrieval controller
  给 Agent 和只读页面使用，只能 manifest/search/page/source。

exports: [LlmWikiRetrievalService]
  其他模块默认只能拿只读能力，不能绕过管理入口直接编译。
```

### 16.7 编译后的只读消费

```text
apps/api/src/modules/llmWiki/controllers/llm-wiki-retrieval.controller.ts
apps/api/src/modules/llmWiki/services/llm-wiki-retrieval.service.ts
apps/api/src/modules/llmWiki/services/llm-wiki-search.service.ts
```

看点：

- retrieval API 只读，不触发编译。
- `getManifest()` 读取 sources、pages、pageClaims、facts 计数和 `index.md`。
- `search(...)` 走 `LlmWikiSearchService`。
- `readPage(...)` 返回 page 和 links。
- `readSource(...)` 按 sourceId 回读 raw source。
- search 主要索引已发布页面正文、标题、tags、path；旧 fact/page claims 只是附加检索文本。

Agent 链路应从 retrieval 进入，不应该依赖 management/store/compiler。

怎么执行：

```text
Agent 或前端读 Wiki
  -> GET /api/llm-wiki/retrieval/manifest
  -> GET /api/llm-wiki/retrieval/search?q=...
  -> GET /api/llm-wiki/retrieval/page?path=...
  -> 必要时 GET /api/llm-wiki/retrieval/source/:sourceId
```

这里是编译后的消费链路，不是编译链路。它只读已发布页面，最多按 sourceId 回读 raw source，不会创建 candidate，也不会修改 Wiki。

## 17. 当前取舍

保留：

- LLM 编译语义 Wiki。
- 显式成本估算。
- hash 幂等。
- candidate checkpoint。
- 自动发布。
- source/page 贡献关系。
- raw source 回读能力。

移除或降级：

- section 级多次模型抽 fact。
- 每页单独模型 writer。
- citations/evidence/sourceSpan。
- quote 与 sourceSpan 精确匹配。
- claims 作为发布硬门槛。
- source 删除后的全量重编译。
- rebuild 默认跑 LLM。
- orphan_page 作为默认 warning。
- needs_reconcile / weak_evidence 作为当前 open issue。

当前设计目标：

```text
用少量、可预估的模型调用，把 source 编译成可读 Wiki；
用本地结构 gate 防止坏写入；
不让模型承担它不稳定的精确证据坐标任务。
```
