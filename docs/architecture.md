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
