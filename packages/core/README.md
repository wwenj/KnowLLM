# KnowLLM Core

核心业务包，承载 source 管理、Wiki 编译、页面合并、检索、lint、Agent 查询等能力。

API、CLI、MCP 和 Worker 都应该复用这里的能力，避免各自实现一套逻辑。
