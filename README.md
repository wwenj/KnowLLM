# KnowLLM

KnowLLM 是一个面向 Agent 的 LLM Wiki 开源项目设计方案。它的目标不是再做一个传统 RAG 文档问答系统，而是把原始资料编译成一套可读、可编辑、可追溯、可被 Agent 调用的 Markdown Wiki。

当前仓库处于开源方案整理阶段，核心设计来自三条线索：

1. Andrej Karpathy 提出的 LLM Wiki 思路：让 AI 先把资料整理成持续演化的知识库，而不是每次提问都从原文重新检索。
2. 对 Agent 知识库演进路径的判断：传统 Vector RAG 适合基础问答和长尾兜底，但不适合作为复杂 Agent 的核心外挂知识层。
3. 一个内部项目中的 llmWiki 原型实践：已经验证了 source、schema、compile、fusion、wiki、lint、issue、Agent query 这条链路的工程可行性。

KnowLLM 准备把这套思路抽象成一个通用开源项目，服务两类使用场景：

- 个人用户：本地安装 CLI 后启动一个轻量 Web 工作区，用来上传资料、编译 Wiki、查看日志、搜索页面、执行 lint，并通过 Skill、MCP 或 CLI 快速接入 Claude Code、Codex、Cursor 等 Agent 工具。
- 企业用户：私有化部署一个 LLM Wiki 服务，提供资料上传、编译任务、Wiki 管理、诊断、查询检索和 Agent 接入能力，用作企业内部 Agent 的长期知识层。

## 背景

很多知识库项目的默认起点是 RAG：上传文档，切成 chunk，写入向量库，查询时召回 Top-K，再交给模型生成答案。

这条路线能解决不少问答问题，但对 Agent 长期使用并不理想。Agent 需要的不只是“这次召回了几段文本”，而是一个可以长期维护、可以复盘来源、可以不断吸收新资料的知识结构。传统 chunk 往往会丢失章节语义、上下文指代、跨文档关系和历史演进。资料越多，Agent 越容易在零散片段里重复理解、重复拼接、重复犯错。

LLM Wiki 的思路是把知识整理前置：

```text
raw sources -> schema-guided compile -> wiki pages -> lint/issues -> agent query
```

原始资料仍然是事实来源，但它不直接承担长期检索层。系统先用 LLM 把资料编译成结构化 Markdown Wiki，再围绕 Wiki 做搜索、人工编辑、诊断和 Agent 查询。Wiki 页面是人能读懂的中间层，也是 Agent 更容易导航的知识地图。

## 项目定位

KnowLLM 可以理解成两个东西的组合：

```text
LLM Wiki Compiler + Agent Knowledge Workspace
```

它不是单纯的文档总结器，也不是单纯的向量检索服务。

它要解决的是：

- 如何把不断新增的原始资料编译成稳定 Wiki 页面。
- 如何让新资料合并进已有页面，而不是制造重复页面。
- 如何保留 source、page、claim、relationship 之间的来源链路。
- 如何用 lint 和 issue 持续维护知识库健康度。
- 如何让 Agent 查询时先读 Wiki，再按需回到 raw source 核验证据。
- 如何同时支持个人本地工作流和企业私有化服务。

## 技术架构

KnowLLM 的核心分层如下：

```text
Interfaces
  CLI / Web Workspace / MCP Server / Agent Skill / HTTP API

Agent Query Runtime
  manifest -> plan -> search/read -> review -> source verify -> snippets/answer

Wiki Maintenance
  search index / lint / issues / provenance / version history

Wiki Artifacts
  index / summaries / concepts / entities / comparisons / sidecar metadata

Compile Runtime
  parse -> draft -> normalize -> fusion -> stage -> commit

Knowledge Schema
  AGENTS.md / wiki rules / page rules / citation rules / query rules

Raw Sources
  markdown / text / pdf / html / docx / metadata / extracted text
```

### Raw Sources

`source` 是唯一事实源。上传或导入后的原始资料只读保存，并记录文件名、hash、来源、解析状态、schema 版本和影响过的 Wiki 页面。

首版可以优先支持 Markdown 和纯文本。后续再加入 PDF、HTML、DOCX、网页抓取和外部系统同步。

### Knowledge Schema

`schema` 是知识库的规则文件，类似 Karpathy 示例里的 `CLAUDE.md`，也类似 Agent 项目里的 `AGENTS.md`。

它定义：

- 当前知识库的目的和边界。
- source 如何进入系统。
- Wiki 页面类型和格式。
- 来源引用规则。
- 冲突和不确定信息的处理方式。
- Agent 查询时的优先级和禁止行为。

### Compile Runtime

编译流程负责把 source 变成 Wiki。

它不是简单总结，而是一个带约束的写入流程：

1. 读取 schema、source 和当前 Wiki manifest。
2. 调用模型生成结构化 draft。
3. 服务端规范化 draft，限制路径、类型、数量和来源标记。
4. 为 concept、entity、comparison 等页面查找候选旧页。
5. 调用 fusion 模型合并新旧内容。
6. 生成 staged changes，写入 Wiki、metadata、issue 和 index。

原则是：模型负责理解和写草稿，系统负责边界、路径、来源、一致性和提交。

### Wiki Artifacts

Wiki 是可读、可编辑、可版本化的 Markdown 文件集合。

推荐的基础页面类型：

- `index`：自动生成的导航页。
- `summary`：一份 source 对应的摘要页。
- `concept`：可复用概念页。
- `entity`：稳定对象页，例如产品、工具、组织、人物、项目。
- `comparison`：跨实体或跨方案的对比分析页。

`claim` 和 `relationship` 更适合先作为结构化 sidecar metadata 存储，再按需要渲染到页面或用于 Agent 推理。这样能避免把每个原子断言都变成 Markdown 页面，导致 Wiki 过碎。

### Wiki Maintenance

长期可用的知识库需要维护能力。

KnowLLM 需要提供：

- 全文搜索和可选 hybrid retrieval。
- 页面 frontmatter 和来源校验。
- 死链、孤立页、重复标题、超大页面检测。
- 缺失来源、来源已删除、schema drift、贡献记录不一致检测。
- issue 生命周期管理。
- 页面 diff、版本历史和人工审核入口。

lint 不应该静默改知识。它应该先把问题暴露出来，再提供可审阅的修复建议。

### Agent Query Runtime

Agent 查询不是简单 `search(q)`。

更合理的流程是：

```text
load manifest
  -> plan query
  -> collect candidates
  -> read wiki pages
  -> review evidence
  -> search/follow/read more
  -> read raw sources when needed
  -> verify source support
  -> return snippets or synthesize answer
```

这样可以把 LLM Wiki 作为 Agent 的知识检索节点使用：

- `snippets` 模式：只返回知识片段，交给上层 Agent 或 Chat 模型组织回答。
- `answer` 模式：直接基于证据生成最终答案。
- `wiki-only` 模式：只使用 Wiki 页面，不回读 source。
- `key-sources` / `exhaustive` 模式：按重要性回读原始资料核验。

### Interfaces

KnowLLM 面向个人和企业提供多种入口：

- CLI：初始化、导入、编译、搜索、查询、lint、导出、启动本地服务。
- Web Workspace：上传资料、查看编译进度、浏览 Wiki、编辑页面、查看 issue、运行查询。
- MCP Server：把 Wiki 搜索、页面读取、source 核验、query 作为 MCP tools 暴露给外部 Agent。
- Agent Skill：提供 Claude Code、Codex、Cursor 等工具可直接读取的使用说明和命令封装。
- HTTP API：给企业系统、内部 Agent 平台和自动化任务接入。

## 个人使用形态

目标体验：

```text
npm install -g knowllm
knowllm init my-wiki
cd my-wiki
knowllm start
```

启动后打开本地 Web 工作区，用户可以：

- 上传 Markdown、TXT、PDF 或网页资料。
- 选择模型和 schema。
- 发起 compile。
- 查看任务日志、模型调用、变更计划和失败原因。
- 浏览生成的 Wiki 页面。
- 搜索、查询、lint 和修复 issue。
- 一键生成 MCP 配置或 Agent Skill 接入说明。

本地目录应该保持透明，用户可以直接用 VS Code、Obsidian、Git 或普通编辑器查看和管理 Markdown 文件。

## 企业使用形态

企业版重点不是“多一个网页上传工具”，而是提供一个可私有化的 Agent 知识层。

典型能力包括：

- 多 workspace 或多 tenant 管理。
- 服务端上传、批量导入和定时同步。
- 持久化任务队列和 worker。
- staging + commit/rollback，避免半次 ingest 污染 Wiki。
- REST API 和 MCP Gateway。
- 权限、审计、运行日志和模型调用记录。
- 可配置模型供应商和私有模型网关。
- 对象存储、数据库和 Git 备份。
- 检索评测、引用覆盖率和 unsupported claim 检查。

企业部署中，KnowLLM 应该和现有 RAG、Graph RAG、搜索引擎、文档系统协作，而不是强行替代所有知识基础设施。LLM Wiki 更适合作为高价值、需要长期维护的核心知识层。

## 当前设计文档

- [LLM Wiki 开源实现方案](LLM%20Wiki%20开源实现方案.md)：当前开源项目要实现的完整技术方案。
- [Karpathy 的 LLM Wiki：让 AI 不再每次都从零开始读你的资料](调研记录/Karpathy%20的%20LLM%20Wiki：让%20AI%20不再每次都从零开始读你的资料.md)：LLM Wiki 背景和使用方式整理。
- [llmWiki 实现说明](调研记录/llmWiki实现说明.md)：内部原型实现的工程说明，是本项目方案的主要来源之一。
- [面向 Agent 的知识库技术演进与范式迭代](调研记录/面向%20Agent%20的知识库技术演进与范式迭代.md)：从 Vector RAG、Graph RAG 到 LLM Wiki 的技术判断。

## 路线图

### v0.1: 本地最小可用版本

- CLI 初始化 workspace。
- 支持 Markdown / TXT source。
- schema 配置。
- source -> draft -> wiki compile。
- summary / concept / entity 基础页面模型。
- 本地 Web 工作区。
- 全文搜索、lint、issue。
- CLI query 和 MCP tools。

### v0.2: Agent 集成版本

- planner / reviewer / synthesizer 查询链路。
- snippets 输出模式。
- Claude Code / Codex / Cursor Skill 模板。
- raw source 核验。
- 查询 run 日志和可观测性。
- 基础评测集和 citation support 检查。

### v0.3: 生产化版本

- PDF / HTML / DOCX 解析。
- 持久化任务队列。
- staged commit 和 rollback。
- 页面版本历史和 diff。
- claim / relationship sidecar。
- hybrid retrieval。
- HTTP API、鉴权、审计、多 workspace。
- Docker Compose 和私有化部署文档。

## 设计边界

- KnowLLM 不把模型输出当成可信写入，所有路径、类型、来源和提交都必须由系统校验。
- KnowLLM 不承诺适合高频实时数据流。LLM Wiki 有写放大，更适合高价值、可维护、需要长期沉淀的知识。
- KnowLLM 不把传统 RAG 视为无价值。长尾海量资料、低价值日志和兜底问答仍然适合 RAG 或搜索引擎。
- KnowLLM 的核心价值是把知识整理成能被人和 Agent 共同维护的中间层。

## License

MIT
