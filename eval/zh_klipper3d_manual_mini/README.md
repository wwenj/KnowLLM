# Klipper 3D 打印机中文手册评测集

这是一套用于 KnowLLM llmWiki 的小体量、高价值、知识内聚评测数据集。数据来自 Klipper3d/klipper-translations，固定到 commit `ccb363e`。

## 适配理由

- 领域：3D 打印机固件安装、配置、校准、排障和参考手册
- 文档数：51 篇，满足 50 篇以上、100 篇以下。
- 形态：保留原始 Markdown 章节、列表、表格、配置片段、步骤、注意事项和引用，不整理成统一 QA 卡片。
- 事实：compile cases 以原文证据片段为 gold facts，Agent cases 以同一批 sources 派生。
- 许可：GPL-3.0，许可文本见 `LICENSE-GPL-3.0.txt`。

## 抽样与清洗

选择 docs/locales/zh_Hans 下简体中文 Markdown 中中文字符数不少于 200 的自然文档，排除 README、index、导航、空翻译和明显过短页面。

长度统计按清理代码块和图片引用后的正文估算：最短 210 中文字符，最长 6488 中文字符，平均 2122 中文字符。数据集中保留了长短混合，避免全部整理成统一模板。

## 丢弃的候选/内容

- PX4 中文文档被丢弃：899 篇 zh Markdown 中，满足中文字符数与中文占比的页面只有 2 篇。
- QGroundControl 中文文档被丢弃：84 篇 zh Markdown 中，绝大多数实际为空翻译或英文内容。

## 文件说明

- `sources/`：原始 Markdown source，共 51 篇。
- `source_manifest.json`：来源、license、commit、原始路径、sha256 和抽样规则。
- `compile_cases.json`：40 个编译事实保留 case。
- `agent_cases.json`：32 个 Agent case，其中包含 2 个拒答 case。
- `upload_compile_dataset.json`：便于现有上传/编译流程一次性读取 sources 的辅助 JSON。
