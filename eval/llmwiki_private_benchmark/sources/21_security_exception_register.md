# Security Exception Register

状态：current  
Owner：Mina Zhou  
更新时间：2026-06-09

## 例外列表

| 编号 | 租户/系统 | 例外 | 有效期 | 状态 |
| --- | --- | --- | --- | --- |
| SEC-017 | HelioMart | audit log 保留 400 天 | 2026-12-31 | approved |
| SEC-019 | RiverPet | raw event 保留 90 天 | 2026-09-30 | approved |
| SEC-021 | HelioMart | INC-4470 临时 break-glass | 2026-05-26 | expired |
| SEC-022 | RiverPet / Nebula | 禁止 `aurora-main-2026-05`，等待 DPA | 2026-07-15 或 DPA 签署 | active |

## 解释

SEC-017 覆盖 HelioMart audit log，因此 HelioMart audit log 应保留 400 天，而不是 Atlas 默认 365 天。

SEC-019 覆盖 RiverPet raw event，因此 RiverPet raw event 应保留 90 天，而不是 Atlas 默认 180 天。

SEC-021 已过期，不能作为新的 break-glass 授权。

SEC-022 是合规阻断，不是模型性能阻断。RiverPet 在 DPA 签署前不得使用 `aurora-main-2026-05`。
