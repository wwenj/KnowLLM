# 前后端执行流程与产品边界审计

审计日期：2026-06-15

## 1. 结论

当前产品面已收敛为：

```text
LLM Wiki Source 管理与编译
+ Wiki 浏览、编辑、搜索与诊断
+ 独立 LLM Wiki Agent 调试与运行历史
+ 本地文件持久化
```

Session、基础 Chat、LLM Wiki Chat Tool、前端 `/chat`、Session REST、Session WebSocket 和本地 Session 数据均已删除。

`ModelService.chat()` 和上游 `/chat/completions` 仍保留，因为它们是 compiler、fusion 和 llmWiki Agent 使用的模型调用协议，不是产品 Chat 模块。

## 2. 当前真实架构

| 模块 | 入口 | 当前行为 |
| --- | --- | --- |
| Web | `/llm-wiki`、`/agents` | REST 页面，不包含 WebSocket |
| API | `/api/llm-wiki/*`、`/api/agents/*`、`/api/models`、Health、Debug | 不包含 `/api/session/*` |
| 模型 | OpenAI-compatible `/chat/completions` | compiler、fusion、Agent JSON 调用 |
| 持久化 | `.knowllm/llm-wiki/`、`.knowllm/agents/` | 不包含 `.knowllm/sessions/` |

当前后端共 26 个 REST 路由：

| 路由组 | 数量 | 前端覆盖 |
| --- | ---: | ---: |
| LLM Wiki | 17 | 17 |
| Agent | 6 | 6 |
| Model | 1 | 1 |
| Health / Debug | 2 | 0 |
| 合计 | 26 | 24 |

前端 `llmWikiApi` 有 18 个方法，其中 `tree()` 复用 manifest，因此对应 17 个唯一 LLM Wiki 路由。Health 和 Debug 仅作为后端运维接口保留。

## 3. 独立 Agent 执行链

```text
Web 提交 query + limit + model
  -> POST /api/agents/llmWiki/runs
  -> 校验 query/sourcePolicy/budget/models
  -> 创建 run 和独立 AbortController
  -> planner 驱动多轮 Wiki 检索
  -> raw source review
  -> 生成 knowledgeSnippets
  -> 始终执行最终答案合成
  -> 保存 result.md / result.json / events.jsonl / meta.json
  -> Web 轮询详情并支持 REST 取消
```

Agent 不再接受改变执行链的 snippets 输出模式。`knowledgeSnippets` 仍作为结果证据保留。

## 4. 已删除能力

- 后端 `src/modules/session/` 全部代码和模块注册。
- `/api/session/*` REST 与 Session WebSocket。
- Session 对 Agent 的父级取消信号和事件回调桥接。
- 前端 `Chat.tsx`、`pages/chat/`、`api/session.ts`、`api/session-ws.ts`。
- `/chat` 路由和侧边导航入口。
- `SESSION_DEFAULT_MODEL`、模型流式 SSE 解析和直接 `ws` 依赖。
- `.knowllm/sessions/` 历史数据。

## 5. 当前对齐矩阵

| 能力 | 前端 | 服务端 | 结论 |
| --- | --- | --- | --- |
| Source 管理与 ingest | 已实现 | 已实现 | 对齐 |
| Wiki tree/page/search/lint/issue | 已实现 | 已实现 | 基本对齐 |
| 独立 LLM Wiki Agent | 已实现 | 已实现 | 对齐 |
| Agent 运行历史与取消 | 已实现 | 已实现 | 对齐 |
| 模型列表 | `/api/models` | `/api/models` | 对齐 |
| Session / Chat / WebSocket | 已删除 | 已删除 | 已收敛 |

## 6. 剩余风险

- Source ingest 不是事务操作，且缺少跨进程锁。
- FlexSearch 仍不是语义检索，复杂自然语言查询依赖 Agent planner 拆词。
- Agent run 没有统一超时、并发限制和保留策略。
- HTTP 异常仍统一返回 200，真实错误码位于响应体。
- Web/API 类型分别维护，`packages/protocol` 尚未接入真实业务契约。
- 前端 API base 仍固定为 `http://localhost:39247`。

## 7. 验收要求

- `pnpm check`、`pnpm lint`、`pnpm build` 和 API 单测通过。
- 全仓代码不存在 Session 模块、Session API、Session WebSocket、Chat 页面、`SESSION_DEFAULT_MODEL` 或 Agent Chat 桥接残留。
- `/api/session/*` 不再存在。
- `/api/agents/*`、`/api/llm-wiki/*` 和 `/api/models` 保持可用。
- 不执行复杂浏览器 UI 自动化测试。
