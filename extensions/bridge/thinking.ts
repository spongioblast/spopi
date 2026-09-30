// ABOUTME: Thinking level, budgets, and auto-compaction.
// ABOUTME: Values are stored in Pi settings.json.

import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ConfigContext } from "./paths";
import {
  getDefaultAutoCompaction,
  getDefaultAutoRetry,
  getDefaultThinkingLevel,
  getModelThinkingLevel,
  getThinkingBudgets,
  setDefaultAutoCompaction,
  setDefaultAutoRetry,
  setDefaultThinkingLevel,
  setModelThinkingLevel,
  setThinkingBudget,
} from "./thinking-prefs";
import type { BridgeHandlers } from "./types";

function settingsFor(ctx: ConfigContext): SettingsManager {
  const cwd = typeof ctx.cwd === "string" && ctx.cwd ? ctx.cwd : process.cwd();
  return SettingsManager.create(cwd, getAgentDir());
}

export const handlers = {
  get_default_thinking_level: async (ctx, params) => {
    return { ok: true, data: getDefaultThinkingLevel(params.scope, ctx) };
  },
  set_default_thinking_level: async (ctx, params) => {
    return { ok: true, data: setDefaultThinkingLevel(params.level, params.scope, ctx) };
  },
  get_model_thinking_level: async (_ctx, params) => {
    return { ok: true, data: getModelThinkingLevel(params.provider, params.modelId) };
  },
  set_model_thinking_level: async (_ctx, params) => {
    return {
      ok: true,
      data: setModelThinkingLevel(params.provider, params.modelId, params.level ?? null),
    };
  },
  get_thinking_budgets: async (ctx, _params) => {
    return { ok: true, data: getThinkingBudgets(ctx) };
  },
  set_thinking_budget: async (_ctx, params) => {
    return { ok: true, data: setThinkingBudget(params.level, params.tokens) };
  },
  get_default_auto_compaction: async (ctx, params) => {
    return { ok: true, data: getDefaultAutoCompaction(params.scope, ctx) };
  },
  set_default_auto_compaction: async (ctx, params) => {
    return { ok: true, data: setDefaultAutoCompaction(params.enabled, params.scope, ctx) };
  },
  get_default_auto_retry: async (ctx, params) => {
    return { ok: true, data: getDefaultAutoRetry(params.scope, ctx) };
  },
  set_default_auto_retry: async (ctx, params) => {
    return { ok: true, data: setDefaultAutoRetry(params.enabled, params.scope, ctx) };
  },
  get_show_thinking: async (ctx, _params) => {
    return { ok: true, data: { enabled: !settingsFor(ctx).getHideThinkingBlock() } };
  },
  set_show_thinking: async (ctx, params) => {
    if (typeof params.enabled !== "boolean") throw new Error("enabled is required");
    const manager = settingsFor(ctx);
    manager.setHideThinkingBlock(!params.enabled);
    await manager.flush();
    return { ok: true, data: { enabled: params.enabled } };
  },
} satisfies BridgeHandlers;
