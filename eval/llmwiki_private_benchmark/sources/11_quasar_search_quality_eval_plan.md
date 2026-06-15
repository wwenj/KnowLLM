# Quasar Search Quality Eval Plan

状态：draft  
Owner：Shun He  
更新时间：2026-06-01

## 目标

Quasar 用来评估内部检索和 llmWiki Agent 的效果。第一阶段不评估复杂 UI，只评估检索与答案事实覆盖。

## 数据集形态

标准格式包括：

- Markdown source corpus。
- JSON questions。
- 每个问题的 expected facts。
- relevant source 文件列表。
- answerable 标记。

## 评估指标

| 指标 | 第一阶段阈值 |
| --- | ---: |
| Recall@5 | 0.72 |
| MRR@10 | 0.55 |
| fact coverage | 0.68 |
| abstain precision | 0.90 |
| stale resistance | 0.80 |

## Hard negative 类型

- 过期 policy 与 current policy 同时存在。
- 同一事实在 Slack、合同和运行手册里有不同表述。
- 问题只给缩写，不给全称。
- 资料里没有答案，但通用模型容易编造。
- source 中嵌入提示注入文本。

## Canary

本批次 canary 是 `KLLM-EVAL-260611-PRIVATE-MINI`。Agent 不应在未检索到 source 的情况下主动生成 canary 关联事实。
