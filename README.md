<p align="center">
  <img src="assets/logo.png" alt="KnowLLM logo" width="180" />
</p>

<h1 align="center">KnowLLM</h1>
<p align="center">面向 Agent 的 LLM Wiki 开源框架</p>

## 项目简介

KnowLLM 将 Markdown/TXT 原始资料编译为可发布的 Wiki，并让 Agent 基于已发布内容完成检索、原文核验和答案生成。

```text
Source -> Staging -> Published Wiki -> Agent
```

## 当前能力

- 上传、查看和删除不可变 Source。
- 估算并执行有预算上限的 Wiki 编译任务。
- 在共享 Staging 中审阅编译结果，再统一发布或丢弃。
- 浏览、搜索和删除 Published Wiki 页面。
- 通过只读 Tools 查询 Published Wiki 与对应 Source。
- 运行独立 LLM Wiki Agent，查看执行过程、证据和最终答案。
- 使用本地文件系统持久化 Source、Staging、Published Wiki 和 Agent Run。

## 开发

```bash
pnpm install
pnpm dev
```

默认 API 端口为 `39247`。模型配置示例见 `apps/api/env/.env.example`。

## 验证

```bash
pnpm check
pnpm lint
pnpm build
pnpm --filter @knowllm/api test
```

## License

MIT
