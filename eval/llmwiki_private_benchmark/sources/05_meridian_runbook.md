# Meridian ETA Cache Runbook

状态：current  
Owner：Arman Li  
更新时间：2026-05-24

## 正常阈值

- edge cache TTL：默认 90 秒。
- 最大可接受 staleness：120 秒。
- 告警阈值：`p95_cache_staleness_seconds > 180` 持续 3 分钟。
- 紧急暂停 ETA 自动承诺的最长时间：15 分钟。

## 排障步骤

1. 查看 `/health/cache-delta`，确认 delta worker backlog 是否超过 5,000。
2. 若只有单租户异常，先执行租户级 purge，禁止执行 global purge。
3. 切换 `eta_shadow_only=true`，让 Meridian 只计算不承诺。
4. drain 受影响区域的 delta worker。
5. 用 replay sample 对比 inventory snapshot 和 ETA 输出。
6. 恢复前必须确认 p95 staleness 连续 5 分钟小于 120 秒。

## 回滚顺序

1. 回滚最近的 config precedence 变更。
2. 清理受影响租户 edge cache。
3. 恢复 delta worker。
4. 关闭 shadow-only。

## 禁止项

- 不允许为了快速止血执行 global purge。
- 不允许把环境变量 TTL 当成租户级 TTL 的上级配置。
- 不允许用 replay event 直接生成 Polaris 收费项目。
