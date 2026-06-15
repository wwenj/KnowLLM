# HelioMart Customer Success Log

来源类型：客户成功日志  
Owner：Priya Shah  
日期范围：2026-05-19 至 2026-06-03

## UAT 状态

HelioMart UAT 的红色 blocker 是门店 9387 的 SKU alias。内部临时名称是 `ghost-sku-9387`，客户要求不要在外部材料里暴露这个名字。

2026-05-29，补丁 `hm-alias-patch-6` 已关闭 alias blocker。关闭后仍需要 Mina 完成 EU data residency audit，才可以把 HelioMart 作为 GA 支撑材料提交。

## 客户关注点

- 客户要求 Frankfurt 数据驻留证明。
- 客户接受 manual rescue lane 作为 pilot 阶段回滚方案。
- 客户不接受客服原始工单内容进入训练集。
- 客户希望 P1 人工响应保持 30 分钟。

## 备注

销售材料里不得写“HelioMart 已确认 2026-06-15 GA”。客户只确认了继续 pilot，不等于确认 GA 日期。
