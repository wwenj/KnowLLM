# Third-party Vendor Risk Register

状态：current  
Owner：Mina Zhou  
更新时间：2026-06-03

## Vendor 概览

| Vendor | 用途 | 可见数据 | 限制 |
| --- | --- | --- | --- |
| DataScope | 地址校验、KYC、TACR 辅助 | 未脱敏街道地址、租户 ID | token TTL 20 分钟；EU endpoint 必须用 Frankfurt |
| ClearLedger | Polaris invoice total 对账 | invoice total、credit memo id、税务区域 | 不可见 raw support ticket content |
| PulseBridge | incident paging | incident id、服务名、严重等级 | 不可见客户 PII |

## 合规状态

- ClearLedger SOC2 有效期至 2026-11-30。
- DataScope EU endpoint 为 Frankfurt，适配 HelioMart 欧洲门店要求。
- PulseBridge 只能接收 incident metadata，不接收订单明细。

## 禁止项

ClearLedger 不能接收 raw event，也不能接收 raw support ticket content。DataScope 是唯一允许看到未脱敏街道地址的外部 vendor，但只能用于地址校验和 KYC。
