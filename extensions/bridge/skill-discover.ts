// ABOUTME: Finds Pi and agents skill roots for the global and project scopes.
// ABOUTME: Collection itself lives in skill-discovery; this file adds scope and source.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  discoverSkillsFromRoot as discoverSharedFromRoot,
  type DiscoveredSkill as SharedDiscoveredSkill,
  type SkillDiagnostic as SharedSkillDiagnostic,
  type SkillDiscoveryRoot as SharedSkillDiscoveryRoot,
} from "./skill-discovery.ts";
import { CONFIG_DIR_NAME, resolveLocal } from "./skill-paths.ts";
import { isOverride, isPlainGlob } from "./skill-rules.ts";
import type {
  BuildSkillInventoryOptions,
  DiscoveredRoot,
  RawSkill,
  SkillDiagnostic,
  SkillRootKind,
  SkillScope,
} from "./skill-types.ts";

/** Map an internal root's `"user"` scope to the shared module's `"global"`. */
export function toSharedScope(scope: "user" | "project"): "global" | "project" {
  return scope === "user" ? "global" : "project";
}

/** Map a shared DiscoveredSkill back into the internal RawSkill pipeline. */
export function adaptSharedSkill(s: SharedDiscoveredSkill): RawSkill {
  return {
    canonicalPath: s.canonicalPath,
    filePath: s.filePath,
    name: s.name,
    description: s.description,
    disableModelInvocation: s.disableModelInvocation,
    isConfiguredFile: s.isConfiguredFile,
    root: adaptSharedRoot(s.root),
  };
}

/** Map a shared SkillDiscoveryRoot back to the internal DiscoveredRoot shape. */
export function adaptSharedRoot(r: SharedSkillDiscoveryRoot): DiscoveredRoot {
  return {
    dir: r.dir,
    mode: r.mode,
    baseDir: r.baseDir,
    scope: r.scope === "global" ? "user" : "project",
    source: r.source === "auto" || r.source === "local" ? r.source : "local",
  };
}

/**
 * Delegate to the shared discovery module and adapt results back into the
 * internal RawSkill pipeline. This preserves byte-compatible behavior with
 * the previous inline collector while letting package/install sources reuse
 * the same collector.
 */
export function discoverSkillsFromRoot(
  root: DiscoveredRoot,
  diagnostics: SkillDiagnostic[],
): RawSkill[] {
  const sharedRoot: SharedSkillDiscoveryRoot = {
    dir: root.dir,
    mode: root.mode,
    baseDir: root.baseDir,
    scope: toSharedScope(root.scope),
    source: root.source,
  };
  const sharedDiags: SharedSkillDiagnostic[] = diagnostics;
  return discoverSharedFromRoot(sharedRoot, sharedDiags).map(adaptSharedSkill);
}

export function findGitRoot(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function collectAncestorAgentsSkillDirs(cwd: string): string[] {
  const dirs: string[] = [];
  const gitRoot = findGitRoot(cwd);
  let dir = resolve(cwd);
  for (;;) {
    dirs.push(join(dir, ".agents", "skills"));
    if (gitRoot && dir === gitRoot) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

export function globalRoots(
  opts: BuildSkillInventoryOptions,
  settingsSkills: string[],
): DiscoveredRoot[] {
  const home = opts.homeDir ?? homedir();
  const roots: DiscoveredRoot[] = [
    {
      dir: join(opts.agentDir, "skills"),
      mode: "pi",
      baseDir: opts.agentDir,
      scope: "user",
      source: "auto",
    },
    {
      dir: join(home, ".agents", "skills"),
      mode: "agents",
      baseDir: join(home, ".agents"),
      scope: "user",
      source: "auto",
    },
  ];
  for (const entry of settingsSkills) {
    if (isOverride(entry) || isPlainGlob(entry)) continue;
    roots.push({
      dir: resolveLocal(entry, opts.agentDir),
      mode: "pi",
      baseDir: opts.agentDir,
      scope: "user",
      source: "local",
    });
  }
  return roots;
}

export function projectRoots(
  opts: BuildSkillInventoryOptions,
  settingsSkills: string[],
): DiscoveredRoot[] {
  const home = opts.homeDir ?? homedir();
  const projectBase = join(opts.cwd, CONFIG_DIR_NAME);
  const roots: DiscoveredRoot[] = [
    {
      dir: join(projectBase, "skills"),
      mode: "pi",
      baseDir: projectBase,
      scope: "project",
      source: "auto",
    },
  ];
  for (const agentsDir of collectAncestorAgentsSkillDirs(opts.cwd)) {
    if (resolve(agentsDir) === resolve(join(home, ".agents", "skills"))) continue;
    roots.push({
      dir: agentsDir,
      mode: "agents",
      baseDir: dirname(agentsDir),
      scope: "project",
      source: "auto",
    });
  }
  for (const entry of settingsSkills) {
    if (isOverride(entry) || isPlainGlob(entry)) continue;
    roots.push({
      dir: resolveLocal(entry, projectBase),
      mode: "pi",
      baseDir: projectBase,
      scope: "project",
      source: "local",
    });
  }
  return roots;
}

/** Theoretical project roots to display even when the project is untrusted. */
export function projectRootPaths(opts: BuildSkillInventoryOptions): string[] {
  const home = opts.homeDir ?? homedir();
  const paths = [join(opts.cwd, CONFIG_DIR_NAME, "skills")];
  for (const agentsDir of collectAncestorAgentsSkillDirs(opts.cwd)) {
    if (resolve(agentsDir) === resolve(join(home, ".agents", "skills"))) continue;
    paths.push(agentsDir);
  }
  return paths;
}

/**
 * Classify a discovered root into a SkillRootKind for display.
 */
export function detectRootKind(dir: string, opts: BuildSkillInventoryOptions): SkillRootKind {
  const home = opts.homeDir ?? homedir();
  if (dir === join(opts.agentDir, "skills")) return "pi";
  if (dir === join(opts.cwd, CONFIG_DIR_NAME, "skills")) return "pi";
  if (dir === join(home, ".agents", "skills")) return "agents";
  if (dir.startsWith(`${join(home, ".agents")}/skills/`)) return "agents";
  // Project local entry: depends on how it was registered.
  return "configured";
}

export function settingsPathFor(scope: SkillScope, opts: BuildSkillInventoryOptions): string {
  return scope === "global"
    ? join(opts.agentDir, "settings.json")
    : join(opts.cwd, CONFIG_DIR_NAME, "settings.json");
}
