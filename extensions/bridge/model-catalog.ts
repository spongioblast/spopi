// ABOUTME: Model catalog, preferences file, and health checks.
// ABOUTME: models.json writes stay with the provider and settings handlers.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  type ProbeModel,
  type ProviderProtocol,
  testProviderConnectivity,
} from "../custom-provider-probe";
import { modelHealth } from "./model-calls";
import type { RegistryInternals } from "./oauth-manager";
import { readAuthConfig } from "./oauth-manager";
import type { ConfigContext } from "./paths";
import { errMessage, modelsConfigPath, modelsPrefsPath } from "./paths";

export type ModelHealthStatus = "unknown" | "healthy" | "unhealthy";

export type ModelHealth = {
  status: ModelHealthStatus;
  checkedAt?: string;
  latencyMs?: number;
  error?: string;
};

export type ModelPreferencesFile = {
  visibility?: Record<string, boolean>;
  health?: Record<string, ModelHealth>;
};

export type CatalogModel = {
  provider?: string;
  id?: string;
  name?: string;
  contextWindow?: number;
  api?: string;
  baseUrl?: string;
  apiKey?: string;
};

export type CatalogRegistry = {
  getAll: () => CatalogModel[];
  getAvailable: () => CatalogModel[] | Promise<CatalogModel[]>;
  getProviderAuthStatus: (provider: string) => {
    configured?: boolean;
    source?: string;
    label?: string;
  };
  getProviderDisplayName: (provider: string) => string;
  // The live pi registry resolves to ModelsRefreshResult; every caller here
  // awaits and discards it, so the contract only promises "awaitable".
  refresh: () => undefined | Promise<unknown>;
  getApiKeyForProvider?: (provider: string) => Promise<string | undefined>;
  getApiKeyAndHeaders?: (model: CatalogModel) => Promise<{
    ok?: boolean;
    apiKey?: string;
  }>;
};

export const MODEL_REGISTRY_REFRESH_TIMEOUT_MS = 2_000;

export function modelPreferenceKey(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}

export function normalizeModelHealth(value: unknown): ModelHealth {
  if (!value || typeof value !== "object") return { status: "unknown" };
  const candidate = value as Partial<ModelHealth>;
  if (candidate.status !== "healthy" && candidate.status !== "unhealthy") {
    return { status: "unknown" };
  }
  const health: ModelHealth = {
    status: candidate.status,
    checkedAt: typeof candidate.checkedAt === "string" ? candidate.checkedAt : undefined,
    latencyMs: typeof candidate.latencyMs === "number" ? candidate.latencyMs : undefined,
  };
  if (typeof candidate.error === "string") health.error = candidate.error;
  return health;
}

export function sanitizeHealthError(error: unknown): string {
  const raw = errMessage(error) || "Health check failed";
  return raw
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, "[REDACTED]")
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, "bearer [REDACTED]")
    .slice(0, 240);
}

export class ModelPreferencesStore {
  readonly path: string;

  constructor(filePath = modelsPrefsPath()) {
    this.path = filePath;
  }

  read(): Required<ModelPreferencesFile> {
    if (!fs.existsSync(this.path)) return { visibility: {}, health: {} };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.path, "utf8")) as ModelPreferencesFile;
      return {
        visibility:
          parsed.visibility &&
          typeof parsed.visibility === "object" &&
          !Array.isArray(parsed.visibility)
            ? parsed.visibility
            : {},
        health:
          parsed.health && typeof parsed.health === "object" && !Array.isArray(parsed.health)
            ? parsed.health
            : {},
      };
    } catch {
      return { visibility: {}, health: {} };
    }
  }

  write(next: Required<ModelPreferencesFile>): void {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    fs.writeFileSync(this.path, JSON.stringify(next, null, 2), "utf8");
    invalidateModelCatalogCache();
  }

  /**
   * An explicit switch wins. Without one, a model the user listed in
   * models.json is on, and a built-in catalog model is off.
   */
  isVisible(provider: string, modelId: string, listed = false): boolean {
    const value = this.read().visibility[modelPreferenceKey(provider, modelId)];
    return typeof value === "boolean" ? value : listed;
  }

  setVisibility(provider: string, modelId: string, visible: boolean): void {
    const prefs = this.read();
    prefs.visibility[modelPreferenceKey(provider, modelId)] = visible;
    this.write(prefs);
  }

  getHealth(provider: string, modelId: string): ModelHealth {
    return normalizeModelHealth(this.read().health[modelPreferenceKey(provider, modelId)]);
  }

  setHealth(provider: string, modelId: string, health: ModelHealth): void {
    const prefs = this.read();
    prefs.health[modelPreferenceKey(provider, modelId)] = normalizeModelHealth(health);
    this.write(prefs);
  }

  /** Moves visibility and health entries from one provider id to another. */
  renameProvider(from: string, to: string): number {
    const prefs = this.read();
    const prefix = `${from}/`;
    let moved = 0;
    for (const table of [prefs.visibility, prefs.health] as Array<Record<string, unknown>>) {
      for (const key of Object.keys(table)) {
        if (!key.startsWith(prefix)) continue;
        table[`${to}/${key.slice(prefix.length)}`] = table[key];
        delete table[key];
        moved += 1;
      }
    }
    if (moved > 0) this.write(prefs);
    return moved;
  }
}

export const MODEL_CATALOG_CACHE_TTL_MS = 3_000;
let modelCatalogCache: {
  expires: number;
  promise: ReturnType<typeof buildModelCatalogUncached>;
} | null = null;

export function invalidateModelCatalogCache(): void {
  modelCatalogCache = null;
}

// The registry's getAvailable()/getProviderAuthStatus() probe live provider
// auth on every call; short-lived caching avoids re-probing every provider
// each time a session switch or Settings open asks for the catalog.
export async function buildModelCatalog(
  registry: CatalogRegistry,
  preferences: ModelPreferencesStore,
) {
  if (modelCatalogCache && modelCatalogCache.expires > Date.now()) {
    return modelCatalogCache.promise;
  }
  const promise = buildModelCatalogUncached(registry, preferences);
  modelCatalogCache = { expires: Date.now() + MODEL_CATALOG_CACHE_TTL_MS, promise };
  promise.catch(() => invalidateModelCatalogCache());
  return promise;
}

export async function buildModelCatalogUncached(
  registry: CatalogRegistry,
  preferences: ModelPreferencesStore,
) {
  const allModels = registry.getAll();
  const availableModels = await registry.getAvailable();
  const availableKeys = new Set(
    availableModels
      .filter((model) => model.provider && model.id)
      .map((model) => modelPreferenceKey(model.provider as string, model.id as string)),
  );
  const providerNames = Array.from(
    new Set(allModels.map((model) => model.provider).filter(Boolean)),
  ).sort() as string[];
  const listed = listedModelKeys();

  return {
    providers: providerNames.map((providerName) => {
      const status = registry.getProviderAuthStatus(providerName);
      return {
        provider: providerName,
        displayName: registry.getProviderDisplayName(providerName),
        configured: Boolean(status.configured),
        source: status.source,
        label: status.label,
        models: allModels
          .filter(
            (model) =>
              model.provider === providerName &&
              model.id &&
              availableKeys.has(modelPreferenceKey(providerName, model.id as string)),
          )
          .sort((a, b) => String(a.id).localeCompare(String(b.id)))
          .map((model) => {
            const modelId = model.id as string;
            return {
              provider: providerName,
              id: modelId,
              name: model.name,
              contextWindow: model.contextWindow,
              available: availableKeys.has(modelPreferenceKey(providerName, modelId)),
              visible: preferences.isVisible(
                providerName,
                modelId,
                listed.has(modelPreferenceKey(providerName, modelId)),
              ),
              health: preferences.getHealth(providerName, modelId),
            };
          }),
      };
    }),
  };
}

/** `provider/model` for every model entry in models.json. */
export function listedModelKeys(configPath = modelsConfigPath()): Set<string> {
  const keys = new Set<string>();
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      providers?: Record<string, { models?: Array<{ id?: unknown }> }>;
    };
    for (const [provider, entry] of Object.entries(parsed.providers ?? {})) {
      for (const model of Array.isArray(entry?.models) ? entry.models : []) {
        if (typeof model?.id === "string" && model.id) {
          keys.add(modelPreferenceKey(provider, model.id));
        }
      }
    }
  } catch {
    // No models.json, or one Pi could not read either.
  }
  return keys;
}

export function protocolFromModelApi(api: unknown): ProviderProtocol | null {
  const value = String(api || "").trim();
  if (value === "anthropic-messages") return "anthropic-messages";
  if (
    value === "openai-completions" ||
    value === "openai-responses" ||
    value === "azure-openai-responses" ||
    value === "mistral-conversations"
  ) {
    return "openai-completions";
  }
  return null;
}

export function credentialKey(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const cred = value as { type?: string; key?: unknown; access?: unknown };
  if (cred.type === "api_key" && typeof cred.key === "string" && cred.key.trim()) {
    return cred.key.trim();
  }
  if (cred.type === "oauth" && typeof cred.access === "string" && cred.access.trim()) {
    return cred.access.trim();
  }
  return undefined;
}

export async function resolveProviderApiKeyForHealthCheck(
  registry: CatalogRegistry,
  provider: string,
  model: CatalogModel,
): Promise<string | undefined> {
  if (typeof registry.getApiKeyForProvider === "function") {
    try {
      const key = await registry.getApiKeyForProvider(provider);
      if (typeof key === "string" && key.trim()) return key.trim();
    } catch {
      // fall through
    }
  }
  if (typeof registry.getApiKeyAndHeaders === "function") {
    try {
      const auth = await registry.getApiKeyAndHeaders(model);
      if (auth?.ok !== false && typeof auth?.apiKey === "string" && auth.apiKey.trim()) {
        return auth.apiKey.trim();
      }
    } catch {
      // fall through
    }
  }
  const internals = registry as CatalogRegistry & RegistryInternals;
  const store = internals.runtime?.credentials ?? internals.credentials;
  if (typeof store?.read === "function") {
    try {
      const key = credentialKey(await store.read(provider));
      if (key) return key;
    } catch {
      // fall through
    }
  }
  if (typeof model.apiKey === "string" && model.apiKey.trim()) return model.apiKey.trim();
  try {
    const key = credentialKey(readAuthConfig()[provider]);
    if (key) return key;
  } catch {
    // ignore
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(modelsConfigPath(), "utf8")) as {
      providers?: Record<string, { apiKey?: string }>;
    };
    const key = parsed.providers?.[provider]?.apiKey;
    if (typeof key === "string" && key.trim()) return key.trim();
  } catch {
    // ignore
  }
  return undefined;
}

export function asProviderProtocol(value: unknown): ProviderProtocol {
  if (value === "openai-completions" || value === "anthropic-messages") return value;
  throw new Error("protocol must be openai-completions or anthropic-messages");
}

export function parseProbeModels(params: Record<string, unknown>): ProbeModel[] {
  const modelsRaw = params.models;
  if (Array.isArray(modelsRaw)) {
    return modelsRaw
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        id: typeof item.id === "string" ? item.id.trim() : "",
        ...(typeof item.name === "string" ? { name: item.name } : {}),
        ...(typeof item.contextWindow === "number" ? { contextWindow: item.contextWindow } : {}),
        ...(typeof item.maxTokens === "number" ? { maxTokens: item.maxTokens } : {}),
        ...(typeof item.reasoning === "boolean" ? { reasoning: item.reasoning } : {}),
      }))
      .filter((model) => Boolean(model.id));
  }
  const modelIds = params.modelIds;
  if (!Array.isArray(modelIds)) return [];
  return modelIds
    .map((id) => (typeof id === "string" ? id.trim() : ""))
    .filter(Boolean)
    .map((id) => ({ id }));
}

export async function runHttpModelHealthCheck(
  registry: CatalogRegistry,
  model: CatalogModel,
): Promise<{ ok: boolean; latencyMs: number; error?: string } | null> {
  const protocol = protocolFromModelApi(model.api);
  const baseUrl = typeof model.baseUrl === "string" ? model.baseUrl.trim() : "";
  const provider = typeof model.provider === "string" ? model.provider : "";
  const modelId = typeof model.id === "string" ? model.id : "";
  if (!protocol || !baseUrl || !provider || !modelId) return null;
  const apiKey = await resolveProviderApiKeyForHealthCheck(registry, provider, model);
  if (!apiKey) return null;
  const probe = await testProviderConnectivity({
    baseUrl,
    apiKey,
    protocol,
    modelId,
  });
  return {
    ok: probe.ok,
    latencyMs: probe.latencyMs,
    error: probe.ok
      ? undefined
      : probe.error || (probe.status ? `HTTP ${probe.status}` : "Health check failed"),
  };
}

export async function runSessionModelHealthCheck(
  registry: CatalogRegistry,
  model: CatalogModel,
): Promise<{
  ok: boolean;
  error?: string;
}> {
  const probe = await modelHealth(
    {
      model,
      modelRegistry: registry as {
        streamSimple?: (
          model: unknown,
          context: {
            systemPrompt?: string;
            messages: Array<{ role: string; content: string; timestamp: number }>;
          },
        ) => AsyncIterable<{ type?: string; delta?: string }>;
      },
    },
    {
      provider: typeof model.provider === "string" ? model.provider : undefined,
      modelId: typeof model.id === "string" ? model.id : undefined,
    },
  );
  return { ok: probe.ok, error: probe.error };
}

export async function runModelHealthCheck(
  registry: CatalogRegistry,
  model: CatalogModel,
  preferences: ModelPreferencesStore,
): Promise<{ provider: string; modelId: string } & ModelHealth> {
  const provider = model.provider as string;
  const modelId = model.id as string;
  const startedAt = Date.now();
  try {
    const httpProbe = await runHttpModelHealthCheck(registry, model);
    const probe = httpProbe ?? (await runSessionModelHealthCheck(registry, model));
    const result: { provider: string; modelId: string } & ModelHealth = {
      provider,
      modelId,
      status: probe.ok ? "healthy" : "unhealthy",
      checkedAt: new Date().toISOString(),
      latencyMs: httpProbe?.latencyMs ?? Date.now() - startedAt,
      error: probe.ok ? undefined : sanitizeHealthError(probe.error || "Health check failed"),
    };
    preferences.setHealth(provider, modelId, result);
    return result;
  } catch (e: unknown) {
    const result: { provider: string; modelId: string } & ModelHealth = {
      provider,
      modelId,
      status: "unhealthy",
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      error: sanitizeHealthError(e),
    };
    preferences.setHealth(provider, modelId, result);
    return result;
  }
}

export async function refreshRegistryBestEffort(registry?: CatalogRegistry): Promise<boolean> {
  if (!registry) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), MODEL_REGISTRY_REFRESH_TIMEOUT_MS);
      timer.unref?.();
    });
    const refresh = (async () => {
      await registry.refresh();
      invalidateModelCatalogCache();
      return true;
    })().catch(() => false);
    return await Promise.race([refresh, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function configTools(ctx: ConfigContext) {
  const registry = ctx.modelRegistry;
  const preferences = new ModelPreferencesStore();
  const requireRegistry = (): CatalogRegistry => {
    if (!registry) throw new Error("Model registry not ready yet — try again in a moment.");
    return registry;
  };
  return { registry, preferences, requireRegistry };
}
