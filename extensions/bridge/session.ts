// ABOUTME: Session title, tree navigation, and paste offload.
// ABOUTME: These ops do not read models.json or settings.json.

import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { writePasteOffloadFile } from "./paste-offload";
import { asString, renameHistoricalSession } from "./paths";
import { generateTitleForSession } from "./session-title";
import type { BridgeHandlers } from "./types";

export const handlers = {
  write_paste_offload: async (ctx, params) => {
    const content = params.content;
    if (typeof content !== "string") throw new Error("content is required");
    if (!ctx.cwd) throw new Error("Active workspace is required");
    const result = writePasteOffloadFile(ctx.cwd, content);
    return { ok: true, data: { path: result.relativePath } };
  },
  navigate_tree: async (ctx, params) => {
    const targetId = asString(params.targetId);
    if (!targetId) throw new Error("targetId is required");
    if (typeof ctx.navigateTree !== "function") {
      throw new Error("Session tree navigation is unavailable.");
    }
    const result = await ctx.navigateTree(targetId, {
      summarize: params.summarize === true,
      ...(typeof params.customInstructions === "string"
        ? { customInstructions: params.customInstructions }
        : {}),
      ...(typeof params.replaceInstructions === "boolean"
        ? { replaceInstructions: params.replaceInstructions }
        : {}),
      ...(typeof params.label === "string" ? { label: params.label } : {}),
    });
    return { ok: true, data: result ?? { cancelled: false } };
  },
  set_label: async (ctx, params) => {
    const entryId = asString(params.entryId);
    const label = asString(params.label);
    if (!entryId || !label) throw new Error("entryId and label are required");
    if (typeof ctx.setLabel !== "function") throw new Error("Labels are unavailable.");
    ctx.setLabel(entryId, label);
    return { ok: true };
  },
  rename_historical_session: async (_ctx, params) => {
    const result = await renameHistoricalSession(params.filePath, params.name);
    return { ok: true, data: result };
  },
  generate_session_title: async (ctx, _params) => {
    const sessionFile = ctx.sessionManager?.getSessionFile();
    if (!sessionFile) throw new Error("The active session has not been saved yet.");
    const modelRuntime = await ModelRuntime.create();
    const title = await generateTitleForSession(sessionFile, {
      model: ctx.model,
      modelRuntime,
    });
    return { ok: true, data: { title } };
  },
} satisfies BridgeHandlers;
