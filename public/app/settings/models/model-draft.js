// ABOUTME: Pure helpers for one models.json model entry: copies, thinking control, images, setup results.
// ABOUTME: No DOM; the model form and the provider view read and write entries through these.

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const DEFAULT_THINKING_LEVEL = "high";
export const IMAGE_RESIZE_DEFAULTS = Object.freeze({
  maxWidth: 1280,
  maxHeight: 1280,
  maxBytes: 524288,
  jpegQuality: 80,
});
const THINKING_BUDGET_FIELD = "thinking_token_budget";
const DEFAULT_CHAT_TEMPLATE_KWARGS = Object.freeze({
  enable_thinking: { $var: "thinking.enabled" },
});

/**
 * @typedef {Record<string, unknown>} Compat
 * @typedef {{
 *   id?: string,
 *   name?: string,
 *   contextWindow?: number,
 *   maxTokens?: number,
 *   reasoning?: boolean,
 *   input?: string[],
 *   inputLimits?: { images?: { resize?: Record<string, number> } } & Record<string, unknown>,
 *   thinkingLevelMap?: Record<string, string | null>,
 *   compat?: Compat,
 *   [key: string]: unknown,
 * }} ModelEntry
 * @typedef {{ compat?: Compat, [key: string]: unknown }} ProviderEntry
 * @typedef {"none" | "reasoning-effort" | "qwen-chat-template" | "chat-template" | "other"} ThinkingControl
 */

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function cloneEntry(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/** @param {ModelEntry} model */
function compatOf(model) {
  model.compat ||= {};
  return model.compat;
}

/** @param {ModelEntry} model */
function dropEmptyCompat(model) {
  if (model.compat && Object.keys(model.compat).length === 0) delete model.compat;
}

/**
 * How Pi will switch thinking for this model; model compat overrides provider compat.
 * @param {ModelEntry} model
 * @param {ProviderEntry} [provider]
 * @returns {ThinkingControl}
 */
export function thinkingControlOf(model, provider) {
  const compat = { ...(provider?.compat || {}), ...(model?.compat || {}) };
  const format = compat.thinkingFormat;
  if (format === "qwen-chat-template" || format === "chat-template") return format;
  if (typeof format === "string" && format) return "other";
  if (compat.supportsReasoningEffort === true) return "reasoning-effort";
  return "none";
}

/**
 * The provider sets a format for every model, which a model cannot switch off.
 * @param {ProviderEntry} [provider]
 */
export function providerThinkingFormat(provider) {
  const format = provider?.compat?.thinkingFormat;
  return typeof format === "string" && format ? format : "";
}

/**
 * @param {ModelEntry} model
 * @param {ThinkingControl} control
 */
export function setThinkingControl(model, control) {
  if (control === "other") return;
  const compat = compatOf(model);
  if (control === "none") {
    delete compat.thinkingFormat;
    delete compat.chatTemplateKwargs;
    if (compat.supportsReasoningEffort === true) delete compat.supportsReasoningEffort;
  } else if (control === "reasoning-effort") {
    delete compat.thinkingFormat;
    delete compat.chatTemplateKwargs;
    compat.supportsReasoningEffort = true;
  } else {
    compat.thinkingFormat = control;
    if (compat.supportsReasoningEffort === true) delete compat.supportsReasoningEffort;
    if (control === "chat-template") {
      compat.chatTemplateKwargs ||= cloneEntry(DEFAULT_CHAT_TEMPLATE_KWARGS);
    } else {
      delete compat.chatTemplateKwargs;
    }
  }
  dropEmptyCompat(model);
}

/**
 * Levels Pi offers for this model: none without reasoning; a level mapped to null is gone;
 * xhigh and max only when mapped.
 * @param {ModelEntry} model
 */
export function supportedThinkingLevels(model) {
  if (!model?.reasoning) return ["off"];
  const map = model.thinkingLevelMap;
  return THINKING_LEVELS.filter((level) => {
    if (map && level in map) return map[level] !== null;
    return level !== "xhigh" && level !== "max";
  });
}

/**
 * @param {ModelEntry} model
 * @param {string | null | undefined} saved
 */
export function effectiveThinkingLevel(model, saved) {
  const levels = supportedThinkingLevels(model);
  if (saved && levels.includes(saved)) return saved;
  if (levels.includes(DEFAULT_THINKING_LEVEL)) return DEFAULT_THINKING_LEVEL;
  return levels[levels.length - 1] || "off";
}

/** @param {ModelEntry} model */
export function acceptsImages(model) {
  return Array.isArray(model?.input) && model.input.includes("image");
}

/**
 * @param {ModelEntry} model
 * @param {boolean} on
 */
export function setAcceptsImages(model, on) {
  if (on) {
    model.input = ["text", "image"];
    model.inputLimits ||= {};
    model.inputLimits.images ||= {};
    model.inputLimits.images.resize = {
      ...IMAGE_RESIZE_DEFAULTS,
      ...(model.inputLimits.images.resize || {}),
    };
    return;
  }
  model.input = ["text"];
  if (model.inputLimits) {
    delete model.inputLimits.images;
    if (Object.keys(model.inputLimits).length === 0) delete model.inputLimits;
  }
}

/**
 * @param {ModelEntry} model
 * @param {"maxWidth" | "maxHeight" | "maxBytes"} field
 * @param {number | undefined} value
 */
export function setImageResize(model, field, value) {
  if (!acceptsImages(model)) return;
  setAcceptsImages(model, true);
  const resize = /** @type {Record<string, number>} */ (model.inputLimits?.images?.resize);
  if (value && Number.isFinite(value) && value > 0) resize[field] = Math.round(value);
  else resize[field] = IMAGE_RESIZE_DEFAULTS[field];
}

/** @param {ModelEntry} model */
export function hasThinkingBudget(model) {
  return typeof model?.compat?.thinkingTokenBudgetField === "string";
}

/**
 * @param {ModelEntry} model
 * @param {boolean} on
 */
export function setThinkingBudget(model, on) {
  if (on) compatOf(model).thinkingTokenBudgetField = THINKING_BUDGET_FIELD;
  else if (model.compat) delete model.compat.thinkingTokenBudgetField;
  dropEmptyCompat(model);
}

/**
 * @param {ModelEntry} model
 * @param {boolean} on
 */
export function setReasoning(model, on) {
  if (on) model.reasoning = true;
  else delete model.reasoning;
}

/**
 * @typedef {{ id: string, ok: boolean | null, detail: string }} SetupCheck
 * @typedef {{
 *   reasoning?: boolean,
 *   thinkingMode?: string,
 *   thinkingFormat?: string,
 *   supportsReasoningEffort?: boolean,
 *   thinkingLevelMap?: Record<string, string | null>,
 *   input?: string[],
 *   inputLimits?: ModelEntry["inputLimits"],
 *   contextWindow?: number,
 *   thinkingTokenBudgetField?: string,
 * }} SetupSuggestion
 * @typedef {{ modelId?: string, server?: string, checks?: SetupCheck[], suggestion?: SetupSuggestion }} SetupResult
 */

/**
 * Writes what Set up model found; a check that could not tell leaves its fields alone.
 * @param {ModelEntry} model
 * @param {SetupResult} result
 */
export function applySetupResult(model, result) {
  const suggestion = result?.suggestion || {};
  const checks = new Map((result?.checks || []).map((check) => [check.id, check]));
  if (suggestion.contextWindow) model.contextWindow = suggestion.contextWindow;
  if (checks.get("thinking")?.ok !== null && suggestion.thinkingMode !== "unknown") {
    setReasoning(model, suggestion.reasoning === true);
    if (suggestion.thinkingLevelMap) model.thinkingLevelMap = { ...suggestion.thinkingLevelMap };
    else delete model.thinkingLevelMap;
    if (suggestion.supportsReasoningEffort === true) {
      setThinkingControl(model, "reasoning-effort");
    } else if (suggestion.thinkingFormat === "qwen-chat-template") {
      setThinkingControl(model, "qwen-chat-template");
    }
  }
  const images = checks.get("images");
  if (images && images.ok !== null) setAcceptsImages(model, images.ok === true);
  const budget = checks.get("budget");
  if (budget && budget.ok !== null) setThinkingBudget(model, budget.ok === true);
}

/**
 * @param {ModelEntry} model
 * @param {ProviderEntry} [provider]
 */
export function modelBadges(model, provider) {
  return {
    contextWindow: typeof model?.contextWindow === "number" ? model.contextWindow : undefined,
    thinking: model?.reasoning === true,
    thinkingControl: thinkingControlOf(model, provider),
    images: acceptsImages(model),
  };
}
