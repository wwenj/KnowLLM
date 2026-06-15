# Nebula Limited Rollout Update

状态：current  
Owner：Omar Xu  
更新时间：2026-06-05

## 变更摘要

Nebula limited rollout 从 2026-06-05 起应用以下覆盖规则：

- P1 support flow 的 cache TTL 从 6 小时改为 2 小时。
- 其他低风险客服宏仍使用 6 小时 TTL。
- redaction version 从 v2 升级到 v3。
- RiverPet 在 DPA 签署前禁止使用 `aurora-main-2026-05`。
- HelioMart 可以使用 `aurora-main-2026-05`，但必须保留 Frankfurt data residency 审计记录。

## v3 脱敏差异

redaction v3 额外移除门店联系人姓名、工单附件中的 EXIF 位置和未脱敏街道门牌。v3 不会删除租户 ID，因为租户 ID 是审计必要字段。

## 运营提醒

如果用户问 P1 support flow 的 TTL，应回答 2 小时。如果问题没有限定 P1 support flow，则默认 TTL 仍是 6 小时。

RiverPet 的模型限制不是性能问题，而是 DPA 未签署导致的合规限制。
