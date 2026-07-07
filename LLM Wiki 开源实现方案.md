# LLM Wiki 开源实现方案

本文只记录 KnowLLM 当前 llmWiki 的核心原理和实现方案。

## 1. 核心原理

llmWiki 是一个编译型语义 Wiki 系统。

它的目标不是在查询时从碎片里临时拼答案，而是在 source 进入系统时就让模型完成阅读、抽取、组织、写作、校验和发布，把理解后的知识沉淀成稳定的 Markdown Wiki。

核心分工：

```text
source
  原始事实来源，只保存原文和证据。

facts
  内部事实账本，用于覆盖率、追踪、评测和发布门禁。

page-claims
  页面与 facts 的映射账本，用于判断页面到底覆盖了哪些事实。

wiki pages
  正式知识层，必须是可阅读的长语义 Markdown 页面。

publish gate
  发布前硬门禁，负责拦截结构性问题和事实覆盖问题。

Agent
  默认读取 Wiki 页面，必要时回读 raw source，不直接把 facts 当主知识入口。
```

一句话原则：

```text
facts 负责正确性，claims 负责追踪，gate 负责拦截，pages 负责语义，Agent 读 pages。
```

## 2. 编译链路

当前编译链路固定为：

```text
source
  -> sectioner
  -> fact extractor
  -> semantic page planner
  -> semantic page writer
  -> claims verifier
  -> publish gate
  -> publish
```

### sectioner

sectioner 只负责把 source 切成可处理的结构段，不做语义改写。

切分依据：

- Markdown 标题。
- 表格。
- 代码块。
- 列表。
- 配置段。
- 普通段落。

输出 source map：

```text
meta/source-maps/<sourceId>.json
```

source map 记录 sourceId、filename、sha256、title、sections，以及每个 section 的 headingPath、startOffset、endOffset、content。

### fact extractor

fact extractor 只负责从 section 中抽取可追踪事实，不决定最终页面形态。

每个 fact 必须包含：

```ts
{
  factId: string;
  sourceId: string;
  sectionId: string;
  type: LlmWikiFactType;
  importance: LlmWikiFactImportance;
  fact: string;
  evidence: string;
  sourceSpan: { start: number; end: number };
  entities: string[];
  retention: LlmWikiFactRetention;
}
```

fact 类型：

```text
definition | command | config | parameter | default | procedure_step
warning | constraint | exception | version_change
api_request | api_response | error_case | relationship
```

importance：

```text
must | should | nice
```

retention：

```text
exact | semantic | background
```

默认规则：

- `command`、`config`、`warning`、`default`、`version_change` 默认是 `must`。
- 命令、配置、参数、默认值、API 请求/响应、版本号、错误码优先使用 `exact`。
- `must` fact 必须进入至少一个正式 Wiki 页面。

facts 持久化到：

```text
meta/facts/<sourceId>.json
```

### semantic page planner

semantic page planner 负责规划正式 Wiki 页面。

输入：

- source map。
- fact ledger。
- schema。
- 已有页面列表。

输出：

```ts
{
  path: string;
  title: string;
  type: LlmWikiPageType;
  tags: string[];
  semanticGoal: string;
  factIds: string[];
  linkTargets: string[];
}
```

含义：

- `semanticGoal` 表示这个页面要让 Agent 读懂什么。
- `factIds` 表示该页面必须承载哪些 facts。
- `linkTargets` 表示该页面应链接哪些 Wiki 页面。

规划约束：

- 必须生成 `summary` 页面。
- 所有 `must` fact 必须被至少一个页面计划覆盖。
- 不允许把每个 fact 拆成一个短页面。
- 不允许为了检索粒度牺牲页面语义完整性。
- linkTargets 只能指向本次计划页面或已有页面。

### semantic page writer

semantic page writer 基于 page plan 和 facts 写正式 Markdown 页面。

输出：

```ts
{
  path: string;
  title: string;
  type: LlmWikiPageType;
  tags: string[];
  body: string;
  claimedFactIds: string[];
}
```

正文要求：

- 必须是完整 Markdown。
- 必须以一级标题开始。
- 必须像专业手册或知识库页面。
- 允许较长，目标是 Agent 单页读懂一个主题。
- 不能写成 fact 清单、审计日志、Evidence 列表或 Trace 日志。
- 不应批量出现 `Evidence:`、`Trace:`、`factId`、`sourceSpan`。
- `claimedFactIds` 只能声明正文实际承载的 facts。
- `retention=exact` 的关键字面值必须保留在正文中。

## 3. 页面模型

页面类型固定为：

```text
index
summary
concept
entity
reference
procedure
changelog
troubleshooting
```

页面用途：

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

页面路径：

```text
wiki/index.md
wiki/summaries/<sourceId>.md
wiki/concepts/<slug>.md
wiki/entities/<slug>.md
wiki/references/<slug>.md
wiki/procedures/<slug>.md
wiki/changelogs/<slug>.md
wiki/troubleshooting/<slug>.md
```

页面使用 Markdown + YAML frontmatter：

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

正文是正式知识内容。事实追踪以 page-claims 为准，不靠正文里的 source 字符串判断。

## 4. page-claims

每个发布页面都会写入：

```text
meta/page-claims/<pagePathHash>.json
```

结构：

```ts
{
  path: string;
  factIds: string[];
  sourceIds: string[];
  updatedAt: string;
}
```

作用：

- 记录页面覆盖了哪些 facts。
- 支持 must fact 覆盖率计算。
- 支持 compile evaluation。
- 支持 source 删除和重编译。
- 支持 publish gate 校验页面正文与 claims 是否一致。

page-claims 是内部账本，不是正式阅读层。

## 5. publish gate

publish gate 是正式发布前的硬门禁。

输入：

- 待发布页面。
- page-claims。
- fact ledger。

发布条件：

- `must` fact 覆盖率达到发布线。
- 每个 claimed fact 必须能在页面正文中找到语义或字面支撑。
- `retention=exact` 的命令、配置键、默认值、API 路径、版本号、错误码必须保留关键字面值。
- 正式页面不能是 fact dump。
- 模型失败、JSON 无效、页面计划无效、正文与 claims 不一致，均禁止发布。

自动处理：

- 死链：能匹配 path/title 就修正，不能匹配就去掉 wiki link 保留文本。
- 重复标题：同类型同标题页面发布前合并。
- 不可达页面：普通页面不可达则不发布。

issue 类型：

```text
auto_fixed
blocked_publish
human_review
```

前端只展示 `human_review`。结构性问题必须由编译器和 gate 处理，不能转成用户手工任务。

## 6. Ingest 与发布

入口：

```text
POST /api/llm-wiki/manage/sources/:sourceId/ingest
```

返回：

```ts
{
  jobId: string;
  sourceId: string;
  status: "running";
}
```

流程：

```text
校验 source
  -> 校验解析模型
  -> 创建 ingest job
  -> source 标记 ingesting
  -> 编译到 staging
  -> publish gate
  -> gate 通过后发布正式产物
  -> gate 不通过只写 job report，source 标记 failed
```

正式发布写入：

```text
wiki/
meta/source-maps/
meta/facts/
meta/page-claims/
meta/page-contributions/
ingest-jobs/<jobId>/report.json
```

job report 记录 jobId、sourceId、model、status、stage、pages、factCount、coverage、issues、error、startedAt、endedAt。

## 7. 融合、删除与重建

旧 fallback merge 已删除。

融合规则：

- 新编译内容必须通过 publish gate 才能发布。
- 新 `must` fact 不允许静默丢弃。
- 仍有 source 支撑的 fact 保留。
- 无 source 支撑的 fact 移除。
- 同主题多 source 合并后仍写语义 Wiki 页面，不写 facts 列表。
- 冲突 facts 写入页面的“冲突/未确认”语义段，并生成 `human_review`。

删除 source：

```text
删除 source
  -> 移除该 source 的 facts / source-map / page-claims / contribution
  -> 删除受影响页面
  -> 剩余 ready source 重新进入 semantic ingest
```

全量重建：

```text
POST /api/llm-wiki/manage/rebuild
```

行为：

```text
清空已编译 Wiki 产物
  -> 保留 sources
  -> 所有 source 重新进入 ingest job
  -> 重新生成 semantic wiki
```

## 8. 检索与 Agent

Agent 不以 facts 为主检索入口。

默认路径：

```text
manifest
  -> searchWiki
  -> readWikiPage
  -> follow links
  -> optional readRawSource
```

manifest 提供页面路径、标题、页面类型、tags、source 状态、facts/page-claims 摘要。

search 索引可以包含 fact text、fact entities、fact type、source filename、section heading path，用于帮助命中页面；但返回对象仍然是 Wiki 页面。

Agent 使用页面类型：

- 命令、配置、参数、默认值：读 `reference`。
- 安装、校准、操作：读 `procedure`。
- 版本和行为变化：读 `changelog`。
- 错误、异常、排障：读 `troubleshooting`。
- 概念和对象关系：读 `concept` / `entity`。
- source 全貌：读 `summary`。

## 9. Evaluation

compile evaluation 优先读取 page-claims。

判断规则：

- expected fact 是否进入 page-claims。
- Judge 仍用于语义判断。
- Judge 给出的 `wikiEvidence` 必须能在最终页面正文中命中。
- evidence 命不中页面正文的 correct 标为 `needs_review`。
- unsupported correct 不计入可靠 correct。

核心指标：

```text
coveredByClaims
judgeNeedsReview
unsupportedCorrect
mustAccuracy
weightedScore
```

验收线：

```text
incorrect = 0
sourceMissingCases = 0
failedCases = 0
mustAccuracy >= 0.95
weightedScore >= 90
open structural issues = 0
```

允许存在 `human_review`，但只能来自真实语义冲突或 source 证据歧义。

## 10. 模块边界

核心模块：

```text
llm-wiki-compiler.service.ts
  sectioner / fact extractor / semantic planner / semantic writer / claims / gate

llm-wiki-publish-gate.ts
  发布前自动修复和硬拦截

llm-wiki-fact.utils.ts
  fact normalize / fact id / 默认 importance / page claims 映射

llm-wiki-store.service.ts
  source / wiki / facts / source-map / page-claims / job report 持久化

llm-wiki-ingest.service.ts
  ingest job 生命周期、模型校验、正式发布、重建

llm-wiki-retrieval.service.ts
  Agent 只读访问

llm-wiki-search.service.ts
  页面搜索索引

llm-wiki-lint.service.ts
  health report，不制造结构性人工 warning

compile-evaluation.service.ts
  基于 page-claims 和页面正文评估编译结果
```

API 边界：

- `manage` 接口负责写入、编译、重建和人工管理。
- `retrieval` 接口只读。
- Agent 只能通过 retrieval 访问 llmWiki。
- evaluation 只评估已发布结果，不参与发布。
