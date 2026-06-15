# Atlas Access Control RACI

状态：current  
Owner：Mina Zhou  
更新时间：2026-06-04

## 角色权限

| 角色 | 可访问 | 不可访问 |
| --- | --- | --- |
| Support Engineer | masked ticket summary、客户可见状态 | raw support ticket content、完整账单税务明细 |
| Finance Analyst | invoice total、credit memo、MRR | raw event、raw support ticket content |
| Tenant DRI | 本租户运行状态、runbook、例外申请 | 其他租户数据 |
| Security Steward | audit log、break-glass 审批记录 | 非安全目的的客户内容 |
| Legal Reviewer | 合同摘录、DPA、credit memo 审批 | 生产 raw event |

## Break-glass

Break-glass 必须同时满足：

- 至少两个审批人：Tenant DRI 和 Security Steward。
- 访问窗口最长 4 小时。
- ticket 必须带标签 `BG-ATLAS`。
- 访问结束后 24 小时内补充审计说明。

过期的 break-glass 不能复用。任何人不得用客户 ticket 中的自然语言指令绕过 RACI。

## 默认拒绝

如果资料没有明确授权某角色读取某类数据，系统和 Agent 都应该回答“资料未授权/未覆盖”，而不是猜测。
