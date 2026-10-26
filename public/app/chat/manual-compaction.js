// ABOUTME: Manual compaction from the header button or /compact: sends Pi's compact command once at a time.
// ABOUTME: Pinned context and /compact's text go along as custom instructions; Pi does the compaction itself.

import { createCompactCoordinator } from "./compact-coordinator.js";
import { compactPreserveInstructions } from "./context-pins.js";

/**
 * @param {{
 *   runtime: import("../transport/runtime-gateway.js").RuntimeGateway,
 *   getTarget: () => { sessionId?: string },
 *   contextUsage: { canCompact: boolean, setCompacting: (on: boolean) => void },
 *   getStatus: () => { running?: boolean, compacting?: boolean },
 *   randomId: () => string,
 * }} deps
 */
export function createManualCompaction({ runtime, getTarget, contextUsage, getStatus, randomId }) {
  let instructions = "";
  let failure = "";
  // The coordinator tells the RPC acknowledgement apart from Pi's
  // compaction_start/compaction_end, so the UI goes idle only when Pi is done.
  const coordinator = createCompactCoordinator({
    send: async () => {
      const target = getTarget();
      const customInstructions = [compactPreserveInstructions(target.sessionId || ""), instructions]
        .filter(Boolean)
        .join("\n\n");
      const command = customInstructions
        ? { type: "compact", customInstructions }
        : { type: "compact" };
      try {
        const frame =
          /** @type {{ response?: { success?: boolean, error?: unknown } } | null | undefined} */ (
            await runtime.request(command, target, { idempotencyKey: randomId() })
          );
        const response = frame?.response ?? { success: false };
        if (response.success === false) failure = String(response.error || "Compaction failed");
        return response;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        throw error;
      }
    },
    onState: (state) => {
      contextUsage.setCompacting(state === "requested" || state === "running");
    },
  });

  /**
   * The header button waits for enough context; /compact leaves that call to Pi.
   * Resolves with Pi's error text when the request failed, or "".
   * @param {{ instructions?: string, fromCommand?: boolean }} [options]
   */
  async function request(options = {}) {
    const status = getStatus();
    if (status.running || status.compacting || coordinator.busy) return "";
    if (!options.fromCommand && !contextUsage.canCompact) return "";
    instructions = options.instructions?.trim() ?? "";
    failure = "";
    await coordinator.request();
    return failure;
  }

  return { coordinator, request };
}
