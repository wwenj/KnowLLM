# Web 核心代码逻辑

`apps/web` 当前只承载两个业务入口：

- `/llm-wiki`：Source 管理、编译、Wiki 浏览编辑、搜索与诊断。
- `/agents`：提交、查看和取消独立 LLM Wiki Agent run。

`/chat` 页面、Session REST 客户端和 WebSocket 客户端已删除；访问旧 `/chat` 地址会进入 NotFound。

## 1. 应用入口与路由

```text
src/main.tsx
  -> src/App.tsx
  -> src/router.tsx
  -> src/components/AppLayout.tsx
```

- 根路由跳转 `/llm-wiki`。
- 侧边导航只展示“调试中心”和“LLM Wiki 管理”。
- NotFound 的“回到主页”跳转 `/llm-wiki`。

## 2. API 调用层

所有 REST 调用都经过 `src/api/http.ts`，当前业务 API 文件为：

- `src/api/llmWiki.ts`：Source、page、search、schema、lint 和 issue。
- `src/api/agent.ts`：Agent profile、run 创建、详情、取消和历史。
- `src/api/model.ts`：模型列表。

成功响应要求服务端 envelope：`{ code, msg, data }`。当前 API base 固定为 `http://localhost:39247`。

## 3. LLM Wiki 页面

`src/pages/LlmWiki.tsx` 负责：

- Source 上传、重命名、删除和 ingest 状态轮询。
- Wiki 页面树、查看、编辑和删除。
- 搜索、schema 编辑、lint 和 issue 查看。

当前文件选择器与服务端均收敛为 `.md`、`.txt`。

## 4. Agent 调试页面

`src/pages/DeepAgent.tsx` 当前只支持 LLM Wiki Agent：

```text
页面初始化
  -> agentApi.listAgents()
  -> modelApi.list()
  -> agentApi.getDefaults("llmWiki")
  -> agentApi.listAllRuns()

提交运行
  -> agentApi.createRun("llmWiki", { query, limit, model })
  -> 每 1.5 秒轮询 agentApi.getRun()
  -> terminal 状态后停止轮询并刷新历史

取消运行
  -> agentApi.cancelRun(agentType, runId)
```

Agent 结果继续复用 `src/components/MarkdownRenderer/`。

## 5. 维护边界

- 前端不再包含会话历史、基础聊天、LLM Wiki Chat Tool 或 WebSocket。
- 前端类型未复用 `packages/protocol`，修改 Agent 或 LLM Wiki API 时需要同步更新。
- 当前仍有 `zspace-*` 全局样式命名残留，但已不存在 `zspace.chat.*` 读取逻辑。
