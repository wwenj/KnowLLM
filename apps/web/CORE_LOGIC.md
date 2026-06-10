# Web 核心代码逻辑

`apps/web` 是 KnowLLM 的 React 工作区，当前只承载三个核心业务入口：

- `LLM Wiki`：source 上传、编译、Wiki 浏览编辑、搜索、诊断。
- `Chat`：基础对话与 LLM Wiki Tool 对话。
- `Agent 调试`：提交和查看 LLM Wiki Agent run。

## 1. 应用入口与路由

启动链路：

```text
src/main.tsx
  -> src/App.tsx
  -> src/router.tsx
  -> src/components/AppLayout.tsx
```

关键文件：

- `src/main.tsx`：挂载 React。
- `src/App.tsx`：包裹全局 `ErrorBoundary`、`RouterProvider`、`Toaster`。
- `src/router.tsx`：定义 `/llm-wiki`、`/chat`、`/agents` 三个路由，根路由跳转 `/llm-wiki`。
- `src/components/AppLayout.tsx`：顶部品牌、侧边导航和页面容器。
- `src/components/NotFound.tsx`：404 页面。

## 2. API 调用层

所有 REST 调用都经过 `src/api/http.ts`：

- 固定 API base：`http://localhost:39247`。
- 成功响应要求服务端 envelope：`{ code, msg, data }`。
- `code !== 0` 或非 JSON 响应会抛出 `ApiError`。
- 默认通过 `sonner` toast 展示错误；调用方可传 `silent` 静默。

业务 API 文件：

- `src/api/llmWiki.ts`：LLM Wiki source、page、search、schema、lint、issue。
- `src/api/session.ts`：Session REST，包括会话列表、详情、创建、删除、tools。
- `src/api/session-ws.ts`：Session WebSocket 客户端。
- `src/api/agent.ts`：Agent profile、run 创建、详情、取消、历史。
- `src/api/model.ts`：模型列表。

WebSocket 地址固定为：

```text
ws://localhost:39247/api/session/ws/session/:sessionId
```

## 3. LLM Wiki 页面

入口文件：`src/pages/LlmWiki.tsx`

核心状态：

- `sources` / `stats`：source 列表和统计。
- `tree` / `activePath` / `activePage`：Wiki 页面树和当前页面。
- `query` / `hits`：搜索框与搜索结果。
- `schema` / `schemaDraft`：Schema 查看与编辑。
- `issues` / `lintMode`：诊断 issue 与检查模式。

核心流程：

```text
页面加载
  -> llmWikiApi.listSources()
  -> 渲染 source 列表与统计卡片

上传文件
  -> llmWikiApi.uploadSource(file)
  -> 刷新 source 列表

解析 source
  -> llmWikiApi.ingestSource(sourceId)
  -> 后端异步编译
  -> 前端检测到 ingesting 后每 1.5 秒轮询 listSources()

打开 Wiki
  -> llmWikiApi.tree()
  -> llmWikiApi.page(path)
  -> 在 Dialog 中编辑完整 Markdown

保存页面
  -> llmWikiApi.savePage(activePath, content)
  -> 重新加载 tree

诊断
  -> llmWikiApi.lint(mode)
  -> llmWikiApi.issues("open")
```

当前边界：

- 文件选择器只允许 `.md`、`.txt`，服务端还支持 `.html`。
- 页面类型前端只声明 `index | summary | concept | entity`，服务端还支持 `comparison | manual`。
- Wiki 编辑器直接编辑完整 Markdown，包括 frontmatter。

## 4. Chat 页面

入口文件：`src/pages/Chat.tsx`

拆分组件：

- `pages/chat/ConversationList.tsx`：左侧会话列表、创建、删除。
- `pages/chat/ChatMessageList.tsx`：消息渲染、thinking、复制、空状态。
- `pages/chat/ChatComposer.tsx`：输入框、模型选择、Tool 选择、发送/停止。
- `pages/chat/ThinkingBlock.tsx`：展示模型 thinking 内容。
- `pages/chat/types.ts`：Chat 页面内部类型。

初始化流程：

```text
加载 session 列表、模型列表、tools
  -> 没有 session 时创建“新聊天”
  -> 读取当前 session 全量消息
  -> 建立 SessionWsClient
```

发送流程：

```text
用户输入
  -> 如果选择 Tool，wireContent 增加 [assistant:llmWiki]
  -> 前端先插入本地 user message 和 assistant streaming 占位
  -> WebSocket sendMessage({ content: wireContent, model })
  -> 接收 thinking / stream 增量更新占位消息
  -> 接收 done 后替换为服务端 message_id 和最终内容
  -> 刷新会话列表标题与时间
```

停止流程：

```text
点击停止
  -> WebSocket sendCancel()
  -> 前端停止当前 streaming 占位
  -> 服务端取消当前 session task
```

当前边界：

- Chat 历史由服务端全量传给模型，前端没有 token 预算控制。
- 切换会话会断开旧 WebSocket，也会取消旧会话正在生成的回复。
- Tool 当前只有 `llmWiki`。
- 附件和 Skill picker 已删除。

## 5. Agent 调试页面

入口文件：`src/pages/DeepAgent.tsx`

当前虽然文件名仍叫 `DeepAgent.tsx`，实际只支持 LLM Wiki Agent。

拆分组件：

- `pages/deep-agent/AgentConfigPanel.tsx`：Agent 切换、query、limit、model 配置。
- `pages/deep-agent/HistoryCard.tsx`：运行历史。
- `pages/deep-agent/RunOutputPanel.tsx`：执行过程和结果。
- `pages/deep-agent/utils.ts`：构造 run body、格式化状态、导出日志。
- `pages/deep-agent/types.ts`：Agent 页面内部类型。

执行流程：

```text
页面初始化
  -> agentApi.listAgents()
  -> modelApi.list()
  -> agentApi.getDefaults("llmWiki")
  -> agentApi.listAllRuns()

提交运行
  -> buildRunBody({ query, limit, model })
  -> agentApi.createRun("llmWiki", body)
  -> 每 1.5 秒轮询 agentApi.getRun()
  -> terminal 状态后停止轮询并刷新历史

取消运行
  -> agentApi.cancelRun(agentType, runId)
```

URL 支持通过查询参数打开指定 run：

```text
/agents?agentType=llmWiki&runId=<runId>
```

## 6. Markdown 渲染

Markdown 相关组件位于 `src/components/MarkdownRenderer/`：

- `index.tsx`：统一 Markdown 渲染入口，支持 GFM。
- `CodeBlock.tsx`：代码块展示。
- `ImageRenderer.tsx`：图片渲染。
- `MarkdownRenderBoundary.tsx`：Markdown 渲染局部错误保护。

Chat 和 Agent 结果都复用这套渲染逻辑。

## 7. 样式与 UI 组件

- 全局样式：`src/styles/index.css`、`src/styles/theme.less`。
- Chat 独立样式：`src/pages/chat/styles.module.less`。
- 基础 UI 组件：`src/components/ui/*`。

当前仍有历史命名残留：

- `zspace-*` CSS class。
- `zspace.chat.*` localStorage key。
- `index.html` 标题仍是 `ZSpace`。

## 8. 维护注意事项

- 前端类型目前是手写的，未复用 `packages/protocol`，改接口时要同步更新 `src/api/*`。
- REST/WS 地址写死在前端，部署或端口变更时需要先改配置方案。
- Chat 和 Agent 都依赖后端 LLM Wiki 搜索质量；搜索策略变更会同时影响两个页面。
- 不要在前端展示服务端未实现的 Agent、Skill、artifact、token stats 等能力，避免契约再次漂移。
