// ABOUTME: Sets up one model in detail: thinking on/off, images, vLLM thinking budget, context.
// ABOUTME: Sends a few tiny requests to that model (reasoning_effort included) and writes nothing.

import { deflateSync } from "node:zlib";
import type { FetchLike } from "./provider-catalog.ts";
import { normalizeBaseUrl } from "./provider-catalog.ts";
import { timedFetch } from "./provider-http.ts";
import {
  joinUrl,
  openaiAuthHeaders,
  parseOpenAiModels,
  serverFromModels,
} from "./provider-parse.ts";

export const SETUP_REQUEST_TIMEOUT_MS = 30_000;
export const SETUP_MAX_TOKENS = 16;

/** Resize defaults Pi applies to images before they reach the model. */
export const DEFAULT_IMAGE_RESIZE = {
  maxWidth: 1280,
  maxHeight: 1280,
  maxBytes: 524288,
  jpegQuality: 80,
};

export const SWITCHABLE_THINKING_LEVEL_MAP: Record<string, string | null> = {
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

/** Pi levels that can carry a `reasoning_effort` value, in Pi's order. */
export const EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** Not a real effort: a server that accepts it does not check `reasoning_effort` at all. */
const EFFORT_PROBE = "spopi-check";

/** vLLM names what it takes: "Supported types are xhigh (default), medium, and low." */
export function effortsFromError(error: string | undefined): string[] | null {
  const match = /supported types are ([^."]+)/i.exec(error || "");
  if (!match) return null;
  return EFFORT_LEVELS.filter((level) => new RegExp(`\\b${level}\\b`, "i").test(match[1]));
}

/** Each supported level sends its own name; the rest are hidden. */
export function effortLevelMap(
  levels: string[],
  off: string | null,
): Record<string, string | null> {
  const map: Record<string, string | null> = { off };
  for (const level of EFFORT_LEVELS) map[level] = levels.includes(level) ? level : null;
  return map;
}

/** A model that always thinks: off is not a choice; without a budget only one level applies. */
export function alwaysThinkingLevelMap(budget: boolean): Record<string, string | null> {
  return budget
    ? { off: null, ...SWITCHABLE_THINKING_LEVEL_MAP }
    : { off: null, minimal: null, low: null, medium: null, high: "high" };
}

export type SetupCheckId = "thinking" | "effort" | "images" | "budget" | "context";

export type SetupCheck = {
  id: SetupCheckId;
  /** true: works; false: does not; null: skipped or could not tell. */
  ok: boolean | null;
  detail: string;
};

export type ThinkingMode = "switchable" | "always" | "none" | "unknown";

export type ModelSetupSuggestion = {
  reasoning: boolean;
  thinkingMode: ThinkingMode;
  thinkingFormat?: "qwen-chat-template";
  /** The server checks `reasoning_effort`; the level map names the values it takes. */
  supportsReasoningEffort?: true;
  thinkingLevelMap?: Record<string, string | null>;
  input: string[];
  inputLimits?: { images: { resize: typeof DEFAULT_IMAGE_RESIZE } };
  contextWindow?: number;
  thinkingTokenBudgetField?: "thinking_token_budget";
};

export type ModelSetupResult = {
  modelId: string;
  server?: string;
  checks: SetupCheck[];
  suggestion: ModelSetupSuggestion;
};

type ChatReply = {
  ok: boolean;
  status?: number;
  error?: string;
  reasoning: boolean;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A solid-colour RGB PNG, built here so no binary blob ships in source. */
export function solidPng(size: number, rgb: [number, number, number]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x += 1) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** vLLM / SGLang put reasoning in `reasoning_content` or `reasoning`; raw templates leave `<think>`. */
export function replyHasReasoning(payload: unknown): boolean {
  const choice = (payload as { choices?: Array<{ message?: Record<string, unknown> }> })
    ?.choices?.[0];
  const message = choice?.message;
  if (!message) return false;
  return (
    nonEmpty(message.reasoning_content) ||
    nonEmpty(message.reasoning) ||
    nonEmpty(message.thinking) ||
    (typeof message.content === "string" && message.content.includes("<think>"))
  );
}

async function chat(
  fetchImpl: FetchLike,
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<ChatReply> {
  const { response, error } = await timedFetch(
    fetchImpl,
    endpoint,
    { method: "POST", headers: openaiAuthHeaders(apiKey), body: JSON.stringify(body) },
    timeoutMs,
  );
  if (error || !response) return { ok: false, error: error || "No response", reasoning: false };
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: text.slice(0, 240) || `HTTP ${response.status}`,
      reasoning: false,
    };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, status: response.status, error: "Response is not JSON", reasoning: false };
  }
  return { ok: true, status: response.status, reasoning: replyHasReasoning(payload) };
}

function failure(reply: ChatReply): string {
  return reply.status ? `HTTP ${reply.status}: ${reply.error}` : reply.error || "No response";
}

const IMAGE_REJECTION = /image|vision|multimodal|multi-modal|image_url|modalit/i;

type EffortProbe = { check: SetupCheck; levels: string[]; offWorks: boolean };

/**
 * Only a server that rejects a made-up effort really reads `reasoning_effort`. Its error usually
 * lists the values it takes; otherwise each level is tried. `none` counts as off only when the
 * reply then has no reasoning.
 */
async function probeEfforts(
  send: (body: Record<string, unknown>) => Promise<ChatReply>,
  base: Record<string, unknown>,
): Promise<EffortProbe> {
  const probe = await send({ ...base, reasoning_effort: EFFORT_PROBE });
  if (probe.ok) {
    return { check: { id: "effort", ok: false, detail: "ignored" }, levels: [], offWorks: false };
  }
  if (!probe.status || probe.status >= 500) {
    return {
      check: { id: "effort", ok: null, detail: failure(probe) },
      levels: [],
      offWorks: false,
    };
  }
  let levels = effortsFromError(probe.error);
  if (!levels) {
    levels = [];
    for (const level of EFFORT_LEVELS) {
      if ((await send({ ...base, reasoning_effort: level })).ok) levels.push(level);
    }
  }
  if (levels.length === 0) {
    return { check: { id: "effort", ok: false, detail: "rejected" }, levels, offWorks: false };
  }
  const none = await send({ ...base, reasoning_effort: "none" });
  const offWorks = none.ok && !none.reasoning;
  const detail = offWorks ? `${levels.join(", ")}; off: none` : levels.join(", ");
  return { check: { id: "effort", ok: true, detail }, levels, offWorks };
}

/**
 * Tiny requests against one model, `max_tokens` 16 each: thinking on, thinking off, one 16x16
 * image, (vLLM only) `thinking_token_budget`, and for a thinking model the `reasoning_effort`
 * values it takes. The model list is read once more for its context window; that loads nothing.
 */
export async function setupOneModel(options: {
  baseUrl: string;
  apiKey?: string;
  modelId: string;
  server?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<ModelSetupResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const apiKey = String(options.apiKey || "").trim();
  const modelId = String(options.modelId || "").trim();
  if (!modelId) throw new Error("modelId is required");
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs ?? SETUP_REQUEST_TIMEOUT_MS;
  const endpoint = joinUrl(baseUrl, "/v1/chat/completions");
  const checks: SetupCheck[] = [];

  let server = options.server;
  let contextWindow: number | undefined;
  const listed = await timedFetch(
    fetchImpl,
    joinUrl(baseUrl, "/v1/models"),
    { method: "GET", headers: openaiAuthHeaders(apiKey) },
    timeoutMs,
  );
  if (listed.response?.ok) {
    const models = parseOpenAiModels(await listed.response.json().catch(() => null));
    server = server || serverFromModels(models);
    contextWindow = models.find((model) => model.id === modelId)?.contextWindow;
  }
  checks.push(
    contextWindow
      ? { id: "context", ok: true, detail: String(contextWindow) }
      : { id: "context", ok: null, detail: "not reported" },
  );

  const base = {
    model: modelId,
    max_tokens: SETUP_MAX_TOKENS,
    messages: [{ role: "user", content: "Reply with OK." }],
  };
  const on = await chat(
    fetchImpl,
    endpoint,
    apiKey,
    { ...base, chat_template_kwargs: { enable_thinking: true } },
    timeoutMs,
  );
  let mode: ThinkingMode = "unknown";
  let switchable = false;
  if (on.ok) {
    const off = await chat(
      fetchImpl,
      endpoint,
      apiKey,
      { ...base, chat_template_kwargs: { enable_thinking: false } },
      timeoutMs,
    );
    if (!off.ok) {
      mode = on.reasoning ? "always" : "unknown";
      checks.push({ id: "thinking", ok: on.reasoning ? true : null, detail: failure(off) });
    } else if (on.reasoning && !off.reasoning) {
      mode = "switchable";
      switchable = true;
      checks.push({ id: "thinking", ok: true, detail: "switchable" });
    } else if (on.reasoning && off.reasoning) {
      mode = "always";
      checks.push({ id: "thinking", ok: true, detail: "always" });
    } else {
      mode = "none";
      checks.push({ id: "thinking", ok: false, detail: "none" });
    }
  } else {
    // The server refused chat_template_kwargs; ask plainly whether it reasons anyway.
    const plain = await chat(fetchImpl, endpoint, apiKey, base, timeoutMs);
    if (plain.ok) {
      mode = plain.reasoning ? "always" : "none";
      checks.push({
        id: "thinking",
        ok: plain.reasoning,
        detail: plain.reasoning ? "always" : "none",
      });
    } else {
      checks.push({ id: "thinking", ok: null, detail: failure(plain) });
    }
  }

  const noThinking = switchable ? { chat_template_kwargs: { enable_thinking: false } } : {};
  const png = solidPng(16, [220, 30, 30]).toString("base64");
  const image = await chat(
    fetchImpl,
    endpoint,
    apiKey,
    {
      ...base,
      ...noThinking,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What colour is this? One word." },
            { type: "image_url", image_url: { url: `data:image/png;base64,${png}` } },
          ],
        },
      ],
    },
    timeoutMs,
  );
  const imagesOk = image.ok;
  checks.push({
    id: "images",
    ok: image.ok ? true : image.status && image.status < 500 ? false : null,
    detail: image.ok
      ? "accepted"
      : image.status && IMAGE_REJECTION.test(image.error || "")
        ? "rejected"
        : failure(image),
  });

  let budget = false;
  const thinks = mode === "switchable" || mode === "always";
  if (server === "vllm" && thinks) {
    const reply = await chat(
      fetchImpl,
      endpoint,
      apiKey,
      {
        ...base,
        ...(switchable ? { chat_template_kwargs: { enable_thinking: true } } : {}),
        thinking_token_budget: 8,
      },
      timeoutMs,
    );
    budget = reply.ok;
    checks.push({ id: "budget", ok: reply.ok, detail: reply.ok ? "accepted" : failure(reply) });
  } else {
    checks.push({ id: "budget", ok: null, detail: server === "vllm" ? "no thinking" : "not vLLM" });
  }

  const effort = thinks
    ? await probeEfforts((body) => chat(fetchImpl, endpoint, apiKey, body, timeoutMs), base)
    : null;
  checks.push(effort?.check ?? { id: "effort", ok: null, detail: "no thinking" });
  // Switchable thinking moves to reasoning_effort only when `none` really switches it off.
  const useEffort = Boolean(effort?.levels.length) && (mode === "always" || effort?.offWorks);

  const suggestion: ModelSetupSuggestion = {
    reasoning: thinks,
    thinkingMode: mode,
    input: imagesOk ? ["text", "image"] : ["text"],
    ...(imagesOk ? { inputLimits: { images: { resize: { ...DEFAULT_IMAGE_RESIZE } } } } : {}),
    ...(contextWindow ? { contextWindow } : {}),
    ...(budget ? { thinkingTokenBudgetField: "thinking_token_budget" as const } : {}),
  };
  if (useEffort && effort) {
    suggestion.supportsReasoningEffort = true;
    suggestion.thinkingLevelMap = effortLevelMap(effort.levels, effort.offWorks ? "none" : null);
  } else if (mode === "switchable") {
    suggestion.thinkingFormat = "qwen-chat-template";
    suggestion.thinkingLevelMap = { ...SWITCHABLE_THINKING_LEVEL_MAP };
  } else if (mode === "always") {
    suggestion.thinkingLevelMap = alwaysThinkingLevelMap(budget);
  }
  return { modelId, ...(server ? { server } : {}), checks, suggestion };
}
