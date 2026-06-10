# KnowLLM API

`apps/api` 是从 `server_copy` 精简后的 Nest 服务端，只保留：

- LLM Wiki source / wiki / search / lint / issue 接口。
- LLM Wiki Agent 与基础 Chat Agent。
- 基础 Session REST 和 WebSocket 对话。
- Health、Debug LLM Wiki、OpenAI-compatible 模型调用封装。

本地数据默认写入仓库根目录 `.knowllm/`。敏感配置只放 `env/.env.*`，这些文件已被根 `.gitignore` 忽略。

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
SESSION_DEFAULT_MODEL=deepseek-v4-flash
```

模型调用使用 OpenAI-compatible `POST /chat/completions` 和 Bearer API key。未配置模型时，LLM Wiki 编译和问答会使用本地确定性 fallback。

## 接口文档

开发环境启动后访问：

- Swagger UI: `http://localhost:39247/api-docs`
- OpenAPI JSON: `http://localhost:39247/api-docs-json`

Session WebSocket 不属于 OpenAPI，地址为：

```text
ws://localhost:39247/api/session/ws/session/:sessionId
```
