// ABOUTME: cacheWarming in Pi settings.json, shown beside the cache-hit chip.
// ABOUTME: The Cockpit select reads and writes it through the bridge.

import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { agentConfigPath } from "./paths";
import { readSettingsRecord } from "./settings-io";
import type { BridgeHandlers } from "./types";

const MODES = ["off", "streaming", "idle"] as const;

type CacheWarming = (typeof MODES)[number];

function modeOf(value: unknown): CacheWarming {
  return value === "off" || value === "idle" || value === "streaming" ? value : "streaming";
}

export function readCacheWarming() {
  const settings = readSettingsRecord(agentConfigPath());
  return { mode: modeOf(settings.cacheWarming), path: agentConfigPath() };
}

export function applyCacheWarmingMode(
  mode: CacheWarming,
  manager: { setCacheWarmingMode: (mode: CacheWarming) => void },
) {
  manager.setCacheWarmingMode(mode);
}

export async function writeCacheWarming(mode: unknown) {
  if (!MODES.includes(mode as CacheWarming)) {
    throw new Error("mode must be off, streaming, or idle");
  }
  const agentDir = getAgentDir();
  const manager = SettingsManager.create(agentDir, agentDir);
  applyCacheWarmingMode(mode as CacheWarming, manager);
  await manager.flush();
  return { mode, path: agentConfigPath() };
}

export const handlers = {
  get_cache_warming: async () => {
    return { ok: true, data: readCacheWarming() };
  },
  set_cache_warming: async (_ctx, params) => {
    return { ok: true, data: await writeCacheWarming(params.mode) };
  },
} satisfies BridgeHandlers;
