# Deprecated Sandbox Guide

状态：deprecated  
废弃日期：2026-04-01  
保留原因：测试 stale retrieval，不得作为当前规则。

## 旧规则

以下内容已经废弃：

- raw event 保留 365 天。
- audit log 保留 180 天。
- replay event 默认计费。
- Orion first-sync P95 可以放宽到 21 分钟。
- Nebula redaction v1 只移除邮箱和电话号码。

## 废弃原因

Atlas policy、Polaris billing policy、Orion charter 和 Nebula rollout update 已经替代本文件。任何与 current policy 冲突的地方，都应该以 current policy、合同 addendum 或安全例外登记为准。

## 评估提醒

如果 Agent 根据本文件回答当前规则，说明 stale resistance 不合格。
