# Architecture

KnowLLM 采用 monorepo 结构。

- `apps/web`：React 工作区。
- `apps/api`：Node API 服务。
- `packages/core`：核心编译、检索和知识库能力。
- `packages/protocol`：共享类型和协议。
- `packages/cli`：命令行入口。
- `packages/mcp-server`：MCP 接入。
- `packages/skill-templates`：Agent Skill 模板。
- `templates/workspace`：用户本地工作区模板。

## 服务端模块边界

`apps/api/src/modules/llmWiki` 负责知识库自身能力：

- `LlmWikiManagementService`：Source、Schema、页面、Lint 和 Issue 管理。
- `LlmWikiIngestService`：执行 Source 编译与融合。
- `LlmWikiRetrievalService`：对外提供稳定只读检索契约，包括 manifest、search、read page 和 read source。

`apps/api/src/modules/agent` 负责 Agent 查询运行时。LLM Wiki Agent 只能通过内部
`LlmWikiAgentTools` 调用 `LlmWikiRetrievalService`，不得直接依赖 Store、Search、
Schema 或编译服务。

当前 HTTP 路由分组：

- `/api/llm-wiki/manage/*`：知识库管理和写操作。
- `/api/llm-wiki/retrieval/*`：标准只读检索能力。
- `/api/agents/llmWiki/*`：完整 Agent Query 执行与运行记录。

CLI、MCP 和其他 Agent 后续应复用 Retrieval Contract，不重复实现检索逻辑。
