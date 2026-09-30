// ABOUTME: Thinking-budget presets for vllm-thinking-budget.ts (vLLM only).
// ABOUTME: Writes settings.thinkingBudgets[level]; never posts a slash command.

const THINKING_BUDGET_PRESETS = [1024, 2048, 4096, 8192, 12288, 16384, 24576, 32768, 49152, 63488];

/**
 * @param {unknown} value
 * @param {{ min?: number, max?: number }} [options]
 * @returns {number}
 */
export function clampThinkingBudget(value, { min = 0, max = 65536 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * @param {unknown} current
 * @returns {number}
 */
export function nextThinkingBudget(current) {
  const value = clampThinkingBudget(current);
  const index = THINKING_BUDGET_PRESETS.findIndex((preset) => preset > value);
  return THINKING_BUDGET_PRESETS[index === -1 ? 0 : index];
}

/**
 * @param {unknown} tokens
 * @returns {string}
 */
export function formatThinkingBudget(tokens) {
  return clampThinkingBudget(tokens).toLocaleString("en-US");
}
