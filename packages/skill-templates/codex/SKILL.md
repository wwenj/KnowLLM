---
name: knowllm
description: Query a local KnowLLM LLM Wiki workspace through the KnowLLM CLI.
---

# KnowLLM Skill

Use this skill when the user asks about knowledge that may already exist in the local KnowLLM workspace.

## Query

Use the local CLI:

```bash
knowllm query "<question>" --json
```

## Search

Use search when the user needs candidate pages rather than a synthesized answer:

```bash
knowllm search "<query>" --json
```

## Rules

- Prefer `knowllm query` for user-facing answers.
- Prefer `knowllm search` when you need to inspect relevant Wiki pages.
- Do not invent knowledge that is not returned by KnowLLM.
- If KnowLLM returns insufficient evidence, say the local Wiki does not contain enough information.
