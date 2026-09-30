// ABOUTME: Extension, skill, prompt, and theme enablement.
// ABOUTME: Writes the same filters Pi's config command would.

import { asString, parseSkillScope, skillInventoryOptions } from "./paths";
import { scheduleReload } from "./reload-after-change";
import {
  buildResourceInventory,
  type ResourceKind,
  setResourceEnabled,
} from "./resource-inventory";
import type { BridgeHandlers } from "./types";

export const handlers = {
  list_resource_inventory: async (ctx, params) => {
    const scope = parseSkillScope(params.scope);
    return { ok: true, data: buildResourceInventory(skillInventoryOptions(scope, ctx)) };
  },
  set_resource_enabled: async (ctx, params) => {
    const scope = parseSkillScope(params.scope);
    const kind = params.kind;
    const id = asString(params.id);
    if (kind !== "extension" && kind !== "skill" && kind !== "prompt" && kind !== "theme") {
      throw new Error("Invalid resource kind");
    }
    if (!id) throw new Error("id is required");
    if (typeof params.enabled !== "boolean") throw new Error("enabled is required");
    const result = await setResourceEnabled({
      ...skillInventoryOptions(scope, ctx),
      kind: kind as ResourceKind,
      id,
      enabled: params.enabled,
    });
    const reload = scheduleReload(ctx);
    return {
      ok: true,
      data: {
        ...result,
        reloaded: reload.reloaded,
        runtimeRestartRequired: !reload.reloaded,
      },
      postResponse: reload.postResponse,
    };
  },
} satisfies BridgeHandlers;
