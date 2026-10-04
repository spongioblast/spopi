// ABOUTME: Enables or disables a skill by writing Pi's exact + and - rules.
// ABOUTME: The write goes through Pi's SettingsManager, then rebuilds the inventory.

import { stringList, updatePiSettings } from "./pi-settings.ts";
import { settingsPathFor } from "./skill-discover.ts";
import { buildSkillInventory } from "./skill-inventory.ts";
import { toPosix } from "./skill-paths.ts";
import {
  buildMatchContextFromRule,
  matchesAnyExact,
  matchesAnyPattern,
  normalizeExactPattern,
  overridesOf,
} from "./skill-rules.ts";
import { collectLeaves, findGroupInRoots, findSkillInRoots } from "./skill-tree.ts";
import type {
  MutateSkillEnabledOptions,
  SkillInventory,
  SkillInventoryItem,
  SkillMutationResult,
  SkillTarget,
} from "./skill-types.ts";

export const mutationQueues = new Map<string, Promise<unknown>>();

export function serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
  const prev = mutationQueues.get(key) ?? Promise.resolve();
  const next = prev.then(work, work);
  mutationQueues.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

export function posixRuleForSkill(item: SkillInventoryItem): string {
  return toPosix(item.ruleRelativeDir);
}

export function filterInPlace<T>(arr: T[], keep: (v: T) => boolean): void {
  for (let i = arr.length - 1; i >= 0; i--) if (!keep(arr[i])) arr.splice(i, 1);
}

export function removeExactPrefix(arr: string[], rule: string, prefixes: string[]): void {
  filterInPlace(arr, (e) => {
    for (const p of prefixes) {
      if (e.startsWith(p) && normalizeExactPattern(e.slice(1)) === rule) return false;
    }
    return true;
  });
}

export function ensureOverridePresent(arr: string[], prefix: string, body: string): void {
  const entry = `${prefix}${body}`;
  if (!arr.includes(entry)) arr.push(entry);
}

/**
 * Compute the next `skills` array from the current one and the requested mutation.
 * Preserves unrelated entries; managed exact `+`/`-` and group `!` rules are
 * added/removed idempotently per the spec's minimal-mutation policy.
 */
export function computeNextSkills(
  current: string[],
  inventory: SkillInventory,
  target: SkillTarget,
  enabled: boolean,
): string[] {
  const next = current.map((e) => toPosix(e));

  if (target.kind === "skill") {
    const item = findSkillInRoots(inventory.roots, target.id);
    if (!item) throw new Error("Unknown skill target");
    const rule = posixRuleForSkill(item);
    if (!enabled) {
      // Disable: exact `-` has final precedence (overrides any `+`).
      ensureOverridePresent(next, "-", rule);
    } else {
      // Enable: remove the managed exact `-`, then force-include only if a
      // broader `!` exclusion still matches.
      removeExactPrefix(next, rule, ["-"]);
      const ctx = buildMatchContextFromRule(item.ruleRelativeDir, item.ruleBaseDir);
      const { excl } = overridesOf(next);
      if (excl.some((p) => matchesAnyPattern(ctx, [p]))) ensureOverridePresent(next, "+", rule);
    }
    return next;
  }

  const group = findGroupInRoots(inventory.roots, target.id);
  if (!group) throw new Error("Unknown group target");
  const groupRule = toPosix(group.ruleBaseRelativePath);
  const members = collectLeaves(group);
  const memberRules = new Set(members.map((i) => posixRuleForSkill(i)));

  if (!enabled) {
    // Disable group: drop managed `+` for members, add group `!`.
    filterInPlace(
      next,
      (e) => !(e.startsWith("+") && memberRules.has(normalizeExactPattern(e.slice(1)))),
    );
    ensureOverridePresent(next, "!", `${groupRule}/**`);
  } else {
    // Enable group: remove the exact group `!`; keep child `-`; add `+` for
    // members still matched by a remaining broader `!` (skip those already
    // force-excluded, since `-` has final precedence and `+` would be inert).
    filterInPlace(
      next,
      (e) => !(e.startsWith("!") && normalizeExactPattern(e.slice(1)) === `${groupRule}/**`),
    );
    const { excl, fexc } = overridesOf(next);
    for (const member of members) {
      const ctx = buildMatchContextFromRule(member.ruleRelativeDir, member.ruleBaseDir);
      if (matchesAnyExact(ctx, fexc)) continue;
      if (excl.some((p) => matchesAnyPattern(ctx, [p]))) {
        ensureOverridePresent(next, "+", posixRuleForSkill(member));
      }
    }
  }
  return next;
}

export async function mutateSkillEnabled(
  opts: MutateSkillEnabledOptions,
): Promise<SkillMutationResult> {
  const settingsPath = settingsPathFor(opts.scope, {
    scope: opts.scope,
    cwd: opts.cwd,
    agentDir: opts.agentDir,
  });
  return serialized(settingsPath, async () => {
    if (opts.scope === "project" && !opts.projectTrusted) {
      throw new Error("Project is not trusted; cannot mutate project skills");
    }
    const pre = buildSkillInventory(opts);
    const expectedScope = opts.scope === "global" ? "user" : "project";
    if (opts.target.kind === "skill") {
      const item = findSkillInRoots(pre.roots, opts.target.id);
      if (!item) throw new Error("Unknown skill target");
      if (item.scope !== expectedScope) {
        throw new Error("Skill does not belong to the selected scope");
      }
      if (item.ambiguous) {
        throw new Error(
          "Skill target is ambiguous across discovery roots; edit settings.json manually",
        );
      }
    } else {
      const group = findGroupInRoots(pre.roots, opts.target.id);
      if (!group) throw new Error("Unknown group target");
      if (group.scope !== expectedScope) {
        throw new Error("Group does not belong to the selected scope");
      }
      if (group.ambiguous) {
        throw new Error(
          "Group target is ambiguous across discovery roots; edit settings.json manually",
        );
      }
    }

    await updatePiSettings(
      (manager) => {
        const scoped =
          opts.scope === "global" ? manager.getGlobalSettings() : manager.getProjectSettings();
        const nextSkills = computeNextSkills(
          stringList(scoped.skills),
          pre,
          opts.target,
          opts.enabled,
        );
        if (opts.scope === "global") manager.setSkillPaths(nextSkills);
        else manager.setProjectSkillPaths(nextSkills);
      },
      { scope: opts.scope, cwd: opts.cwd, agentDir: opts.agentDir },
    );

    const inventory = buildSkillInventory(opts);
    return { inventory, runtimeRestartRequired: true };
  });
}
