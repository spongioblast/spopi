// ABOUTME: Codex device-code login for the Settings models page.
// ABOUTME: One login runs per Pi process; other providers are rejected.

import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { OAuthOperationEvent } from "../oauth-login-operations";
import { configTools, invalidateModelCatalogCache } from "./model-catalog";
import { oauthLoginManager } from "./oauth-manager";
import { asString } from "./paths";
import { createPiOAuthLoginAdapter } from "./pi-oauth-login-adapter";
import type { BridgeHandlers } from "./types";

export const handlers = {
  get_oauth_login_capabilities: async (_ctx, _params) => {
    const runtime = await ModelRuntime.create();
    const adapter = createPiOAuthLoginAdapter(runtime);
    const capability = await adapter.getCodexCapability();
    if (capability.kind !== "supported") {
      // Unsupported / unavailable providers report an empty list rather
      // than a synthesized capability (baseline protocol rule).
      return { ok: true, data: { providers: [] } };
    }
    // ModelRuntime.checkAuth returns AuthCheck | undefined; an AuthCheck
    // means Pi holds a usable credential regardless of method.
    const configured = Boolean(await runtime.checkAuth("openai-codex"));
    return {
      ok: true,
      data: { providers: [{ providerId: "openai-codex", deviceCode: true, configured }] },
    };
  },
  start_oauth_login: async (ctx, params) => {
    const { registry } = configTools(ctx);

    const provider = asString(params.provider);
    const method = asString(params.method);
    if (provider !== "openai-codex" || method !== "device_code") {
      throw new Error("Unsupported OAuth provider or method");
    }
    if (!ctx.oauthNotify) throw new Error("OAuth event channel is unavailable");
    const started = oauthLoginManager.start();
    const emit = (event: OAuthOperationEvent) => ctx.oauthNotify?.(event);
    // Fire-and-forget: the response resolves immediately with the
    // operation id; device-code/progress/terminal events stream over the
    // config notify channel afterwards.
    void (async () => {
      const runtime = await ModelRuntime.create();
      const adapter = createPiOAuthLoginAdapter(runtime);
      let expiryTimer: ReturnType<typeof setTimeout> | null = null;
      const clearExpiryTimer = () => {
        if (expiryTimer) {
          clearTimeout(expiryTimer);
          expiryTimer = null;
        }
      };
      try {
        await adapter.startCodexDeviceCodeLogin(
          {
            onDeviceCode: (code) => {
              try {
                emit(oauthLoginManager.bindDeviceCode(started.operationId, code));
                if (code.expiresInSeconds && code.expiresInSeconds > 0) {
                  clearExpiryTimer();
                  expiryTimer = setTimeout(() => {
                    expiryTimer = null;
                    try {
                      emit(oauthLoginManager.expire(started.operationId));
                    } catch {
                      // Operation already terminal.
                    }
                  }, code.expiresInSeconds * 1000);
                }
              } catch {
                // Operation already terminal; nothing to emit.
              }
            },
            onProgress: (message) => {
              try {
                emit(oauthLoginManager.bindProgress(started.operationId, message));
              } catch {
                // Operation already terminal; nothing to emit.
              }
            },
          },
          started.signal,
        );
        clearExpiryTimer();
        try {
          emit(oauthLoginManager.complete(started.operationId));
          if (registry) {
            await registry.refresh();
            invalidateModelCatalogCache();
          }
        } catch {
          // Already removed (cancelled/expired) — nothing to complete.
        }
      } catch (error) {
        clearExpiryTimer();
        const aborted = (error as Error | null)?.name === "AbortError";
        try {
          const event = aborted
            ? oauthLoginManager.cancel(started.operationId)
            : oauthLoginManager.fail(started.operationId, error);
          if (event) emit(event);
        } catch {
          // Already terminal; nothing to emit.
        }
      }
    })().catch((error) => {
      console.warn("[spopi-bridge] OAuth login chain error:", error);
    });
    return {
      ok: true,
      data: { operationId: started.operationId, provider: "openai-codex", state: "starting" },
    };
  },
  cancel_oauth_login: async (ctx, params) => {
    const _op = "cancel_oauth_login";

    const operationId = asString(params.operationId);
    if (!operationId) throw new Error("operationId is required");
    // Unknown ids are a tolerated no-op (map wiped by restart/reload);
    // the UI treats them as expired per design §5.
    const cancelled = oauthLoginManager.cancel(operationId);
    if (cancelled) ctx.oauthNotify?.(cancelled);
    return { ok: true, data: { operationId } };
  },
  oauth_logout: async (ctx, params) => {
    const { registry } = configTools(ctx);
    const _op = "oauth_logout";

    const provider = asString(params.provider);
    // Same codex-only whitelist as start_oauth_login (design §3): the
    // op surface never forwards another provider to runtime.logout().
    if (provider !== "openai-codex") throw new Error("Unsupported OAuth provider");
    const runtime = await ModelRuntime.create();
    await runtime.logout(provider);
    if (registry) {
      await registry.refresh();
      invalidateModelCatalogCache();
    }
    return { ok: true, data: { provider } };
  },
} satisfies BridgeHandlers;
