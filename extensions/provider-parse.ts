// ABOUTME: Turns /v1/models and Anthropic model payloads into probe records.
// ABOUTME: Non-chat ids are scored down so protocol detection prefers chat models.

import {
  CLAUDE_HINTS,
  isLikelyNonChatModel,
  OPENAI_COMPAT_HINTS,
  type ProbeModel,
  type ProviderProtocol,
  serverFromOwnedBy,
} from "./provider-catalog.ts";

export function joinUrl(baseUrl: string, pathPart: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const part = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
  // Avoid double /v1/v1 when user already ends with /v1
  if (base.endsWith("/v1") && part.startsWith("/v1/")) {
    return `${base}${part.slice(3)}`;
  }
  return `${base}${part}`;
}

/** A blank key sends no auth header, for keyless local servers. */
export function openaiAuthHeaders(apiKey: string): Record<string, string> {
  return {
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    "Content-Type": "application/json",
  };
}

export function anthropicAuthHeaders(apiKey: string): Record<string, string> {
  return {
    ...(apiKey ? { "x-api-key": apiKey } : {}),
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };
}

export function serverFromModels(models: ProbeModel[]): string | undefined {
  for (const model of models) {
    const server = serverFromOwnedBy(model.ownedBy);
    if (server) return server;
  }
  return undefined;
}

export function looksClaudeModels(models: ProbeModel[]): boolean {
  return models.some((model) =>
    CLAUDE_HINTS.some((hint) => `${model.id} ${model.name || ""}`.toLowerCase().includes(hint)),
  );
}

export function positiveTokenLimit(value: unknown): number | undefined {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

export function modelTokenLimit(item: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = positiveTokenLimit(item[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function parseOpenAiModels(payload: unknown): ProbeModel[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const models: ProbeModel[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== "string" || !id.trim()) continue;
    if (isLikelyNonChatModel(id.trim())) continue;
    const name =
      typeof record.name === "string"
        ? record.name
        : typeof record.display_name === "string"
          ? record.display_name
          : undefined;
    const ownedBy = typeof record.owned_by === "string" ? record.owned_by : undefined;
    const contextWindow = modelTokenLimit(record, [
      "context_window",
      "contextWindow",
      "context_length",
      "contextLength",
      "max_context_tokens",
      "maxContextTokens",
      "max_model_len",
    ]);
    const maxTokens = modelTokenLimit(record, [
      "max_output_tokens",
      "maxOutputTokens",
      "max_tokens",
      "maxTokens",
      "output_token_limit",
      "outputTokenLimit",
    ]);
    models.push({
      id: id.trim(),
      name,
      ownedBy,
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxTokens ? { maxTokens } : {}),
    });
  }
  return models.filter((model) => !isLikelyNonChatModel(model.id, model.contextWindow));
}

export function parseAnthropicModels(payload: unknown): ProbeModel[] {
  // Anthropic official: { data: [{ id, display_name, ... }] }
  const fromData = parseOpenAiModels(payload);
  if (fromData.length > 0) return fromData;
  if (!payload || typeof payload !== "object") return [];
  const models = (payload as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];
  const out: ProbeModel[] = [];
  for (const item of models) {
    if (typeof item === "string" && item.trim()) {
      out.push({ id: item.trim() });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const id =
      typeof (item as { id?: unknown }).id === "string"
        ? (item as { id: string }).id
        : typeof (item as { name?: unknown }).name === "string"
          ? (item as { name: string }).name
          : "";
    if (!id.trim()) continue;
    const record = item as Record<string, unknown>;
    const name =
      typeof record.display_name === "string"
        ? record.display_name
        : typeof record.name === "string"
          ? record.name
          : undefined;
    const contextWindow = modelTokenLimit(record, [
      "context_window",
      "contextWindow",
      "context_length",
      "contextLength",
      "max_context_tokens",
    ]);
    const maxTokens = modelTokenLimit(record, [
      "max_output_tokens",
      "maxOutputTokens",
      "max_tokens",
      "maxTokens",
      "output_token_limit",
    ]);
    out.push({
      id: id.trim(),
      name,
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxTokens ? { maxTokens } : {}),
    });
  }
  return out;
}

export function scoreProtocolFromModels(models: ProbeModel[], preferred: ProviderProtocol): number {
  if (models.length === 0) return preferred === "openai-completions" ? 1 : 0;
  let openaiHits = 0;
  let claudeHits = 0;
  for (const model of models) {
    const hay = `${model.id} ${model.name || ""} ${model.ownedBy || ""}`.toLowerCase();
    if (CLAUDE_HINTS.some((h) => hay.includes(h))) claudeHits += 1;
    if (OPENAI_COMPAT_HINTS.some((h) => hay.includes(h))) openaiHits += 1;
  }
  if (preferred === "anthropic-messages") {
    return claudeHits * 3 + (models.length > 0 ? 1 : 0) - openaiHits;
  }
  return openaiHits * 2 + (models.length > 0 ? 2 : 0) - claudeHits;
}
