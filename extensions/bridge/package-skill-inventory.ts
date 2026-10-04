// ABOUTME: Resolves configured Pi package skill sources into installed roots and identity.
// ABOUTME: Read-only: parses settings.json packages[], dedupes by identity, and resolves install roots.

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { collectPackageSkillCandidates } from "./package-skill-candidates.ts";
import { type ParsedPackageSource, packageIdentity, parsePackageSource } from "./package-source.ts";
import type { BuildSkillInventoryOptions, SkillDiagnostic, SkillScope } from "./skill-inventory.ts";

const CONFIG_DIR_NAME = ".pi";

export type PackageSkillInventoryOptions = BuildSkillInventoryOptions;

export type PackageSkillCandidate = {
  id: string;
  canonicalPath: string;
  relativePath: string;
  name: string;
  description: string;
  diagnostics: SkillDiagnostic[];
};

export type PackageSkillCard = {
  id: string;
  source: string;
  identity: string;
  scope: SkillScope; // "global" | "project"
  effectivePackageRoot?: string;
  version?: string;
  candidates: PackageSkillCandidate[];
  diagnostics: SkillDiagnostic[];
};

export type PackageSkillInventory = {
  scope: SkillScope; // selected emphasis/count scope, not a resolution filter
  trusted: boolean;
  packages: PackageSkillCard[];
  diagnostics: SkillDiagnostic[];
};

// Internal resolution types (Task 2 produces source/identity/root only;
// Task 3 builds candidates on top of the effective package entries).

/**
 * A parsed package source. Mirrors Pi's ParsedSource union:
 * - npm: { type, spec, name, version?, range?, pinned }
 * - git: GitSource { type, repo, host, path, ref?, pinned }
 * - local: { type, path }

/**
 * A raw configured package entry as read from settings.json `packages[]`.
 * May be a bare source string or an object `{ source, autoload? }`.
 */
export type ConfiguredPackageEntry = {
  source: string;
  /** True when the entry is an `autoload:false` delta; false otherwise. */
  autoload: boolean;
};

/**
 * A resolved package with its parsed source, scope, install root, and
 * provenance. The `sourceScope` is the scope of the settings entry that
 * contributed the effective source (used for autoload:false inheritance);
 * `scope` is the display/effective scope of this resolved entry.
 */
export type ResolvedPackage = {
  parsed: ParsedPackageSource;
  identity: string;
  /** Display/effective scope of this entry. */
  scope: SkillScope;
  /** Scope of the settings file that contributed the effective source. */
  sourceScope: SkillScope;
  /** The settings source string (for display). */
  source: string;
  /** True if this entry originated from an autoload:false delta. */
  autoload: boolean;
  /** Resolved install root, or undefined if not installed. */
  installedRoot?: string;
};

// ── Install root resolution ───────────────────────────────────────────

/**
 * Resolve the install root for a parsed source in a given scope. Mirrors
 * Pi's getNpmInstallPath / getGitInstallPath / local resolution, using only
 * the managed (non-legacy) paths. Throws if a normalized git path escapes the
 * install root (traversal protection, matching Pi's resolveManagedPath).
 *
 * `options` provides agentDir (global base) and cwd (project base).
 */
export function resolveInstalledPackageRoot(
  parsed: ParsedPackageSource,
  scope: SkillScope,
  options: { agentDir: string; cwd: string },
): string {
  if (parsed.type === "npm") {
    return scope === "global"
      ? join(options.agentDir, "npm", "node_modules", parsed.name)
      : join(options.cwd, CONFIG_DIR_NAME, "npm", "node_modules", parsed.name);
  }
  if (parsed.type === "git") {
    const installRoot =
      scope === "global"
        ? join(options.agentDir, "git")
        : join(options.cwd, CONFIG_DIR_NAME, "git");
    return resolveManagedPath(installRoot, parsed.host, parsed.path);
  }
  // local: relative global against agentDir, relative project against <cwd>/.pi,
  // absolute stays absolute.
  const p = expandLocalPath(parsed.path);
  if (isAbsolute(p)) return resolve(p);
  const base = scope === "global" ? options.agentDir : join(options.cwd, CONFIG_DIR_NAME);
  return resolve(base, p);
}

/** Expand ~ / ~/ to homedir, matching Pi's normalizePath. */
export function expandLocalPath(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return join(homedir(), input.slice(2));
  return input;
}

/**
 * Resolve `parts` under `root`, refusing paths that escape root. Mirrors Pi's
 * resolveManagedPath (used by getGitInstallPath / getManagedNpmInstallPath).
 */
export function resolveManagedPath(root: string, ...parts: string[]): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, ...parts);
  if (!isWithinPackage(resolvedPath, resolvedRoot)) {
    throw new Error(`Refusing to use path outside package install root: ${resolvedPath}`);
  }
  return resolvedPath;
}

/**
 * Containment check shared by local-source resolution and manifest-entry
 * glob expansion. `path === root` is allowed (the package root itself may be
 * a valid entry); any path strictly beneath `<root>/` is allowed; anything
 * else (parent traversal, absolute path elsewhere, sibling directory) is not.
 */
export function isWithinPackage(path: string, root: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${sep}`);
}

// ── Settings reading ──────────────────────────────────────────────────

export type RawSettings = { packages?: unknown };

/**
 * Read packages[] and surface a per-entry diagnostic for malformed entries
 * (non-string, null, object without `source`). Returns the valid entries and
 * diagnostics for the malformed ones.
 */
export function readSettingsPackagesWithDiags(
  settingsPath: string,
  diagnostics: SkillDiagnostic[],
): ConfiguredPackageEntry[] {
  if (!existsSync(settingsPath)) return [];
  let text: string;
  try {
    text = readFileSync(settingsPath, "utf-8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "invalid JSON";
    diagnostics.push({ path: settingsPath, message: `Pi settings must be valid JSON: ${msg}` });
    return [];
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    diagnostics.push({ path: settingsPath, message: "Pi settings must be a JSON object" });
    return [];
  }
  const packages = (parsed as RawSettings).packages;
  if (!Array.isArray(packages)) return [];
  const entries: ConfiguredPackageEntry[] = [];
  let malformed = 0;
  for (const raw of packages) {
    if (typeof raw === "string") {
      entries.push({ source: raw, autoload: false });
      continue;
    }
    if (raw !== null && typeof raw === "object") {
      const obj = raw as { source?: unknown; autoload?: unknown };
      if (typeof obj.source === "string") {
        entries.push({ source: obj.source, autoload: obj.autoload === false });
        continue;
      }
    }
    malformed += 1;
  }
  if (malformed > 0) {
    diagnostics.push({
      path: settingsPath,
      message: `${malformed} malformed package entr${malformed === 1 ? "y" : "ies"} skipped`,
    });
  }
  return entries;
}

// ── Dedupe / precedence ───────────────────────────────────────────────

/**
 * Build one effective combined package list from project-first + global
 * settings entries, applying Pi-compatible precedence:
 *
 * - Project ordinary entries replace matching global entries (by identity).
 * - An `autoload:false` project delta that matches a global entry inherits
 *   that global entry's source/scope/base/installed-root, but retains project
 *   provenance for display (scope = "project", sourceScope = "global").
 * - An unmatched project `autoload:false` delta resolves against its own
 *   project source/root.
 * - Unrelated entries from both scopes remain.
 * - Duplicate same-scope identities keep the first (Pi first-wins).
 *
 * The response `scope` (passed in `options.scope`) controls emphasis/count,
 * NOT which effective packages are resolved.
 */
export function dedupeConfiguredPackages(
  globalEntries: ConfiguredPackageEntry[],
  projectEntries: ConfiguredPackageEntry[],
  options: { agentDir: string; cwd: string; projectTrusted: boolean },
): ResolvedPackage[] {
  /**
   * Deduplicate resolved packages within a single scope by identity, keeping
   * the first occurrence (Pi-compatible first-wins). This runs before
   * cross-scope precedence so duplicate same-scope entries collapse.
   */
  function dedupeSameScope(resolved: ResolvedPackage[]): ResolvedPackage[] {
    const seen = new Set<string>();
    const out: ResolvedPackage[] = [];
    for (const r of resolved) {
      if (seen.has(r.identity)) continue;
      seen.add(r.identity);
      out.push(r);
    }
    return out;
  }

  const resolveEntry = (entry: ConfiguredPackageEntry, scope: SkillScope): ResolvedPackage => {
    const parsed = parsePackageSource(entry.source);
    const identity = packageIdentity(parsed);
    let installedRoot: string | undefined;
    try {
      const root = resolveInstalledPackageRoot(parsed, scope, options);
      installedRoot = existsSync(root) && statSync(root).isDirectory() ? root : undefined;
    } catch {
      installedRoot = undefined;
    }
    return {
      parsed,
      identity,
      scope,
      sourceScope: scope,
      source: entry.source,
      autoload: entry.autoload,
      installedRoot,
    };
  };

  const resolvedGlobal = dedupeSameScope(globalEntries.map((e) => resolveEntry(e, "global")));
  if (!options.projectTrusted) return resolvedGlobal;

  const resolvedProject = dedupeSameScope(projectEntries.map((e) => resolveEntry(e, "project")));
  const globalByIdentity = new Map(resolvedGlobal.map((r) => [r.identity, r]));
  const result: ResolvedPackage[] = [];
  const seenIdentities = new Set<string>();

  for (const proj of resolvedProject) {
    if (seenIdentities.has(proj.identity)) continue;
    seenIdentities.add(proj.identity);
    const matchingGlobal = globalByIdentity.get(proj.identity);
    if (proj.autoload && matchingGlobal) {
      // autoload:false project delta: inherit the global source/root, keep
      // project provenance for display.
      result.push({
        ...matchingGlobal,
        scope: "project",
        sourceScope: "global",
        source: proj.source,
        autoload: true,
      });
    } else {
      result.push(proj);
    }
  }
  for (const glob of resolvedGlobal) {
    if (seenIdentities.has(glob.identity)) continue;
    seenIdentities.add(glob.identity);
    result.push(glob);
  }
  return result;
}

/**
 * Build a package skill inventory for the requested scope: one card per
 * configured package that contributes skills, with candidates from the shared
 * discovery collector.
 *
 * For untrusted project scope, returns `{ trusted:false, packages:[] }`
 * without reading or disclosing project package paths/diagnostics.
 */
export function buildPackageSkillInventory(
  options: PackageSkillInventoryOptions,
): PackageSkillInventory {
  const globalSettingsPath = join(options.agentDir, "settings.json");
  const projectSettingsPath = join(options.cwd, CONFIG_DIR_NAME, "settings.json");
  const diagnostics: SkillDiagnostic[] = [];
  const trusted = Boolean(options.projectTrusted);

  // Untrusted project: do NOT read project settings; return global-only with
  // trusted:false when the requested scope is project.
  if (options.scope === "project" && !trusted) {
    return { scope: "project", trusted: false, packages: [], diagnostics };
  }

  const globalEntries = readSettingsPackagesWithDiags(globalSettingsPath, diagnostics);
  const projectEntries = trusted
    ? readSettingsPackagesWithDiags(projectSettingsPath, diagnostics)
    : [];

  const resolved = dedupeConfiguredPackages(globalEntries, projectEntries, {
    agentDir: options.agentDir,
    cwd: options.cwd,
    projectTrusted: trusted,
  });

  const packages: PackageSkillCard[] = resolved.map((r) => {
    const cardDiags: SkillDiagnostic[] = [];
    if (!r.installedRoot) {
      cardDiags.push({ message: "package is not installed" });
    }
    const version = readPackageVersion(r.installedRoot);
    const candidates = r.installedRoot ? collectPackageSkillCandidates(r, cardDiags) : [];
    return {
      id: r.identity,
      source: r.source,
      identity: r.identity,
      scope: r.scope,
      effectivePackageRoot: r.installedRoot,
      version,
      candidates,
      diagnostics: cardDiags,
    };
  });

  // Only packages that actually contribute skills are shown — a configured
  // but skill-less package (uninstalled, empty manifest, or no skills/ dir)
  // adds noise to the Skills page, so drop it here rather than in the UI.
  const packagesWithSkills = packages.filter((p) => p.candidates.length > 0);
  return { scope: options.scope, trusted, packages: packagesWithSkills, diagnostics };
}

/** Read the version from a package's package.json, if present. */
function readPackageVersion(installedRoot?: string): string | undefined {
  if (!installedRoot) return undefined;
  const pkgJson = join(installedRoot, "package.json");
  if (!existsSync(pkgJson)) return undefined;
  try {
    const pkg = JSON.parse(readFileSync(pkgJson, "utf-8")) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

export { collectPackageSkillCandidates } from "./package-skill-candidates.ts";
export { packageIdentity, parseGitUrl, parsePackageSource } from "./package-source.ts";
