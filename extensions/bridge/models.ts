// ABOUTME: Model catalog, visibility, health, and models.json.
// ABOUTME: Provider probes and OAuth live in their own modules.

import {
  buildModelCatalog,
  configTools,
  invalidateModelCatalogCache,
  modelPreferenceKey,
  refreshRegistryBestEffort,
  runModelHealthCheck,
} from "./model-catalog";
import { agentConfigPath, asString, modelsConfigPath } from "./paths";
import {
  backupConfigFile,
  readConfigFile,
  readSettingsRecord as readSettingsObject,
  writeConfigFile,
} from "./settings-io";
import { readEnabledModels, scopedModelId, setScopedModel } from "./thinking-prefs";
import type { BridgeHandlers } from "./types";

export const handlers = {
  list_model_catalog: async (ctx, _params) => {
    const { preferences, requireRegistry } = configTools(ctx);

    const catalog = await buildModelCatalog(requireRegistry(), preferences);
    return { ok: true, data: catalog };
  },
  set_model_visibility: async (ctx, params) => {
    const { preferences } = configTools(ctx);

    const provider = asString(params.provider);
    const modelId = asString(params.modelId);
    if (!provider || !modelId) throw new Error("provider and modelId are required");
    const visible = params.visible === true;
    preferences.setVisibility(provider, modelId, visible);
    return { ok: true, data: { provider, modelId, visible } };
  },
  check_model_health: async (ctx, params) => {
    const { preferences, requireRegistry } = configTools(ctx);

    const reg = requireRegistry();
    const provider = asString(params.provider);
    const modelId = asString(params.modelId);
    if (!provider) throw new Error("provider is required");
    const availableKeys = new Set(
      (await reg.getAvailable())
        .filter((model) => model.provider && model.id)
        .map((model) => modelPreferenceKey(model.provider as string, model.id as string)),
    );
    const models = reg.getAll().filter((model) => {
      if (model.provider !== provider || !model.id) return false;
      if (modelId) return model.id === modelId;
      return availableKeys.has(modelPreferenceKey(provider, model.id as string));
    });
    if (models.length === 0) throw new Error("No matching models available for health check");
    const results = await Promise.all(
      models.map((model) => runModelHealthCheck(reg, model, preferences)),
    );
    return { ok: true, data: { results } };
  },
  /** Reloads Pi's model list, so a model Pi did not list at start becomes selectable. */
  refresh_models: async (ctx, _params) => {
    const { registry } = configTools(ctx);
    invalidateModelCatalogCache();
    return { ok: true, data: { refreshed: await refreshRegistryBestEffort(registry) } };
  },
  list_scoped_models: async (_ctx, _params) => {
    const models = readEnabledModels(readSettingsObject(agentConfigPath()));
    return { ok: true, data: { modelIds: models.map(scopedModelId) } };
  },
  set_scoped_model: async (_ctx, params) => {
    return {
      ok: true,
      data: setScopedModel(params.provider, params.modelId, params.enabled),
    };
  },
  read_models_config: async (_ctx, _params) => {
    return { ok: true, data: readConfigFile(modelsConfigPath(), '{\n  "providers": {}\n}\n') };
  },
  write_models_config: async (ctx, params) => {
    const { registry } = configTools(ctx);

    const content = params.content;
    if (typeof content !== "string") throw new Error("content must be a string");
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("models.json must be a JSON object");
    }
    if (
      "providers" in parsed &&
      (typeof parsed.providers !== "object" || Array.isArray(parsed.providers))
    ) {
      throw new Error("'providers' must be an object");
    }
    // Keep a safety copy of the previous models.json so a bad save can be
    // rolled back; the frontend can restore it if the new content breaks.
    backupConfigFile(modelsConfigPath());
    writeConfigFile(modelsConfigPath(), content);
    invalidateModelCatalogCache();
    const refreshed = await refreshRegistryBestEffort(registry);
    return { ok: true, data: { path: modelsConfigPath(), refreshed } };
  },
} satisfies BridgeHandlers;
