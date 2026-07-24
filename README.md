<p align="center">
  <img src="assets/logo.png" alt="KnowLLM logo" width="180" />
</p>

<h1 align="center">KnowLLM</h1>
<p align="center">面向 Agent 的 LLM Wiki 开源框架</p>

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

发布时先生成完整 Published Revision，再原子切换正式指针。Agent 在切换前读取旧版本，切换后统一读取新版本，不会混用不同 Revision 的正文、来源关系和索引。取消、丢弃或发布会先让未完成任务失去写权限，晚到的模型响应不能回写 Staging 或正式 Wiki。

### 5. 删除与重编译

Source 删除前会检查 Staging 和 Published 中的真实派生产物；只要页面、Facts、Source Map 或 Search Index 仍然引用该 Source，删除就会被拒绝。判断依据是产物关系；批量删除会先验证全部 Source，避免出现部分删除成功。

正式页面删除使用 Revision CAS。系统基于调用方看到的 Revision 构建新快照，清理正文、Facts、双向来源映射、页面关联和索引；Revision 已变化时拒绝提交，避免删除覆盖并发发布。

失败的 Source 可以重新编译，已进入当前 Staging 的 Source 不允许重复提交。当前重编译采用增量更新：Writer 以既有页面为基线合并新知识；严格的 Source 旧贡献替换和跨次 Facts 清理仍待后续完善。

### 6. Tools 查询入口

Tools 只读取 Published Wiki，对外提供 `getCatalog`、`searchWiki`、`readPage` 和 `readSource`。Catalog 用于规划，Search 用于候选召回，Page 提供正式正文与页面关系，Source 用于按行回查原文和 Facts 对应位置。

当前搜索使用标题、目标、Facts 和正文的确定性关键词匹配，不依赖向量库。搜索结果只提供候选信息、命中字段和摘要，Agent 必须继续读取页面才能获得正式证据；Tools 因此是编译产物与运行时 Agent 之间唯一稳定的读取合同。

### 7. Agent 检索

Agent 按照 `Catalog -> Planner -> Tools -> ReAct -> Evidence Gate -> Final` 执行。Planner 仅消费精简的页面目录，先判断相关性并拆分任务；无关问题会直接结束，不再消耗后续 Tools 和模型调用。

页面证据和 Source 证据都必须通过原文 Quote 校验。Source Trace 只能访问当前任务已读取页面所暴露的 Source，并按行分段读取；检索过程有固定的轮数、Tools 调用和 Token 预算，重复读取优先使用缓存。

生成答案前会再次检查 Published Catalog Fingerprint。Wiki 在检索期间发生变化时，本次证据会失效并停止回答，避免混合不同 Revision 的内容。

## 评测设计

当前评测实现仍基于旧 llmWiki 合同，新版 Published Revision 适配正在开发。后续重构会保留数据集、Gold Facts、Judge 和指标设计，并将评测输入绑定到不可变 Revision。

### 1. 评测数据集

同一批 Sources 同时生成 `source_manifest.json`、`compile_cases.json` 和 `agent_cases.json`。Source 通过 SHA-256 固定版本；编译评测使用带原文证据和重要级别的 Gold Facts，Agent 评测增加问题、参考答案、相关 Source、Expected Facts 和拒答用例。

同源数据集让编译与 Agent 评测使用同一事实标准，能够区分问题出在知识编译、检索路径还是最终回答。数据集应覆盖流程、配置、限制、例外、冲突和多文档综合，不能用模板化 QA 卡片代替真实 Source。

### 2. 编译评测

编译评测固定一个 Published Revision，通过 Source Hash 找到相关页面，判断每条 Gold Fact 在最终 Wiki 中属于 `correct`、`missing` 还是 `incorrect`。Judge 只能用最终 Wiki 页面作为正确依据，原始 Source 只用于解释 Gold Fact 的来源。

核心指标包括 `weightedScore`、`mustAccuracy`、遗漏率、错误率和字符覆盖率。新版 Run 还需要保存 Revision 产物、数据集 Hash、Judge/Compiler 元数据；Source 缺失应标记为不完整，不能用剩余 Case 的高分掩盖覆盖缺口。

### 3. Agent 检索评测

Agent 评测执行真实检索链路，记录 Planner、Tools、页面读取、Source Trace、证据和最终答案。主要评估 Source 命中、事实覆盖、答案忠实度、回答正确性、拒答正确性和检索成本。

Judge 只能基于 Expected Facts、参考答案、Agent 答案和本次检索证据判分，不能使用外部知识补充答案。新版评测需要适配当前 `query / limit / fastModel / qualityModel` 与 Published Tools 合同，并在运行期间固定 Wiki Revision。

## 更新日志与开发进度

当前阶段：LLM Wiki 的核心编译与 Agent 检索链路已经完成，项目进入评测体系开发阶段。

- [x] LLM Wiki 编译层完成
- [x] Agent 检索层完成
- [x] 测试数据集收集完成
- [ ] 编译评测开发中
- [ ] Agent 评测开发中

### 2026-07-24

- 完成 llmWiki 编译层、原子发布和冲突处理主链路。
- 完成 Published Tools 与 Agent 检索、证据核验链路。
- 完成编译评测与 Agent 评测数据集收集。
- 开始按新版 Published Revision 合同重构评测模块。
