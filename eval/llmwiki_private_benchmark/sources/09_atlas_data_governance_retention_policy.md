# Atlas Data Governance and Retention Policy

状态：current  
Owner：Mina Zhou  
更新时间：2026-06-02

## 默认保留期

| 数据类型 | 默认保留期 |
| --- | ---: |
| raw event | 180 天 |
| derived aggregate | 730 天 |
| audit log | 365 天 |
| masked ticket summary | 365 天 |
| raw support ticket content | 30 天，且不得用于训练 |

## 租户例外

- HelioMart audit log 保留 400 天，例外编号 SEC-017，有效期至 2026-12-31。
- RiverPet raw event 保留 90 天，例外编号 SEC-019。
- Solace Grocer 欧盟 PII 保留 30 天。

## 删除与隔离

客户删除请求必须在 7 个自然日内完成。删除前进入 quarantine bucket 的数据最多保留 14 天；超过 14 天必须自动清理。

## 训练限制

原始客服工单内容不得用于模型训练。脱敏后的工单摘要只能用于客服宏质量评估和检索质量评估，不能用于构建可识别个人身份的训练样本。
