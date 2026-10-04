// ABOUTME: Writes settings.json keys through Pi's SettingsManager, so Pi owns their shape and lock.
// ABOUTME: Keys Pi has no setter for stay in settings-io.ts; ARCHITECTURE.md lists them.

import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";

export type PiSettingsScope = "global" | "project";

export type PiSettingsLocation = { scope?: PiSettingsScope; cwd?: string; agentDir?: string };

/**
 * A load or write failure for the scope is thrown, not swallowed: Pi skips
 * the write when the file cannot be parsed. The caller checks project trust.
 */
export async function updatePiSettings(
  apply: (manager: SettingsManager) => void,
  { scope = "global", cwd, agentDir = getAgentDir() }: PiSettingsLocation = {},
): Promise<SettingsManager> {
  if (scope === "project" && !cwd) throw new Error("Project settings require an active workspace");
  const manager = SettingsManager.create(cwd || agentDir, agentDir);
  apply(manager);
  await manager.flush();
  const failure = manager.drainErrors().find((entry) => entry.scope === scope);
  if (failure) throw failure.error;
  return manager;
}

export function updateGlobalSettings(
  apply: (manager: SettingsManager) => void,
): Promise<SettingsManager> {
  return updatePiSettings(apply);
}

/** A settings array as Pi stores it; non-strings are dropped. */
export function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}
