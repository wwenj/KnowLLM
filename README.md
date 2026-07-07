<p align="center">
  <img src="assets/logo.png" alt="KnowLLM logo" width="180" />
</p>

<h1 align="center">KnowLLM</h1>
<p align="center">面向 Agent 的 LLM Wiki 开源框架</p>

## 项目简介

KnowLLM 是一个面向 Agent 的 LLM Wiki 框架，用于把原始资料编译成可维护、可追溯、可检索的 Markdown Wiki，再让 Agent 基于这份 Wiki 完成证据驱动的检索、原文核验和答案生成。

```text
原始资料 -> Markdown Wiki -> 证据驱动的 llmWiki Agent
```

它重点解决三个问题：

- 把零散资料沉淀成长期可维护的 Wiki，而不是一次性 RAG chunk。
- 让 Agent 回答可以回到 Wiki 页面、source 和证据片段。
- 用评测拆清楚问题来自 Wiki 编译、Agent 检索，还是最终回答。

## 核心能力

- 上传和管理 Markdown/TXT source。
- 将 source 编译、融合为 summary、concept 和 entity Wiki 页面。
- 保留 source、页面来源和知识贡献记录。
- 浏览、编辑、搜索和检查 Wiki。
- 运行独立 llmWiki Agent，查看检索轮次、证据片段、原文核验和最终答案。
- 运行 compile 评测和 Agent 评测，输出可解释的分项指标。
- 基于本地文件系统持久化，便于调试和复现。

````

## 评测体系

KnowLLM 的评测用于验证当前 llmWiki 链路是否可信：

```text
真实文档 -> Wiki 编译 -> Agent 检索 -> 证据约束回答
````

评测被拆成两层：

- `compile`：验证原始资料中的关键事实，是否在 Wiki 编译后被保留。
- `agent`：验证 Agent 是否能找到证据，并生成被证据支持的答案。

### 设计依据

市场上的评测方法大致有三类：

- 检索评测：证明系统能否找到相关文档，但不能证明答案正确。
- RAG 评测：拆解 context relevance、faithfulness、answer correctness，更接近知识问答系统。
- LLM-as-Judge：用模型做语义判卷，但判卷标准必须来自可追溯的人工标注，而不是 Judge 自己生成。

llmWiki 的核心风险也正好对应这三点：

```text
Wiki 编译丢事实 -> 后续回答没有可靠知识基础
Agent 没命中证据 -> 回答可能依赖模型记忆或幻觉
答案不忠实证据 -> 检索成功也不能代表系统可信
```

所以当前评测不只看最终答案，而是把失败点拆开：事实保留、证据命中、事实覆盖、答案忠实性。

### 样本构造

评测样本从同一批真实文档派生，而不是用 QA 卡片反推 source。

当前样本来源经过专门筛选：它们不是普通演示文档，而是为评测准备的领域内聚资料，要求有稳定来源、明确事实、可追溯证据，以及足够暴露编译和 Agent 回答问题的复杂度。

```text
sources
  -> gold facts + evidence
  -> compile cases
  -> agent cases
```

`gold facts` 是核心标准。每条事实都要能回到原文证据，Agent 问答中的 expected facts 也应尽量复用这些事实，避免编译评测和问答评测使用两套互相矛盾的答案标准。

### llmWiki 编译评测

编译评测回答一个问题：

```text
Wiki 是否保留了原始资料里的关键事实？
```

实现方式：

1. 读取人工标注的 expected facts。
2. 找到这些事实对应的已编译 Wiki 页面。
3. 用固定 Judge 判断每条事实是 `correct`、`missing` 还是 `incorrect`。
4. 按事实重要性加权汇总。

评分设计：

```text
must   = 3
should = 2
nice   = 1

weightedScore = correctWeight / totalWeight * 100
mustAccuracy  = mustCorrect / mustTotal
incorrectRate = incorrect / totalFacts
```

这里不只看正确率，还单独约束 `mustAccuracy` 和 `incorrectRate`。原因是：关键事实丢失和错误事实写入，比普通遗漏更容易破坏后续 Agent 的可信度。

### Agent 检索评测

Agent 评测回答另一个问题：

```text
Agent 是否能基于 Wiki 找到证据，并给出事实充分、证据忠实的答案？
```

实现方式：

1. 运行用户问题。
2. 记录 Agent 的检索与证据轨迹。
3. 判断是否命中相关来源。
4. 判断答案是否覆盖 expected facts。
5. 判断答案是否被证据支持。
6. 对资料不足的问题，判断是否正确拒答。

单题分以事实覆盖为主、二元正确为辅：

```text
factScore = max(0, (correctFacts - incorrectFacts) / totalFacts)
taskScore = 0.7 * factScore + 0.3 * binaryAnswerScore
```

拒答题不计算事实覆盖，只判断是否正确拒答。

### 总分设计

Agent 总分不是单一准确率，而是多维加权：

```text
overallScore =
  50 * taskCorrectnessRate +
  25 * faithfulnessRate +
  15 * factAccuracy +
   5 * sourceHitRate +
   5 * completionRate
```

权重含义：

- `taskCorrectnessRate`：最终任务是否完成，是主指标。
- `faithfulnessRate`：答案是否忠实证据，是可信度指标。
- `factAccuracy`：事实覆盖是否充分，是细粒度质量指标。
- `sourceHitRate`：是否找到来源，是检索诊断指标。
- `completionRate`：是否稳定跑完，是工程稳定性指标。

等级口径：

```text
excellent:         >= 90
pass:              >= 80
needs_improvement: >= 60
failed:            otherwise
```

### Judge 边界

LLM Judge 只是语义判卷器，不是评测标准本身。

当前实现通过以下方式降低不确定性：

- 使用固定 Judge 模型。
- 使用低温度或确定性配置。
- 要求结构化 JSON 输出。
- 只允许有限状态：`correct`、`missing`、`incorrect`。
- 保留证据片段和判定原因，便于人工抽查。

更严谨的做法是定期抽样人工复核 Judge 结果，统计 Judge 与人工判断的一致性。

### 实现边界

评测模块只读取已编译结果并写入评测 run，不负责资料生产链路本身。

它不会：

- 上传 source。
- 触发 ingest。
- 改写 Wiki 页面。
- 用 Judge 结果替代人工复核。

当前保留两套评测数据：

- `eval/zh_klipper3d_manual_mini`
- `eval/farmbot_genesis_v18_manual_mini`

其中 `zh_klipper3d_manual_mini` 是当前标准示例数据集。

## License

MIT
