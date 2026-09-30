// ABOUTME: Thinking level, token budgets, and auto-compaction in settings.json.
// ABOUTME: Reads use the strict settings parser; writes take Pi's settings lock.

import * as path from "node:path";
import type { ConfigContext } from "./paths";
import { agentConfigPath, asString, PROJECT_CONFIG_DIR_NAME } from "./paths";
import {
  readSettingsRecord as readSettingsObject,
  resolveSettingsPath,
  updateSettingsObject,
} from "./settings-io";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const THINKING_LEVELS = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export function asThinkingLevel(value: unknown): ThinkingLevel {
  const level = asString(value);
  if (THINKING_LEVELS.has(level as ThinkingLevel)) return level as ThinkingLevel;
  throw new Error(`Unsupported thinking level: ${level || String(value)}`);
}

export function getProjectSettings(
  ctx: ConfigContext,
): { path: string; settings: Record<string, unknown> } | null {
  const cwd = asString(ctx.cwd);
  if (!cwd || (ctx.isProjectTrusted && !ctx.isProjectTrusted())) return null;
  const settingsPath = path.join(cwd, PROJECT_CONFIG_DIR_NAME, "settings.json");
  return { path: settingsPath, settings: readSettingsObject(settingsPath) };
}

export function getDefaultThinkingLevel(scope: unknown, ctx: ConfigContext) {
  const requestedScope = asString(scope) || "global";
  if (requestedScope === "project" || requestedScope === "effective") {
    const project = getProjectSettings(ctx);
    const projectValue = project?.settings.defaultThinkingLevel;
    if (
      project &&
      typeof projectValue === "string" &&
      THINKING_LEVELS.has(projectValue as ThinkingLevel)
    ) {
      return { level: projectValue, source: "project", path: project.path };
    }
    if (requestedScope === "project") {
      const writableProject = resolveSettingsPath("project", ctx);
      return { level: "off", source: "pi_default", path: writableProject.path };
    }
  }
  const globalValue = readSettingsObject(agentConfigPath()).defaultThinkingLevel;
  if (typeof globalValue === "string" && THINKING_LEVELS.has(globalValue as ThinkingLevel)) {
    return { level: globalValue, source: "global", path: agentConfigPath() };
  }
  return { level: "off", source: "pi_default", path: agentConfigPath() };
}

export function setDefaultThinkingLevel(level: unknown, scope: unknown, ctx: ConfigContext) {
  const thinkingLevel = asThinkingLevel(level);
  const target = resolveSettingsPath(scope, ctx);
  updateSettingsObject(target.path, (settings) => {
    settings.defaultThinkingLevel = thinkingLevel;
  });
  return { level: thinkingLevel, scope: target.scope, path: target.path };
}

function modelReference(provider: unknown, modelId: unknown): string {
  const normalizedProvider = asString(provider).trim();
  const normalizedModelId = asString(modelId).trim();
  if (!normalizedProvider || !normalizedModelId) {
    throw new Error("provider and modelId are required");
  }
  return `${normalizedProvider}/${normalizedModelId}`;
}

/** Pi's per-model thinking level: `settings.json` `modelThinkingLevels["provider/model"]`. */
export function getModelThinkingLevel(provider: unknown, modelId: unknown) {
  const reference = modelReference(provider, modelId);
  const levels = readSettingsObject(agentConfigPath()).modelThinkingLevels;
  const value =
    levels && typeof levels === "object" && !Array.isArray(levels)
      ? (levels as Record<string, unknown>)[reference]
      : undefined;
  return {
    reference,
    level: typeof value === "string" && THINKING_LEVELS.has(value as ThinkingLevel) ? value : null,
  };
}

/** `level: null` removes the entry so the global default applies again. */
export function setModelThinkingLevel(provider: unknown, modelId: unknown, level: unknown) {
  const reference = modelReference(provider, modelId);
  const thinkingLevel = level === null || level === "" ? null : asThinkingLevel(level);
  updateSettingsObject(agentConfigPath(), (settings) => {
    const existing = settings.modelThinkingLevels;
    const levels =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    if (thinkingLevel) levels[reference] = thinkingLevel;
    else delete levels[reference];
    if (Object.keys(levels).length > 0) settings.modelThinkingLevels = levels;
    else delete settings.modelThinkingLevels;
  });
  return { reference, level: thinkingLevel, path: agentConfigPath() };
}

/**
 * A provider rename in settings.json: per-model thinking levels, the enabled (scoped)
 * models, and the default provider.
 */
export function renameProviderInSettings(from: string, to: string) {
  const prefix = `${from}/`;
  const settings = readSettingsObject(agentConfigPath());
  const levels = settings.modelThinkingLevels;
  const touchesLevels =
    levels &&
    typeof levels === "object" &&
    !Array.isArray(levels) &&
    Object.keys(levels).some((key) => key.startsWith(prefix));
  const touchesEnabled = readEnabledModels(settings).some((pattern) => pattern.startsWith(prefix));
  if (!touchesLevels && !touchesEnabled && settings.defaultProvider !== from) return false;
  updateSettingsObject(agentConfigPath(), (next) => {
    const current = next.modelThinkingLevels;
    if (current && typeof current === "object" && !Array.isArray(current)) {
      const renamed: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
        renamed[key.startsWith(prefix) ? `${to}/${key.slice(prefix.length)}` : key] = value;
      }
      next.modelThinkingLevels = renamed;
    }
    const enabled = readEnabledModels(next);
    if (enabled.length > 0) {
      next.enabledModels = enabled.map((pattern) =>
        pattern.startsWith(prefix) ? `${to}/${pattern.slice(prefix.length)}` : pattern,
      );
    }
    if (next.defaultProvider === from) next.defaultProvider = to;
  });
  return true;
}

export const FALLBACK_THINKING_BUDGETS: Record<string, number> = {
  minimal: 1024,
  low: 4096,
  medium: 12288,
  high: 32768,
  xhigh: 49152,
  max: 63488,
};

export function clampBudgetTokens(value: unknown): number {
  const tokens = Number(value);
  if (!Number.isFinite(tokens)) throw new Error("tokens must be a number");
  return Math.min(65536, Math.max(0, Math.round(tokens)));
}

export function parseThinkingBudgets(value: unknown): Record<string, number> {
  const budgets = { ...FALLBACK_THINKING_BUDGETS };
  if (!value || typeof value !== "object" || Array.isArray(value)) return budgets;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (key === "off" || !THINKING_LEVELS.has(key as ThinkingLevel)) continue;
    const tokens = Number(raw);
    if (!Number.isFinite(tokens)) continue;
    budgets[key] = Math.min(65536, Math.max(0, Math.round(tokens)));
  }
  return budgets;
}

export function getThinkingBudgets(ctx: ConfigContext) {
  const { level } = getDefaultThinkingLevel("effective", ctx);
  const settings = readSettingsObject(agentConfigPath());
  return { level, budgets: parseThinkingBudgets(settings.thinkingBudgets) };
}

export function setThinkingBudget(level: unknown, tokens: unknown) {
  const thinkingLevel = asThinkingLevel(level);
  if (thinkingLevel === "off") {
    throw new Error("Thinking budget does not apply when thinking is off");
  }
  const clamped = clampBudgetTokens(tokens);
  updateSettingsObject(agentConfigPath(), (settings) => {
    const existing = settings.thinkingBudgets;
    const budgets =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    budgets[thinkingLevel] = clamped;
    settings.thinkingBudgets = budgets;
  });
  return { level: thinkingLevel, tokens: clamped, path: agentConfigPath() };
}

export function getCompactionEnabled(settings: Record<string, unknown>): boolean | undefined {
  const compaction = settings.compaction;
  if (!compaction || typeof compaction !== "object" || Array.isArray(compaction)) return undefined;
  const enabled = (compaction as Record<string, unknown>).enabled;
  return typeof enabled === "boolean" ? enabled : undefined;
}

export function getDefaultAutoCompaction(scope: unknown, ctx: ConfigContext) {
  const requestedScope = asString(scope) || "global";
  if (requestedScope === "project" || requestedScope === "effective") {
    const project = getProjectSettings(ctx);
    const projectValue = project ? getCompactionEnabled(project.settings) : undefined;
    if (typeof projectValue === "boolean") {
      return { enabled: projectValue, source: "project", path: project?.path };
    }
    if (requestedScope === "project") {
      const writableProject = resolveSettingsPath("project", ctx);
      return { enabled: true, source: "pi_default", path: writableProject.path };
    }
  }
  const globalValue = getCompactionEnabled(readSettingsObject(agentConfigPath()));
  if (typeof globalValue === "boolean") {
    return { enabled: globalValue, source: "global", path: agentConfigPath() };
  }
  return { enabled: true, source: "pi_default", path: agentConfigPath() };
}

export function setDefaultAutoCompaction(enabled: unknown, scope: unknown, ctx: ConfigContext) {
  if (typeof enabled !== "boolean") throw new Error("enabled must be a boolean");
  const target = resolveSettingsPath(scope, ctx);
  updateSettingsObject(target.path, (settings) => {
    const existing = settings.compaction;
    const compaction =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    compaction.enabled = enabled;
    settings.compaction = compaction;
  });
  return { enabled, scope: target.scope, path: target.path };
}

export function getDefaultAutoRetry(scope: unknown, _ctx: ConfigContext) {
  const settings = readSettingsObject(agentConfigPath());
  const retry = settings.retry;
  const enabled =
    retry && typeof retry === "object" && !Array.isArray(retry)
      ? (retry as Record<string, unknown>).enabled
      : undefined;
  return {
    enabled: typeof enabled === "boolean" ? enabled : true,
    source: typeof enabled === "boolean" ? "global" : "pi_default",
    path: agentConfigPath(),
    scope: asString(scope) || "global",
  };
}

export function setDefaultAutoRetry(enabled: unknown, scope: unknown, _ctx: ConfigContext) {
  if (typeof enabled !== "boolean") throw new Error("enabled must be a boolean");
  updateSettingsObject(agentConfigPath(), (settings) => {
    const existing = settings.retry;
    const retry =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    retry.enabled = enabled;
    settings.retry = retry;
  });
  return { enabled, scope: asString(scope) || "global", path: agentConfigPath() };
}

export function readEnabledModels(settings: Record<string, unknown>): string[] {
  return Array.isArray(settings.enabledModels)
    ? settings.enabledModels.filter(
        (model): model is string => typeof model === "string" && model.trim().length > 0,
      )
    : [];
}

// Composer favorites are provider/model pairs; a persisted thinking-level
// suffix (`provider/model:level`) is stripped so the UI matches on identity.
export function scopedModelId(pattern: string): string {
  const suffixIndex = pattern.lastIndexOf(":");
  return suffixIndex === -1 ? pattern : pattern.slice(0, suffixIndex);
}

export function setScopedModel(provider: unknown, modelId: unknown, enabled: unknown) {
  const normalizedProvider = asString(provider);
  const normalizedModelId = asString(modelId);
  if (!normalizedProvider || !normalizedModelId) {
    throw new Error("provider and modelId are required");
  }
  if (typeof enabled !== "boolean") throw new Error("enabled must be a boolean");
  const reference = `${normalizedProvider}/${normalizedModelId}`;
  let modelIds: string[] = [];
  updateSettingsObject(agentConfigPath(), (settings) => {
    const current = readEnabledModels(settings);
    const withoutModel = current.filter((pattern) => scopedModelId(pattern) !== reference);
    const models = enabled ? [...withoutModel, reference] : withoutModel;
    if (models.length > 0) settings.enabledModels = models;
    else delete settings.enabledModels;
    modelIds = models.map(scopedModelId);
  });
  return {
    provider: normalizedProvider,
    modelId: normalizedModelId,
    enabled,
    modelIds,
  };
}
