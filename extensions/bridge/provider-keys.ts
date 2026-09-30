// ABOUTME: Where a custom provider's key comes from, changing it, and renaming the provider.
// ABOUTME: Key values never leave this module; status reports only the source.

import * as fs from "node:fs";
import { checkProviderAccess, KEYLESS_API_KEY } from "../custom-provider-probe";
import {
  configTools,
  protocolFromModelApi,
  refreshRegistryBestEffort,
  resolveProviderApiKeyForHealthCheck,
  sanitizeHealthError,
} from "./model-catalog";
import {
  moveStoredCredential,
  readStoredCredential,
  removeStoredApiKey,
  setStoredApiKey,
} from "./oauth-manager";
import { asString, type ConfigContext, modelsConfigPath } from "./paths";
import { backupConfigFile, writeConfigFile } from "./settings-io";
import { renameProviderInSettings } from "./thinking-prefs";
import type { BridgeHandlers } from "./types";

export type KeySource = "auth" | "env" | "command" | "literal" | "placeholder" | "none";

type ModelsDocument = {
  providers?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};

const PROVIDER_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

function readModels(): ModelsDocument {
  if (!fs.existsSync(modelsConfigPath())) return { providers: {} };
  const parsed = JSON.parse(fs.readFileSync(modelsConfigPath(), "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("models.json must be a JSON object");
  }
  return parsed as ModelsDocument;
}

function writeModels(doc: ModelsDocument): void {
  backupConfigFile(modelsConfigPath());
  writeConfigFile(modelsConfigPath(), `${JSON.stringify(doc, null, 2)}\n`);
}

function providerEntry(doc: ModelsDocument, provider: string): Record<string, unknown> {
  const entry = doc.providers?.[provider];
  if (!entry || typeof entry !== "object") {
    throw new Error(`Provider ${provider} is not in models.json`);
  }
  return entry;
}

/** How Pi reads a models.json `apiKey`: `!cmd` runs, `$NAME` / `${NAME}` interpolate, else literal. */
export function classifyModelsKey(value: unknown): KeySource {
  if (typeof value !== "string" || !value.trim()) return "none";
  const key = value.trim();
  if (key.startsWith("!")) return "command";
  if (/(^|[^$])\$(\{[A-Za-z_]\w*\}|[A-Za-z_])/.test(key)) return "env";
  if (key === KEYLESS_API_KEY) return "placeholder";
  return "literal";
}

export function isKeyReference(value: string): boolean {
  const source = classifyModelsKey(value);
  return source === "env" || source === "command";
}

async function keyStatus(ctx: ConfigContext, provider: string) {
  const { registry } = configTools(ctx);
  const stored = await readStoredCredential(registry, provider);
  const modelsKey = classifyModelsKey(readModels().providers?.[provider]?.apiKey);
  const source: KeySource = stored ? "auth" : modelsKey;
  return { source, modelsLiteral: modelsKey === "literal" };
}

export const handlers = {
  get_provider_key_status: async (ctx, params) => {
    const provider = asString(params.provider);
    if (!provider) throw new Error("provider is required");
    return { ok: true, data: await keyStatus(ctx, provider) };
  },
  /**
   * `apiKey`: a literal key, stored in auth.json; a literal in models.json is dropped.
   * `reference`: `$NAME` or `!command`, written to models.json; a stored key is removed so it applies.
   */
  set_provider_key: async (ctx, params) => {
    const { registry } = configTools(ctx);
    const provider = asString(params.provider);
    const apiKey = asString(params.apiKey);
    const reference = asString(params.reference);
    if (!provider) throw new Error("provider is required");
    if (!apiKey && !reference) throw new Error("apiKey or reference is required");
    const doc = readModels();
    const entry = providerEntry(doc, provider);
    if (reference && isKeyReference(reference)) {
      entry.apiKey = reference;
      writeModels(doc);
      await removeStoredApiKey(registry, provider);
    } else {
      await setStoredApiKey(registry, provider, apiKey || reference);
      if (classifyModelsKey(entry.apiKey) === "literal") {
        delete entry.apiKey;
        writeModels(doc);
      }
    }
    await refreshRegistryBestEffort(registry);
    return { ok: true, data: await keyStatus(ctx, provider) };
  },
  move_provider_key_to_auth: async (ctx, params) => {
    const { registry } = configTools(ctx);
    const provider = asString(params.provider);
    if (!provider) throw new Error("provider is required");
    const doc = readModels();
    const entry = providerEntry(doc, provider);
    if (classifyModelsKey(entry.apiKey) !== "literal") {
      throw new Error("models.json has no literal key for this provider");
    }
    await setStoredApiKey(registry, provider, String(entry.apiKey).trim());
    delete entry.apiKey;
    writeModels(doc);
    await refreshRegistryBestEffort(registry);
    return { ok: true, data: await keyStatus(ctx, provider) };
  },
  /** Leaves the keyless placeholder so a local server stays listed. */
  remove_provider_key: async (ctx, params) => {
    const { registry } = configTools(ctx);
    const provider = asString(params.provider);
    if (!provider) throw new Error("provider is required");
    const doc = readModels();
    const entry = providerEntry(doc, provider);
    await removeStoredApiKey(registry, provider);
    entry.apiKey = KEYLESS_API_KEY;
    delete entry.authHeader;
    writeModels(doc);
    await refreshRegistryBestEffort(registry);
    return { ok: true, data: await keyStatus(ctx, provider) };
  },
  /** Asks the server for its model list with the provider's current key (or none). */
  test_provider_access: async (ctx, params) => {
    const { registry } = configTools(ctx);
    const provider = asString(params.provider);
    if (!provider) throw new Error("provider is required");
    const entry = providerEntry(readModels(), provider);
    const baseUrl = typeof entry.baseUrl === "string" ? entry.baseUrl.trim() : "";
    if (!baseUrl) throw new Error(`Provider ${provider} has no baseUrl in models.json`);
    const api = typeof entry.api === "string" ? entry.api : "openai-completions";
    const protocol = protocolFromModelApi(api);
    if (!protocol) throw new Error("Test works with OpenAI-compatible and Anthropic servers");
    const key = registry
      ? await resolveProviderApiKeyForHealthCheck(registry, provider, { provider, baseUrl, api })
      : typeof entry.apiKey === "string"
        ? entry.apiKey
        : undefined;
    const attempt = await checkProviderAccess({
      baseUrl,
      apiKey: key === KEYLESS_API_KEY ? "" : key,
      protocol,
    });
    return {
      ok: true,
      data: {
        ok: attempt.ok,
        status: attempt.status,
        latencyMs: attempt.latencyMs,
        modelCount: attempt.models?.length ?? 0,
        needsKey: attempt.status === 401 || attempt.status === 403,
        error: attempt.ok ? undefined : sanitizeHealthError(attempt.error),
      },
    };
  },
  rename_custom_provider: async (ctx, params) => {
    const { registry, preferences } = configTools(ctx);
    const from = asString(params.from);
    const to = asString(params.to);
    if (!from || !to) throw new Error("from and to are required");
    if (!PROVIDER_ID_RE.test(to)) {
      throw new Error("Use letters, numbers, dots, dashes, or underscores (max 64)");
    }
    if (from === to) return { ok: true, data: { from, to, keyMoved: false } };
    const doc = readModels();
    const providers = doc.providers ?? {};
    providerEntry(doc, from);
    if (providers[to]) throw new Error(`Provider ${to} already exists`);
    const renamed: Record<string, Record<string, unknown>> = {};
    for (const [id, entry] of Object.entries(providers)) renamed[id === from ? to : id] = entry;
    doc.providers = renamed;
    writeModels(doc);
    const keyMoved = await moveStoredCredential(registry, from, to);
    preferences.renameProvider(from, to);
    renameProviderInSettings(from, to);
    await refreshRegistryBestEffort(registry);
    return { ok: true, data: { from, to, keyMoved } };
  },
} satisfies BridgeHandlers;
