# FarmBot Genesis v1.8 硬件手册评测集

这是一套用于 KnowLLM llmWiki 的小体量、高价值、知识内聚评测数据集。数据来自 FarmBot-Docs/farmbot-genesis，固定到 commit `44e0fa2`。

## 适配理由

- 领域：农业机器人硬件装配、维护、改装和故障排查手册
- 文档数：71 篇，满足 50 篇以上、100 篇以下。
- 形态：保留原始 Markdown 章节、列表、表格、配置片段、步骤、注意事项和引用，不整理成统一 QA 卡片。
- 事实：compile cases 以原文证据片段为 gold facts，Agent cases 以同一批 sources 派生。
- 许可：MIT，许可文本见 `LICENSE-MIT.txt`。

## 抽样与清洗

选择 v1.8 中清洗后英文词数不少于 150 的 Markdown，优先保留 assembly、extras/maintenance、extras/mods、extras/reference、extras/troubleshooting 和少量信息较完整的 BOM 页面；排除空目录页和短零件卡片。

长度统计按清理代码块和图片引用后的正文估算：最短 158 英文词元，最长 2396 英文词元，平均 481 英文词元。数据集中保留了长短混合，避免全部整理成统一模板。

## 丢弃的候选/内容

- FarmBot 旧版本目录未混入本数据集，避免同一手册跨版本重复。
- v1.8 中大量极短 BOM 零件卡片被排除，避免 source 退化成统一模板规格卡。

## 文件说明

- `sources/`：原始 Markdown source，共 71 篇。
- `source_manifest.json`：来源、license、commit、原始路径、sha256 和抽样规则。
- `compile_cases.json`：45 个编译事实保留 case。
- `agent_cases.json`：32 个 Agent case，其中包含 2 个拒答 case。
- `upload_compile_dataset.json`：便于现有上传/编译流程一次性读取 sources 的辅助 JSON。
