# llmWiki 评测数据集设计标准

本文档用于统一 KnowLLM 当前项目中 llmWiki 评测数据集的设计口径。目标不是做大规模开放域检索 benchmark，而是评估 llmWiki 在小体量、高价值、知识内聚场景下的编译质量和 Agent 检索回答质量。

## 1. 评测目标

llmWiki 的定位不是通用搜索引擎，也不是海量文档向量库。它更适合：

- 资料规模较小，通常不超过 100 篇 source。
- 知识领域内聚，例如一个产品手册、一套内部政策、一组法律案例、一批项目文档。
- 文档之间存在实体、术语、版本、约束、流程或上下游关系。
- 更关注事实准确性和证据可追溯，而不是泛化召回。

因此评测重点不是“能不能在十万篇资料里搜到相关文档”，而是：

```text
原始高价值资料是否被正确编译成 Wiki
Agent 是否能基于这份 Wiki 找到证据并正确回答
```

## 2. 基本目录结构

每套评测数据建议使用以下结构：

```text
eval/<dataset_id>/
  README.md
  sources/
    xxx.md
    yyy.md
  source_manifest.json
  compile_cases.json
  agent_cases.json
```

其中：

- `sources/` 是唯一的原始文档集合。
- `compile_cases.json` 只服务编译结果评测。
- `agent_cases.json` 只服务 Agent 检索和回答评测。
- `source_manifest.json` 记录来源、license、原始路径、sha256、抽样规则等元信息。

原则上第一版应该是一套 sources，同时派生两类 cases，而不是编译评测和 Agent 评测各用一套完全不同的 source。这样才能定位问题来自编译、检索还是 Agent 回答。

## 3. Source 文档要求

### 3.1 合格 source 的特征

source 应尽量接近真实人写文档，而不是为了评测临时生成的标准答案卡片。合格文档通常具备：

- 篇幅适中，建议单篇 800-8000 中文字符或等价长度。
- 结构不完全一致，有自然的人写痕迹。
- 包含段落、列表、表格、步骤、注意事项、配置片段、例外说明等混合形态。
- 领域内聚，同一批文档围绕同一产品、项目、流程或专业主题。
- 有明确事实点，例如实体、数值、日期、版本、阈值、规则、条件、例外、禁止项。
- 存在一定真实复杂度，例如新旧版本、术语别名、局部例外、废弃规则、跨文档引用。
- 尽量不是通用模型训练中极常见的百科常识。

适合的来源示例：

- 产品手册，例如数据库、工业软件、设备控制系统、开发工具的用户文档。
- 运维 runbook、故障排查手册、配置参考。
- 法律案例、裁判文书、合规条款。
- 领域技术规范、工程实践文档。
- 项目章程、会议纪要、变更记录、发布说明、客户支持记录。

### 3.2 不合格 source 的特征

以下数据不适合作为正式 llmWiki 编译评测主集：

- 每篇都是同一个模板，例如固定的“问题/答案/来源/标签”结构。
- 单篇太短，只有一问一答或一小段说明。
- 纯 QA 数据，每条样本只是 `instruction -> output`。
- 文档之间完全不相关，只是随机百科段落集合。
- 所有事实都是常见公开知识，模型可能不检索也能答出。
- 没有 license 或来源不可追溯。
- 只适合检索，不包含可拆解的 expected facts。

例如，单条 QA 卡片：

```text
问题：水平井设计原则是什么？
答案：水平井应平行于最小水平地应力方向。
```

这类数据可以作为 Agent 问答样本，但不适合作为正式 source。正式 source 更应该是完整章节、操作手册、配置说明或案例文书。

## 4. `compile_cases.json` 设计

编译评测关心的是：

```text
source 编译成 Wiki 后，关键事实有没有被正确保留
```

它不是问答评测，因此不需要 `question` 和 `expectedAnswer`。

推荐结构：

```json
{
  "datasetId": "zh_klipper3d_manual_mini",
  "name": "Klipper 3D 打印机中文手册编译评测",
  "sourceDir": "sources",
  "cases": [
    {
      "id": "C001",
      "name": "打印床调平关键事实保留",
      "sourceFiles": ["03-打印床调平.md"],
      "expectedFacts": [
        {
          "id": "C001-F01",
          "fact": "打印床调平文档要求先完成基础配置检查",
          "sourceFile": "03-打印床调平.md",
          "evidence": "在执行本指南前需要先完成基础配置检查。",
          "type": "procedure",
          "importance": "must"
        }
      ]
    }
  ]
}
```

字段说明：

| 字段 | 说明 |
|---|---|
| `id` | case 或 fact 的稳定 ID |
| `name` | 人类可读名称 |
| `sourceFiles` | 该 case 依赖的原始 source |
| `expectedFacts` | 编译后 Wiki 必须保留的事实 |
| `fact` | 原子事实，必须可判断 |
| `sourceFile` | 事实来自哪个 source |
| `evidence` | 原文证据片段，便于人工复核 |
| `type` | 事实类型，如 `definition`、`config`、`limit`、`procedure`、`exception`、`conflict_resolution` |
| `importance` | 可选，`must` / `should` / `nice` |

`expectedFacts` 要尽量原子化。一条 fact 只表达一个判断。

好例子：

```text
BLTouch 探针校准前需要确认探针可以成功部署和收回
```

差例子：

```text
探针校准说明正确
```

## 5. `agent_cases.json` 设计

Agent 评测关心的是：

```text
Agent 能否根据用户问题找到正确证据，并生成被证据支持的答案
```

推荐结构：

```json
{
  "datasetId": "zh_klipper3d_manual_mini",
  "name": "Klipper 3D 打印机中文手册 Agent 评测",
  "sourceDir": "sources",
  "cases": [
    {
      "id": "A001",
      "question": "Klipper 的打印床调平流程开始前，需要先完成什么检查？",
      "answerable": true,
      "expectedAnswer": "需要先完成基础配置检查，再执行打印床调平指南。",
      "expectedFacts": [
        "打印床调平文档要求先完成基础配置检查"
      ],
      "relevantSources": ["03-打印床调平.md"],
      "mustInclude": ["打印床调平", "基础配置检查"],
      "evaluationType": "single_doc_fact"
    }
  ]
}
```

字段说明：

| 字段 | 说明 |
|---|---|
| `question` | 用户真实可能问法 |
| `answerable` | 当前 sources 是否足以回答 |
| `expectedAnswer` | 标准参考答案 |
| `expectedFacts` | 回答必须覆盖的事实点 |
| `relevantSources` | 应命中的 source |
| `mustInclude` | 简单关键词校验 |
| `evaluationType` | 单文档、多文档、配置查询、故障排查、拒答、冲突消解等 |

`answerable=false` 只建议放在 Agent 评测，不建议放在编译评测。因为编译评测的目标是事实保留，不是测试拒答。

## 6. 编译评测流程

编译评测必须和编译过程分离。

标准流程：

```text
1. 评测人员先通过现有 llmWiki 管理页面上传并编译 sources
2. 评测模块读取 compile_cases.json
3. 对 source 文件内容计算 SHA256
4. 用 SHA256 匹配当前已编译完成的 llmWiki source
5. 只读取匹配 source 关联的最终 Wiki 页面
6. 使用 LLM Judge 判断 expectedFacts 是否被 Wiki 正确保留
7. 输出 correct / missing / incorrect
```

评测模块不能：

- 上传 source。
- 触发 ingest。
- 修改当前 llmWiki。
- 重写 Wiki 页面。

评测模块只能写：

```text
.knowllm/evaluations/...
```

即独立评测数据和运行报告。

## 7. Agent 评测流程

Agent 评测在编译完成之后执行。

标准流程：

```text
1. 读取 agent_cases.json
2. 对每个 case 调用当前 llmWiki Agent
3. 记录 Agent 检索轨迹、读取页面、读取 source、最终答案
4. 判断 relevantSources 是否命中
5. 判断 expectedFacts 是否被答案覆盖
6. 判断答案是否被证据支持
7. 对 answerable=false 的问题判断是否正确拒答
```

核心指标：

- `source_hit`：是否命中应检索 source。
- `fact_coverage`：答案是否覆盖 expectedFacts。
- `faithfulness`：答案是否被检索到的 Wiki/source 支持。
- `answer_correctness`：最终回答是否正确。
- `abstain_correctness`：资料不足时是否拒答。
- `trajectory_efficiency`：检索轮数、无效页面数、模型调用量。

## 8. LLM Judge 的角色

LLM Judge 不是评测标准本身，只是语义判卷器。

评测标准来自人工或数据集标注的 Gold Facts：

```text
expectedFacts + evidence + relevantSources
```

LLM Judge 只负责判断：

```text
最终 Wiki 或 Agent 答案是否语义上支持某条 expectedFact
```

为了降低不确定性：

- Judge 使用固定模型。
- `temperature = 0`。
- 输出强制 JSON。
- 状态只能是 `correct`、`missing`、`incorrect`。
- 必须返回证据页面、证据片段和原因。
- 评测结果需要支持人工抽查。

不能把 LLM Judge 分数理解为绝对真理。更严谨的做法是抽样人工复核 Judge 输出，统计 Judge 与人工的一致率。

## 9. 数据源选择标准

### 9.1 优先级

优先选择：

- 公开可获取。
- license 明确。
- 领域足够窄。
- 文档由人写成，而不是生成式 QA。
- 单篇文档有足够长度和结构复杂度。
- 有稳定原始路径或版本。
- 通用模型不容易完全凭训练记忆回答。

### 9.2 可接受数据源

较适合：

- Klipper 3D 打印机固件中文手册。
- FarmBot Genesis 农业机器人硬件装配、维护、排障手册。
- 设备维修手册、机器操作手册、硬件校准和故障排查手册。
- 偏内部的运维 runbook、事故处理指南、现场操作规程。
- LeCaRDv2 法律案例文书。
- 真实产品的配置、运维、故障排查文档，前提是领域足够窄且不是基础模型高频训练材料。

谨慎使用：

- CAIL2018：结构化标签好用，但 license 标注不明确。
- CMRC2018 / DRCD：适合单文档阅读理解，不适合主 llmWiki 场景。
- DuReader：问题真实，但文档噪声大且主题发散。

不建议作为主 source：

- 纯 QA 数据集。
- instruction tuning 数据。
- 一问一答卡片。
- 随机百科段落集合。

## 10. 数据集验收清单

一套正式数据集进入评测前，应满足：

- `sources/*.md` 数量不超过 100。
- 每篇 source 不是统一模板卡片。
- 每篇 source 建议至少 800 字，短配置文件除外。
- source 之间属于同一知识域。
- 至少 70% source 能派生 2 条以上 expectedFacts。
- `compile_cases.json` 中每个 fact 都有 `evidence`。
- `agent_cases.json` 中每个 answerable case 都有 `relevantSources`。
- 所有 source 引用都能找到对应 md。
- `source_manifest.json` 记录原始来源和 license。
- 数据集中包含一定比例的多文档、配置、流程、例外、冲突或版本变化场景。
- 随机抽查 10 个 fact，人工能在原文中找到证据。

## 11. 当前项目注意事项

历史临时数据集已经移除。后续评测数据应按本文档重新整理，不再依赖内置默认 benchmark。

临时生成的 QA 卡片类数据，例如一条问题配一条标准答案的 `sources/*.md`，不应作为正式主评测集。它可以辅助 Agent 问答 smoke test，但不足以评估 llmWiki 编译能力。

后续正式公开数据集建议优先从真实产品文档中抽样，例如设备/机器手册、硬件校准文档、维修指南、内部 runbook。抽样时应保留原始 Markdown 的自然结构，不要统一改造成标准 QA 模板。
