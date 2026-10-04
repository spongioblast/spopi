// ABOUTME: Manual compaction from the header button: sends Pi's compact command once at a time.
// ABOUTME: Pinned context goes along as custom instructions; Pi does the compaction itself.

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
  // The coordinator tells the RPC acknowledgement apart from Pi's
  // compaction_start/compaction_end, so the UI goes idle only when Pi is done.
  const coordinator = createCompactCoordinator({
    send: async () => {
      const target = getTarget();
      const customInstructions = compactPreserveInstructions(target.sessionId || "");
      const command = customInstructions
        ? { type: "compact", customInstructions }
        : { type: "compact" };
      const frame = /** @type {{ response?: unknown } | null | undefined} */ (
        await runtime.request(command, target, { idempotencyKey: randomId() })
      );
      return frame?.response ?? { success: false };
    },
    onState: (state) => {
      contextUsage.setCompacting(state === "requested" || state === "running");
    },
  });

  async function request() {
    const status = getStatus();
    if (!contextUsage.canCompact || status.running || status.compacting || coordinator.busy) return;
    await coordinator.request();
  }

  return { coordinator, request };
}
