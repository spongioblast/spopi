// ABOUTME: Skill enablement rules copied from Pi's settings.json skills array.
// ABOUTME: Exact + and - rules win over broader globs, matching Pi's precedence.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { basenamePosix, globMatch, toPosix } from "./skill-paths.ts";

export function isOverride(entry: string): boolean {
  return entry.startsWith("!") || entry.startsWith("+") || entry.startsWith("-");
}

export function isPlainGlob(entry: string): boolean {
  return !isOverride(entry) && (entry.includes("*") || entry.includes("?"));
}

export function readSettingsSkills(settingsPath: string): {
  skills: string[];
  parseError?: string;
} {
  if (!existsSync(settingsPath)) return { skills: [] };
  let text: string;
  try {
    text = readFileSync(settingsPath, "utf-8");
  } catch {
    return { skills: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "invalid JSON";
    return { skills: [], parseError: msg };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { skills: [], parseError: "settings must be a JSON object" };
  }
  const skills = (parsed as { skills?: unknown }).skills;
  if (!Array.isArray(skills)) return { skills: [] };
  return { skills: skills.filter((s): s is string => typeof s === "string") };
}

export function normalizeExactPattern(pattern: string): string {
  let p = pattern;
  if (p.startsWith("./") || p.startsWith(".\\")) p = p.slice(2);
  return toPosix(p);
}

export type MatchContext = {
  rel: string;
  abs: string;
  name: string;
  parentRel: string;
  parentAbs: string;
  parentName: string;
};

/**
 * Build a match context from an already-resolved base-relative skill directory.
 * Used during mutation, where the on-disk canonical path may differ from the
 * rule base (e.g. macOS /var → /private/var) and would break glob matching.
 */
export function buildMatchContextFromRule(ruleRelativeDir: string, baseDir: string): MatchContext {
  const rel = `${ruleRelativeDir}/SKILL.md`;
  return {
    rel,
    abs: toPosix(join(baseDir, rel)),
    name: "SKILL.md",
    parentRel: ruleRelativeDir,
    parentAbs: toPosix(join(baseDir, ruleRelativeDir)),
    parentName: basenamePosix(ruleRelativeDir),
  };
}

export function buildMatchContext(filePath: string, baseDir: string): MatchContext {
  const parent = dirname(filePath);
  return {
    rel: toPosix(relative(baseDir, filePath)),
    abs: toPosix(filePath),
    name: basenamePosix(filePath),
    parentRel: toPosix(relative(baseDir, parent)),
    parentAbs: toPosix(parent),
    parentName: basenamePosix(parent),
  };
}

export function matchesAnyPattern(ctx: MatchContext, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const p = toPosix(pattern);
    return (
      globMatch(p, ctx.rel) ||
      globMatch(p, ctx.name) ||
      globMatch(p, ctx.abs) ||
      globMatch(p, ctx.parentRel) ||
      globMatch(p, ctx.parentName) ||
      globMatch(p, ctx.parentAbs)
    );
  });
}

export function matchesAnyExact(ctx: MatchContext, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const n = normalizeExactPattern(pattern);
    if (n === ctx.rel || n === ctx.abs) return true;
    return n === ctx.parentRel || n === ctx.parentAbs;
  });
}

export function overridesOf(skills: string[]): { excl: string[]; finc: string[]; fexc: string[] } {
  const excl: string[] = [];
  const finc: string[] = [];
  const fexc: string[] = [];
  for (const e of skills) {
    if (e.startsWith("!")) excl.push(e.slice(1));
    else if (e.startsWith("+")) finc.push(e.slice(1));
    else if (e.startsWith("-")) fexc.push(e.slice(1));
  }
  return { excl, finc, fexc };
}

export function isEnabledByOverrides(
  ctx: MatchContext,
  skills: string[],
): { enabled: boolean; matched: string[] } {
  const { excl, finc, fexc } = overridesOf(skills);
  const matched: string[] = [];
  let enabled = true;
  if (excl.length > 0) {
    const hits = excl.filter((p) => matchesAnyPattern(ctx, [p]));
    if (hits.length > 0) {
      enabled = false;
      for (const h of hits) matched.push(`!${h}`);
    }
  }
  if (finc.length > 0) {
    const hits = finc.filter((p) => matchesAnyExact(ctx, [p]));
    if (hits.length > 0) {
      enabled = true;
      for (const h of hits) matched.push(`+${h}`);
    }
  }
  if (fexc.length > 0) {
    const hits = fexc.filter((p) => matchesAnyExact(ctx, [p]));
    if (hits.length > 0) {
      enabled = false;
      for (const h of hits) matched.push(`-${h}`);
    }
  }
  return { enabled, matched };
}

// ── Precedence (mirrors Pi resourcePrecedenceRank) ────────────────────

/**
 * Canonicalize an existing path for identity comparison. Uses realpath when
 * the path exists (resolving symlinks) and falls back to the lexical resolve
 * otherwise — matching `canonicalizeExistingPath` in the shared discovery
 * module. Two skills settings entries that alias the same directory via
 * different symlink spellings must be treated as the same root.
 */
export function precedenceRank(scope: "user" | "project", source: "auto" | "local"): number {
  const scopeBase = scope === "project" ? 0 : 2;
  return scopeBase + (source === "local" ? 0 : 1);
}
