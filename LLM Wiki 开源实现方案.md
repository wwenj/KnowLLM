# LLM Wiki 开源实现方案

本文是 KnowLLM 当前准备开源实现的技术方案。它基于已有 llmWiki 原型经验重新整理，去掉内部业务路径、内部服务名和项目专用逻辑，只保留可以沉淀为通用开源项目的核心设计。

一句话目标：

```text
把原始资料编译成可维护的 Markdown Wiki，并把它作为个人和企业 Agent 的长期知识层。
```

## 1. 目标和边界

### 1.1 核心目标

KnowLLM 要实现的是一套生产可落地的 LLM Wiki 系统，而不是一篇概念文章或一个一次性脚本。

核心目标包括：

- 支持本地快速安装和启动。
- 支持上传、导入、解析、编译和管理资料。
- 把资料编译成 Markdown Wiki，而不是只写入向量库。
- 保留 raw source 作为事实源。
- 支持 Wiki 页面人工编辑、搜索、lint 和 issue 管理。
- 支持 Agent 以 CLI、MCP、Skill、HTTP API 的方式调用。
- 支持企业私有化部署，提供任务、日志、权限、审计和查询服务。

### 1.2 非目标

首版不应该把范围做散：

- 不做通用文档管理系统。
- 不做 Obsidian 替代品。
- 不做全量企业搜索引擎。
- 不做纯向量 RAG 平台。
- 不承诺高频实时写入场景。
- 不让模型直接决定文件系统写入边界。

KnowLLM 可以接入 RAG、Graph RAG、搜索引擎和对象存储，但主线必须保持：source 是事实源，Wiki 是长期知识层，Agent query 是证据使用层。

## 2. 设计原则

### 2.1 Compile first

传统 RAG 是 query-time retrieval。KnowLLM 的主线是 ingest-time compile。

资料进入系统后，先被整理成 Wiki 页面。后续查询先面对整理后的知识结构，再按需要回到原始资料核验。

### 2.2 Markdown first

Wiki 页面使用 Markdown 存储。原因不是 Markdown 高级，而是它足够透明：

- 人能直接读。
- Git 能直接 diff。
- Obsidian、VS Code、Cursor、Claude Code、Codex 都能处理。
- 版本管理、人工审核和迁移成本低。

### 2.3 Source of truth 不动

raw source 不应该被模型改写。所有 Wiki 页面都只是派生产物。

如果 Wiki 和 source 冲突，以 source 为准。Agent 回答重要问题时，应能回到 source 做核验。

### 2.4 模型不可信

模型可以生成 draft、融合建议、查询计划和证据判断，但不能绕过系统校验。

系统必须校验：

- 文件路径。
- 页面类型。
- source id。
- frontmatter。
- schema hash。
- issue 类型。
- 任务状态。
- token 和成本预算。

### 2.5 可复盘

每一次 compile、fusion、lint、query 都应该留下可读记录。

当用户问“为什么生成了这页”“为什么这个 Agent 这样回答”“为什么这份 source 影响了这些页面”时，系统应该能给出过程证据，而不是只有一个最终答案。

## 3. 核心概念

### 3.1 Workspace

`workspace` 是一个独立知识库实例。个人本地通常只有一个 workspace，企业部署可以有多个 workspace 或 tenant。

每个 workspace 有自己的 source、schema、wiki、metadata、issues、tasks 和 runs。

### 3.2 Source

`source` 是用户导入的原始资料，是事实源。

首版 source 类型：

- Markdown。
- TXT。

后续扩展：

- PDF。
- HTML。
- DOCX。
- 网页抓取。
- Git 仓库文件。
- 外部知识系统同步。

source 必须记录：

- source id。
- 原始文件名。
- 文件类型。
- 文件大小。
- sha256。
- 上传或导入时间。
- 解析状态。
- 使用的 schema hash。
- 影响过的 Wiki 页面。
- 错误信息。

### 3.3 Schema

`schema` 是知识库规则。它可以以 `AGENTS.md`、`CLAUDE.md` 或 `knowllm.schema.md` 的形式存在。

它约束：

- 知识库目的。
- 页面类型。
- 页面写作规则。
- 来源引用规则。
- 术语和命名规则。
- 合并和冲突处理规则。
- Agent 查询优先级。
- 不确定信息处理规则。

schema 的内容会参与 compile 和 query，并通过 hash 写入 source 和 page metadata。

### 3.4 Draft

`draft` 是模型根据 source 生成的中间结构。

它不是最终写盘结果。系统必须对 draft 做规范化、路径限制、来源补齐和数量控制。

### 3.5 Wiki Page

`wiki page` 是最终可读的 Markdown 页面。

基础页面类型：

- `index`：自动生成的全局入口。
- `summary`：source 摘要页。
- `concept`：抽象概念页。
- `entity`：稳定对象页。
- `comparison`：对比分析页。
- `manual`：人工维护页面，可选。

页面应该包含 YAML frontmatter，用来保存 title、type、tags、sources、schema_hash、updated_at 等元信息。

### 3.6 Claim

`claim` 是可验证的原子断言，例如“系统使用 staged commit 避免半次写入污染 Wiki”。

claim 不一定要成为 Markdown 页面。更合理的方式是先作为 sidecar metadata 存储，并绑定来源、页面段落和证据。

### 3.7 Relationship

`relationship` 是带类型、方向和证据的关系边，例如：

```text
LLM Wiki -> improves -> Agent long-term knowledge maintenance
```

relationship 同样适合存储在 sidecar metadata 中，再用于 Agent 查询、图谱视图或页面生成。

### 3.8 Issue

`issue` 是知识库维护问题，不等于 GitHub issue。

常见 issue：

- dead link。
- orphan page。
- duplicate title。
- missing source。
- schema drift。
- weak evidence。
- conflict。
- needs review。
- unsupported claim。

issue 应有 open、resolved、ignored 等状态，并保留创建来源。

### 3.9 Run

`run` 是一次 Agent 查询或任务执行记录。

它应该保存：

- 输入参数。
- 使用的模型。
- 执行状态。
- 中间事件。
- 读取过的页面。
- 读取过的 source。
- reviewer 判断。
- 最终 snippets 或 answer。
- 失败原因。

## 4. 数据目录设计

个人本地模式推荐使用文件系统作为主存储。

```text
.knowllm/
  config/
    knowllm.yaml
    models.yaml
  schema/
    AGENTS.md
  sources/
    <sourceId>/
      source.<ext>
      extracted.md
      meta.json
  wiki/
    index.md
    summaries/
      <sourceId>.md
    concepts/
      *.md
    entities/
      *.md
    comparisons/
      *.md
    manual/
      *.md
  meta/
    pages/
      <pagePathHash>.json
    contributions/
      <pagePathHash>.json
    claims/
      *.json
    relationships/
      *.json
    search/
      index.json
  issues/
    open/
      *.json
    resolved/
      *.json
    ignored/
      *.json
  tasks/
    <taskId>/
      meta.json
      events.jsonl
      plan.json
      result.json
  runs/
    <runId>/
      meta.json
      events.jsonl
      result.md
      result.json
  logs/
    YYYY-MM-DD.jsonl
```

企业服务模式推荐抽象成：

```text
DATA_ROOT/
  workspaces/
    <workspaceId>/
      ...
```

企业部署可以把 metadata、tasks、runs、issues 放入数据库，把 source 和 wiki artifact 放入对象存储或 Git-backed storage。但逻辑模型应保持一致。

## 5. Source 生命周期

source 状态建议设计为：

```text
uploaded -> parsed -> compiling -> ready
uploaded -> failed
parsed -> failed
compiling -> failed
ready -> compiling -> ready
```

### 5.1 Import

导入阶段只做文件级处理：

- 检查文件大小。
- 检查扩展名。
- 拒绝明显二进制内容。
- 计算 sha256。
- 生成 source id。
- 写入原文和 meta。

这一步不调用模型。

### 5.2 Parse

解析阶段把不同格式统一成 `extracted.md`。

首版 Markdown / TXT 可以直接规范化。后续 PDF、HTML、DOCX 需要进入解析器。

解析器输出应包含：

- 正文 Markdown。
- 标题或文档名。
- 页码或段落 anchors，可选。
- 原始文件 metadata。
- 解析警告。

### 5.3 Compile

编译阶段才调用模型，把 parsed source 转成 Wiki draft。

同一个 source 不允许并发 compile。企业部署下应使用持久化任务队列，个人本地可以先用进程内任务，但任务中断必须显式标记失败。

### 5.4 Recompile

重新编译 source 前，需要处理旧贡献。

原则：

- source 独占的 summary 页面可以删除重建。
- source 独占的 concept/entity/comparison 页面可以删除。
- 多 source 共享页面不能直接删正文，只能移除当前 source 的贡献记录，再通过新一轮 fusion 修正页面。
- 如果支持段落级 provenance，才可以精确删除某个 source 支撑的段落。

## 6. Compile Pipeline

完整编译链路如下：

```text
load schema
  -> load source
  -> load wiki manifest
  -> compile draft
  -> normalize draft
  -> find candidate pages
  -> fusion
  -> build staged changes
  -> validate changes
  -> commit
  -> rebuild index
  -> update metadata
```

### 6.1 Load Manifest

manifest 是当前 Wiki 的地图，包含：

- 页面列表。
- 页面标题、类型、tags、sources。
- index 摘要。
- schema hash。
- source 列表和状态。
- 最近 issue 摘要。

manifest 会进入模型上下文，用来减少重复页面，帮助模型判断应该创建新页还是更新旧页。

### 6.2 Compile Draft

compiler model 输出结构化 draft。

建议输出至少包含：

- summary。
- concepts。
- entities。
- comparisons，可选。
- claims，可选。
- relationships，可选。
- warnings。

服务端必须允许模型输出不稳定，因此需要支持：

- JSON 代码块提取。
- JSON repair 或重试。
- schema validation。
- 空字段兜底。
- 超长内容截断。

### 6.3 Normalize Draft

normalize 阶段负责把模型输出变成可信内部对象。

处理规则：

- summary 路径由系统强制生成。
- concept/entity/comparison 只能写入允许目录。
- slug 只允许安全字符。
- 每类页面数量设置上限。
- tags 去重并限制数量。
- 正文缺少一级标题时自动补齐。
- 缺少 source 标记时自动追加来源说明。
- 无效 source id 直接丢弃。

### 6.4 Candidate Matching

concept、entity、comparison 需要先找候选旧页。

候选来源：

- 路径完全相同。
- 标题标准化后相同。
- tags 或 alias 命中。
- 全文搜索命中。
- relationship/claim sidecar 命中。
- embedding 命中，可选。

只允许同类型或兼容类型合并。concept 不应随意合并进 entity。

### 6.5 Fusion

fusion model 的任务是把新 draft 合并进候选旧页。

允许动作：

- `create`：新建页面。
- `update`：更新已有页面。
- `skip`：信息重复，无需写入。
- `conflict`：存在冲突，需要保留冲突说明并生成 issue。

服务端二次校验：

- target path 必须来自 draft path 或候选页面。
- type 不允许被模型随意改变。
- sources 必须存在。
- issue kind 必须在白名单内。
- 页面正文必须是 Markdown。

### 6.6 Staged Changes

生产化版本不应该边融合边写最终文件。

更稳妥的方式是先生成 staged changes：

```text
create page
update page
delete page
update source meta
write contribution
write claim sidecar
write relationship sidecar
write issue
rebuild index
```

用户或系统可以在 commit 前查看变更摘要。

### 6.7 Commit

commit 阶段要尽量保证一致性。

个人本地版本可以采用 staging directory + atomic rename。企业版本应结合数据库事务、对象存储版本号或 Git commit。

提交失败时需要保留 recovery 信息，不能让 source 显示 ready 但页面只写了一半。

## 7. Wiki 页面模型

### 7.1 Frontmatter

每个非 index 页面建议包含：

```yaml
---
title: LLM Wiki Architecture
type: concept
tags:
  - llm-wiki
  - architecture
sources:
  - source_abc
schema_hash: hash
updated_at: 2026-06-10T00:00:00.000Z
---
```

扩展字段：

- aliases。
- confidence。
- owner。
- review_status。
- last_verified_at。
- related。
- claims。

### 7.2 Summary Page

summary 是 source 的入口页。

它应该回答：

- 这份资料是什么。
- 主要内容是什么。
- 贡献了哪些概念、实体、关系和断言。
- 适合回答哪些问题。
- 有哪些不确定点。

### 7.3 Concept Page

concept 用来维护抽象知识点。

它应该包含：

- 定义。
- 背景。
- 关键机制。
- 适用场景。
- 与其他概念的关系。
- 来源证据。
- 未解决问题。

### 7.4 Entity Page

entity 用来维护稳定对象。

对象可以是：

- 产品。
- 工具。
- 框架。
- 组织。
- 人物。
- 项目。
- 业务对象。

entity 页面应避免写成百科口吻的空泛介绍，重点是和当前知识库目标相关的信息。

### 7.5 Comparison Page

comparison 是跨对象分析页。

例如：

- LLM Wiki vs Vector RAG。
- CLI-first vs Web-first。
- Personal workspace vs Enterprise service。

comparison 适合做成 Markdown 页面，因为它通常是面向人和 Agent 都有价值的派生分析。

### 7.6 Claim 和 Relationship Sidecar

claim 和 relationship 建议先不作为一等 Markdown 页面，而是存成 sidecar：

```text
meta/claims/*.json
meta/relationships/*.json
```

这样可以用于：

- 检查 unsupported claim。
- 构建局部关系图。
- 辅助 Agent 多跳查询。
- 给页面生成“相关关系”区块。
- 未来接入 Graph RAG。

## 8. Provenance 设计

KnowLLM 的核心可信度来自 provenance。

至少需要三层来源：

### 8.1 Page-level Provenance

页面 frontmatter 中记录 sources。

这能说明页面被哪些 source 支撑，但不能说明每段话来自哪里。

### 8.2 Contribution-level Provenance

contribution 记录某个 source 何时影响过某个页面：

- source id。
- source sha256。
- schema hash。
- page path。
- change summary。
- compile task id。
- written at。

它用于 recompile、delete source、审计和 issue 检查。

### 8.3 Block-level Provenance

生产化版本应该逐步支持段落级来源。

可选方案：

- Markdown 注释 anchor。
- sidecar block map。
- paragraph hash。
- source span。

block-level provenance 可以支持更精确的删除、回滚、引用和证据核验，但实现复杂度较高，不应阻塞 v0.1。

## 9. Search 和 Retrieval

### 9.1 直接读取

提供直接读取能力：

- 读取 Wiki tree。
- 读取指定页面。
- 读取 source 原文或 extracted.md。
- 读取 issue。
- 读取 run。

这类操作不调用模型。

### 9.2 全文搜索

首版可使用本地全文搜索。

索引字段：

- title。
- path。
- type。
- tags。
- aliases。
- frontmatter。
- body。

排序可以先用简单规则：

- title 命中权重最高。
- tag/alias 次之。
- path 次之。
- body 命中最低。

### 9.3 Hybrid Retrieval

生产化版本可以引入 embedding，但对象应该是 Wiki 页面和段落，不是直接回到原始 chunk RAG。

推荐方式：

```text
keyword search + page embedding + claim/relationship hints + recency/source priority
```

这样仍然保持 Wiki-first，而不是退回 chunk-first。

## 10. Agent Query Runtime

Agent query 是 KnowLLM 面向外部 Agent 的核心能力。

输入：

- query。
- output mode。
- source policy。
- budget。
- model config。
- workspace id。
- optional filters。

输出：

- snippets。
- answer，可选。
- used pages。
- used sources。
- coverage summary。
- gaps。
- stop reason。
- run id。

### 10.1 Output Modes

`snippets`：

只返回结构化知识片段，适合被上层 Agent 继续使用。

`answer`：

直接生成最终回答，适合用户在工作台或 CLI 中查询。

`report`：

生成更长的研究报告，可作为后续扩展。

### 10.2 Source Policies

`wiki-only`：

只读 Wiki，不读原始资料。速度快，但证据强度较弱。

`auto`：

由 reviewer 判断是否需要读取 source。

`key-sources`：

读取关键页面关联的主要 source。

`exhaustive`：

在预算内尽量读取所有相关 source。

### 10.3 Execution Graph

推荐查询图：

```text
load_manifest
  -> plan_query
  -> collect_candidates
  -> read_page_batch
  -> review_evidence
  -> execute_next_actions
  -> read_page_batch
  -> review_evidence
  -> read_raw_sources
  -> review_sources
  -> build_snippets
  -> synthesize_answer
  -> finish
```

### 10.4 Planner

planner 负责拆解问题：

- intent。
- keywords。
- entities。
- candidate paths。
- search queries。
- required topics。
- excluded topics。
- research tasks。

planner 的输出只能作为计划，不能直接读取文件。

### 10.5 Reviewer

reviewer 负责判断证据是否足够：

- 哪些页面保留。
- 哪些页面丢弃。
- 为什么保留或丢弃。
- 缺哪些信息。
- 下一步读什么页面、搜什么词、跟什么链接、读什么 source。

reviewer 只能请求系统允许的动作。

### 10.6 Source Verifier

source verifier 判断 Wiki 页面是否被原始资料支撑。

输出：

- verified。
- wiki-only。
- partial。
- conflict。
- unknown。

这个结果会进入 snippets 和 answer 的证据说明，但不应该自动改 Wiki。

## 11. Lint 和 Issue 系统

lint 分成四类：

### 11.1 Structural Lint

- missing frontmatter。
- invalid type。
- dead link。
- orphan page。
- duplicate title。
- oversized page。
- index missing。
- invalid path。

### 11.2 Evidence Lint

- missing source。
- deleted source ref。
- missing claim source。
- stale source digest。
- schema drift。
- contribution missing。
- unsupported claim。

### 11.3 Quality Lint

- 页面过长，建议拆分。
- 页面过短，可能没有知识价值。
- 重复页面。
- 术语命名不一致。
- comparison 缺少对比维度。
- entity 页面缺少关键字段。

### 11.4 Security Lint

- source 中存在 prompt injection 风险。
- 页面中存在可疑命令。
- 外链或附件风险。
- schema 包含危险指令。

lint 的输出是 issue 或 repair proposal。默认不自动修改正文。

## 12. CLI 设计

CLI 是个人用户的第一入口，也应该是企业自动化的最小依赖。

建议命令：

```text
knowllm init <dir>
knowllm start
knowllm import <file-or-url>
knowllm sources list
knowllm compile <sourceId>
knowllm compile --all
knowllm wiki tree
knowllm wiki open <path>
knowllm search <query>
knowllm query <question>
knowllm lint
knowllm issues list
knowllm export
knowllm mcp init
knowllm skill init
```

CLI 设计原则：

- 命令输出适合人读。
- 支持 `--json` 给脚本和 Agent 使用。
- 所有 destructive 操作需要确认或显式 `--yes`。
- 运行失败必须返回明确 exit code。

## 13. Web Workspace 设计

Web Workspace 面向本地和企业控制台。

核心页面：

- Overview：source 数量、Wiki 页面数、open issues、最近任务。
- Sources：上传、导入、解析状态、重新编译、删除。
- Compile：任务队列、日志、模型调用、staged changes。
- Wiki：文件树、Markdown 预览、编辑、来源面板。
- Search：全文搜索和 hybrid 检索调试。
- Query：Agent query 调试，展示 planner、reviewer、snippets 和 sources。
- Issues：lint 结果、状态流转、修复建议。
- Settings：schema、模型、预算、MCP、Skill、导出配置。

Web UI 的重点是低噪声控制台，不需要做营销型页面。

## 14. MCP 设计

MCP Server 用来让 Claude Code、Codex、Cursor 等 Agent 工具调用 KnowLLM。

建议 tools：

- `knowllm_search`：搜索 Wiki。
- `knowllm_read_page`：读取页面。
- `knowllm_read_source`：读取 source。
- `knowllm_query`：执行 Agent query。
- `knowllm_lint`：运行 lint。
- `knowllm_list_issues`：列出 issue。
- `knowllm_compile_source`：可选，触发编译。

建议 resources：

- workspace manifest。
- wiki index。
- schema。
- recent runs。

MCP 默认应该是 read-mostly。写操作需要显式开启。

## 15. Agent Skill 设计

Skill 的目标是让外部 Agent 知道如何正确使用当前 Wiki，而不是让用户手写长提示词。

Skill 应包含：

- 当前 workspace 目的。
- 何时使用 KnowLLM。
- 查询优先级。
- CLI 或 MCP 调用方式。
- 引用来源规则。
- 不确定时的回答规则。
- 禁止直接编造 Wiki 中不存在的内容。

对 Claude Code、Codex、Cursor 可以分别生成适配文件，但核心规则应来自同一份 schema。

## 16. HTTP API 设计

企业私有化部署需要 HTTP API。

模块建议：

- Workspace API。
- Source API。
- Compile Task API。
- Wiki Page API。
- Search API。
- Query Run API。
- Issue API。
- Schema API。
- Model Provider API。
- Audit API。

API 返回应稳定，适合接入内部 Agent 平台。

对于长任务：

- 提交任务后立即返回 task id。
- 客户端通过轮询或 SSE/WebSocket 获取状态。
- task events 使用 JSONL 保存。
- 支持 cancel。

## 17. 模型运行时

KnowLLM 不应该绑定单一模型厂商。

需要抽象模型角色：

- compiler model。
- fusion model。
- planner model。
- reviewer model。
- verifier model。
- synthesizer model。
- embedding model，可选。

运行时能力：

- JSON schema 输出。
- 重试。
- 超时。
- token 预算。
- 成本估算。
- prompt 版本记录。
- model call trace。
- provider fallback，可选。

模型失败时要显式失败或生成 issue，不能静默降级成低质量答案。

## 18. 企业部署架构

企业版推荐结构：

```text
Web Console
  -> API Server
      -> Task Queue
      -> Worker
      -> Model Gateway
      -> Metadata DB
      -> Object Storage / Git Storage
      -> Search Index
      -> Audit Log
```

### 18.1 API Server

负责鉴权、workspace 管理、source 管理、query API 和控制台接口。

### 18.2 Worker

负责 parse、compile、fusion、lint、index rebuild 和长查询任务。

### 18.3 Storage

个人版优先 file-backed。

企业版可以拆分：

- source 原文：对象存储。
- wiki 页面：Git-backed storage 或对象存储。
- metadata：PostgreSQL。
- search index：本地索引、Meilisearch、OpenSearch 或其他搜索服务。
- task events：数据库或 JSONL 日志。

### 18.4 Auth 和权限

企业版至少需要：

- workspace 级权限。
- source 读取权限。
- compile 权限。
- wiki 编辑权限。
- query 权限。
- admin 权限。
- audit log。

权限会影响 Agent 可读取的页面和 source。

## 19. 安全设计

### 19.1 文件路径安全

所有 path 必须走白名单和 root containment 校验。

不允许：

- `../`。
- 绝对路径。
- 隐藏系统文件。
- 任意扩展名写入。
- 模型决定最终根目录。

### 19.2 Prompt Injection

source 是不可信输入。

系统 prompt 和 schema 必须明确：

- source 中的指令只是资料内容。
- source 不能要求模型泄露密钥。
- source 不能要求模型改系统规则。
- source 不能要求模型执行外部命令。

### 19.3 写操作保护

默认读操作安全，写操作必须经过权限和任务系统。

MCP 和 Skill 接入时，写能力默认关闭，避免外部 Agent 误触发大规模重编译或删除。

### 19.4 Secret 管理

模型 key、外部系统 token、企业 API token 不得写入 Wiki、run result 或 issue。

日志需要做敏感字段脱敏。

## 20. Evaluation 和测试

LLM Wiki 的测试不能只看单元测试。

至少要覆盖四层：

### 20.1 契约测试

- 路径校验。
- frontmatter 读写。
- source 状态流转。
- draft normalize。
- issue lifecycle。
- API schema。

### 20.2 Compile Golden Tests

用固定小型资料集验证：

- 是否生成预期 summary。
- 是否创建或更新正确页面。
- 是否避免重复页面。
- 是否保留来源。
- 冲突是否生成 issue。

### 20.3 Retrieval Eval

建立问题集和期望证据页：

- Hit@k。
- Recall@k。
- MRR。
- NDCG。
- answer citation support。
- unsupported claim rate。
- abstain correctness。

### 20.4 Agent Trace Review

评估不只看最终答案，还要看：

- planner 是否拆对任务。
- reviewer 是否丢掉噪声页面。
- source verifier 是否识别证据不足。
- stop reason 是否合理。
- token 和成本是否可控。

## 21. 版本路线

### 21.1 v0.1 本地 MVP

范围：

- CLI workspace init。
- Markdown / TXT source。
- schema。
- compile to summary/concept/entity。
- file-backed wiki。
- search。
- lint。
- issue。
- query snippets。
- local Web Workspace。
- MCP read/query tools。

不做：

- 多租户。
- 权限系统。
- PDF 复杂解析。
- 持久化任务队列。
- hybrid retrieval。
- block-level provenance。

### 21.2 v0.2 Agent 集成增强

范围：

- planner/reviewer/verifier/synthesizer 完整查询图。
- Skill 模板生成。
- run trace 可视化。
- raw source 核验。
- query eval harness。
- PDF/HTML 初步解析。
- staged changes 预览。

### 21.3 v0.3 生产化

范围：

- worker + persistent queue。
- staged commit + rollback。
- 多 workspace。
- HTTP API。
- auth/audit。
- claim/relationship sidecar。
- hybrid retrieval。
- Git backup。
- Docker Compose。

### 21.4 v1.0 稳定版

范围：

- 完整个人本地体验。
- 稳定企业私有化部署。
- 兼容主流 Agent 工具。
- 可观测、可评测、可迁移。
- 清晰插件接口。

## 22. 风险和取舍

### 22.1 写放大

LLM Wiki 把整理工作放到写入阶段，每次新增 source 可能触发多页更新和模型调用。它不适合高频实时日志。

缓解方式：

- 批量 compile。
- 任务队列。
- staged changes。
- 增量候选匹配。
- 模型预算限制。

### 22.2 规模墙

当 Wiki 页面极多时，manifest 和候选上下文会变大。

缓解方式：

- 分 workspace。
- 分 topic。
- index 摘要。
- hybrid retrieval。
- page embedding。
- query-time page ranking。

### 22.3 模型幻觉

模型可能错误总结、错误合并或遗漏来源。

缓解方式：

- source verifier。
- provenance。
- lint。
- issue。
- human review。
- eval。

### 22.4 过度结构化

如果一开始就把 claim、relationship、comparison 全部做成复杂图谱，项目会变重。

建议顺序：

```text
summary / concept / entity
  -> contribution provenance
  -> comparison page
  -> claim sidecar
  -> relationship sidecar
  -> graph/hybrid retrieval
```

## 23. 最小落地闭环

KnowLLM 首版最重要的闭环不是功能多，而是链路完整：

```text
用户导入资料
  -> 系统保存 raw source
  -> 模型编译 draft
  -> 系统规范化并融合
  -> 写入 Markdown Wiki
  -> 用户能浏览和编辑
  -> lint 能发现问题
  -> Agent 能 query 出 snippets
  -> snippets 能带来源和不确定点
```

只要这条链路稳定，后续 PDF、企业部署、MCP、Skill、Hybrid Retrieval 都是自然扩展。

## 24. 结论

KnowLLM 的价值不在于“用 LLM 总结文档”，而在于把知识库拆成一组可维护的工程对象：

- raw source：事实来源。
- schema：编译和查询规则。
- draft：模型生成的中间结果。
- fusion：新知识进入旧知识的过程。
- wiki：人和 Agent 都能读的长期知识层。
- provenance：来源和贡献记录。
- lint/issues：知识库健康维护。
- query runtime：Agent 使用证据的执行链路。
- interfaces：CLI、Web、MCP、Skill、HTTP。

这套设计承认 LLM 会犯错，也承认传统 RAG 仍有价值。它真正要做的是把高价值知识从“临时召回片段”提升为“可持续维护的知识工程资产”。
