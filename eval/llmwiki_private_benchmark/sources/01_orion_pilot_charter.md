# Orion Pilot Charter

文档状态：approved  
Owner：Lin Qiao  
版本：2026-05-18

## 项目目标

Orion 的目标是把新连锁客户门店上线周期从平均 11 天压缩到 3 天以内。项目只覆盖 onboarding、地址校验、税务地址交叉校验（TACR）、首轮库存同步和失败回滚，不覆盖长期库存预测。

## 范围

Orion pilot 范围包括：

1. MOP 中的门店资料导入。
2. TACR v3 地址校验。
3. 首轮库存 first-sync。
4. 异常门店进入 manual rescue lane。
5. 事件 `orion.store.ready.v2` 发往 Meridian 和 Polaris。

不在范围内：

- Aquila 预测补货。
- 客户自定义税务模型训练。
- 对客服原始工单内容做模型训练。

## GA gate

Orion 从 pilot 进入 GA 必须同时满足：

- 至少 3 个租户完成试点验收。
- first-sync P95 小于 18 分钟。
- TACR false reject rate 小于 1.5%。
- 连续 14 天无 SEV1。
- runbook、回滚剧本和客户成功 FAQ 全部签字。

如果任一租户未达标，该租户不得作为 GA 证据；其他租户可以保留 pilot 结果，但不能单独触发 GA。

## 风险

RiverPet 的地址格式存在楼层、门牌、宠物医院合并地址等噪声，TACR v3 对该租户的 false reject 风险最高。HelioMart 的风险主要在欧洲数据驻留和门店 9387 的 SKU alias。
