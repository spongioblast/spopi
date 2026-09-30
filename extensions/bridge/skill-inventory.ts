// ABOUTME: Assembles the skill inventory the Settings page shows.
// ABOUTME: Discovery, rules, and the tree live in sibling modules.

import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  detectRootKind,
  discoverSkillsFromRoot,
  globalRoots,
  projectRootPaths,
  projectRoots,
  settingsPathFor,
} from "./skill-discover.ts";
import { CONFIG_DIR_NAME, toPosix } from "./skill-paths.ts";
import {
  buildMatchContext,
  isEnabledByOverrides,
  isPlainGlob,
  precedenceRank,
  readSettingsSkills,
} from "./skill-rules.ts";
import { annotateTree, insertSkillIntoTree, markGroupAmbiguity, sortTree } from "./skill-tree.ts";
import type {
  BuildSkillInventoryOptions,
  DiscoveredRoot,
  RawSkill,
  SkillDiagnostic,
  SkillInventory,
  SkillInventoryItem,
  SkillRoot,
} from "./skill-types.ts";

export {
  migrateLegacySkills,
  readSettingsObject,
  withSettingsLock,
  writeSettingsAtomically,
} from "./settings-io.ts";
export { mutateSkillEnabled } from "./skill-mutate.ts";
export {
  buildMatchContext,
  matchesAnyExact,
  matchesAnyPattern,
  normalizeExactPattern,
  overridesOf,
} from "./skill-rules.ts";
export type {
  BuildSkillInventoryOptions,
  MutateSkillEnabledOptions,
  SkillChild,
  SkillDiagnostic,
  SkillGroupNode,
  SkillInventory,
  SkillInventoryItem,
  SkillMutationResult,
  SkillRoot,
  SkillRootKind,
  SkillScope,
  SkillStatus,
  SkillTarget,
} from "./skill-types.ts";

export function buildSkillInventory(opts: BuildSkillInventoryOptions): SkillInventory {
  const globalSettingsPath = join(opts.agentDir, "settings.json");
  const projectSettingsPath = join(opts.cwd, CONFIG_DIR_NAME, "settings.json");
  const settingsPath = settingsPathFor(opts.scope, opts);
  const diagnostics: SkillDiagnostic[] = [];

  // The inventory always reflects the full Pi discovery (global + project roots)
  // so that name collisions resolve in Pi's real precedence order. Each root is
  // resolved against its own scope's settings, exactly as Pi does. The `scope`
  // option selects which settings file mutations target and which custom rules
  // are surfaced; it never filters the displayed skills.
  const globalSettings = readSettingsSkills(globalSettingsPath);
  if (globalSettings.parseError)
    diagnostics.push({ path: globalSettingsPath, message: globalSettings.parseError });
  const trusted = Boolean(opts.projectTrusted);
  const projectSettingsRaw = trusted
    ? readSettingsSkills(projectSettingsPath)
    : { skills: [] as string[] };
  if (trusted && projectSettingsRaw.parseError) {
    diagnostics.push({
      path: projectSettingsPath,
      message: projectSettingsRaw.parseError as string,
    });
  }
  const scopeSettings = opts.scope === "global" ? globalSettings : projectSettingsRaw;
  const customRules = scopeSettings.skills.filter((s) => isPlainGlob(s)).map((s) => toPosix(s));

  const roots: DiscoveredRoot[] = [...globalRoots(opts, globalSettings.skills)];
  if (trusted) roots.push(...projectRoots(opts, projectSettingsRaw.skills));

  const discoveredRoots = roots.map((r) => r.dir).filter((d) => existsSync(d));
  if (opts.scope === "project" && !trusted) {
    // Still surface where project skills would be discovered so the UI can
    // show the trust warning next to the resource roots.
    for (const p of projectRootPaths(opts)) discoveredRoots.push(p);
  }

  const settingsForRoot = (root: DiscoveredRoot): string[] =>
    root.scope === "user" ? globalSettings.skills : projectSettingsRaw.skills;

  const rawSkills: RawSkill[] = [];
  for (const root of roots) {
    for (const s of discoverSkillsFromRoot(root, diagnostics)) rawSkills.push(s);
  }

  type Resolved = { raw: RawSkill; enabled: boolean; matching: string[] };
  const resolved: Resolved[] = rawSkills.map((raw) => {
    const ctx = buildMatchContext(raw.filePath, raw.root.baseDir);
    const { enabled, matched } = isEnabledByOverrides(ctx, settingsForRoot(raw.root));
    return { raw, enabled, matching: matched };
  });

  // Precedence order: sort by Pi's resourcePrecedenceRank. Array.sort is
  // stable, so equal-rank records keep discovery order (first-wins), matching
  // Pi's accumulator insertion order before loadSkills de-duplicates names.
  resolved.sort((a, b) => {
    const ra = precedenceRank(a.raw.root.scope, a.raw.root.source);
    const rb = precedenceRank(b.raw.root.scope, b.raw.root.source);
    return ra - rb;
  });

  const seenPath = new Set<string>();
  const items: SkillInventoryItem[] = [];
  const nameWinner = new Map<string, SkillInventoryItem>();
  for (const r of resolved) {
    if (seenPath.has(r.raw.canonicalPath)) continue;
    seenPath.add(r.raw.canonicalPath);
    const skillDir = dirname(r.raw.filePath);
    const ruleRelativeDir = toPosix(
      relative(r.raw.root.baseDir, r.raw.isConfiguredFile ? r.raw.filePath : skillDir),
    );
    const treePath = r.raw.isConfiguredFile ? "" : toPosix(relative(r.raw.root.dir, skillDir));
    const item: SkillInventoryItem = {
      kind: "skill",
      id: r.raw.canonicalPath,
      canonicalPath: r.raw.canonicalPath,
      name: r.raw.name,
      description: r.raw.description,
      enabled: r.enabled,
      status: r.enabled ? "enabled" : "disabled",
      ruleBaseDir: r.raw.root.baseDir,
      ruleRelativeDir,
      treePath,
      sourceRoot: r.raw.root.dir,
      scope: r.raw.root.scope,
      source: r.raw.root.source,
      matchingRules: r.matching,
      ambiguous: false,
    };
    items.push(item);
    if (r.enabled) {
      if (!nameWinner.has(r.raw.name)) nameWinner.set(r.raw.name, item);
    }
  }
  // Mark enabled losers as shadowed by their higher-precedence winner.
  for (const item of items) {
    if (!item.enabled) continue;
    const winner = nameWinner.get(item.name);
    if (winner && winner.id !== item.id) {
      item.status = "shadowed";
      item.shadowedBy = { id: winner.id, canonicalPath: winner.canonicalPath, name: winner.name };
    }
  }

  // Cross-root ambiguity for skill targets: a generated exact `+`/`-` rule is
  // relative to each root's Pi base; if the same relative dir resolves under
  // more than one sourceRoot in a scope, one portable rule would mutate
  // multiple roots, so such skills are read-only.
  const dirToRoots = new Map<string, Set<string>>();
  for (const it of items) {
    const dirKey = `${it.scope}::${it.ruleRelativeDir}`;
    const dirSet = dirToRoots.get(dirKey) ?? new Set<string>();
    dirSet.add(it.sourceRoot);
    dirToRoots.set(dirKey, dirSet);
  }
  for (const it of items) {
    if ((dirToRoots.get(`${it.scope}::${it.ruleRelativeDir}`)?.size ?? 0) > 1) it.ambiguous = true;
  }

  // Build one tree per sourceRoot. A skill's treePath (relative to its root
  // dir) decides its place: the final segment is the skill leaf, intermediate
  // segments become group containers. A single-skill dir like Humanizer-zh
  // (treePath "Humanizer-zh") is therefore a top-level skill row, not a group.
  const itemsByRoot = new Map<string, SkillInventoryItem[]>();
  for (const it of items) {
    const arr = itemsByRoot.get(it.sourceRoot) ?? [];
    arr.push(it);
    itemsByRoot.set(it.sourceRoot, arr);
  }
  const rootMeta = new Map(roots.map((r) => [r.dir, r]));
  const builtRoots: SkillRoot[] = [];
  const groupPathRoots = new Map<string, Set<string>>();
  for (const [sourceRoot, rootItems] of itemsByRoot) {
    const meta = rootMeta.get(sourceRoot);
    if (!meta) continue;
    const tree: SkillRoot = {
      sourceRoot: meta.dir,
      ruleBaseDir: meta.baseDir,
      scope: meta.scope,
      source: meta.source,
      rootKind: detectRootKind(meta.dir, opts),
      children: [],
    };
    for (const it of rootItems) insertSkillIntoTree(tree, it, meta);
    annotateTree(tree, groupPathRoots);
    builtRoots.push(tree);
  }
  for (const tree of builtRoots) markGroupAmbiguity(tree, groupPathRoots);
  for (const tree of builtRoots) sortTree(tree);

  return {
    scope: opts.scope,
    settingsPath,
    trusted,
    roots: builtRoots,
    customRules,
    discoveredRoots,
    diagnostics,
  };
}
