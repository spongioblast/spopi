// ABOUTME: One Codex login per Pi process, plus auth.json API key storage.
// ABOUTME: Unknown operation ids resolve as expired; the map is not persisted.

import * as fs from "node:fs";
import * as path from "node:path";
import { createOAuthLoginOperationManager } from "../oauth-login-operations";
import type { CatalogRegistry } from "./model-catalog";
import { authConfigPath } from "./paths";

// One active Codex login per embedded pi process; the in-memory map is the
// sole operation registry (design §1) — unknown ids resolve to expired.
export const oauthLoginManager = createOAuthLoginOperationManager();

export type ApiKeyCredential = { type: "api_key"; key: string };

export type CredentialStoreLike = {
  modify?: (
    provider: string,
    fn: (current: unknown) => Promise<ApiKeyCredential | undefined>,
  ) => Promise<unknown>;
  delete?: (provider: string) => Promise<void>;
  read?: (provider: string) => Promise<unknown>;
};

export type RegistryInternals = {
  runtime?: { credentials?: CredentialStoreLike };
  credentials?: CredentialStoreLike;
  authStorage?: {
    set?: (provider: string, value: ApiKeyCredential) => void | Promise<void>;
    remove?: (provider: string) => void | Promise<void>;
  };
};

export function readAuthConfig(): Record<string, unknown> {
  if (!fs.existsSync(authConfigPath())) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(authConfigPath(), "utf8"));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

export function writeAuthConfig(auth: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(authConfigPath()), { recursive: true });
  fs.writeFileSync(authConfigPath(), JSON.stringify(auth, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(authConfigPath(), 0o600);
  } catch {
    // chmod is best-effort on platforms/filesystems that do not support POSIX modes.
  }
}

export async function setStoredApiKey(
  registry: CatalogRegistry | undefined,
  provider: string,
  apiKey: string,
): Promise<void> {
  const internals = registry as (CatalogRegistry & RegistryInternals) | undefined;
  const credentials = internals?.runtime?.credentials;
  if (credentials?.modify) {
    await credentials.modify(provider, async () => ({ type: "api_key", key: apiKey }));
    return;
  }
  if (internals?.authStorage?.set) {
    await internals.authStorage.set(provider, { type: "api_key", key: apiKey });
    return;
  }
  const auth = readAuthConfig();
  auth[provider] = { type: "api_key", key: apiKey };
  writeAuthConfig(auth);
}

/** The stored credential for a provider, from Pi's credential store or auth.json. */
export async function readStoredCredential(
  registry: CatalogRegistry | undefined,
  provider: string,
): Promise<unknown> {
  const internals = registry as (CatalogRegistry & RegistryInternals) | undefined;
  const store = internals?.runtime?.credentials;
  if (typeof store?.read === "function") {
    try {
      const credential = await store.read(provider);
      if (credential) return credential;
    } catch {
      // fall back to the file
    }
  }
  return readAuthConfig()[provider];
}

/** Moves a stored credential of any type to another provider id. */
export async function moveStoredCredential(
  registry: CatalogRegistry | undefined,
  from: string,
  to: string,
): Promise<boolean> {
  const stored = await readStoredCredential(registry, from);
  if (!stored || typeof stored !== "object") return false;
  // OAuth credentials move unchanged; the store treats the value as opaque.
  const credential = stored as ApiKeyCredential;
  const internals = registry as (CatalogRegistry & RegistryInternals) | undefined;
  const credentials = internals?.runtime?.credentials;
  if (credentials?.modify) {
    await credentials.modify(to, async () => credential);
  } else if (internals?.authStorage?.set) {
    await internals.authStorage.set(to, credential);
  } else {
    const auth = readAuthConfig();
    auth[to] = credential;
    writeAuthConfig(auth);
  }
  await removeStoredApiKey(registry, from);
  return true;
}

export async function removeStoredApiKey(
  registry: CatalogRegistry | undefined,
  provider: string,
): Promise<void> {
  const internals = registry as (CatalogRegistry & RegistryInternals) | undefined;
  const credentials = internals?.runtime?.credentials;
  if (credentials?.delete) {
    await credentials.delete(provider);
    return;
  }
  if (internals?.authStorage?.remove) {
    await internals.authStorage.remove(provider);
    return;
  }
  if (!fs.existsSync(authConfigPath())) return;
  const auth = readAuthConfig();
  delete auth[provider];
  writeAuthConfig(auth);
}
