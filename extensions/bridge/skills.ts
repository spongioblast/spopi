// ABOUTME: Skill inventory reads and enablement.
// ABOUTME: Package discovery stays in the skill modules.

import { buildPackageSkillInventory } from "./package-skill-inventory";
import {
  asString,
  parseSkillScope,
  parseSkillTarget,
  type SkillInventoryMutation,
  skillInventoryOptions,
} from "./paths";
import { scheduleReload } from "./reload-after-change";
import { addSkillFolder, scanSkillFolder } from "./skill-install";
import { buildSkillInventory, mutateSkillEnabled } from "./skill-inventory";
import type { BridgeHandlers } from "./types";

export const handlers = {
  list_package_skill_inventory: async (ctx, params) => {
    const scope = parseSkillScope(params.scope);
    return {
      ok: true,
      data: buildPackageSkillInventory(skillInventoryOptions(scope, ctx)),
    };
  },
  list_skill_inventory: async (ctx, params) => {
    const scope = parseSkillScope(params.scope);
    return { ok: true, data: buildSkillInventory(skillInventoryOptions(scope, ctx)) };
  },
  set_skill_enabled: async (ctx, params) => {
    const mutation = params as SkillInventoryMutation;
    const scope = parseSkillScope(mutation.scope);
    const target = parseSkillTarget(mutation.target);
    if (typeof mutation.enabled !== "boolean") {
      throw new Error("Invalid skill inventory mutation");
    }
    const result = await mutateSkillEnabled({
      ...skillInventoryOptions(scope, ctx),
      target,
      enabled: mutation.enabled,
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
  scan_skill_folder: async (_ctx, params) => {
    const folder = asString(params.path);
    if (!folder) throw new Error("path is required");
    return { ok: true, data: scanSkillFolder(folder) };
  },
  add_skill_folder: async (ctx, params) => {
    const folder = asString(params.path);
    const scope = parseSkillScope(params.scope);
    if (!folder) throw new Error("path is required");
    if (!Array.isArray(params.selection)) throw new Error("selection is required");
    const added = await addSkillFolder(ctx, folder, scope, params.selection);
    const reload = scheduleReload(ctx);
    return {
      ok: true,
      data: { ...added, reloaded: reload.reloaded },
      postResponse: reload.postResponse,
    };
  },
} satisfies BridgeHandlers;
