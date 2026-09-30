// ABOUTME: Probes a custom OpenAI-compatible base URL and suggests a provider id.
// ABOUTME: It does not write the provider into settings.

import {
  DEFAULT_OPENAI_MAX_TOKENS,
  defaultReasoning,
  groqMaxOutputTokens,
  groqThinkingLevelMap,
  isGroqBaseUrl,
  isLikelyNonChatModel,
  looksClaudeModelId,
  looksQwenThinkingModel,
  looksReasoningEffortModel,
  type ModelsJsonDocument,
  type ModelsJsonProvider,
  normalizeBaseUrl,
  openaiCompletionsCompat,
  type ProbeModel,
  type ProviderProtocol,
  sanitizeProviderId,
} from "./provider-catalog.ts";

export type {
  ConnectivityProbeResult,
  ModelsJsonDocument,
  ModelsJsonProvider,
  ProbeModel,
  ProtocolProbeAttempt,
  ProtocolProbeResult,
  ProviderProtocol,
} from "./provider-catalog.ts";
export {
  defaultReasoning,
  isLikelyNonChatModel,
  normalizeBaseUrl,
  resolveProviderId,
  sanitizeProviderId,
  suggestProviderIdFromBaseUrl,
} from "./provider-catalog.ts";
export {
  checkProviderAccess,
  detectProviderProtocol,
  fetchUpstreamModels,
  testProviderConnectivity,
} from "./provider-http.ts";

export const KEYLESS_API_KEY = "none";

export function buildModelsJsonProviderEntry(options: {
  baseUrl: string;
  protocol: ProviderProtocol;
  models: Array<string | ProbeModel>;
  apiKey?: string;
  includeApiKeyInFile?: boolean;
}): ModelsJsonProvider {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  // Full model defaults improve relay reliability (context/maxTokens/cost).
  // Minimal `{ id }` works for Ollama, but some Claude/OpenAI proxies behave
  // better with explicit windows — match pi docs "Full Example".
  const models = options.models
    .map((m) => {
      const id = typeof m === "string" ? m.trim() : String(m.id || "").trim();
      if (!id) return null;
      const advertisedContext = typeof m === "string" ? undefined : m.contextWindow;
      if (
        options.protocol === "openai-completions" &&
        isLikelyNonChatModel(id, advertisedContext)
      ) {
        return null;
      }
      const name = typeof m === "string" ? undefined : m.name ? String(m.name) : undefined;
      const looksClaude = looksClaudeModelId(id);
      const reasoning =
        typeof m !== "string" && typeof m.reasoning === "boolean"
          ? m.reasoning
          : defaultReasoning(id, options.protocol);
      const contextWindow =
        typeof m === "string"
          ? looksClaude
            ? 200000
            : 128000
          : m.contextWindow || (looksClaude ? 200000 : 128000);
      let maxTokens =
        typeof m === "string"
          ? looksClaude
            ? 8192
            : DEFAULT_OPENAI_MAX_TOKENS
          : m.maxTokens || (looksClaude ? 8192 : DEFAULT_OPENAI_MAX_TOKENS);
      if (isGroqBaseUrl(baseUrl)) {
        maxTokens = looksReasoningEffortModel(id)
          ? Math.min(groqMaxOutputTokens(id), contextWindow)
          : Math.min(maxTokens, groqMaxOutputTokens(id), contextWindow);
      } else {
        maxTokens = Math.min(maxTokens, contextWindow);
      }
      const groq = isGroqBaseUrl(baseUrl);
      const thinkingLevelMap = groq ? groqThinkingLevelMap(id) : undefined;
      const compat: Record<string, unknown> = {
        ...(groq && looksReasoningEffortModel(id) ? { supportsReasoningEffort: true } : {}),
        ...(reasoning &&
        !groq &&
        options.protocol === "openai-completions" &&
        looksQwenThinkingModel(id)
          ? { thinkingFormat: "qwen-chat-template" }
          : {}),
      };
      return {
        id,
        ...(name ? { name } : {}),
        reasoning,
        input: ["text"] as string[],
        // Preserve upstream relay metadata whenever it advertises token limits.
        // Defaults remain only for incomplete /v1/models responses.
        contextWindow,
        maxTokens,
        ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
        ...(Object.keys(compat).length > 0 ? { compat } : {}),
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      };
    })
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
  if (models.length === 0) {
    throw new Error("At least one model id is required");
  }
  const entry: ModelsJsonProvider = {
    baseUrl,
    api: options.protocol,
    models,
  };
  const apiKey = String(options.apiKey || "").trim();
  if (options.protocol === "openai-completions") {
    entry.compat = openaiCompletionsCompat(baseUrl);
    if (apiKey) entry.authHeader = true;
  }
  if (!apiKey) {
    // Pi lists a provider only when it has a key; keyless local servers ignore this one.
    entry.apiKey = KEYLESS_API_KEY;
  } else if (options.includeApiKeyInFile) {
    entry.apiKey = apiKey;
  }
  return entry;
}

export function mergeProviderIntoModelsJson(
  existing: unknown,
  providerId: string,
  entry: ModelsJsonProvider,
): ModelsJsonDocument {
  const id = sanitizeProviderId(providerId);
  const doc: ModelsJsonDocument =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as ModelsJsonDocument) }
      : { providers: {} };
  const providers =
    doc.providers && typeof doc.providers === "object" && !Array.isArray(doc.providers)
      ? { ...doc.providers }
      : {};
  providers[id] = entry;
  doc.providers = providers;
  return doc;
}
