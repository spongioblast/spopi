// ABOUTME: Detects a relay protocol and measures one connectivity request.
// ABOUTME: Tests inject fetchImpl; this module does not write models.json.

import type {
  ConnectivityProbeResult,
  FetchLike,
  ProbeModel,
  ProtocolProbeAttempt,
  ProtocolProbeResult,
  ProviderProtocol,
} from "./provider-catalog.ts";
import { normalizeBaseUrl, suggestProviderIdFromBaseUrl } from "./provider-catalog.ts";
import {
  anthropicAuthHeaders,
  joinUrl,
  looksClaudeModels,
  openaiAuthHeaders,
  parseAnthropicModels,
  parseOpenAiModels,
  scoreProtocolFromModels,
  serverFromModels,
} from "./provider-parse.ts";

export async function timedFetch(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs = 15000,
): Promise<{ response?: Response; latencyMs: number; error?: string }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    return { response, latencyMs: Date.now() - started };
  } catch (e: unknown) {
    const message =
      e instanceof Error
        ? e.name === "AbortError"
          ? `Request timed out after ${timeoutMs}ms`
          : e.message
        : String(e);
    return { latencyMs: Date.now() - started, error: message };
  } finally {
    clearTimeout(timer);
  }
}

async function probeOpenAi(
  baseUrl: string,
  apiKey: string,
  fetchImpl: FetchLike,
): Promise<ProtocolProbeAttempt> {
  const endpoint = joinUrl(baseUrl, "/v1/models");
  const { response, latencyMs, error } = await timedFetch(fetchImpl, endpoint, {
    method: "GET",
    headers: openaiAuthHeaders(apiKey),
  });
  if (error || !response) {
    return {
      protocol: "openai-completions",
      ok: false,
      latencyMs,
      endpoint,
      error: error || "No response",
    };
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      protocol: "openai-completions",
      ok: false,
      status: response.status,
      latencyMs,
      endpoint,
      error: body.slice(0, 240) || `HTTP ${response.status}`,
    };
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      protocol: "openai-completions",
      ok: false,
      status: response.status,
      latencyMs,
      endpoint,
      error: "Response is not JSON",
    };
  }
  const models = parseOpenAiModels(payload);
  // Some relays return 200 with non-list bodies for wrong protocol.
  if (models.length === 0 && !(payload as { object?: string })?.object) {
    return {
      protocol: "openai-completions",
      ok: false,
      status: response.status,
      latencyMs,
      endpoint,
      error: "No OpenAI-style model list in response",
      models: [],
    };
  }
  return {
    protocol: "openai-completions",
    ok: true,
    status: response.status,
    latencyMs,
    endpoint,
    models,
  };
}

async function probeAnthropic(
  baseUrl: string,
  apiKey: string,
  fetchImpl: FetchLike,
): Promise<ProtocolProbeAttempt> {
  // Prefer /v1/models (official + many relays). Fall back to a tiny messages
  // probe when the models endpoint is missing.
  const modelsEndpoint = joinUrl(baseUrl, "/v1/models");
  const modelsAttempt = await timedFetch(fetchImpl, modelsEndpoint, {
    method: "GET",
    headers: anthropicAuthHeaders(apiKey),
  });

  if (modelsAttempt.response?.ok) {
    try {
      const payload = await modelsAttempt.response.json();
      const models = parseAnthropicModels(payload);
      if (models.length > 0) {
        return {
          protocol: "anthropic-messages",
          ok: true,
          status: modelsAttempt.response.status,
          latencyMs: modelsAttempt.latencyMs,
          endpoint: modelsEndpoint,
          models,
        };
      }
    } catch {
      // fall through to messages probe
    }
  }

  const messagesEndpoint = joinUrl(baseUrl, "/v1/messages");
  const messagesAttempt = await timedFetch(fetchImpl, messagesEndpoint, {
    method: "POST",
    headers: anthropicAuthHeaders(apiKey),
    body: JSON.stringify({
      model: "claude-3-5-haiku-latest",
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    }),
  });

  if (messagesAttempt.error || !messagesAttempt.response) {
    const status = modelsAttempt.response?.status;
    const err =
      messagesAttempt.error ||
      (modelsAttempt.response
        ? `Models HTTP ${modelsAttempt.response.status}; messages failed`
        : modelsAttempt.error) ||
      "No response";
    return {
      protocol: "anthropic-messages",
      ok: false,
      status,
      latencyMs: messagesAttempt.latencyMs || modelsAttempt.latencyMs,
      endpoint: messagesEndpoint,
      error: err,
    };
  }

  // Auth/protocol success signals: 200, or 400/404 with anthropic-shaped error
  // (wrong model id still proves Claude protocol).
  const status = messagesAttempt.response.status;
  let bodyText = "";
  try {
    bodyText = await messagesAttempt.response.text();
  } catch {
    bodyText = "";
  }
  let payload: unknown;
  try {
    payload = bodyText ? JSON.parse(bodyText) : undefined;
  } catch {
    payload = undefined;
  }
  const looksAnthropic =
    status === 200 ||
    (typeof bodyText === "string" &&
      (bodyText.includes("type") ||
        bodyText.includes("anthropic") ||
        bodyText.includes("claude"))) ||
    (payload &&
      typeof payload === "object" &&
      ("type" in (payload as object) || "error" in (payload as object)));

  if (!looksAnthropic && status >= 500) {
    return {
      protocol: "anthropic-messages",
      ok: false,
      status,
      latencyMs: messagesAttempt.latencyMs,
      endpoint: messagesEndpoint,
      error: bodyText.slice(0, 240) || `HTTP ${status}`,
    };
  }

  if (!looksAnthropic && (status === 401 || status === 403)) {
    return {
      protocol: "anthropic-messages",
      ok: false,
      status,
      latencyMs: messagesAttempt.latencyMs,
      endpoint: messagesEndpoint,
      error: bodyText.slice(0, 240) || `HTTP ${status}`,
    };
  }

  // 401 on anthropic headers against OpenAI endpoints is common; only accept
  // if models probe already hinted anthropic OR body looks anthropic.
  if (!looksAnthropic) {
    return {
      protocol: "anthropic-messages",
      ok: false,
      status,
      latencyMs: messagesAttempt.latencyMs,
      endpoint: messagesEndpoint,
      error: bodyText.slice(0, 240) || `HTTP ${status}`,
    };
  }

  return {
    protocol: "anthropic-messages",
    ok: status < 500,
    status,
    latencyMs: messagesAttempt.latencyMs,
    endpoint: messagesEndpoint,
    models: [],
    error: status >= 400 ? bodyText.slice(0, 240) || `HTTP ${status}` : undefined,
  };
}

export function describeAttempt(attempt: ProtocolProbeAttempt): string {
  const outcome = attempt.status
    ? `HTTP ${attempt.status}${attempt.error && attempt.error !== `HTTP ${attempt.status}` ? `: ${attempt.error}` : ""}`
    : attempt.error || "no response";
  return `${attempt.endpoint} → ${outcome}`;
}

/**
 * Reads model lists only; it never sends a generation request, so servers that load
 * models on demand (LM Studio) load nothing. The Anthropic probe runs only when the
 * OpenAI probe failed, the user chose Anthropic, or the listed models look like Claude.
 */
export async function detectProviderProtocol(options: {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: FetchLike;
  preferred?: ProviderProtocol | "auto";
}): Promise<ProtocolProbeResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const apiKey = String(options.apiKey || "").trim();
  const fetchImpl = options.fetchImpl || fetch;
  const preferred = options.preferred || "auto";

  const attempts: ProtocolProbeAttempt[] = [];
  if (preferred === "anthropic-messages") {
    const anthropic = await probeAnthropic(baseUrl, apiKey, fetchImpl);
    attempts.push(anthropic);
    if (!anthropic.ok) attempts.push(await probeOpenAi(baseUrl, apiKey, fetchImpl));
  } else {
    const openai = await probeOpenAi(baseUrl, apiKey, fetchImpl);
    attempts.push(openai);
    if (!openai.ok || looksClaudeModels(openai.models || [])) {
      attempts.push(await probeAnthropic(baseUrl, apiKey, fetchImpl));
    }
  }

  const scored = attempts
    .map((attempt) => ({
      attempt,
      score:
        (attempt.ok ? 10 : 0) +
        scoreProtocolFromModels(attempt.models || [], attempt.protocol) +
        (attempt.models && attempt.models.length > 0 ? 5 : 0) -
        // Prefer faster ok attempt slightly
        (attempt.ok ? Math.min(attempt.latencyMs, 5000) / 5000 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 5) {
    return {
      baseUrl,
      protocol: "unknown",
      confidence: "none",
      models: [],
      attempts,
      suggestedId: suggestProviderIdFromBaseUrl(baseUrl),
      error:
        attempts.map(describeAttempt).join(" | ") || "Could not detect OpenAI or Claude protocol",
    };
  }

  const models = best.attempt.models || [];
  const confidence: ProtocolProbeResult["confidence"] =
    best.score >= 16 ? "high" : best.score >= 10 ? "medium" : "low";
  const server = serverFromModels(models);

  return {
    baseUrl,
    protocol: best.attempt.protocol,
    confidence,
    latencyMs: best.attempt.latencyMs,
    models,
    attempts,
    ...(server ? { server } : {}),
    suggestedId: suggestProviderIdFromBaseUrl(baseUrl, server),
  };
}

export async function fetchUpstreamModels(options: {
  baseUrl: string;
  apiKey?: string;
  protocol: ProviderProtocol;
  fetchImpl?: FetchLike;
}): Promise<{ models: ProbeModel[]; latencyMs: number; endpoint: string }> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const apiKey = String(options.apiKey || "").trim();
  const fetchImpl = options.fetchImpl || fetch;
  const attempt =
    options.protocol === "anthropic-messages"
      ? await probeAnthropic(baseUrl, apiKey, fetchImpl)
      : await probeOpenAi(baseUrl, apiKey, fetchImpl);
  if (!attempt.ok && (!attempt.models || attempt.models.length === 0)) {
    throw new Error(describeAttempt(attempt));
  }
  return {
    models: attempt.models || [],
    latencyMs: attempt.latencyMs,
    endpoint: attempt.endpoint,
  };
}

/**
 * Lists the models with the given key. Status 401 or 403 means the server wants a key.
 * A model list never loads a model, so this stays cheap on LM Studio and Ollama.
 */
export async function checkProviderAccess(options: {
  baseUrl: string;
  apiKey?: string;
  protocol: ProviderProtocol;
  fetchImpl?: FetchLike;
}): Promise<ProtocolProbeAttempt> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const apiKey = String(options.apiKey || "").trim();
  const fetchImpl = options.fetchImpl || fetch;
  return options.protocol === "anthropic-messages"
    ? probeAnthropic(baseUrl, apiKey, fetchImpl)
    : probeOpenAi(baseUrl, apiKey, fetchImpl);
}

export async function testProviderConnectivity(options: {
  baseUrl: string;
  apiKey?: string;
  protocol: ProviderProtocol;
  modelId?: string;
  fetchImpl?: FetchLike;
}): Promise<ConnectivityProbeResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const apiKey = String(options.apiKey || "").trim();
  const fetchImpl = options.fetchImpl || fetch;

  if (options.protocol === "openai-completions") {
    const model = options.modelId || "gpt-4o-mini";
    const endpoint = joinUrl(baseUrl, "/v1/chat/completions");
    const { response, latencyMs, error } = await timedFetch(fetchImpl, endpoint, {
      method: "POST",
      headers: openaiAuthHeaders(apiKey),
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    if (error || !response) {
      return {
        ok: false,
        protocol: options.protocol,
        latencyMs,
        endpoint,
        error: error || "No response",
      };
    }
    // 200 = full success; 400 often means auth+route ok but model id wrong.
    const ok = response.status < 500 && response.status !== 401 && response.status !== 403;
    let errText: string | undefined;
    if (!ok || response.status >= 400) {
      errText = (await response.text().catch(() => "")).slice(0, 240) || `HTTP ${response.status}`;
    }
    return {
      ok,
      protocol: options.protocol,
      latencyMs,
      endpoint,
      status: response.status,
      error: ok ? undefined : errText,
    };
  }

  const model = options.modelId || "claude-3-5-haiku-latest";
  const endpoint = joinUrl(baseUrl, "/v1/messages");
  const { response, latencyMs, error } = await timedFetch(fetchImpl, endpoint, {
    method: "POST",
    headers: anthropicAuthHeaders(apiKey),
    body: JSON.stringify({
      model,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  if (error || !response) {
    return {
      ok: false,
      protocol: options.protocol,
      latencyMs,
      endpoint,
      error: error || "No response",
    };
  }
  const ok = response.status < 500 && response.status !== 401 && response.status !== 403;
  let errText: string | undefined;
  if (!ok || response.status >= 400) {
    errText = (await response.text().catch(() => "")).slice(0, 240) || `HTTP ${response.status}`;
  }
  return {
    ok,
    protocol: options.protocol,
    latencyMs,
    endpoint,
    status: response.status,
    error: ok ? undefined : errText,
  };
}
