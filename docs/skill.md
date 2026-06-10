# Skill

KnowLLM Skill 用来告诉 Codex、Claude Code、Cursor 等工具如何查询本地 Wiki。

Skill 不直接实现知识检索，而是调用：

```bash
knowllm query "<question>" --json
```
