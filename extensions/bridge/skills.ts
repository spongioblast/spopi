// ABOUTME: Skill folder scan and add for the Customizations page.
// ABOUTME: Listing and enabling skills go through resources.ts and resource-inventory.ts.

import { asString, parseSkillScope } from "./paths";
import { scheduleReload } from "./reload-after-change";
import { addSkillFolder, scanSkillFolder } from "./skill-install";
import type { BridgeHandlers } from "./types";

export const handlers = {
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
