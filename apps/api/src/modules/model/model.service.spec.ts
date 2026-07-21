import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { ModelService } from "./model.service";

test("model service exposes safe enabled model list from local provider config", async () => {
  await withTempModelConfig(
    [
      providerConfig({
        name: "Provider A",
        baseUrl: "https://provider-a.test/v1",
        apiKey: "secret-a",
        models: ["fast", "main"],
      }),
      providerConfig({
        name: "Disabled",
        baseUrl: "https://disabled.test/v1",
        apiKey: "secret-disabled",
        models: ["disabled"],
        enabled: false,
      }),
      providerConfig({
        name: "Missing Key",
        baseUrl: "https://missing-key.test/v1",
        apiKey: "",
        models: ["missing-key"],
      }),
    ],
    () => {
      const service = new ModelService();
      const models = service.listModels();

      assert.deepEqual(
        models.map((item) => item.id),
        ["provider-a:fast", "provider-a:main"],
      );
      assert.equal(models[0].providerName, "Provider A");
      assert.equal(JSON.stringify(models).includes("secret-a"), false);
      assert.equal(JSON.stringify(models).includes("provider-a.test"), false);
      assert.equal(service.hasConfiguredModel(), true);
    },
  );
});

test("model service resolves ids and unique model names", async () => {
  await withTempModelConfig(
    [
      providerConfig({
        name: "Provider A",
        baseUrl: "https://a.test/v1",
        apiKey: "secret-a",
        models: ["same", "unique"],
      }),
      providerConfig({
        name: "Provider B",
        baseUrl: "https://b.test/v1",
        apiKey: "secret-b",
        models: ["same"],
      }),
    ],
    () => {
      const service = new ModelService();

      assert.equal(service.resolveModel("provider-a:same"), "provider-a:same");
      assert.equal(service.resolveModel("unique"), "provider-a:unique");
      assert.equal(service.findModel("same"), null);
      assert.equal(service.resolveModel("missing"), "");
      assert.equal(service.resolveModel(""), "provider-a:same");
    },
  );
});

test("model service routes chat requests to the selected provider", async () => {
  await withTempModelConfig(
    [
      providerConfig({
        name: "Provider A",
        baseUrl: "https://a.test/v1",
        apiKey: "secret-a",
        models: ["model-a"],
      }),
      providerConfig({
        name: "Provider B",
        baseUrl: "https://b.test/api/",
        apiKey: "secret-b",
        models: ["model-b"],
      }),
    ],
    async () => {
      const calls: Array<{
        url: string;
        auth: string;
        body: Record<string, unknown>;
      }> = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (
        input: string | URL | Request,
        init?: RequestInit,
      ) => {
        calls.push({
          url: String(input),
          auth: String(new Headers(init?.headers).get("authorization") || ""),
          body: JSON.parse(String(init?.body || "{}")) as Record<
            string,
            unknown
          >,
        });
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }) as typeof fetch;
      try {
        const service = new ModelService();
        await service.chat({
          model: "provider-b:model-b",
          messages: [{ role: "user", content: "hello" }],
        });
      } finally {
        globalThis.fetch = originalFetch;
      }

      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "https://b.test/api/chat/completions");
      assert.equal(calls[0].auth, "Bearer secret-b");
      assert.equal(calls[0].body.model, "model-b");
    },
  );
});

test("model service omits parameters unsupported by a selected model", async () => {
  await withTempModelConfig(
    [
      providerConfig({
        name: "Provider A",
        baseUrl: "https://a.test/v1",
        apiKey: "secret-a",
        models: [
          "regular-model",
          { name: "restricted-model", unsupportedParameters: ["temperature", "max_tokens"] },
        ],
      }),
    ],
    async () => {
      const bodies: Record<string, unknown>[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (
        _input: string | URL | Request,
        init?: RequestInit,
      ) => {
        bodies.push(
          JSON.parse(String(init?.body || "{}")) as Record<string, unknown>,
        );
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }) as typeof fetch;
      try {
        const service = new ModelService();
        await service.chat({
          model: "provider-a:regular-model",
          temperature: 0,
          maxTokens: 321,
          messages: [{ role: "user", content: "hello" }],
        });
        await service.chat({
          model: "provider-a:restricted-model",
          temperature: 0,
          maxTokens: 321,
          messages: [{ role: "user", content: "hello" }],
        });
      } finally {
        globalThis.fetch = originalFetch;
      }

      assert.equal(bodies[0].temperature, 0);
      assert.equal(bodies[0].max_tokens, 321);
      assert.equal("temperature" in bodies[1], false);
      assert.equal("max_tokens" in bodies[1], false);
      assert.equal(bodies[1].max_completion_tokens, 321);
    },
  );
});

test("model service honors an explicit max_completion_tokens provider contract", async () => {
  await withTempModelConfig(
    [
      providerConfig({
        name: "Provider A",
        baseUrl: "https://a.test/v1",
        apiKey: "secret-a",
        models: [{ name: "gpt-5.5", outputTokenParameter: "max_completion_tokens" }],
      }),
    ],
    async () => {
      let body: Record<string, unknown> = {};
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
        body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
        return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;
      try {
        const service = new ModelService();
        await service.chat({ model: "provider-a:gpt-5.5", maxTokens: 321, messages: [{ role: "user", content: "probe" }] });
      } finally {
        globalThis.fetch = originalFetch;
      }
      assert.equal(body.max_completion_tokens, 321);
      assert.equal("max_tokens" in body, false);
    },
  );
});

test("model service applies provider unsupported parameters to all its models", async () => {
  await withTempModelConfig(
    [
      providerConfig({
        name: "Provider A",
        baseUrl: "https://a.test/v1",
        apiKey: "secret-a",
        models: ["model-a", "model-b"],
        unsupportedParameters: ["temperature"],
      }),
    ],
    async () => {
      const bodies: Record<string, unknown>[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (
        _input: string | URL | Request,
        init?: RequestInit,
      ) => {
        bodies.push(
          JSON.parse(String(init?.body || "{}")) as Record<string, unknown>,
        );
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }) as typeof fetch;
      try {
        const service = new ModelService();
        await service.chat({
          model: "provider-a:model-a",
          temperature: 0,
          messages: [{ role: "user", content: "hello" }],
        });
        await service.chat({
          model: "provider-a:model-b",
          temperature: 0.2,
          messages: [{ role: "user", content: "hello" }],
        });
      } finally {
        globalThis.fetch = originalFetch;
      }

      assert.equal(
        bodies.every((body) => !("temperature" in body)),
        true,
      );
    },
  );
});

test("model service adapts json schema response format per provider", async () => {
  const schemaFormat = {
    type: "json_schema" as const,
    json_schema: {
      name: "wiki_output",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
      },
    },
  };
  await withTempModelConfig(
    [
      providerConfig({
        name: "OpenAI",
        provider: "openai",
        baseUrl: "https://openai.test/v1",
        apiKey: "secret-openai",
        models: ["gpt"],
      }),
      providerConfig({
        name: "Claude",
        provider: "anthropic",
        baseUrl: "https://claude.test/v1",
        apiKey: "secret-claude",
        models: ["claude"],
      }),
      providerConfig({
        name: "Gemini",
        provider: "gemini",
        baseUrl: "https://gemini.test/v1",
        apiKey: "secret-gemini",
        models: ["gemini"],
      }),
      providerConfig({
        name: "DeepSeek",
        provider: "deepseek",
        baseUrl: "https://deepseek.test",
        apiKey: "secret-deepseek",
        models: ["deepseek"],
      }),
      providerConfig({
        name: "Mimo",
        provider: "mimo",
        baseUrl: "https://mimo.test/v1",
        apiKey: "secret-mimo",
        models: ["mimo"],
      }),
      providerConfig({
        name: "Unsupported",
        provider: "openai",
        baseUrl: "https://unsupported.test/v1",
        apiKey: "secret-unsupported",
        models: ["unsupported"],
        unsupportedParameters: ["response_format"],
      }),
    ],
    async () => {
      const urls: string[] = [];
      const bodies: Record<string, unknown>[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (
        input: string | URL | Request,
        init?: RequestInit,
      ) => {
        urls.push(String(input));
        bodies.push(
          JSON.parse(String(init?.body || "{}")) as Record<string, unknown>,
        );
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }) as typeof fetch;
      try {
        const service = new ModelService();
        for (const model of [
          "openai:gpt",
          "claude:claude",
          "gemini:gemini",
          "deepseek:deepseek",
          "mimo:mimo",
          "unsupported:unsupported",
        ]) {
          await service.chat({
            model,
            messages: [{ role: "user", content: "hello" }],
            response_format: schemaFormat,
          });
        }
      } finally {
        globalThis.fetch = originalFetch;
      }

      assert.deepEqual(bodies[0].response_format, schemaFormat);
      assert.deepEqual(bodies[1].output_config, {
        format: {
          type: "json_schema",
          schema: schemaFormat.json_schema.schema,
        },
      });
      assert.deepEqual(bodies[2].response_format, {
        type: "text",
        mime_type: "application/json",
        schema: schemaFormat.json_schema.schema,
      });
      assert.equal("response_format" in bodies[3], false);
      assert.equal(urls[3], "https://deepseek.test/beta/chat/completions");
      assert.deepEqual(bodies[3].tool_choice, {
        type: "function",
        function: { name: "wiki_output" },
      });
      assert.deepEqual(bodies[3].tools, [
        {
          type: "function",
          function: {
            name: "wiki_output",
            description: "Return the response in the required JSON schema.",
            strict: true,
            parameters: schemaFormat.json_schema.schema,
          },
        },
      ]);
      assert.deepEqual(bodies[4].response_format, schemaFormat);
      assert.equal("response_format" in bodies[5], false);
      assert.equal("output_config" in bodies[5], false);
      assert.equal("tools" in bodies[5], false);
    },
  );
});

test("model service reads strict tool call arguments as assistant content", async () => {
  await withTempModelConfig(
    [
      providerConfig({
        name: "DeepSeek",
        provider: "deepseek",
        baseUrl: "https://deepseek.test",
        apiKey: "secret-deepseek",
        models: ["deepseek"],
      }),
    ],
    async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "",
                  tool_calls: [
                    { function: { arguments: "{\"ok\":true}" } },
                  ],
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        )) as typeof fetch;
      try {
        const service = new ModelService();
        const res = await service.chat({
          model: "deepseek:deepseek",
          messages: [{ role: "user", content: "hello" }],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "tool output",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: { ok: { type: "boolean" } },
                required: ["ok"],
              },
            },
          },
        });

        assert.equal(res.choices?.[0]?.message?.content, "{\"ok\":true}");
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

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
  const previousLlmWikiModel = process.env.LLM_WIKI_MODEL;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knowllm-models-"));
  const file = path.join(dir, "models.local.json");
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  process.env.KNOWLLM_MODELS_CONFIG = file;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  delete process.env.MODEL;
  delete process.env.LLM_WIKI_MODEL;
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
    if (previousLlmWikiModel === undefined) delete process.env.LLM_WIKI_MODEL;
    else process.env.LLM_WIKI_MODEL = previousLlmWikiModel;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
