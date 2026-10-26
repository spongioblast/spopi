// ABOUTME: Runs Pi's terminal-only slash commands (/compact, /model, /thinking, /export) from the composer.
// ABOUTME: RPC prompt would send them to the model as text, so each maps to its own RPC call or picker.

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/**
 * @param {{
 *   compact: (instructions: string) => Promise<string>,
 *   openModelPicker: () => void,
 *   cycleThinking: () => void,
 *   setThinkingLevel: (level: string) => Promise<unknown>,
 *   exportSession: () => Promise<unknown>,
 * }} deps
 * @returns {Record<string, (args: string) => Promise<void>>}
 */
export function createPiBuiltinCommands(deps) {
  return {
    async pi_compact(args) {
      const failure = await deps.compact(args.trim());
      if (failure) throw new Error(failure);
    },
    async pi_model() {
      deps.openModelPicker();
    },
    async pi_thinking(args) {
      const level = args.trim().toLowerCase();
      if (!level) {
        deps.cycleThinking();
        return;
      }
      if (!THINKING_LEVELS.has(level)) {
        throw new Error(
          `Unknown thinking level: ${level}. Use ${[...THINKING_LEVELS].join(", ")}.`,
        );
      }
      await deps.setThinkingLevel(level);
    },
    async pi_export() {
      await deps.exportSession();
    },
  };
}
