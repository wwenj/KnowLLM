<p align="center">
  <img src="assets/logo.png" alt="KnowLLM logo" width="180" />
</p>

<h1 align="center">KnowLLM</h1>
<p align="center">面向 Agent 的 LLM Wiki 开源框架</p>

KnowLLM 将原始资料编译为可维护、可追溯的 Markdown Wiki，并提供独立 llmWiki Agent 基于 Wiki 完成多轮检索、原文核验和答案生成。

```text
原始资料 -> Markdown Wiki -> 证据驱动的 llmWiki Agent
```

## 当前能力

- 上传和管理 Markdown/TXT 资料。
- 将资料编译、融合为 summary、concept 和 entity Wiki 页面。
- 保留原始资料、页面来源和知识贡献记录。
- 浏览、编辑、搜索和检查 Wiki。
- 运行独立 llmWiki Agent，查看检索轨迹、证据片段和最终答案。
- 本地文件系统持久化。

## 快速启动

要求：

- Node.js `>=26.2.0`
- pnpm
- OpenAI-compatible 模型服务

```bash
pnpm install
pnpm dev
```

默认地址：

```text
Web: http://localhost:43127
API: http://localhost:39247
Swagger: http://localhost:39247/api-docs
```

模型配置：

默认从 `apps/api/env/models.local.json` 读取私密 provider 数组；该文件不提交 Git。可复制
`apps/api/env/models.local.example.json` 后填入真实 `apiKey`，也可以用 `apiKeyEnv` 从环境变量读取。
如果本地模型数组不存在或没有可用 provider，会回退到下面的旧 env 单模型配置。

```bash
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=your-key
OPENAI_MODEL=your-model
LLM_WIKI_MODEL=your-model
AGENT_FAST_MODEL=your-model
AGENT_MAIN_MODEL=your-model
```

## 文档

- [产品定义](PRODUCT.md)
- [LLM Wiki 开源实现方案](LLM%20Wiki%20开源实现方案.md)
- [评测数据说明](eval/llmwiki_private_benchmark/README.md)

## License

MIT
