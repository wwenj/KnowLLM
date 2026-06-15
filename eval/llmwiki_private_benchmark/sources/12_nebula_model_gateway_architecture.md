# Nebula Model Gateway Architecture

状态：approved  
Owner：Omar Xu  
版本：2026-05-28

## 目标

Nebula 是客服宏、工单摘要和内部检索问答的模型网关。它负责模型路由、PII 脱敏、缓存、审计和租户级策略。

## 模型路由

- 分类任务默认走 `comet-lite-2026-05`。
- 答案合成任务默认走 `aurora-main-2026-05`。
- 高风险客户问题必须打开 raw source review。
- 未签 DPA 的租户不得使用会离开本区域的外部模型。

## 缓存

默认缓存 key 包含：

1. model id。
2. tenant id。
3. prompt hash。
4. redaction version。
5. source policy。

架构文档里的默认缓存 TTL 是 6 小时。后续 rollout update 可以对特定流程覆盖该值。

## 脱敏

Nebula redaction v2 会移除姓名、邮箱、电话号码和完整街道地址。原始客服工单内容只允许在租户区域内短期处理，不允许进入模型训练。

## 审计

每次答案合成都必须记录 model id、redaction version、source ids、tenant id 和 request hash。
