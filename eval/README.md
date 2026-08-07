# KnowLLM llmWiki 评测数据

本目录只保存可复核的评测数据、来源材料和校验工具，不保存运行结果。

当前评测链路：

```text
原始 Source -> Wiki 编译质量评测 -> Published Wiki -> Agent 检索回答评测
```

运行结果统一写入 `.knowllm/evaluations/`，不写回本目录。

## 目录结构

```text
eval/
├── README.md
├── tools/
│   └── validate_llmwiki_dataset.mjs
├── zh_klipper3d_manual_mini/
│   ├── README.md
│   ├── LICENSE-GPL-3.0.txt
│   ├── source_manifest.json
│   ├── compile_cases.json
│   ├── agent_cases.json
│   ├── validate_agent_cases.mjs
│   └── sources/
└── farmbot_genesis_v18_manual_mini/
    ├── README.md
    ├── LICENSE-MIT.txt
    ├── source_manifest.json
    ├── compile_cases.json
    ├── agent_cases.json
    └── sources/
```

## 数据集状态

### `zh_klipper3d_manual_mini`

当前标准评测集。

- 51 篇 Klipper 中文手册 Source。
- `source_manifest.json` 保存来源、commit、license、文件路径和 SHA-256。
- `compile_cases.json` 保存编译质量 Gold Facts。
- `agent_cases.json` 是 Agent Evaluation V2 的内置数据，绑定 Published Revision `Xgi4wdAIWgvMEbe4`。
- Agent 数据包含 30 道题、78 条 Required Facts，每条事实绑定 Published 页面 `pageKey + quote`。
- `validate_agent_cases.mjs` 校验当前 Published Revision 与全部 Gold Quote。

后端当前只会读取：

```text
eval/zh_klipper3d_manual_mini/agent_cases.json
```

### `farmbot_genesis_v18_manual_mini`

保留的参考数据集，不是当前可运行的标准评测集。

- 71 篇 FarmBot Genesis v1.8 英文手册 Source。
- 保留 manifest、compile cases、旧 Agent cases 和 License，供后续迁移或扩展评测集时参考。
- 当前 Agent cases 仍是旧 Schema，没有绑定 Published Revision，不能直接用于 Agent Evaluation V2。
- 当前综合校验规则不会通过该数据集；使用前必须重新编译 Wiki，并按 V2 结构重做 `agent_cases.json`。

## 文件职责

### `sources/*.md`

冻结的原始资料，是编译评测的 Source of Truth。Agent V2 不直接读取这些文件。

### `source_manifest.json`

记录数据集来源、固定 commit、license、文件名、原始路径和 SHA-256，用于确认 Source 没有漂移。

### `compile_cases.json`

编译质量标准答案。每条 Gold Fact 都应包含原子事实、原文证据、事实类型和重要级别。

当前编译评测迁移代码尚未注册到 `AppModule`，但后续重构仍需要这些数据，因此保留。

### `agent_cases.json`

Agent 检索回答标准答案。

当前 V2 只支持 Klipper 数据集，核心字段为：

```text
revisionId
question
expectedAnswer
requiredFacts[].fact
requiredFacts[].evidence.pageKey
requiredFacts[].evidence.quote
```

### License

公开数据集的许可证原文必须与数据一起保留。

## 校验

校验 Klipper Source、manifest、compile cases 和 Agent V2 Published 证据：

```bash
node eval/tools/validate_llmwiki_dataset.mjs eval/zh_klipper3d_manual_mini
```

只校验当前 Agent V2 内置数据：

```bash
pnpm --filter @knowllm/api validate:agent-evaluation-data
```

## 维护约束

- 不再保存把全部 Source 正文重复展开的 `upload_compile_dataset.json`。
- 不使用生成脚本直接覆盖人工维护的 Gold Cases。
- 修改 Klipper `agent_cases.json` 后必须重新运行两项校验。
- Published Revision 变化后，必须重新核对所有 `pageKey + quote`，不能只修改 `revisionId`。
- FarmBot 在完成 V2 迁移前只能作为参考资料，不能显示为可运行评测集。
