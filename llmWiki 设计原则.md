# llmWiki 设计原则

## 核心判断

llmWiki 的本质不是更复杂的检索系统，而是一个由 LLM 维护的语义 Wiki。

它的目标是让 LLM 在编译期读懂原始资料，把理解后的知识沉淀成稳定、可维护、可被人和 Agent 阅读的 Markdown Wiki。查询时，Agent 应优先读取 Wiki，而不是重新从 raw source、chunk 或 fact 中临时拼答案。

## 不变原则

1. 编译优先，不是查询时重做理解。

   source 加入系统时就应该被阅读、总结、组织、链接、核对。后续查询应该复用这次理解，而不是每次重新召回碎片再合成。

2. Wiki 页面是语义单元，不是 chunk 容器。

   页面必须表达一个可阅读的概念、对象、参考、流程、变更或排障主题。页面不是 facts 的机械列表，也不是 evidence dump。

3. LLM 是知识维护者，不是搜索包装器。

   LLM 的主要职责是维护 Wiki：写页面、合并旧知识、建立链接、发现冲突、保持一致性。检索只是入口，不是系统核心。

4. raw source 是证据层，Wiki 是知识层。

   raw source 保持原始、可追溯；Wiki 承载被理解后的知识。回答默认基于 Wiki，需要核验时再回到 raw source。

5. 知识要累积，而不是一次性问答。

   每次 ingest、修正、冲突处理和高质量查询结果，都应该让 Wiki 变得更完整。系统价值来自长期维护后的复利。

6. 链接表达理解。

   页面之间的链接不是装饰，也不是图谱噱头，而是 LLM 对概念、实体、流程和来源关系的显式组织。

7. 结构服务语义。

   `summary`、`concept`、`entity`、`reference`、`procedure`、`changelog`、`troubleshooting` 等页面类型，是为了让知识更符合人类和 Agent 的阅读方式，不是为了制造更细的检索粒度。

8. 质量门禁保护 Wiki，不替代 Wiki。

   facts、claims、source span、lint、publish gate 是编译质量控制和可追溯机制。它们是账本，不应该成为主要的知识阅读界面。

9. Agent 读 Wiki，而不是读账本。

   Agent 的默认检索路径应是 manifest、搜索语义页面、读取页面、沿链接扩展、必要时核验 source。fact ledger 可以用于评测、审计和调试，但不应变成主检索范式。

10. 少做检索花活，多做知识维护。

    llmWiki 的优势不在于更细的召回、更复杂的 rerank 或更多检索工具，而在于把维护、综合、链接、冲突处理这些人类难以持续完成的工作交给 LLM。

## 明确非目标

- 不把 llmWiki 做成传统 RAG 的变体。
- 不以 chunk、embedding、rerank、fact hit 作为核心抽象。
- 不为了评测分数牺牲 Wiki 的可读性和语义完整性。
- 不让用户人工处理结构性问题。
- 不把 facts 列表直接发布成正式 Wiki 页面。
- 不让 Agent 在查询时承担本该由编译器完成的跨文档语义理解。

## 工程边界

- 编译器负责语义理解、页面组织、事实覆盖和发布门禁。
- Wiki 页面负责承载可阅读、可复用的知识。
- page-claims 负责记录页面覆盖了哪些事实。
- facts 负责质量追踪、评测和回溯。
- Agent 负责读取 Wiki、综合回答、在必要时核验 source。

## 设计校验问题

任何新功能都必须先回答：

1. 它是在增强编译期的语义理解，还是把理解压力推迟到查询期？
2. 它是在让 Wiki 页面更可读，还是把页面变成更细的索引/账本？
3. 它是在减少人类维护成本，还是制造新的人工检查工作？
4. 它是在让知识长期累积，还是只是在优化一次检索命中？
5. 它是否让 Agent 更依赖 Wiki，而不是更依赖 raw source 或碎片召回？

如果答案偏向后者，就说明方向可能已经跑偏。

## 调研依据

- [Andrej Karpathy 原始 LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)：LLM Wiki 是一种 pattern，核心是让 LLM 增量维护持久化、互联的 Markdown Wiki，而不是查询时从 raw documents 重新做 RAG。
- [DAIR.AI: LLM Knowledge Bases](https://academy.dair.ai/blog/llm-knowledge-bases-karpathy)：LLM 被当作 compiler，读取 raw source 并产出结构化、互联 Wiki；个人规模下不依赖复杂向量库。
- [Hermes Agent: Karpathy's LLM Wiki skill](https://hermes-agent.nousresearch.com/docs/user-guide/skills/bundled/research/research-llm-wiki)：强调 Wiki 会预先编译知识、维护交叉引用、标记矛盾，查询时读取已综合的 Wiki。
- [LLM Wiki v2 社区扩展](https://gist.github.com/rohitg00/2067ab416f7bbe447c1977edaaa681e2)：社区讨论把重点放在生命周期、结构、自动维护和质量控制，而不是把检索复杂化。
- [Enterprise LLM Wiki 讨论](https://falconer.com/guides/enterprise-llm-wiki-karpathy/)：企业化扩展仍强调 capture、link、compound、stay current，核心是维护循环，不是更聪明地搜索坏上下文。
