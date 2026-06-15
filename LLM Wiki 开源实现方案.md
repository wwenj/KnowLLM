<p align="center">
  <img src="assets/logo.png" alt="KnowLLM logo" width="180" />
</p>

# LLM Wiki 开源实现方案

本文是 KnowLLM 当前唯一的技术实现说明，内容以仓库现有代码为准。

KnowLLM 当前聚焦两条主链路：

1. 将 Markdown/TXT 原始资料持续编译、融合为可维护的 Markdown Wiki。
2. 让独立 llmWiki Agent 基于 Wiki 进行多轮检索、证据筛选、raw source 核验和最终答案生成。

核心判断是：

```text
source 是事实源
Wiki 是长期知识层
llmWiki Agent 是证据使用层
```

## 1. 当前实现边界

当前已经实现：

- 上传和管理 `.md`、`.txt` source。
- 使用 Schema 约束 Wiki 编译和查询。
- 将 source 编译为 summary、concept、entity 页面。
- 将新 draft 与已有 Wiki 页面进行融合。
- 保存页面来源、schema hash、source contribution 和运行日志。
- Wiki 页面浏览、编辑、全文搜索、lint 和 issue 管理。
- 独立 llmWiki Agent 多轮检索、页面审查、raw source 核验和答案合成。
- Agent 运行记录、事件记录、历史查询和取消。
- 本地文件系统持久化。

当前没有实现：

- PDF、DOCX、HTML 等文件解析。
- 向量检索、Embedding 或 GraphRAG。
- 多租户、权限和审计系统。
- ingest 事务、跨进程锁和任务队列。
- Agent 统一超时与并发限制。
- source 内容分块编译。超过限制时只编译前半部分。

## 2. 代码结构

```text
apps/api/src/modules/llmWiki/
  controllers/
    llm-wiki-management.controller.ts
    llm-wiki-retrieval.controller.ts
  contracts/
  services/
    llm-wiki-management.service.ts
    llm-wiki-ingest.service.ts
    llm-wiki-compiler.service.ts
    llm-wiki-fusion.service.ts
    llm-wiki-store.service.ts
    llm-wiki-search.service.ts
    llm-wiki-retrieval.service.ts
    llm-wiki-schema.service.ts
    llm-wiki-lint.service.ts
    llm-wiki-issue.service.ts

apps/api/src/modules/agent/
  runners/llm-wiki/
    llm-wiki-agent.runner.ts
    llm-wiki-agent.workflow.ts
    llm-wiki-agent.tools.ts
    llm-wiki-agent-result.ts
    llm-wiki-agent.types.ts
  services/
    agent-run-execution.service.ts
    agent-run-store.service.ts
    agent-registry.service.ts
    agent-result-renderer.service.ts
```

模块边界：

- `LlmWikiModule` 负责知识编译、维护和只读检索契约。
- `AgentModule` 只通过 `LlmWikiRetrievalService` 使用 llmWiki，不直接操作 Wiki 文件。
- `ModelService.chat()` 负责调用 OpenAI-compatible `/chat/completions`。
- Web 只调用 REST API，不参与编译和 Agent 执行决策。

## 3. 数据目录

默认数据根目录是仓库根目录 `.knowllm/`，可通过 `KNOWLLM_DATA_ROOT` 覆盖。

```text
.knowllm/
  llm-wiki/default/
    schema/
      AGENTS.md
    sources/
      <sourceId>/
        source.md | source.txt
        meta.json
    wiki/
      index.md
      summaries/<sourceId>.md
      concepts/<slug>.md
      entities/<slug>.md
    meta/
      page-contributions/<pagePathHash>.json
    issues/
      open/*.json
      resolved/*.json
    log/
      YYYY-MM-DD.md

  agents/runs/
    llmWiki/<runId>/
      meta.json
      events.jsonl
      result.md
      result.json
```

source id、run id 和 issue id 均使用 32 位十六进制字符串。

Wiki 页面只能位于以下路径：

```text
index.md
summaries/<sourceId>.md
concepts/<safe-slug>.md
entities/<safe-slug>.md
```

页面使用 YAML frontmatter 保存基础元数据：

```yaml
---
title: "页面标题"
type: concept
tags:
  - agent
sources:
  - <sourceId>
schema_hash: "<sha256>"
updated_at: "<ISO time>"
---
```

## 4. llmWiki 编译流程

完整编译链路：

```text
上传 source
  -> 校验并持久化原文
  -> source 标记 ingesting
  -> 读取 source、Schema 和已有页面
  -> Compiler 生成结构化 draft
  -> 系统规范化 draft
  -> 移除该 source 上一次 ingest 的影响
  -> Fusion 逐页创建、更新、跳过或标记冲突
  -> 保存 Wiki 页面和 contribution
  -> 重建 index.md
  -> 失效搜索索引
  -> source 标记 ready
```

### 4.1 Source 上传与状态

上传入口：

```text
POST /api/llm-wiki/manage/sources/upload
```

`LlmWikiStoreService.createSource()` 负责：

1. 清理文件名，只保留 basename。
2. 只允许 `.md` 和 `.txt`。
3. 拒绝空文件、纯空白文件和包含 NUL 字节的二进制文件。
4. 限制最大上传大小为 10 MB。
5. 生成 source id 和 SHA-256。
6. 使用临时文件加 rename 的方式原子写入 source 和 `meta.json`。
7. 将 source 状态保存为 `uploaded`。

source 状态：

```text
uploaded -> ingesting -> ready
                      -> failed
```

服务启动时，遗留的 `ingesting` 状态会被标记为 `failed`，错误信息为“服务重启，解析任务已中断”。当前不会自动恢复未完成的 ingest。

### 4.2 Schema

Schema 文件固定为：

```text
.knowllm/llm-wiki/default/schema/AGENTS.md
```

Schema 用来约束：

- source 是唯一事实源。
- 页面类型和页面粒度。
- 来源标注规则。
- 新知识与旧知识的合并规则。
- 冲突和未确认项的处理规则。
- Agent 查询时优先读取 Wiki、必要时回读 source。

系统读取 Schema 内容并计算 SHA-256。完成 ingest 后，当前 schema hash 会写入 source meta、Wiki 页面和 contribution 记录。

### 4.3 Ingest 任务编排

入口：

```text
POST /api/llm-wiki/manage/sources/:sourceId/ingest
```

`LlmWikiIngestService` 使用进程内 `Map<sourceId, Promise>` 防止同一个 source 在当前进程重复 ingest。

启动时：

1. 校验 source 存在。
2. 拒绝已在 jobs Map 中或状态为 `ingesting` 的 source。
3. 将状态改为 `ingesting` 并清空旧错误。
4. 后台执行 `runIngest()`，接口立即返回更新后的 source meta。

当前 jobs Map 只在单进程内有效，不是分布式锁。

### 4.4 Compiler 输入

`LlmWikiCompilerService.compileSource()` 接收：

```text
sourceId
filename
source 原文
existingPages 当前页面引用列表
schema 当前 Schema
```

原文最大编译字符数为 `120000`。超过限制时，仅把前 `120000` 字符传给模型，并显式告诉模型内容已截断。

为了控制 prompt，当前已有 Wiki 页面最多传入 80 个，只包含 path 和 title。

Compiler 调用模型时要求：

- 只基于输入 source，不引入外部知识。
- 只输出 JSON。
- 必须生成一个 summary。
- concept 最多 8 个。
- entity 最多 8 个。
- content 必须是完整 Markdown，并以一级标题开始。
- 关键结论必须标注 source id。
- 信息不足时写未确认项。

模型输出契约：

```json
{
  "summary": {
    "title": "string",
    "content": "string",
    "tags": ["string"]
  },
  "concepts": [
    {
      "path": "concepts/<slug>.md",
      "title": "string",
      "content": "string",
      "tags": ["string"]
    }
  ],
  "entities": [
    {
      "path": "entities/<slug>.md",
      "title": "string",
      "content": "string",
      "tags": ["string"]
    }
  ]
}
```

### 4.5 Compiler 输出规范化

模型输出不能直接写盘。系统会执行以下规范化：

1. 从普通 JSON、JSON Markdown code fence 或首尾 JSON 对象中尝试解析。
2. 解析失败则本次 ingest 失败。
3. 强制生成 `summaries/<sourceId>.md`。
4. concept/entity 各截断到最多 8 个。
5. 路径强制收敛到 `concepts/` 或 `entities/`。
6. slug 只允许英文字母、数字、点、下划线和中划线。
7. 对同批次重复 path 自动追加序号。
8. title 最长 160 字符，tags 最多 20 个。
9. content 缺少一级标题时自动补齐。
10. content 缺少 source id 标注时自动追加来源。

规范化后的页面仍然只是 draft，不会直接覆盖已有 Wiki。

### 4.6 重编译前清理旧贡献

每次重新 ingest 一个 source 前，系统先执行 `detachSourceFromWiki(sourceId)`，移除该 source 上一次编译留下的影响：

- 删除该 source 的 summary 页面。
- 页面仅由该 source 支撑时，删除页面和 contribution。
- 页面仍有其他 source 支撑时，移除该 source 引用并保留页面。
- 多 source 页面移除来源后会进入需要重新核对的状态。
- 清空 source 原有 `touched_pages`。
- 重建 Wiki index。

这一步保证同一个 source 重新编译时不会简单叠加旧结果，但当前不是事务操作。后续步骤失败时，旧贡献不会自动恢复。

### 4.7 Fusion 候选页选择

summary 不参与融合，固定创建或覆盖自己的 `summaries/<sourceId>.md`。

concept/entity draft 会先寻找最多 3 个同类型候选页面，候选优先级为：

1. 与 draft path 完全相同的页面。
2. 与 draft title 规范化后相同的页面。
3. 使用 Wiki 全文搜索命中的页面。

如果没有候选页，直接创建新页面。

### 4.8 Fusion 模型决策

存在候选页时，`LlmWikiFusionService` 将以下内容交给模型：

- 当前 Schema。
- 新 source 的 meta 和截断后的原文。
- 新 draft。
- 最多 3 个已有候选页面。

Fusion 模型只能返回：

```text
create
update
skip
conflict
```

主要规则：

- 新旧信息互补时更新已有页面。
- 保留仍有 source 支撑的旧内容。
- 新旧结论冲突时必须保留冲突或未确认项，并生成 conflict issue。
- `targetPath` 只能是 draft path 或候选页 path。
- 关键结论必须标注 source id。

系统会再次规范化 action、targetPath、title、type、tags、sources 和 issues。非法 targetPath 会回退到第一候选页或 draft path。

### 4.9 Fusion 失败降级

Fusion 模型调用、JSON 解析或结构处理失败时，不会直接中止整个 ingest，而是执行 fallback merge：

1. 优先选择第一候选页。
2. 保留候选页原正文。
3. 在“新增来源待复核”章节追加新 draft。
4. 合并 tags 和 source 引用。
5. 生成 `weak_evidence` issue，记录失败原因。

该降级保证新内容不会完全丢失，但结果必须人工复核。

### 4.10 页面写入与贡献记录

Fusion 结果不为 `skip` 时，系统写入：

- Wiki Markdown 页面。
- 页面 frontmatter。
- `meta/page-contributions/<pagePathHash>.json`。

contribution 按 source 记录：

```json
{
  "path": "concepts/example.md",
  "sources": {
    "<sourceId>": {
      "source_sha256": "<sha256>",
      "schema_hash": "<sha256>",
      "contributed_at": "<ISO time>",
      "summary": "本次融合变更摘要"
    }
  }
}
```

页面写入同样使用临时文件加 rename。它可以避免单个文件出现半写入，但不能保证整次 ingest 的所有页面原子提交。

### 4.11 编译完成

全部 draft 处理完成后：

1. 如果没有生成 concept，创建 `no_concept_generated` warning。
2. 根据所有页面重建 `wiki/index.md`。
3. 更新 source：
   - `status = ready`
   - 保存 schema hash
   - 保存 ingest 时间
   - 清空错误
   - 保存去重后的 `touched_pages`
4. 将内存搜索索引标记为失效。
5. 写入当天 Markdown 日志。

任意未被 Fusion 降级吸收的错误都会令 source 标记为 `failed`，并保存错误摘要。

### 4.12 搜索、Lint 与 Issue

Wiki 搜索使用 FlexSearch 内存索引，同时补充大小写不敏感的全文 includes 匹配。

索引字段：

```text
title + path + type + tags + Markdown body
```

排序是手写权重：

- title 命中：100
- tag 命中：60
- path 命中：30
- body 命中：20

搜索不是向量检索，复杂问题主要依赖 Agent planner 拆分查询词和多轮检索。

Lint 分为：

- 结构检查：死链、孤立页、缺少 frontmatter、重复标题、未进入 index、页面过大。
- 证据检查：缺少 source、引用已删除 source、schema drift、正文缺少 source id、source digest 变化、缺少 contribution。

Issue 使用稳定指纹去重，保存在 `issues/open` 和 `issues/resolved`。

## 5. llmWiki Agent 检索流程

llmWiki Agent 是独立运行的研究型查询 Agent。它不会修改 Wiki，只能通过只读检索契约读取 manifest、搜索 Wiki、读取页面和读取 raw source。

完整流程：

```text
提交 query
  -> 校验输入和模型
  -> 创建 run 与 AbortController
  -> 加载 manifest
  -> Planner 生成查询计划
  -> 收集第一轮候选页面
  -> 批量读取页面
  -> Reviewer 判断 keep/drop、缺口和下一步动作
  -> 多轮搜索、读页、追链接
  -> 选择并读取 raw source
  -> Reviewer 核验 source 支持
  -> 构建 knowledgeSnippets
  -> Synthesizer 生成最终答案
  -> 保存事件、Markdown 结果和 JSON 结果
```

### 5.1 Agent 输入

提交入口：

```text
POST /api/agents/llmWiki/runs
```

输入结构：

```json
{
  "query": "需要研究的问题",
  "sourcePolicy": "auto",
  "budget": {
    "maxRounds": 4,
    "maxEvidencePages": 48,
    "maxRawSources": 12,
    "tokenLimit": null
  },
  "models": {
    "plannerModel": "model-name",
    "reviewerModel": "model-name",
    "synthesizerModel": "model-name"
  }
}
```

约束：

- `query` 必填。
- `sourcePolicy` 支持 `auto`、`wiki-only`、`key-sources`、`exhaustive`。
- `maxRounds` 范围为 1 到 8。
- `maxEvidencePages` 范围为 8 到 96。
- `maxRawSources` 范围为 0 到 24。
- `tokenLimit` 为空或正整数。
- planner、reviewer、synthesizer 模型必须存在于当前模型列表。

兼容字段：

- `limit` 会映射到 `budget.maxEvidencePages`。
- 单个 `model` 会映射到三个模型角色。
- 未知字段会被忽略，不会改变执行链。

### 5.2 Run 创建、持久化与取消

`AgentRunExecutionService` 为每次运行：

1. 校验并规范化输入。
2. 生成 run id。
3. 创建 `meta.json`、空 `result.md` 和 `result.json`。
4. 创建独立 `AbortController`。
5. 将每个 workflow 事件追加到 `events.jsonl`。
6. 完成后写入最终结果、状态、tokens 和统计。

取消入口：

```text
POST /api/agents/llmWiki/runs/:runId/cancel
```

运行中的任务通过自身 AbortController 取消。服务启动时，历史上仍标记为 `running` 的任务会被改为 `cancelled`。

### 5.3 只读检索工具

`LlmWikiAgentTools` 只暴露四个工具：

```text
getManifest()
searchWiki(query, limit)
readWikiPage(path)
readRawSource(sourceId)
```

Agent 不直接依赖 store、文件路径或管理接口。这样可以保证查询流程不会绕过路径校验，也不会修改知识库。

### 5.4 加载 Manifest

Manifest 包含：

- source、ready source 和页面数量。
- 当前 Schema 内容和 hash。
- `index.md` 内容。
- 所有页面的 path、title、type、tags、sources。
- 所有 source 的 id、文件名、状态和 touched pages。

进入模型 prompt 前：

- index 最大截断到 7000 字符。
- Schema 最大截断到 4000 字符。
- 页面最多传入 260 个。
- source 最多传入 120 个。

模型只能规划 manifest 中真实存在的页面和 source。

### 5.5 Planner 查询规划

Planner 根据 query、sourcePolicy、budget 和 manifest 生成：

```text
queryIntent
keywords
entities
tasks[]
coverage
candidatePaths
searchQueries
reason
```

每个 task 包含：

```text
goal
requiredPaths
optionalPaths
searchQueries
expectedContribution
```

Planner 只负责初始任务拆分和第一批候选召回，不决定最终证据。即使 Planner 把某页面放入 requiredPaths，Reviewer 后续仍可丢弃。

模型输出会被规范化：

- 最多 8 个 task。
- 每个 task 最多 16 个 required path、16 个 optional path、8 个搜索词。
- 总候选 path 最多 64 个。
- 总搜索词最多 16 个。
- 非法 intent 回退为 `overview`。
- 模型没有产生有效 task 时，回退为以用户 query 搜索的单任务计划。

### 5.6 第一轮候选召回

候选来源：

1. Planner 的 requiredPaths。
2. 每个 task 的搜索结果。
3. Planner 的 optionalPaths。
4. Planner 的 candidatePaths。

所有 path 都必须存在于 manifest，否则跳过并记录事件。

候选按 path 去重，并使用确定性分数排序：

```text
required_path: 320
linked_page: 240
search_hit: 190
optional_path: 120

summary 页面额外 +35
concept 页面额外 +25
entity 页面额外 +15
搜索基础分最多加入 140
较后 task 每级 -8
```

排序后的候选截断到 `maxEvidencePages`，再转换为首轮 `read_page` 动作。

### 5.7 页面读取

读取节点只处理：

```text
read_page
follow_link
```

执行规则：

- 跳过已读取页面。
- 跳过 manifest 中不存在的 path。
- 不超过 `maxEvidencePages`。
- 读取页面时同步提取合法 `[[wiki/path.md]]` 链接。
- 保存页面来源、任务目标、召回原因、分数和读取轮次。
- 每次成功或失败都写入 run event。

### 5.8 Evidence Reviewer 多轮决策

Reviewer 每轮接收：

- 用户 query。
- 当前轮次和最大轮次。
- 初始查询计划。
- Schema。
- 所有已读取页面。
- 前一轮保留页面和检索记录。
- 允许执行的动作类型。

Reviewer 输出：

```text
keepPages
dropPages
coverage
gaps
nextActions
stop
stopReason
```

每个保留页面包含：

```text
path
taskGoals
relevanceScore
evidenceScore
whyKept
selectedInRound
```

Reviewer 只能保留或丢弃已经读取的页面，也只能返回以下动作：

```text
read_page
search_wiki
follow_link
read_source
stop
```

非法 path、source id 和动作会被系统过滤。

停止条件：

- Reviewer 明确返回 `complete`。
- Reviewer 判断 `insufficient_evidence`。
- 达到 `maxRounds`。
- 没有新的检索动作。
- Token 预算不足。

### 5.9 下一轮动作执行

`execute_next_actions` 根据 Reviewer 决策继续检索：

- `search_wiki`：执行全文搜索，将新命中转换为读页动作。
- `follow_link`：仅允许跟随已读取页面真实存在的 Wiki 链接。
- `read_page`：读取 manifest 中真实存在且尚未读取的页面。
- `read_source`：记录 Reviewer 明确要求核验的 source id，稍后统一读取。
- `stop`：结束页面检索。

如果没有新的页面动作：

- 已有保留页面时，以 `no_new_actions` 结束。
- 没有保留页面时，以 `insufficient_evidence` 结束。

### 5.10 Raw Source 选择

页面检索结束后，Agent 根据保留页面选择 raw source。

`wiki-only`：

- 完全跳过 raw source。
- 页面支持状态标记为 `wiki-only`。

`exhaustive`：

- 优先 Reviewer 明确请求的 source。
- 再按所有保留页面关联 source 的分数排序读取。

`auto`：

- 如果 Reviewer 明确请求了 source，只读取这些 source。
- 否则退化为关键 source 选择。

`key-sources`：

- 优先 required 页面或分数达到最高页面 75% 的关键页面来源。
- 同时保证至少带入排名第一的 source。

所有策略都受 `maxRawSources` 限制。

source 排名考虑：

- source 被多少保留页面引用。
- 页面是否 required。
- 页面召回分数。
- source 覆盖的任务和页面。

raw source 读取后，每份内容最多保留 10000 字符；进入 source reviewer prompt 时每份最多 5000 字符。

### 5.11 Source Reviewer

Source Reviewer 判断最终保留的 Wiki 页面是否被 raw source 支撑。

每个页面的支持状态只能是：

```text
verified
wiki-only
partial
conflict
unknown
```

输出还包括：

- 每页支持说明。
- 新发现的 gaps。
- 整体 coverage summary。

如果没有保留页面，运行会进入 `insufficient_evidence`。

如果 Token 预算不足，系统会为页面生成默认支持状态，不会虚构 source 核验结果。

### 5.12 Knowledge Snippets

`build_final_snippets` 只从 Reviewer 最终保留的页面生成 `knowledgeSnippets`。

每个 snippet 保存：

```text
path
title
type
tags
sources
去除 frontmatter 的正文
taskGoals
relevanceScore
evidenceScore
selectedInRound
whyKept
sourceSupport
```

`knowledgeSnippets` 是 Agent 结果中的证据集合，会写入 `result.json`。它不是可选输出模式，也不会跳过最终答案合成。

### 5.13 最终答案合成

只要存在 knowledge snippets 且 Token 预算允许，Synthesizer 就会执行最终答案生成。

Synthesizer 输入：

- 用户 query。
- 查询计划。
- 所有检索轮次。
- 最终 knowledge snippets。
- raw source 支持摘要。
- gaps、coverage summary 和 stop reason。

硬性约束：

- 只能使用最终保留片段和 source review。
- 不能使用被丢弃页面。
- 不能使用外部常识补事实。
- 必须输出 citations、gaps 和 coverage summary。
- 最终 Markdown 必须包含“依据”和“未覆盖/不确定点”。

降级情况：

- 没有 snippet：输出证据不足结果。
- Token 预算不足：直接渲染 snippets Markdown，不执行自然语言合成。
- 模型输出缺少必要章节：系统自动补齐依据和不确定点。

### 5.14 模型调用与 Token 预算

Planner、Evidence Reviewer、Source Reviewer 和 Synthesizer 都通过 `callJsonWithRetry()` 调用模型：

- 强制 `response_format = json_object`。
- 每个阶段最多尝试 2 次。
- 记录 `model_start` 和 `model_end` 事件。
- 兼容 OpenAI 的 prompt/completion tokens 和 input/output tokens。
- 累加模型调用数、轮次和总 token。

设置 `tokenLimit` 后，系统会：

1. 在调用前检查剩余预算。
2. 估算 JSON payload token。
3. 优先把页面 content 压缩到 1600 字符。
4. 仍超限时继续压缩到 600 字符。
5. 仍无法满足预算时停止对应阶段并记录 gap。

Token 估算采用 `JSON.stringify(payload).length / 4`，属于近似值。

### 5.15 Agent 最终结果

`result.md` 保存面向人的最终答案。

`result.json` 保存结构化结果：

```text
answerMarkdown
knowledgeSnippets
discardedPages
retrievalRounds
rawSources 支持摘要
citations
gaps
coverageSummary
stopReason
plan
sourcePolicy
pageCount
keptPageCount
sourceCount
```

`events.jsonl` 保存执行轨迹，包括：

- manifest 加载。
- 查询计划。
- 候选召回。
- 页面读取。
- 每轮 evidence review。
- 下一步动作。
- raw source 读取。
- source review。
- snippets 构建。
- 模型调用。
- 最终结果。

## 6. 关键 REST 接口

LLM Wiki 管理：

```text
GET  /api/llm-wiki/manage/overview
GET  /api/llm-wiki/manage/sources
POST /api/llm-wiki/manage/sources/upload
POST /api/llm-wiki/manage/sources/:sourceId/ingest
POST /api/llm-wiki/manage/sources/:sourceId/rename
POST /api/llm-wiki/manage/sources/:sourceId/delete
GET  /api/llm-wiki/manage/schema
POST /api/llm-wiki/manage/schema/save
POST /api/llm-wiki/manage/pages/save
POST /api/llm-wiki/manage/pages/delete
POST /api/llm-wiki/manage/lint
GET  /api/llm-wiki/manage/issues
POST /api/llm-wiki/manage/issues/:issueId/resolve
```

只读检索：

```text
GET /api/llm-wiki/retrieval/manifest
GET /api/llm-wiki/retrieval/search
GET /api/llm-wiki/retrieval/page
GET /api/llm-wiki/retrieval/source/:sourceId
```

Agent：

```text
GET  /api/agents
GET  /api/agents/runs
GET  /api/agents/:agentType/defaults
POST /api/agents/:agentType/runs
GET  /api/agents/:agentType/runs/:runId
POST /api/agents/:agentType/runs/:runId/cancel
```

当前只注册 `llmWiki` Agent。

## 7. 模型配置

模型服务使用 OpenAI-compatible 非流式 `/chat/completions`。

基础配置：

```text
OPENAI_BASE_URL
OPENAI_API_KEY
OPENAI_MODEL
MODEL
LLM_WIKI_MODEL
AGENT_FAST_MODEL
AGENT_MAIN_MODEL
```

用途：

- `LLM_WIKI_MODEL`：Compiler 和 Fusion 默认模型。
- `AGENT_FAST_MODEL`：Planner 和 Reviewer 默认模型。
- `AGENT_MAIN_MODEL`：Synthesizer 默认模型。

当前 `/api/models` 的可选模型列表来自 `OPENAI_MODEL`、`MODEL` 和 `LLM_WIKI_MODEL`。如果 `AGENT_FAST_MODEL` 或 `AGENT_MAIN_MODEL` 使用不同模型，该模型还必须出现在可选模型列表中，否则 Agent 输入校验会拒绝运行。

## 8. 当前风险与后续重点

### 8.1 Ingest 不是事务

重新 ingest 会先移除 source 的旧贡献，再执行 Compiler 和 Fusion。中途失败时不能自动恢复完整旧状态。

后续应增加 staged workspace、完整校验和原子 commit。

### 8.2 任务只在单进程内协调

Ingest jobs 和 Agent AbortController 都保存在当前 Node.js 进程内，不支持多实例调度。

后续应引入持久化任务队列、租约和超时。

### 8.3 搜索不是语义检索

当前是 FlexSearch 加手写排序。它透明且可调试，但依赖词面命中。

后续可以在保留当前只读检索契约的前提下增加向量召回或图谱召回，不能绕过 Reviewer 和 source 核验。

### 8.4 Source 编译存在截断

超过 120000 字符的 source 只编译前半部分，可能遗漏后部知识。

后续应增加结构化分段编译、跨段合并和完整覆盖检查。

### 8.5 证据粒度仍以页面为主

当前 provenance 能追踪页面到 source，但不能精确定位 source 段落和 claim。

后续应增加 claim 级证据定位，同时保持 Markdown 页面可读性。

## 9. 验证

当前仓库使用：

```bash
pnpm --filter @knowllm/api test
pnpm check
pnpm lint
pnpm build
```

Agent workflow 测试重点验证：

- Planner 到页面读取、Reviewer、source review、Synthesizer 的完整流程。
- Agent 工具只委托给 llmWiki 只读检索契约。
- 最终结果保留 `knowledgeSnippets`。
- 未知旧字段不会改变执行链。
