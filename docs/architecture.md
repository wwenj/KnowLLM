# Architecture

KnowLLM 采用 monorepo 结构。

- `apps/web`：React 工作区。
- `apps/api`：NestJS API 服务。
- `packages/core`：通用知识库能力。
- `packages/protocol`：共享类型和协议。
- `packages/cli`：命令行入口。
- `packages/mcp-server`：MCP 接入。
- `packages/skill-templates`：Agent Skill 模板。
- `templates/workspace`：用户本地工作区模板。

## 服务端模块边界

`apps/api/src/modules/llmWikiNext` 负责当前知识库主链路：

- `LlmWikiNextService`：Source 管理、编译估算、Compile Pool、Staging 和 Published Wiki。
- `LlmWikiNextStore`：本地持久化、版本快照和发布产物读写。
- `LlmWikiNextToolsService`：为 Agent 和 HTTP Tools 提供 Published Wiki 的只读检索能力。

`apps/api/src/modules/agent` 负责 Agent 查询运行时。Agent 通过 `LlmWikiNextToolsService` 读取 Published Wiki，不直接读写 Store，也不修改 Staging。

当前 HTTP 路由分组：

- `/api/llm-wiki-next/*`：Source、Compile、Staging、Published Wiki 和只读 Tools。
- `/api/agents/*`：Agent 执行、取消和运行记录。
- `/api/models`：模型列表。
- `/api/health`：健康检查。

## 数据边界

当前 LLM Wiki 数据根为 `.knowllm/llm-wiki-next/default`。编译任务先写入共享 Staging；只有显式发布后，Agent 才能通过 Published Tools 读取新版本。

## 待重构评测

旧版编译评测和 Agent 评测源码仍保留在 `apps/api/src/modules/evaluation`、`apps/web/src/api/evaluation.ts`、`apps/web/src/pages/LlmWikiEvaluation` 和 `apps/web/src/pages/LlmWikiAgentEvaluation`。前端页面保留路由和导航入口；后端因依赖已删除的旧 Retrieval Contract，暂不注册并从当前 TypeScript 构建中隔离，等待迁移到 `llmWikiNext` Published revision 合同。
