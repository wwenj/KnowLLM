# Misfiled Salesforce Note: RP-East and Solace

来源类型：CRM 备注  
原路径：HubSpot / Salesforce import / misc  
更新时间：2026-06-08

## RiverPet RP-East 备注

销售在 RP-East 会议中提出是否可以把 Orion first-sync P95 gate 放宽到 22 分钟。产品和工程在 2026-06-08 拒绝该例外，理由是 charter 没有修订，且放宽会让 RiverPet 的数据不能作为 GA 证据。

结论：RiverPet 仍必须满足 18 分钟 P95，不能用 22 分钟作为 GA gate。

## Solace Grocer 备注

Solace Grocer 仍处于试用期。Polaris 不应对 Solace 的 replay event 计费。若账单预览出现 replay event 行，应作为 billing bug 处理。

## 归档问题

这份备注误归档在 Salesforce import 目录下，不是销售承诺，也不是合同条款。它只记录产品对例外申请的回复。
