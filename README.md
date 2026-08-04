<p align="center">
  <img src="assets/logo.webp" alt="KnowLLM logo" width="180" />
</p>

<h1 align="center">KnowLLM</h1>
<p align="center">面向 Agent 的 LLM Wiki 开源设计方案</p>

## 项目简介

KnowLLM 将 Markdown/TXT 原始资料编译为可发布的 Wiki，并让 Agent 基于已发布内容完成检索、原文核验和答案生成。

## 原理与架构设计

KnowLLM 将知识库构建视为一次编译：Source 是事实输入，Wiki 是编译产物，Agent 只读取正式发布版本。模型负责知识规划和内容生成，程序负责输入快照、预算控制、协议校验、冲突处理与原子发布。

这条边界让知识生产与知识消费分开。编译阶段可以调用模型、允许失败、保留完整诊断；运行阶段只面对稳定的页面、索引和来源关系，不需要理解切片、Prompt 或编译状态。

```text
Source
  -> Snapshot / Compile Unit
  -> Planner
  -> Writer
  -> Source Overlay
  -> Shared Staging
  -> 人工确认 / Published Wiki
  -> Tools
  -> Agent
```

### 1. 切片

编译开始时先固定 Source 内容与 Hash。长文档只做保持原文顺序的物理切片，形成临时 Compile Unit；切片不调用模型，不做摘要和事实抽取，也不会成为正式知识实体或暴露给 Agent。

系统会按 Unit 字符数计算动态 `maxPages`，并在执行前估算 Unit 数量、模型调用数和 Token 上限。若产生 `U` 个 Unit，调用上限固定为 `U` 次 Planner 加 `U` 次 Writer；Source Hash、模型参数、预算规则、Prompt 版本和当前工作区一起写入 `confirmHash`，任一条件变化都需要重新确认。

Source 进入持久化 CompilePool 后按配置的 Source 并发调度。单个 Source 内的 Planner 可以并行，Writer 则必须按原文顺序执行，保证后续 Unit 能看到前面 Unit 对同一页面的更新。

### 2. Planner 规划

Planner 读取当前 Unit、已有页面目录和可用页面 ID，输出 `WikiPagePlan`：页面应创建还是更新、页面目标、内容范围、提纲、原文锚点和关联关系都在这一步确定。它相当于编译器的中间表示，先解决知识如何拆分，再交给 Writer 生成正文。

Planner 不生成正文和 Facts。页面 ID 由后端预留：`create` 只能使用预留 ID，`update` 必须引用真实页面；输出还要经过 JSON、页面数量、ID 唯一性、关联关系和必填字段校验。协议不合法时当前 Source 失败，不进入写入阶段。

### 3. Writer 写入

每个 Unit 只调用一次统一 Writer。Writer 同时接收原文、完整 Plan 和需要更新的页面正文，一次生成当前 Plan 涉及的全部 `bodyMarkdown` 与少量 Key Facts；标题、目标和页面关系仍以 Planner 结果为准，Writer 无权改写。

同一 Source 的 Writer 在私有工作副本中按原文顺序累积修改，跨 Source 更新同一页面时使用页面锁。Writer 返回的页面集合必须和 Plan 完全一致，不能缺页、重复或增加页面；Key Facts 会被限制、规范化去重并保留原始 `sourceId/sourceLine` 用于回查。

所有 Unit 成功后，结果才会汇总为一个 Source Overlay 原子写入 Staging。任意 Planner、Writer、JSON 解析或校验失败，整个 Source 的中间结果都会丢弃，不留下半成品。每个 Source 同时保留编译报告，记录 Unit、模型调用、Token、Prompt/响应摘要、校验结果和错误阶段，便于定位失败点。

### 4. 发布

Staging 保存 Pages、Facts、Source Map、Manifest 和 Search Index 的完整候选快照。多个 Source 可以持续合并到同一个 Staging；每次合并都会生成新的 Staging generation，所有产物写入并校验完成后才切换状态。

发布时先生成完整 Published Revision，再原子切换正式指针。指针切换前所有读取仍指向旧版本，切换后只暴露完整的新版本，不会对外暴露写入一半的正文、来源关系或索引。取消、丢弃或发布会先让未完成任务失去写权限，晚到的模型响应不能回写 Staging 或正式 Wiki。

### 5. 删除与重编译

Source 删除前会检查 Staging 和 Published 中的真实派生产物；只要页面、Facts、Source Map 或 Search Index 仍然引用该 Source，删除就会被拒绝。判断依据是产物关系；批量删除会先验证全部 Source，避免出现部分删除成功。

正式页面删除使用 Revision CAS。系统基于调用方看到的 Revision 构建新快照，清理正文、Facts、双向来源映射、页面关联和索引；Revision 已变化时拒绝提交，避免删除覆盖并发发布。

失败的 Source 可以重新编译，已进入当前 Staging 的 Source 不允许重复提交。当前重编译采用增量更新：Writer 以既有页面为基线合并新知识；严格的 Source 旧贡献替换和跨次 Facts 清理仍待后续完善。

### 6. Tools 查询入口

Tools 只读取 Published Wiki，对外提供 `getCatalog`、`searchWiki`、`readPage` 和 `readSource`。Catalog 用于规划，Search 用于候选召回，Page 提供正式正文与页面关系，Source 用于按行回查原文和 Facts 对应位置。

当前搜索使用标题、目标、Facts 和正文的确定性关键词匹配，不依赖向量库。搜索结果只提供候选信息、命中字段和摘要，Agent 必须继续读取页面才能获得正式证据；Tools 因此是编译产物与运行时 Agent 之间唯一稳定的读取合同。

### 7. Agent 检索

Agent 按照 `Catalog -> Planner -> Tools -> ReAct -> Evidence Gate -> Final` 执行。Planner 仅消费精简的页面目录，先判断相关性并拆分任务，再为每个 Task 生成一个首轮 `readPage` 或 `searchWiki` 动作；无关问题会直接结束，不再消耗后续 Tools 和模型调用。

页面证据的 Quote 必须存在于已读取的 Published Wiki 正文，Source 证据的 Quote 必须存在于当前读取的原文片段。Source Trace 只能访问当前 Task 已读取页面所暴露的 Source，并按行分段读取；重复读取优先使用缓存。

Planner 默认尽量保持单 Task，只在问题包含多个独立目标时拆分。ReAct 在受控的轮次、Tools 调用和 Token 预算内持续补充证据，并在复杂冲突或检索停滞时切换到更强的推理能力。

每轮 ReAct 会汇总已读页面的直接关联、反向关联和同 Source 页面，形成只用于导航的小目录；证据不足时优先读取可能补充缺口的关联页面，再进行全局搜索。生成答案前会再次计算 Published Catalog Fingerprint；目录、来源或页面关系发生变化时，本次证据会失效并停止回答。当前尚未把整个 Agent Run 固定到不可变 `revisionId`，正文内容级的一致性保护仍需继续完善。

## 开发进度

### LLM 编译

- ✅ 已完成：固定 Source 快照与 Hash，按原文顺序切片，并在执行前完成调用次数与 Token 预算估算。
- ✅ 已完成：通过 Planner 生成页面计划、预留页面 ID，并对模型输出进行 JSON、数量、关联关系等协议校验。
- ✅ 已完成：通过 Writer 生成页面正文和可回查的 Key Facts；任一 Unit 失败即丢弃该 Source 的中间结果。
- ✅ 已完成：支持 Shared Staging、冲突处理、原子发布与 Revision 切换，避免正式 Wiki 出现半成品或混合版本。
- ❌ 未完成：完善增量重编译时的旧贡献替换，以及跨次编译的 Facts 清理。

### Agent 检索

- ✅ 已完成：提供只读 Published Wiki 的 `getCatalog`、`searchWiki`、`readPage`、`readSource` Tools 合同。
- ✅ 已完成：`Catalog → Planner → Tools → ReAct → Evidence Gate → Final` 检索链路，以及轮数、工具调用和 Token 预算限制。
- ✅ 已完成：支持按 Task 汇总关联页面小目录，引导 ReAct 在证据不足时继续读取兄弟页面，同时保持目录与正式 Evidence 隔离。
- ✅ 已完成：支持 Published Page Quote 与 Source Quote 分层核验、Source 按行回查、重复读取缓存和 Catalog Fingerprint 变化检测。
- ❌ 未完成：将整个 Agent Run 固定到不可变 Published Revision，补齐正文内容级的一致性保护。
- ❌ 未完成：继续基于真实评测结果优化召回、任务规划与复杂多文档问题的检索策略。

### 开放能力与本地 Agent 集成

- ❌ 未完成：提炼可复用的 Core 与 Protocol，统一 Source、Compile、Published Tools 和 Agent 合同。
- ❌ 未完成：发布 npm Packages，补齐版本兼容、配置迁移和安装升级能力。
- ❌ 未完成：实现 CLI，覆盖工作区初始化、资料导入、编译、检索、问答和校验。
- ❌ 未完成：实现只读 MCP Server，向本地 Agent 开放搜索、页面读取、原文核验和问答 Tools。
- ❌ 未完成：提供可安装的 Agent Skills，以及 Codex、Claude Code、Cursor 等工具的配置与端到端示例。

当前 `packages/core`、`packages/protocol`、`packages/cli`、`packages/mcp-server` 和 `packages/skill-templates` 仅为占位骨架，以上能力均未完成开发。

### 评测数据集收集

- ✅ 已完成：收集并固化真实 Source，通过 `source_manifest.json` 保存来源信息与 SHA-256。
- ✅ 已完成：编译评测标准答案；`compile_cases.json` 保存 Gold Facts、原文证据和重要级别。
- ✅ 已完成：Agent 检索评测标准答案；`agent_cases.json` 绑定 Published `revisionId`，保存问题、参考答案、Required Facts、页面 Quote 和拒答用例。

### 编译评测

- ❌ 未完成：面向 Published Revision 的评测架构与执行合同设计。
- ❌ 未完成：设计 Judge、事实判定、评分和覆盖缺口处理规则。
- ❌ 未完成：实现评测执行、运行记录、报告、失败定位和跨版本对比。

### Agent 检索评测

- ❌ 未完成：基于当前 Agent 与 Published Tools 的评测架构和运行合同设计。
- ❌ 未完成：设计 Required Facts 覆盖、证据忠实度、拒答正确性、检索成本等评分规则。
- ❌ 未完成：实现真实 Agent 执行、轨迹记录、Judge、报告和回归对比。

## 邀请共建

KnowLLM 仍在快速迭代，欢迎一起把它做成可验证、可复现的 Agent 知识工程基础设施。
