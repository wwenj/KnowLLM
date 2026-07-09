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

## 16. 当前取舍

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
