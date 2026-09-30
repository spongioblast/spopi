// ABOUTME: Lists skill files shipped inside an installed Pi package.
// ABOUTME: Manifest ! + - rules filter those files; user settings do not.

import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { globSync } from "glob";
import {
  isWithinPackage,
  type PackageSkillCandidate,
  type ResolvedPackage,
} from "./package-skill-inventory.ts";
import {
  type DiscoveredSkill,
  discoverSkillsFromPaths,
  type SkillDiscoveryRoot,
  toPosixPath,
} from "./skill-discovery.ts";
import {
  buildMatchContext,
  matchesAnyExact,
  matchesAnyPattern,
  overridesOf,
  type SkillDiagnostic,
} from "./skill-inventory.ts";

export function readPiManifest(packageRoot: string): { skills?: unknown } | null {
  const pkgJsonPath = join(packageRoot, "package.json");
  if (!existsSync(pkgJsonPath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const pkg = parsed as { pi?: unknown };
  if (typeof pkg.pi !== "object" || pkg.pi === null || Array.isArray(pkg.pi)) return null;
  return pkg.pi as { skills?: unknown };
}

/** True if a manifest entry is an override pattern (!, +, -). */
export function isOverridePattern(s: string): boolean {
  return s.startsWith("!") || s.startsWith("+") || s.startsWith("-");
}

/** True if a manifest entry contains a glob char. */
export function hasGlobPattern(s: string): boolean {
  return s.includes("*") || s.includes("?");
}

/**
 * Collect candidate skill files from a package root, mirroring Pi's
 * collectManifestFiles for the "skills" resource type:
 * - If package.json `pi.skills` is a non-empty array: collect files from its
 *   source entries (plain paths + globs) via the shared discovery collector,
 *   then apply manifest `!`/`+`/`-` override patterns with Pi precedence.
 * - If absent/empty: fall back to the conventional `<packageRoot>/skills/`
 *   directory.
 *
 * Only the package-manifest `pi.skills` override entries are evaluated against
 * the collected skill files. The separate user-owned `settings.json.packages[]
 * .skills` filter is intentionally NOT evaluated — bundled candidates are
 * read-only and never claim an effective enabled/disabled state.
 */
export function collectPackageSkillCandidates(
  pkg: ResolvedPackage,
  diagnostics: SkillDiagnostic[],
): PackageSkillCandidate[] {
  const packageRoot = pkg.installedRoot;
  if (!packageRoot) return [];
  const manifest = readPiManifest(packageRoot);
  // Distinguish three cases, matching Pi's collectDefaultResources:
  //   - pi.skills undefined → conventional <packageRoot>/skills/ fallback;
  //   - pi.skills is an array (including []) → strict manifest processing;
  //   - pi.skills is any other type → record a diagnostic and fall back to
  //     conventional, matching Pi's defensive behavior for malformed manifests.
  const manifestSkillsRaw = manifest?.skills;
  let manifestEntries: string[];
  let manifestDeclared = false;
  if (Array.isArray(manifestSkillsRaw)) {
    manifestDeclared = true;
    manifestEntries = manifestSkillsRaw.every((s) => typeof s === "string")
      ? (manifestSkillsRaw as string[])
      : [];
  } else {
    manifestEntries = [];
    if (manifestSkillsRaw !== undefined) {
      diagnostics.push({
        message: `pi.skills must be a string array; got ${typeof manifestSkillsRaw}, falling back to skills/`,
      });
    }
  }

  const discoveryRoot: SkillDiscoveryRoot = {
    dir: packageRoot,
    mode: "pi",
    baseDir: packageRoot,
    scope: pkg.scope,
    source: "package",
  };

  let collected: DiscoveredSkill[];
  if (manifestDeclared || manifestEntries.length > 0) {
    // Source entries (plain paths + globs) resolve to files/dirs under the
    // package root, then the shared collector walks them. A malicious or
    // compromised package manifest could declare a parent-directory glob or
    // an absolute path to disclose arbitrary host files; reject any resolved
    // path that escapes packageRoot and record a diagnostic instead.
    const sourceEntries = manifestEntries.filter((e) => !isOverridePattern(e));
    const resolvedPaths: string[] = [];
    const MAX_MANIFEST_MATCHES = 10_000;
    for (const entry of sourceEntries) {
      const matches = hasGlobPattern(entry)
        ? globSync(entry, { cwd: packageRoot, absolute: true, dot: false, nodir: false })
        : [resolve(packageRoot, entry)];
      if (matches.length > MAX_MANIFEST_MATCHES) {
        diagnostics.push({
          message: `Manifest entry matched ${matches.length} paths; truncated to ${MAX_MANIFEST_MATCHES}`,
        });
      }
      for (const m of matches.slice(0, MAX_MANIFEST_MATCHES)) {
        const resolved = resolve(m);
        if (isWithinPackage(resolved, packageRoot)) {
          resolvedPaths.push(resolved);
        } else {
          diagnostics.push({
            message: `Refused manifest entry outside package root: ${entry} -> ${resolved}`,
          });
        }
      }
    }
    collected = discoverSkillsFromPaths(resolvedPaths, discoveryRoot, diagnostics);
    // Apply manifest override patterns (!, +, -) against the collected files.
    const overrideEntries = manifestEntries.filter((e) => isOverridePattern(e));
    if (overrideEntries.length > 0) {
      collected = applyManifestOverrides(collected, overrideEntries, packageRoot);
    }
  } else {
    // Conventional fallback: <packageRoot>/skills/ directory.
    collected = discoverSkillsFromPaths([join(packageRoot, "skills")], discoveryRoot, diagnostics);
  }

  // Build candidate cards with stable IDs and POSIX package-root-relative paths.
  return collected.map((s) => {
    const candidateDiags: SkillDiagnostic[] = [];
    const relativePath = toPosixPath(relative(packageRoot, s.skillDir));
    return {
      id: `${pkg.identity}::${s.canonicalPath}`,
      canonicalPath: s.canonicalPath,
      relativePath: relativePath || ".",
      name: s.name,
      description: s.description,
      diagnostics: candidateDiags,
    };
  });
}

/**
 * Apply Pi-compatible `!`/`+`/`-` override patterns to the collected skill
 * files, using the same match context as the inventory matcher. Precedence:
 * `+` force-include adds back, `-` force-exclude removes (final precedence),
 * `!` excludes from the full set. Mirrors Pi's applyPatterns.
 */
export function applyManifestOverrides(
  collected: DiscoveredSkill[],
  overrideEntries: string[],
  packageRoot: string,
): DiscoveredSkill[] {
  const { excl, finc, fexc } = overridesOf(overrideEntries);
  // Start from the full collected set.
  let result = collected;
  // Step 1: `!` excludes.
  if (excl.length > 0) {
    result = result.filter((s) => {
      const ctx = buildMatchContext(s.filePath, packageRoot);
      return !matchesAnyPattern(ctx, excl);
    });
  }
  // Step 2: `+` force-include (add back from the original full set).
  if (finc.length > 0) {
    for (const s of collected) {
      const ctx = buildMatchContext(s.filePath, packageRoot);
      if (!result.includes(s) && matchesAnyExact(ctx, finc)) result.push(s);
    }
  }
  // Step 3: `-` force-exclude (final precedence).
  if (fexc.length > 0) {
    result = result.filter((s) => {
      const ctx = buildMatchContext(s.filePath, packageRoot);
      return !matchesAnyExact(ctx, fexc);
    });
  }
  return result;
}
