# KnowLLM API

`apps/api` 是 KnowLLM 的 NestJS 服务端，当前只提供：

- LLM Wiki source 管理、编译、页面读写、搜索与诊断。
- 独立 LLM Wiki Agent 的提交、运行记录、结果查询与取消。
- Health、Debug 和 OpenAI-compatible 模型调用封装。

本地业务数据默认写入仓库根目录 `.knowllm/`。Session、WebSocket 对话和基础 Chat 已删除。

## 本地配置

复制 `env/.env.example` 为 `env/.env.development`，按需填写：

```bash
NODE_ENV=development
PORT=39247
KNOWLLM_API_PORT=39247
KNOWLLM_DATA_ROOT=/absolute/path/to/KnowLLM/.knowllm
PUBLIC_API_BASE_URL=http://localhost:39247

OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_API_KEY=你的本地密钥
OPENAI_MODEL=deepseek-v4-pro
MODEL=deepseek-v4-pro
LLM_WIKI_MODEL=deepseek-v4-pro
```

模型调用使用 OpenAI-compatible `POST /chat/completions`。这里的 `chat/completions` 是模型协议，不是产品 Chat 模块。

## 接口文档

开发环境启动后访问：

- Swagger UI: `http://localhost:39247/api-docs`
- OpenAPI JSON: `http://localhost:39247/api-docs-json`
