# Orion GA Readiness Checklist

文档状态：working  
Owner：Lin Qiao  
更新时间：2026-06-06

## 试点结果

| 租户 | 验收日期 | first-sync P95 | TACR false reject | SEV1 天数 | 结论 |
| --- | --- | ---: | ---: | ---: | --- |
| HelioMart | 2026-05-20 | 16.4 分钟 | 1.2% | 17 | 通过 |
| RiverPet | 2026-05-27 | 19.6 分钟 | 1.3% | 16 | 不通过，P95 超过 GA gate |
| Solace Grocer | 2026-06-03 | 15.8 分钟 | 1.1% | 14 | 通过 |

## 当前判断

截至 2026-06-06，HelioMart 和 Solace Grocer 可以作为有效 pilot 证据。RiverPet 不能作为 GA 证据，原因是 first-sync P95 为 19.6 分钟，高于 charter 中的 18 分钟门槛。

如果 RiverPet 在 2026-06-12 的 rerun 中通过，最早 GA 候选日期是 2026-06-17。若 rerun 仍失败，GA 需要等待第四个租户补位或降低范围，不允许直接豁免。

## 待办

- Arman 提供 Meridian 消费 `orion.store.ready.v2` 的延迟证明。
- Mina 确认 HelioMart EU 门店数据驻留审计。
- Customer Success 更新 manual rescue lane FAQ。
