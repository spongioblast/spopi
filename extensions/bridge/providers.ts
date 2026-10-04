// ABOUTME: Custom provider detection and API key storage.
// ABOUTME: Keys land in Pi's auth store or auth.json.

import * as fs from "node:fs";
import {
  buildModelsJsonProviderEntry,
  defaultReasoning,
  detectProviderProtocol,
  KEYLESS_API_KEY,
  type ModelsJsonDocument,
  mergeProviderIntoModelsJson,
  normalizeBaseUrl,
  resolveProviderId,
  testProviderConnectivity,
} from "../custom-provider-probe";
import { configureOneModel } from "../provider-model-setup";
import {
  asProviderProtocol,
  configTools,
  invalidateModelCatalogCache,
  parseProbeModels,
  refreshRegistryBestEffort,
  resolveProviderApiKeyForHealthCheck,
} from "./model-catalog";
import { removeStoredApiKey, setStoredApiKey } from "./oauth-manager";
import { asString, modelsConfigPath } from "./paths";
import { writeConfigFile } from "./settings-io";
import type { BridgeHandlers } from "./types";

function readModelsJson(): ModelsJsonDocument {
  if (!fs.existsSync(modelsConfigPath())) return { providers: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(modelsConfigPath(), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as ModelsJsonDocument)
      : { providers: {} };
  } catch {
    return { providers: {} };
  }
}

export const handlers = {
  set_api_key: async (ctx, params) => {
    const { registry } = configTools(ctx);

    const provider = asString(params.provider);
    const apiKey = asString(params.apiKey);
    if (!provider) throw new Error("provider is required");
    if (!apiKey) throw new Error("apiKey is required");
    await setStoredApiKey(registry, provider, apiKey);
    if (registry) {
      await registry.refresh();
      invalidateModelCatalogCache();
    }
    return { ok: true, data: { provider } };
  },
  remove_api_key: async (ctx, params) => {
    const { registry } = configTools(ctx);

    const provider = asString(params.provider);
    if (!provider) throw new Error("provider is required");
    await removeStoredApiKey(registry, provider);
    if (registry) {
      await registry.refresh();
      invalidateModelCatalogCache();
    }
    return { ok: true, data: { provider } };
  },
  detect_custom_provider: async (_ctx, params) => {
    const preferredRaw = asString(params.preferred) || "auto";
    const preferred =
      preferredRaw === "openai-completions" || preferredRaw === "anthropic-messages"
        ? preferredRaw
        : "auto";
    const result = await detectProviderProtocol({
      baseUrl: asString(params.baseUrl),
      apiKey: asString(params.apiKey),
      preferred,
    });
    if (result.protocol !== "unknown") {
      const protocol = result.protocol;
      result.models = result.models.map((model) => ({
        ...model,
        reasoning: defaultReasoning(model.id, protocol),
      }));
    }
    return { ok: true, data: result };
  },
  test_custom_provider: async (_ctx, params) => {
    const result = await testProviderConnectivity({
      baseUrl: asString(params.baseUrl),
      apiKey: asString(params.apiKey),
      protocol: asProviderProtocol(params.protocol),
      modelId: asString(params.modelId) || undefined,
    });
    return { ok: true, data: result };
  },
  setup_custom_model: async (ctx, params) => {
    const { registry } = configTools(ctx);
    const provider = asString(params.provider).trim();
    const modelId = asString(params.modelId).trim();
    if (!provider || !modelId) throw new Error("provider and modelId are required");
    const entry = readModelsJson().providers?.[provider];
    if (!entry?.baseUrl) throw new Error(`Provider ${provider} has no baseUrl in models.json`);
    if (entry.api && entry.api !== "openai-completions") {
      throw new Error("Set up model works with OpenAI-compatible servers");
    }
    const model = registry
      ?.getAll()
      .find((candidate) => candidate.provider === provider && candidate.id === modelId) ?? {
      provider,
      id: modelId,
      baseUrl: entry.baseUrl,
      api: entry.api,
    };
    const apiKey = registry
      ? await resolveProviderApiKeyForHealthCheck(registry, provider, model)
      : typeof entry.apiKey === "string"
        ? entry.apiKey
        : undefined;
    const result = await configureOneModel({
      baseUrl: entry.baseUrl,
      apiKey: apiKey === KEYLESS_API_KEY ? "" : apiKey,
      modelId,
      server: asString(params.server) || undefined,
    });
    return { ok: true, data: result };
  },
  save_custom_provider: async (ctx, params) => {
    const { registry } = configTools(ctx);

    const protocol = asProviderProtocol(params.protocol);
    const baseUrl = normalizeBaseUrl(asString(params.baseUrl));
    const providerId = resolveProviderId(
      asString(params.providerId),
      baseUrl,
      asString(params.server) || undefined,
    );
    const models = parseProbeModels(params);
    if (models.length === 0) throw new Error("Select at least one model");
    const apiKey = asString(params.apiKey).trim();
    const storeKey = params.storeKey !== false;
    const includeApiKeyInFile = params.includeApiKeyInFile === true;
    const entry = buildModelsJsonProviderEntry({
      baseUrl,
      protocol,
      models,
      apiKey,
      includeApiKeyInFile,
    });
    const merged = mergeProviderIntoModelsJson(readModelsJson(), providerId, entry);
    writeConfigFile(modelsConfigPath(), `${JSON.stringify(merged, null, 2)}\n`);
    let keyStored = false;
    if (storeKey && apiKey) {
      await setStoredApiKey(registry, providerId, apiKey);
      keyStored = true;
    }
    const refreshed = await refreshRegistryBestEffort(registry);
    return {
      ok: true,
      data: {
        providerId,
        baseUrl,
        protocol,
        modelCount: models.length,
        keyStored,
        refreshed,
        path: modelsConfigPath(),
      },
    };
  },
} satisfies BridgeHandlers;
