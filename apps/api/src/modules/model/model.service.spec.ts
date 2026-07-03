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
          { name: "restricted-model", unsupportedParameters: ["temperature"] },
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
          messages: [{ role: "user", content: "hello" }],
        });
        await service.chat({
          model: "provider-a:restricted-model",
          temperature: 0,
          messages: [{ role: "user", content: "hello" }],
        });
      } finally {
        globalThis.fetch = originalFetch;
      }

      assert.equal(bodies[0].temperature, 0);
      assert.equal("temperature" in bodies[1], false);
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
