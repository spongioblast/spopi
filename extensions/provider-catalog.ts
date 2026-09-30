// ABOUTME: Provider ids, base URLs, and models.json field defaults.
// ABOUTME: Network probes live next to this file; this module does not fetch.

export type ProviderProtocol = "openai-completions" | "anthropic-messages";

export type ProbeModel = {
  id: string;
  name?: string;
  ownedBy?: string;
  /** Context-window tokens advertised by the upstream relay, when supplied. */
  contextWindow?: number;
  /** Maximum output tokens advertised by the upstream relay, when supplied. */
  maxTokens?: number;
  /** Whether the model thinks: a name hint from Detect, or the user's choice on save. */
  reasoning?: boolean;
};

export type ProtocolProbeAttempt = {
  protocol: ProviderProtocol;
  ok: boolean;
  status?: number;
  latencyMs: number;
  endpoint: string;
  error?: string;
  models?: ProbeModel[];
};

export type ProtocolProbeResult = {
  baseUrl: string;
  protocol: ProviderProtocol | "unknown";
  confidence: "high" | "medium" | "low" | "none";
  latencyMs?: number;
  models: ProbeModel[];
  attempts: ProtocolProbeAttempt[];
  /** Serving software named by `owned_by` (vllm, sglang, ollama, lmstudio, llamacpp). */
  server?: string;
  /** Provider id to prefill when the user left it blank. */
  suggestedId?: string;
  error?: string;
};

export type ConnectivityProbeResult = {
  ok: boolean;
  protocol: ProviderProtocol;
  latencyMs: number;
  endpoint: string;
  status?: number;
  error?: string;
};

export type ModelsJsonProvider = {
  baseUrl: string;
  api: ProviderProtocol;
  apiKey?: string;
  authHeader?: boolean;
  models: Array<{
    id: string;
    name?: string;
    reasoning?: boolean;
    input?: string[];
    inputLimits?: Record<string, unknown>;
    contextWindow?: number;
    maxTokens?: number;
    cost?: Record<string, number>;
    thinkingLevelMap?: Record<string, string | null>;
    compat?: Record<string, unknown>;
  }>;
  compat?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ModelsJsonDocument = {
  providers?: Record<string, ModelsJsonProvider>;
  [key: string]: unknown;
};

export type FetchLike = typeof fetch;

export const OPENAI_COMPAT_HINTS = [
  "openai",
  "gpt-",
  "o1",
  "o3",
  "deepseek",
  "qwen",
  "glm",
  "moonshot",
  "doubao",
  "yi-",
  "llama",
  "mistral",
  "gemini",
];

export const CLAUDE_HINTS = ["claude", "anthropic", "haiku", "sonnet", "opus"];

/** Audio / classifier / TTS ids that Groq (and similar catalogs) mix into /v1/models. */
export const NON_CHAT_MODEL_HINTS = [
  "whisper",
  "tts",
  "orpheus",
  "prompt-guard",
  "playai",
  "distil-whisper",
  "canopylabs/",
];

/** Models that take OpenAI `reasoning_effort` (Groq maps levels onto it). */
export const REASONING_EFFORT_MODEL_HINTS = ["gpt-oss", "o1", "o3", "o4", "/compound"];

/** Name hints for models that reason. Detection sends no requests, so this stays conservative. */
export const REASONING_MODEL_HINTS = [
  ...REASONING_EFFORT_MODEL_HINTS,
  "qwen3",
  "qwq",
  "deepseek-r1",
  "glm-4.5",
  "glm-5",
  "kimi-k2-thinking",
  "magistral",
  "-thinking",
];

/** `owned_by` values that name the serving software. */
export const SERVER_OWNED_BY: Record<string, string> = {
  vllm: "vllm",
  sglang: "sglang",
  library: "ollama",
  ollama: "ollama",
  organization_owner: "lmstudio",
  lmstudio: "lmstudio",
  llamacpp: "llamacpp",
};

export const DEFAULT_OPENAI_MAX_TOKENS = 16384;
/** Groq on_demand TPM is a per-request ceiling; max_completion_tokens counts against it. */
export const GROQ_CHAT_MAX_OUTPUT_TOKENS = 2048;
/** gpt-oss still needs headroom for reasoning, but 32k blows Groq's 8k free TPM. */
export const GROQ_REASONING_MAX_OUTPUT_TOKENS = 2048;
export const MIN_AGENT_CONTEXT_WINDOW = 2048;

export function isLikelyNonChatModel(id: string, contextWindow?: number): boolean {
  const hay = String(id || "").toLowerCase();
  if (!hay) return true;
  if (NON_CHAT_MODEL_HINTS.some((hint) => hay.includes(hint))) return true;
  if (contextWindow && contextWindow > 0 && contextWindow < MIN_AGENT_CONTEXT_WINDOW) return true;
  return false;
}

export function looksReasoningModel(id: string): boolean {
  const hay = String(id || "").toLowerCase();
  return REASONING_MODEL_HINTS.some((hint) => hay.includes(hint));
}

export function looksClaudeModelId(id: string): boolean {
  return /claude|opus|sonnet|haiku|anthropic/i.test(id);
}

/** Name-hint default for `reasoning`; no request is sent. */
export function defaultReasoning(id: string, protocol: ProviderProtocol): boolean {
  return looksClaudeModelId(id) || looksReasoningModel(id) || protocol === "anthropic-messages";
}

export function looksReasoningEffortModel(id: string): boolean {
  const hay = String(id || "").toLowerCase();
  return REASONING_EFFORT_MODEL_HINTS.some((hint) => hay.includes(hint));
}

/** Qwen3 / QwQ switch thinking through `chat_template_kwargs.enable_thinking`. */
export function looksQwenThinkingModel(id: string): boolean {
  const hay = String(id || "").toLowerCase();
  return hay.includes("qwen3") || hay.includes("qwq");
}

export function serverFromOwnedBy(ownedBy: string | undefined): string | undefined {
  if (!ownedBy) return undefined;
  return SERVER_OWNED_BY[ownedBy.trim().toLowerCase()];
}

export function isGroqBaseUrl(baseUrl: string): boolean {
  return /groq\.com/i.test(baseUrl);
}

/**
 * Custom OpenAI-compatible hosts are not api.openai.com.
 * Pi auto-detects unknown hosts as full OpenAI and sends `store` / `strict`,
 * which Groq and most relays reject (health check still passes because it
 * only sends a tiny un-tooled ping).
 */
export function openaiCompletionsCompat(baseUrl: string): Record<string, unknown> {
  const groq = isGroqBaseUrl(baseUrl);
  return {
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsStore: false,
    supportsStrictMode: false,
    supportsLongCacheRetention: false,
    maxTokensField: groq ? "max_completion_tokens" : "max_tokens",
  };
}

export function groqMaxOutputTokens(id: string): number {
  return looksReasoningEffortModel(id)
    ? GROQ_REASONING_MAX_OUTPUT_TOKENS
    : GROQ_CHAT_MAX_OUTPUT_TOKENS;
}

export function groqThinkingLevelMap(id: string): Record<string, string> | undefined {
  if (!looksReasoningEffortModel(id)) return undefined;
  // Groq gpt-oss only accepts low | medium | high (no off/none).
  return {
    off: "low",
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "high",
    max: "high",
  };
}

export function normalizeBaseUrl(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) throw new Error("baseUrl is required");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("baseUrl must be a valid absolute URL (http/https)");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("baseUrl must use http or https");
  }
  // Drop trailing slash; keep path prefix used by many Chinese relay stations.
  url.hash = "";
  url.search = "";
  let href = url.toString();
  if (href.endsWith("/")) href = href.slice(0, -1);
  return href;
}

/**
 * Normalize a provider id for models.json / auth.json keys.
 * Only [a-z0-9._-] are kept. Empty after sanitize is an error — callers that
 * want auto-id should use resolveProviderId(raw, baseUrl).
 */
export function sanitizeProviderId(raw: string): string {
  const id = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/-{2,}/g, "-");
  if (!id) throw new Error("provider id is required");
  if (id.length > 64) throw new Error("provider id is too long (max 64)");
  return id;
}

function isLocalOrIpHost(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "");
  return (
    bare === "localhost" ||
    bare.endsWith(".localhost") ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(bare) ||
    bare.includes(":")
  );
}

/**
 * Derive a stable provider id: the server name when known (`vllm`), `local-<port>` for
 * loopback and IP hosts, otherwise the last two DNS labels (api.foo.example.com → example-com).
 */
export function suggestProviderIdFromBaseUrl(baseUrl: string, server?: string): string {
  if (server && /^[a-z0-9._-]+$/.test(server)) return server;
  let host = "";
  let port = "";
  try {
    const url = new URL(normalizeBaseUrl(baseUrl));
    host = url.hostname || "";
    port = url.port || (url.protocol === "https:" ? "443" : "80");
  } catch {
    const authority = String(baseUrl || "")
      .replace(/^https?:\/\//i, "")
      .split("/")[0];
    host = authority.split(":")[0];
    port = authority.split(":")[1] || "";
  }
  if (host && isLocalOrIpHost(host.toLowerCase())) return port ? `local-${port}` : "local";
  host = host
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!host) return "custom-relay";
  // Prefer last two DNS labels when long (api.foo.example.com → example-com)
  const parts = host.split(".").filter(Boolean);
  let slug = parts.length >= 2 ? `${parts[parts.length - 2]}-${parts[parts.length - 1]}` : host;
  slug = slug.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) slug = "custom-relay";
  if (slug.length > 48) slug = slug.slice(0, 48).replace(/-+$/g, "");
  return slug;
}

/**
 * Resolve provider id: use raw when it sanitizes cleanly; otherwise fall back to baseUrl host.
 * Chinese-only names are not valid models.json keys — auto-derive instead of failing opaquely.
 */
export function resolveProviderId(
  raw: string | undefined,
  baseUrl?: string,
  server?: string,
): string {
  const trimmed = String(raw || "").trim();
  if (trimmed) {
    try {
      return sanitizeProviderId(trimmed);
    } catch {
      // fall through to baseUrl / default
    }
  }
  if (baseUrl && String(baseUrl).trim()) {
    return sanitizeProviderId(suggestProviderIdFromBaseUrl(baseUrl, server));
  }
  throw new Error(
    "provider id is required (use English letters/numbers, or leave blank to auto-fill from Base URL)",
  );
}
