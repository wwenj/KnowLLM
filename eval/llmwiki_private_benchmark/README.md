# llmWiki Private Mini Benchmark

用途：给 KnowLLM 当前的 llmWiki 编译链路和 Agent 检索链路准备一组小规模、私域形态、可人工核对的测试资料。

## 设计边界

- 资料是合成的企业内部文档，不从通用公开技术文档、README、厂商文档直接爬取。
- 主题模拟公司内部知识库：项目章程、事故复盘、运行手册、合同摘录、CRM 备注、会议纪要、路线图、权限/RACI、数据治理和安全例外。
- 当前 source Markdown 数量：22 个，低于 50 个。
- 配套问题文件：`questions.json`，当前 60 个问题，低于 100 个。
- 私域 canary：`KLLM-EVAL-260611-PRIVATE-MINI`。如果模型在未检索资料时直接答出 canary 相关事实，说明评估环境可能被污染。

## 适配当前 llmWiki 的点

- 编译：每个 source 都有明确实体、概念、流程、约束、冲突信息和未确认项，便于观察 compiler 是否能抽取 summary/concepts/entities。
- 融合：多份 source 会重复或修订同一事实，例如 Nebula TTL、Orion GA 日期、Polaris replay 计费、Atlas retention。
- 检索：问题包含精确词、别名、缩写、中文同义表达、表格数值、跨文档推理、缺失答案、过期文档和提示注入。
- Agent：问题集包含单文档、多文档、冲突消解、raw source 核验、sourcePolicy 差异和 abstain 场景。

## 来源参考

这套数据没有复制公开 benchmark 的原文，只参考了公开 benchmark 的评估思想：

- EnterpriseRAG-Bench：企业内部多源资料、跨文档一致性、噪声、近重复和冲突信息。
- BEIR / MTEB：检索评估常用 `corpus / queries / qrels` 思路，以及 Recall/MRR/nDCG 这类指标。
- HotpotQA：多跳问题与 supporting facts。
- CUAD：专业领域里“needle in a haystack”的合同审查问题形态。
- CRUD-RAG：读、更新、冲突修改、不可答等 RAG 应用场景分类。

## 建议使用方式

1. 将 `sources/*.md` 逐个作为 llmWiki source 上传并 ingest。
2. 对 `questions.json` 中的问题逐个调用 llmWiki Agent。
3. 用 `expected_facts` 做事实覆盖率，用 `must_include` 做关键词召回，用 `relevant_sources` 做 source/page 命中分析。
4. 对 `answerable=false` 的问题，主要检查 Agent 是否拒答或明确说资料未覆盖。

## 建议评分口径

- `fact_coverage`：命中 `expected_facts` 的比例。
- `must_include_hit`：答案是否包含核心实体、数值、日期、策略名。
- `source_hit`：检索轨迹或最终引用是否覆盖 `relevant_sources`。
- `stale_resistance`：遇到 deprecated 或被更新的 source 时是否采用最新事实。
- `abstain_correctness`：资料未覆盖时是否拒绝编造。
