// ABOUTME: Queue delivery defaults for steering and follow-up messages.
// ABOUTME: These ops write settings.json. The session RPC call is separate.

import { readQueueModes, writeQueueMode } from "./queue-prefs";
import type { BridgeHandlers } from "./types";

export const handlers = {
  get_queue_modes: async () => {
    return { ok: true, data: readQueueModes() };
  },
  set_queue_mode: async (_ctx, params) => {
    return { ok: true, data: writeQueueMode(params.kind, params.mode) };
  },
} satisfies BridgeHandlers;
