// ABOUTME: Turns a configured Pi package on or off in settings.json.
// ABOUTME: The write uses SettingsManager, the same shape `pi config` stores.

import { getAgentDir, type PackageSource, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ConfigContext } from "./paths";
import { serialized } from "./skill-mutate";

const RESOURCE_KEYS = ["extensions", "skills", "prompts", "themes"] as const;

function sourceOf(entry: PackageSource): string | undefined {
  if (typeof entry === "string") return entry;
  return typeof entry.source === "string" ? entry.source : undefined;
}

function isDisabled(entry: PackageSource): boolean {
  if (typeof entry === "string") return false;
  return RESOURCE_KEYS.every((key) => Array.isArray(entry[key]) && entry[key]?.length === 0);
}

function disabledEntry(source: string): PackageSource {
  return { source, extensions: [], skills: [], prompts: [], themes: [] };
}

export async function setPackageEnabled(
  ctx: ConfigContext,
  scope: "global" | "project",
  source: string,
  enabled: boolean,
): Promise<{ changed: boolean }> {
  if (scope === "project" && ctx.isProjectTrusted && !ctx.isProjectTrusted()) {
    throw new Error("Project is not trusted");
  }
  const name = source.trim();
  if (!name) throw new Error("source is required");
  const cwd = typeof ctx.cwd === "string" && ctx.cwd ? ctx.cwd : process.cwd();
  const agentDir = getAgentDir();
  return serialized(`packages:${scope}:${cwd}`, async () => {
    const manager = SettingsManager.create(cwd, agentDir);
    const settings =
      scope === "project" ? manager.getProjectSettings() : manager.getGlobalSettings();
    const packages = [...(settings.packages ?? [])];
    const index = packages.findIndex((entry) => sourceOf(entry) === name);
    if (index < 0) throw new Error(`Package not configured: ${name}`);
    const current = packages[index];
    if (typeof current === "string" && enabled) return { changed: false };
    if (!enabled) packages[index] = disabledEntry(name);
    else if (isDisabled(current)) packages[index] = name;
    else return { changed: false };
    if (scope === "project") manager.setProjectPackages(packages);
    else manager.setPackages(packages);
    await manager.flush();
    return { changed: true };
  });
}
