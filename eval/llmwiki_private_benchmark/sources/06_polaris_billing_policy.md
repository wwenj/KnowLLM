# Polaris Billing and SLA Policy

状态：current  
Owner：Rhea Tan  
更新时间：2026-05-30

## 月结流程

Polaris 每月 T+2 18:00 UTC 进入 invoice freeze。freeze 后只允许 legal-approved credit memo，不允许客户成功经理直接修改账单金额。

## 计费项

| 项目 | 是否计费 | 税务规则 |
| --- | --- | --- |
| subscription platform fee | 计费 | 对 NorthPier NP-12 免税 |
| per-order automation fee | 计费 | 普通租户应税，NP-12 免税 |
| replay event | 生产租户内部校验不计费；Beta 和试用租户不计费 | 不生成税务行 |
| manual rescue lane | 不单独计费 | 不生成税务行 |

## SLA credit

SLA credit 的临时估算公式：

`credit_usd = affected_order_count * 0.08`

但最终 credit 不能超过该租户当月 MRR 的 12%。如果事故没有超过合同定义的履约承诺阈值，只能作为 goodwill credit 候选，不自动入账。

## 特殊租户

- Solace Grocer 仍处于试用期，replay event 不计费。
- HelioMart pilot 期间平台费折扣由合同 addendum 决定，不在本政策里重复定义。
- RiverPet 的 Orion rerun 不得产生 replay charge。
