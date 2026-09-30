// ABOUTME: Bridge op that enables or disables one configured Pi package.
// ABOUTME: Reloads Pi when it is idle so the package list applies without a restart.

import { setPackageEnabled } from "./package-enable";
import { asString, parseSkillScope } from "./paths";
import { scheduleReload } from "./reload-after-change";
import type { BridgeHandlers } from "./types";

export const handlers = {
  set_package_enabled: async (ctx, params) => {
    const scope = parseSkillScope(params.scope ?? "global");
    const source = asString(params.source);
    if (typeof params.enabled !== "boolean") throw new Error("enabled is required");
    const result = await setPackageEnabled(ctx, scope, source, params.enabled);
    const reload = scheduleReload(ctx);
    return {
      ok: true,
      data: { ...result, reloaded: reload.reloaded },
      postResponse: reload.postResponse,
    };
  },
} satisfies BridgeHandlers;
