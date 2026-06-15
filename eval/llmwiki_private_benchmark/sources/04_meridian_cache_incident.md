# Meridian Cache Incident MIR-2026-0514

事件编号：MIR-2026-0514  
严重等级：SEV2  
Owner：Arman Li  
关闭日期：2026-05-16

## 摘要

2026-05-14 10:22 UTC，Meridian 在 HelioMart West 区域出现履约 ETA 过旧。根因是 release 2.8.3 调整配置优先级后，环境变量 `MERIDIAN_EDGE_TTL_SEC` 覆盖了租户级 TTL，把 edge cache TTL 从 90 秒改成 900 秒。

## 影响

- 影响租户：HelioMart。
- 影响区域：West。
- 受影响订单：1,842 单。
- 用户可见影响：ETA 晚更新，少量门店显示旧库存。
- 恢复时间：47 分钟。
- 没有触发 SEV1，因为履约承诺没有被实际延迟超过合同阈值。

## 修复

1. 回滚 release 2.8.3 的配置优先级变更。
2. 锁定 tenant TTL，不允许环境变量覆盖租户级配置。
3. 新增告警：`p95_cache_staleness_seconds > 180` 持续 3 分钟。
4. runbook 增加禁止全局 purge 的提醒。

## 后续行动

- 2026-05-20 前完成 TTL precedence 单测。
- 2026-05-23 前把 HelioMart West 加入 shadow replay 校验。
- Customer Success 向 HelioMart 提供 SLA credit 初步估算，但最终金额由 Polaris 月结确定。
