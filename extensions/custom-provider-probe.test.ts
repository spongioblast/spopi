// ABOUTME: Tests normalizeBaseUrl / sanitizeProviderId.
// ABOUTME: Includes "normalizes trailing slash and rejects bad schemes".
// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  buildModelsJsonProviderEntry,
  detectProviderProtocol,
  mergeProviderIntoModelsJson,
  normalizeBaseUrl,
  resolveProviderId,
  sanitizeProviderId,
  suggestProviderIdFromBaseUrl,
  testProviderConnectivity,
} from "./custom-provider-probe.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("normalizeBaseUrl / sanitizeProviderId", () => {
  it("normalizes trailing slash and rejects bad schemes", () => {
    expect(normalizeBaseUrl("https://relay.example.com/v1/")).toBe("https://relay.example.com/v1");
    expect(() => normalizeBaseUrl("ftp://x")).toThrow(/http/);
    expect(() => normalizeBaseUrl("not-a-url")).toThrow(/valid/);
  });

  it("sanitizes provider ids", () => {
    expect(sanitizeProviderId(" My Relay ")).toBe("my-relay");
    expect(() => sanitizeProviderId("!!!")).toThrow(/required/);
  });

  it("suggests and resolves id from base URL when raw is empty or Chinese-only", () => {
    expect(suggestProviderIdFromBaseUrl("https://api.example.com/v1")).toBe("example-com");
    expect(resolveProviderId("", "https://relay.foo.io/v1")).toBe("foo-io");
    expect(resolveProviderId("中转站", "https://api.my-relay.net/v1")).toBe("my-relay-net");
    expect(resolveProviderId("My Relay", "https://ignored.example/v1")).toBe("my-relay");
  });

  it("names loopback and IP hosts by server or port, never by the last address labels", () => {
    expect(suggestProviderIdFromBaseUrl("http://127.0.0.1:8000/v1")).toBe("local-8000");
    expect(suggestProviderIdFromBaseUrl("http://127.0.0.1:8000/v1", "vllm")).toBe("vllm");
    expect(suggestProviderIdFromBaseUrl("http://localhost:1234/v1")).toBe("local-1234");
    expect(suggestProviderIdFromBaseUrl("http://192.168.1.20/v1")).toBe("local-80");
    expect(resolveProviderId("", "http://127.0.0.1:8000/v1", "vllm")).toBe("vllm");
  });
});

describe("detectProviderProtocol", () => {
  it("detects OpenAI-compatible /v1/models", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("/v1/models") && !String(url).includes("messages")) {
        // first openai probe
        return jsonResponse({
          object: "list",
          data: [
            {
              id: "gpt-4o-mini",
              owned_by: "openai",
              context_window: 32768,
              max_output_tokens: 4096,
            },
          ],
        });
      }
      return jsonResponse({ error: { type: "not_found_error" } }, 404);
    }) as unknown as typeof fetch;

    const result = await detectProviderProtocol({
      baseUrl: "https://relay.example.com/v1",
      apiKey: "sk-test",
      fetchImpl,
    });
    expect(result.protocol).toBe("openai-completions");
    expect(result.models.map((m) => m.id)).toContain("gpt-4o-mini");
    expect(result.models[0]).toMatchObject({ contextWindow: 32768, maxTokens: 4096 });
    expect(result.confidence).not.toBe("none");
  });

  it("detects Claude when OpenAI list fails and Anthropic models work", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const headers = (init?.headers || {}) as Record<string, string>;
      if (u.endsWith("/v1/models") && headers.Authorization) {
        return jsonResponse({ error: "unauthorized" }, 401);
      }
      if (u.endsWith("/v1/models") && headers["x-api-key"]) {
        return jsonResponse({
          data: [{ id: "claude-3-5-sonnet-latest", display_name: "Sonnet" }],
        });
      }
      return jsonResponse({ error: "no" }, 404);
    }) as unknown as typeof fetch;

    const result = await detectProviderProtocol({
      baseUrl: "https://claude-relay.example.com",
      apiKey: "sk-ant",
      fetchImpl,
    });
    expect(result.protocol).toBe("anthropic-messages");
    expect(result.models[0]?.id).toContain("claude");
  });

  it("detects a keyless vLLM from its model list alone", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/v1/models")) {
        return jsonResponse({
          object: "list",
          data: [{ id: "Qwen3.8-Flash-Next", owned_by: "vllm", max_model_len: 262144 }],
        });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    }) as unknown as typeof fetch;

    const result = await detectProviderProtocol({
      baseUrl: "http://127.0.0.1:8000/v1",
      apiKey: "",
      fetchImpl,
    });

    expect(result.protocol).toBe("openai-completions");
    expect(result.server).toBe("vllm");
    expect(result.suggestedId).toBe("vllm");
    expect(result.models[0]).toMatchObject({ id: "Qwen3.8-Flash-Next", contextWindow: 262144 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://127.0.0.1:8000/v1/models");
    const headers = (calls[0].init?.headers || {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(result.attempts.map((a) => a.protocol)).toEqual(["openai-completions"]);
  });

  it("names the endpoint and status when nothing answers", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:9");
    }) as unknown as typeof fetch;
    const result = await detectProviderProtocol({
      baseUrl: "http://127.0.0.1:9/v1",
      fetchImpl,
    });
    expect(result.protocol).toBe("unknown");
    expect(result.error).toContain("http://127.0.0.1:9/v1/models → connect ECONNREFUSED");
  });
});

describe("testProviderConnectivity", () => {
  it("treats HTTP 200 chat completions as ok with latency", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: "ok" } }] }),
    ) as unknown as typeof fetch;
    const result = await testProviderConnectivity({
      baseUrl: "https://relay.example.com/v1",
      apiKey: "sk",
      protocol: "openai-completions",
      modelId: "gpt-4o-mini",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.endpoint).toContain("/chat/completions");
  });
});

describe("models.json merge helpers", () => {
  it("builds openai entry and merges without clobbering other providers", () => {
    const entry = buildModelsJsonProviderEntry({
      baseUrl: "https://relay.example.com/v1",
      protocol: "openai-completions",
      apiKey: "sk-relay",
      models: [
        "gpt-4o-mini",
        { id: "deepseek-v3", name: "DeepSeek", contextWindow: 65536, maxTokens: 8192 },
      ],
    });
    expect(entry.apiKey).toBeUndefined();
    expect(entry.api).toBe("openai-completions");
    expect(entry.compat).toMatchObject({
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStore: false,
      supportsStrictMode: false,
      maxTokensField: "max_tokens",
    });
    expect(entry.authHeader).toBe(true);
    expect(entry.models[0]).toMatchObject({
      id: "gpt-4o-mini",
      contextWindow: 128000,
      maxTokens: 16384,
    });
    expect(entry.models[1]).toMatchObject({
      id: "deepseek-v3",
      contextWindow: 65536,
      maxTokens: 8192,
    });
    const merged = mergeProviderIntoModelsJson(
      {
        providers: {
          ollama: { baseUrl: "http://localhost:11434/v1", api: "openai-completions", models: [] },
        },
      },
      "My Relay",
      entry,
    );
    expect(Object.keys(merged.providers || {}).sort()).toEqual(["my-relay", "ollama"]);
    expect(merged.providers?.["my-relay"]?.models.map((m) => m.id)).toEqual([
      "gpt-4o-mini",
      "deepseek-v3",
    ]);
  });

  it("writes the keyless placeholder and flags Qwen thinking by name", () => {
    const entry = buildModelsJsonProviderEntry({
      baseUrl: "http://127.0.0.1:8000/v1",
      protocol: "openai-completions",
      models: [{ id: "Qwen3.8-Flash-Next", contextWindow: 262144 }, "llama-3.1-8b"],
    });
    expect(entry.apiKey).toBe("none");
    expect(entry.authHeader).toBeUndefined();
    expect(entry.compat).toMatchObject({ supportsReasoningEffort: false });
    expect(entry.models[0]).toMatchObject({
      reasoning: true,
      contextWindow: 262144,
      compat: { thinkingFormat: "qwen-chat-template" },
    });
    expect(entry.models[1]).toMatchObject({ reasoning: false });
    expect(entry.models[1].compat).toBeUndefined();
  });

  it("fills Claude defaults for anthropic protocol models", () => {
    const entry = buildModelsJsonProviderEntry({
      baseUrl: "https://api.relay.example",
      protocol: "anthropic-messages",
      models: ["claude-sonnet-4-6"],
    });
    expect(entry.api).toBe("anthropic-messages");
    expect(entry.models[0]).toMatchObject({
      id: "claude-sonnet-4-6",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 8192,
    });
  });

  it("drops Groq non-chat catalog entries and sets session-safe OpenAI compat", () => {
    const entry = buildModelsJsonProviderEntry({
      baseUrl: "https://api.groq.com/openai/v1",
      protocol: "openai-completions",
      models: [
        {
          id: "whisper-large-v3",
          name: "Whisper",
          contextWindow: 448,
          maxTokens: 16384,
        },
        {
          id: "meta-llama/llama-prompt-guard-2-86m",
          contextWindow: 512,
          maxTokens: 16384,
        },
        {
          id: "openai/gpt-oss-120b",
          name: "GPT OSS 120B",
          contextWindow: 131072,
          maxTokens: 16384,
        },
      ],
    });
    expect(entry.models.map((m) => m.id)).toEqual(["openai/gpt-oss-120b"]);
    expect(entry.models[0]).toMatchObject({
      reasoning: true,
      maxTokens: 2048,
      thinkingLevelMap: { low: "low", medium: "medium", high: "high" },
    });
    expect(entry.compat).toMatchObject({
      supportsStore: false,
      supportsStrictMode: false,
      supportsReasoningEffort: false,
      maxTokensField: "max_completion_tokens",
    });
    expect(entry.models[0].compat).toMatchObject({ supportsReasoningEffort: true });
  });
});
