import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { ModelService } from "./model.service";

test("model service exposes safe enabled OpenAI model list", async () => {
  await withTempModelConfig(
    [
      providerConfig({
        name: "OpenAPI GPT",
        baseUrl: "https://provider.test/v1",
        apiKey: "secret",
        models: ["fast", "quality"],
      }),
      providerConfig({
        name: "Disabled",
        baseUrl: "https://disabled.test/v1",
        apiKey: "disabled-secret",
        models: ["disabled"],
        enabled: false,
      }),
    ],
    () => {
      const service = new ModelService();
      const models = service.listModels();

      assert.deepEqual(
        models.map((item) => item.id),
        ["openapi-gpt:fast", "openapi-gpt:quality"],
      );
      assert.equal(JSON.stringify(models).includes("secret"), false);
      assert.equal(JSON.stringify(models).includes("provider.test"), false);
      assert.equal(service.resolveModel("fast"), "openapi-gpt:fast");
      assert.equal(service.findModel("missing"), null);
    },
  );
});

test("respond uses only Responses API text.format and parses nested output", async () => {
  await withTempModelConfig(
    [
      providerConfig({
        name: "OpenAPI GPT",
        baseUrl: "https://bella.test/v1/",
        apiKey: "secret",
        models: ["gpt-5.4-mini"],
      }),
    ],
    async () => {
      let requestUrl = "";
      let requestAuth = "";
      let requestBody: Record<string, unknown> = {};
      const debugRequests: Array<{ url: string; body: Record<string, unknown> }> = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (
        input: string | URL | Request,
        init?: RequestInit,
      ) => {
        requestUrl = String(input);
        requestAuth = String(
          new Headers(init?.headers).get("authorization") || "",
        );
        requestBody = JSON.parse(String(init?.body || "{}")) as Record<
          string,
          unknown
        >;
        return response({
          id: "resp_1",
          model: "gpt-5.4-mini",
          status: "completed",
          output_text: null,
          output: [
            { type: "reasoning", summary: [] },
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: '{"ok":true}' }],
            },
          ],
          usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 },
        });
      }) as typeof fetch;
      try {
        const service = new ModelService();
        const result = await service.respond({
          model: "openapi-gpt:gpt-5.4-mini",
          messages: [
            { role: "system", content: "system prompt" },
            { role: "user", content: "question" },
          ],
          textFormat: {
            type: "json_schema",
            name: "answer",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["ok"],
              properties: { ok: { type: "boolean" } },
            },
          },
          maxOutputTokens: 321,
          onRequest: (request) => debugRequests.push(request),
        });

        assert.equal(result.content, '{"ok":true}');
        assert.equal(result.usage?.total_tokens, 16);
      } finally {
        globalThis.fetch = originalFetch;
      }

      assert.equal(requestUrl, "https://bella.test/v1/responses");
      assert.equal(requestAuth, "Bearer secret");
      assert.equal(requestBody.model, "gpt-5.4-mini");
      assert.equal(requestBody.instructions, "system prompt");
      assert.deepEqual(requestBody.input, [
        { role: "user", content: "question" },
      ]);
      assert.equal(requestBody.store, false);
      assert.equal(requestBody.max_output_tokens, 321);
      assert.deepEqual(requestBody.text, {
        format: {
          type: "json_schema",
          name: "answer",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["ok"],
            properties: { ok: { type: "boolean" } },
          },
        },
      });
      assert.equal("messages" in requestBody, false);
      assert.equal("response_format" in requestBody, false);
      assert.equal(debugRequests[0]?.url, "https://bella.test/v1/responses");
      assert.equal(JSON.stringify(debugRequests).includes("secret"), false);
    },
  );
});

test("respond keeps explicit correction history in Responses input", async () => {
  await withTempModelConfig(
    [providerConfig({ name: "OpenAI", baseUrl: "https://openai.test/v1", apiKey: "key", models: ["gpt"] })],
    async () => {
      let body: Record<string, unknown> = {};
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
        body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
        return response({
          id: "resp_2",
          model: "gpt",
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "{}" }],
            },
          ],
        });
      }) as typeof fetch;
      try {
        await new ModelService().respond({
          model: "openai:gpt",
          messages: [
            { role: "system", content: "rules" },
            { role: "user", content: "first" },
            { role: "assistant", content: "invalid" },
            { role: "user", content: "correct it" },
          ],
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
      assert.deepEqual(body.input, [
        { role: "user", content: "first" },
        { role: "assistant", content: "invalid" },
        { role: "user", content: "correct it" },
      ]);
      assert.equal("previous_response_id" in body, false);
    },
  );
});

test("model service ignores non-OpenAI providers", async () => {
  await withTempModelConfig(
    [providerConfig({ provider: "anthropic", name: "Claude", baseUrl: "https://claude.test/v1", apiKey: "key", models: ["claude"] })],
    async () => {
      const service = new ModelService();
      assert.equal(service.listModels().length, 0);
      assert.equal(service.findModel("claude:claude"), null);
    },
  );
});

test("respond rejects incomplete and refusal responses", async () => {
  await withTempModelConfig(
    [providerConfig({ name: "OpenAI", baseUrl: "https://openai.test/v1", apiKey: "key", models: ["gpt"] })],
    async () => {
      const replies = [
        {
          id: "resp_incomplete",
          model: "gpt",
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: [],
        },
        {
          id: "resp_refusal",
          model: "gpt",
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "refusal", refusal: "cannot comply" }],
            },
          ],
        },
      ];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => response(replies.shift())) as typeof fetch;
      try {
        const service = new ModelService();
        await assert.rejects(
          () => service.respond({ model: "openai:gpt", messages: [{ role: "user", content: "one" }] }),
          /未完成: incomplete/,
        );
        await assert.rejects(
          () => service.respond({ model: "openai:gpt", messages: [{ role: "user", content: "two" }] }),
          /模型拒绝回答: cannot comply/,
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function providerConfig(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return {
    provider: "openai",
    enabled: true,
    priority: 0,
    ...overrides,
  };
}

async function withTempModelConfig<T>(
  config: unknown,
  run: () => T | Promise<T>,
): Promise<T> {
  const previousConfig = process.env.KNOWLLM_MODELS_CONFIG;
  const previousOpenaiKey = process.env.OPENAI_API_KEY;
  const previousOpenaiModel = process.env.OPENAI_MODEL;
  const previousModel = process.env.MODEL;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knowllm-models-"));
  const file = path.join(dir, "models.local.json");
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  process.env.KNOWLLM_MODELS_CONFIG = file;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  delete process.env.MODEL;
  try {
    return await run();
  } finally {
    if (previousConfig === undefined) delete process.env.KNOWLLM_MODELS_CONFIG;
    else process.env.KNOWLLM_MODELS_CONFIG = previousConfig;
    if (previousOpenaiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenaiKey;
    if (previousOpenaiModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = previousOpenaiModel;
    if (previousModel === undefined) delete process.env.MODEL;
    else process.env.MODEL = previousModel;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
