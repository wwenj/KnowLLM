# Legacy evaluation source

这里仅保留旧版编译评测迁移代码。Agent 评测已迁移到独立的 `agentEvaluation` 模块。

当前状态：

- 不注册到 `AppModule`，不暴露评测 HTTP 路由。
- 后端源码暂时从 TypeScript 构建中排除，因为仍依赖已删除的旧 `LlmWikiModule` retrieval contract。
- 编译评测后续迁移时应改为读取不可变 Published `revisionId`，不能继续读取旧 manifest/pageClaims/facts 合同。
