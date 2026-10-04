// ABOUTME: Tests Set up model: thinking on/off, image input, the vLLM budget field, and context.
// ABOUTME: A fake server stands in for vLLM and counts generation requests.
// @vitest-environment node

import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { configureOneModel, solidPng } from "./provider-model-setup.ts";

type Behaviour = {
  ownedBy?: string;
  maxModelLen?: number;
  thinksWhenOn?: boolean;
  thinksWhenOff?: boolean;
  rejectKwargs?: boolean;
  rejectImages?: boolean;
  rejectBudget?: boolean;
  /** When set, the server checks `reasoning_effort` against this list. */
  efforts?: string[];
  /** The 400 names the accepted values, as vLLM does. */
  listEfforts?: boolean;
  /** `reasoning_effort: "none"` switches thinking off. */
  noneTurnsOff?: boolean;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fakeServer(behaviour: Behaviour) {
  const chats: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/v1/models")) {
      return json({
        object: "list",
        data: [
          {
            id: "Qwen3.8-Flash-Next",
            owned_by: behaviour.ownedBy ?? "vllm",
            ...(behaviour.maxModelLen ? { max_model_len: behaviour.maxModelLen } : {}),
          },
        ],
      });
    }
    const body = JSON.parse(String(init?.body || "{}"));
    chats.push(body);
    const kwargs = body.chat_template_kwargs as { enable_thinking?: boolean } | undefined;
    if (kwargs && behaviour.rejectKwargs) return json({ error: "unknown field" }, 400);
    const hasImage = JSON.stringify(body.messages).includes("image_url");
    if (hasImage && behaviour.rejectImages) {
      return json({ error: { message: "This model does not support image input" } }, 400);
    }
    if ("thinking_token_budget" in body && behaviour.rejectBudget) {
      return json({ error: "thinking_token_budget is not supported" }, 400);
    }
    const effort = body.reasoning_effort as string | undefined;
    if (effort !== undefined && behaviour.efforts) {
      const accepted = effort === "none" || behaviour.efforts.includes(effort);
      if (!accepted) {
        const [first, ...rest] = behaviour.efforts;
        const named = rest.length
          ? `${first} (default), ${rest.slice(0, -1).concat("").join(", ")}and ${rest.at(-1)}`
          : `${first} (default)`;
        const message = behaviour.listEfforts
          ? `Unexpected reasoning effort ${effort}. Supported types are ${named}.`
          : "invalid reasoning_effort";
        return json({ error: { message, type: "BadRequestError" } }, 400);
      }
    }
    const thinking =
      effort === "none" && behaviour.noneTurnsOff
        ? false
        : kwargs?.enable_thinking === false
          ? behaviour.thinksWhenOff
          : kwargs?.enable_thinking === true
            ? behaviour.thinksWhenOn
            : behaviour.thinksWhenOn || behaviour.thinksWhenOff;
    return json({
      choices: [
        {
          message: {
            role: "assistant",
            content: thinking ? null : "OK",
            ...(thinking ? { reasoning_content: "The user wants" } : {}),
          },
          finish_reason: "length",
        },
      ],
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, chats };
}

const baseUrl = "http://127.0.0.1:8000/v1";

describe("configureOneModel", () => {
  it("keeps the Qwen chat template when the server ignores reasoning_effort", async () => {
    const server = fakeServer({ maxModelLen: 262144, thinksWhenOn: true, thinksWhenOff: false });
    const result = await configureOneModel({
      baseUrl,
      modelId: "Qwen3.8-Flash-Next",
      fetchImpl: server.fetchImpl,
    });

    expect(server.chats).toHaveLength(5);
    expect(server.chats[4].reasoning_effort).toBe("spopi-check");
    expect(server.chats.every((chat) => chat.max_tokens === 16)).toBe(true);
    expect(result.server).toBe("vllm");
    expect(result.suggestion).toEqual({
      reasoning: true,
      thinkingMode: "switchable",
      thinkingFormat: "qwen-chat-template",
      thinkingLevelMap: {
        minimal: "minimal",
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max",
      },
      input: ["text", "image"],
      inputLimits: {
        images: { resize: { maxWidth: 1280, maxHeight: 1280, maxBytes: 524288, jpegQuality: 80 } },
      },
      contextWindow: 262144,
      thinkingTokenBudgetField: "thinking_token_budget",
    });
    expect(result.checks.map((check) => [check.id, check.ok])).toEqual([
      ["context", true],
      ["thinking", true],
      ["images", true],
      ["budget", true],
      ["effort", false],
    ]);
    expect(result.checks.find((check) => check.id === "effort")?.detail).toBe("ignored");
  });

  it("maps levels to the efforts a checking server names, with none as off", async () => {
    const server = fakeServer({
      thinksWhenOn: true,
      thinksWhenOff: false,
      efforts: ["xhigh", "medium", "low"],
      listEfforts: true,
      noneTurnsOff: true,
    });
    const result = await configureOneModel({
      baseUrl,
      modelId: "Qwen3.8-Flash-Next",
      fetchImpl: server.fetchImpl,
    });
    expect(result.suggestion.supportsReasoningEffort).toBe(true);
    expect(result.suggestion.thinkingFormat).toBeUndefined();
    expect(result.suggestion.thinkingLevelMap).toEqual({
      off: "none",
      minimal: null,
      low: "low",
      medium: "medium",
      high: null,
      xhigh: "xhigh",
      max: null,
    });
    expect(result.checks.find((check) => check.id === "effort")).toMatchObject({
      ok: true,
      detail: "low, medium, xhigh; off: none",
    });
    expect(server.chats.map((chat) => chat.reasoning_effort).filter(Boolean)).toEqual([
      "spopi-check",
      "none",
    ]);
  });

  it("tries each level when the error does not list them", async () => {
    const server = fakeServer({
      thinksWhenOn: true,
      thinksWhenOff: false,
      efforts: ["low", "high"],
      noneTurnsOff: true,
    });
    const result = await configureOneModel({
      baseUrl,
      modelId: "Qwen3.8-Flash-Next",
      fetchImpl: server.fetchImpl,
    });
    expect(result.suggestion.thinkingLevelMap).toMatchObject({
      low: "low",
      high: "high",
      medium: null,
    });
    expect(server.chats.map((chat) => chat.reasoning_effort).filter(Boolean)).toEqual([
      "spopi-check",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "none",
    ]);
  });

  it("keeps on/off through the chat template when none does not switch thinking off", async () => {
    const server = fakeServer({
      thinksWhenOn: true,
      thinksWhenOff: false,
      efforts: ["low", "medium"],
      listEfforts: true,
    });
    const result = await configureOneModel({
      baseUrl,
      modelId: "Qwen3.8-Flash-Next",
      fetchImpl: server.fetchImpl,
    });
    expect(result.suggestion.supportsReasoningEffort).toBeUndefined();
    expect(result.suggestion.thinkingFormat).toBe("qwen-chat-template");
    expect(result.checks.find((check) => check.id === "effort")).toMatchObject({
      ok: true,
      detail: "low, medium",
    });
  });

  it("keeps only the level that applies when the model always thinks", async () => {
    const server = fakeServer({ ownedBy: "sglang", thinksWhenOn: true, thinksWhenOff: true });
    const result = await configureOneModel({
      baseUrl,
      modelId: "Qwen3.8-Flash-Next",
      fetchImpl: server.fetchImpl,
    });
    expect(server.chats).toHaveLength(4);
    expect(result.suggestion).toMatchObject({
      reasoning: true,
      thinkingMode: "always",
      thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: "high" },
    });
    expect(result.suggestion.thinkingFormat).toBeUndefined();
    expect(result.suggestion.thinkingTokenBudgetField).toBeUndefined();
    expect(result.checks.find((check) => check.id === "budget")).toMatchObject({ ok: null });
  });

  it("marks a model that rejects images as text only", async () => {
    const server = fakeServer({ thinksWhenOn: false, thinksWhenOff: false, rejectImages: true });
    const result = await configureOneModel({
      baseUrl,
      modelId: "Qwen3.8-Flash-Next",
      fetchImpl: server.fetchImpl,
    });
    expect(result.suggestion).toMatchObject({
      reasoning: false,
      thinkingMode: "none",
      input: ["text"],
    });
    expect(result.suggestion.inputLimits).toBeUndefined();
    expect(result.checks.find((check) => check.id === "images")).toMatchObject({
      ok: false,
      detail: "rejected",
    });
    expect(server.chats).toHaveLength(3);
  });

  it("asks plainly when the server refuses chat_template_kwargs", async () => {
    const server = fakeServer({ rejectKwargs: true, thinksWhenOff: true });
    const result = await configureOneModel({
      baseUrl,
      modelId: "Qwen3.8-Flash-Next",
      fetchImpl: server.fetchImpl,
    });
    expect(result.suggestion.thinkingMode).toBe("always");
    expect(server.chats[1].chat_template_kwargs).toBeUndefined();
  });

  it("leaves the budget field off when vLLM refuses it", async () => {
    const server = fakeServer({ thinksWhenOn: true, thinksWhenOff: false, rejectBudget: true });
    const result = await configureOneModel({
      baseUrl,
      modelId: "Qwen3.8-Flash-Next",
      fetchImpl: server.fetchImpl,
    });
    expect(result.suggestion.thinkingTokenBudgetField).toBeUndefined();
    expect(result.checks.find((check) => check.id === "budget")).toMatchObject({ ok: false });
  });

  it("builds a valid 16x16 PNG for the image check", () => {
    const png = solidPng(16, [220, 30, 30]);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(16);
    const idatLength = png.readUInt32BE(33);
    const pixels = inflateSync(png.subarray(41, 41 + idatLength));
    expect(pixels.length).toBe(16 * (1 + 16 * 3));
  });
});
