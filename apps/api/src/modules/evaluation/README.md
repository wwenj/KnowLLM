# Legacy evaluation source

这里保留旧版编译评测和 Agent 评测的完整实现，供后续迁移到 `llmWikiNext` Published revision 合同时重构。

当前状态：

- 不注册到 `AppModule`，不暴露评测 HTTP 路由。
- 后端源码暂时从 TypeScript 构建中排除，因为仍依赖已删除的旧 `LlmWikiModule` retrieval contract。
- 前端评测 API 和页面已注册路由及导航入口；后端接口在重构完成前仍不可用。
- 重构时应改为读取不可变 Published `revisionId`，不能继续读取旧 manifest/pageClaims/facts 合同。
