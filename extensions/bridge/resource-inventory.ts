// ABOUTME: One Pi-config inventory of extensions, skills, prompts, and themes.
// ABOUTME: Reads loose folders and installed packages, and writes the same settings.json filters Pi uses.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { PackageSource, SettingsManager } from "@earendil-works/pi-coding-agent";
import {
  buildPackageSkillInventory,
  dedupeConfiguredPackages,
  type ResolvedPackage,
  readSettingsPackagesWithDiags,
} from "./package-skill-inventory";
import { updatePiSettings } from "./pi-settings";
import {
  type BuildSkillInventoryOptions,
  buildMatchContext,
  buildSkillInventory,
  matchesAnyExact,
  matchesAnyPattern,
  mutateSkillEnabled,
  overridesOf,
  readSettingsObject,
} from "./skill-inventory";

export type ResourceKind = "extension" | "skill" | "prompt" | "theme";
export type ResourceScope = "global" | "project";

export type ResourceOrigin = {
  type: "package" | "folder";
  label: string;
  source?: string;
};

export type ResourceItem = {
  kind: ResourceKind;
  id: string;
  name: string;
  description: string;
  origin: ResourceOrigin;
  scope: ResourceScope;
  enabled: boolean;
  path: string;
  relativePath: string;
  ambiguous: boolean;
};

export type ResourceInventory = {
  scope: ResourceScope;
  trusted: boolean;
  items: ResourceItem[];
  diagnostics: Array<{ path?: string; message: string }>;
};

const KINDS: ResourceKind[] = ["extension", "skill", "prompt", "theme"];
const LOOSE_SPEC: Record<Exclude<ResourceKind, "skill">, { dir: string; exts: string[] }> = {
  extension: { dir: "extensions", exts: ["ts", "js"] },
  prompt: { dir: "prompts", exts: ["md"] },
  theme: { dir: "themes", exts: ["json"] },
};

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function settingsPathFor(scope: ResourceScope, opts: BuildSkillInventoryOptions): string {
  return scope === "global"
    ? join(opts.agentDir, "settings.json")
    : join(opts.cwd, ".pi", "settings.json");
}

function kindArray(settings: Record<string, unknown>, kind: ResourceKind): string[] | undefined {
  const value = settings[kind === "extension" ? "extensions" : `${kind}s`];
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
}

function kindKey(kind: ResourceKind): "extensions" | "skills" | "prompts" | "themes" {
  if (kind === "extension") return "extensions";
  if (kind === "skill") return "skills";
  if (kind === "prompt") return "prompts";
  return "themes";
}

/** Pi: omit the key to load all, [] to load none, then ! / + / - overrides. */
export function resourceEnabledByFilter(
  filters: string[] | undefined,
  relativePath: string,
  name: string,
): boolean {
  if (!filters) return true;
  if (filters.length === 0) return false;
  const rel = toPosix(relativePath).replace(/^\.\//, "");
  const positives = filters.filter((entry) => !/^[!+-]/.test(entry));
  let enabled =
    positives.length === 0 ||
    positives.some((pattern) => {
      const normalized = toPosix(pattern).replace(/^\.\//, "");
      return normalized === rel || normalized === name || rel.endsWith(`/${normalized}`);
    });
  const ctx = {
    rel,
    abs: rel,
    name: basename(rel),
    parentRel: rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "",
    parentAbs: "",
    parentName: name,
  };
  const { excl, finc, fexc } = overridesOf(filters);
  if (excl.some((pattern) => matchesAnyPattern(ctx, [pattern]))) enabled = false;
  if (finc.some((pattern) => matchesAnyExact(ctx, [pattern]))) enabled = true;
  if (fexc.some((pattern) => matchesAnyExact(ctx, [pattern]))) enabled = false;
  return enabled;
}

function readFilters(
  settingsPath: string,
): Map<string, Partial<Record<ResourceKind, string[] | undefined>>> {
  const map = new Map<string, Partial<Record<ResourceKind, string[] | undefined>>>();
  if (!existsSync(settingsPath)) return map;
  let parsed: { packages?: unknown };
  try {
    parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    return map;
  }
  if (!Array.isArray(parsed.packages)) return map;
  for (const raw of parsed.packages) {
    if (
      !raw ||
      typeof raw !== "object" ||
      typeof (raw as { source?: unknown }).source !== "string"
    ) {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const filters: Partial<Record<ResourceKind, string[] | undefined>> = {};
    for (const kind of KINDS) {
      const value = entry[kindKey(kind)];
      if (Array.isArray(value)) {
        filters[kind] = value.filter((item): item is string => typeof item === "string");
      }
    }
    map.set(entry.source as string, filters);
  }
  return map;
}

function walkFiles(dir: string, exts: string[]): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const visit = (current: string) => {
    let entries: string[] = [];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = join(current, name);
      let info: ReturnType<typeof statSync>;
      try {
        info = statSync(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) visit(full);
      else if (exts.includes(name.split(".").pop()?.toLowerCase() || "")) out.push(full);
    }
  };
  visit(dir);
  return out;
}

function firstLine(filePath: string): string {
  try {
    const line = readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((row) => row.trim())
      .find((row) => row && !row.startsWith("---"));
    return (line || "").replace(/^#+\s*/, "").slice(0, 160);
  } catch {
    return "";
  }
}

function looseEnabled(filePath: string, baseDir: string, filters: string[] | undefined): boolean {
  if (!filters) return true;
  const ctx = buildMatchContext(filePath, baseDir);
  return resourceEnabledByFilter(filters, ctx.rel, ctx.name);
}

function pushLoose(
  items: ResourceItem[],
  opts: BuildSkillInventoryOptions,
  scope: ResourceScope,
  settings: Record<string, unknown>,
) {
  const baseDir = scope === "global" ? opts.agentDir : join(opts.cwd, ".pi");
  const displayScope = scope;
  for (const kind of ["extension", "prompt", "theme"] as const) {
    const spec = LOOSE_SPEC[kind];
    const filters = kindArray(settings, kind);
    for (const filePath of walkFiles(join(baseDir, spec.dir), spec.exts)) {
      const rel = toPosix(relative(baseDir, filePath));
      items.push({
        kind,
        id: `folder:${kind}:${displayScope}:${rel}`,
        name: basename(filePath).replace(/\.[^.]+$/, ""),
        description: kind === "prompt" ? firstLine(filePath) : "",
        origin: { type: "folder", label: spec.dir },
        scope: displayScope,
        enabled: looseEnabled(filePath, baseDir, filters),
        path: filePath,
        relativePath: rel,
        ambiguous: false,
      });
    }
  }
}

function packageFiles(pkg: ResolvedPackage): Array<{
  kind: ResourceKind;
  name: string;
  description: string;
  relativePath: string;
  path: string;
}> {
  const root = pkg.installedRoot;
  if (!root) return [];
  const found: Array<{
    kind: ResourceKind;
    name: string;
    description: string;
    relativePath: string;
    path: string;
  }> = [];
  const addDir = (kind: Exclude<ResourceKind, "skill">) => {
    const spec = LOOSE_SPEC[kind];
    for (const filePath of walkFiles(join(root, spec.dir), spec.exts)) {
      found.push({
        kind,
        name: basename(filePath).replace(/\.[^.]+$/, ""),
        description: kind === "prompt" ? firstLine(filePath) : "",
        relativePath: toPosix(relative(root, filePath)),
        path: filePath,
      });
    }
  };
  addDir("extension");
  addDir("prompt");
  addDir("theme");
  return found;
}

export function buildResourceInventory(opts: BuildSkillInventoryOptions): ResourceInventory {
  const trusted = Boolean(opts.projectTrusted);
  const diagnostics: ResourceInventory["diagnostics"] = [];
  if (opts.scope === "project" && !trusted) {
    return { scope: "project", trusted: false, items: [], diagnostics };
  }

  const items: ResourceItem[] = [];
  const skills = buildSkillInventory(opts);
  diagnostics.push(...skills.diagnostics);
  const wantSkillScope = opts.scope === "global" ? "user" : "project";
  for (const root of skills.roots) {
    const leaves: Array<{
      id: string;
      name: string;
      description: string;
      enabled: boolean;
      canonicalPath: string;
      ruleRelativeDir: string;
      scope: string;
      sourceRoot: string;
      ambiguous: boolean;
    }> = [];
    const visit = (node: { children?: Array<Record<string, unknown>> }) => {
      for (const child of node.children ?? []) {
        if (child.kind === "skill") leaves.push(child as never);
        else visit(child as never);
      }
    };
    visit(root as never);
    for (const skill of leaves) {
      if (skill.scope !== wantSkillScope) continue;
      items.push({
        kind: "skill",
        id: `folder:skill:${opts.scope}:${skill.id}`,
        name: skill.name,
        description: skill.description,
        origin: { type: "folder", label: skill.sourceRoot },
        scope: opts.scope,
        enabled: skill.enabled,
        path: skill.canonicalPath,
        relativePath: skill.ruleRelativeDir,
        ambiguous: skill.ambiguous,
      });
    }
  }

  const settingsPath = settingsPathFor(opts.scope, opts);
  let settings: Record<string, unknown> = {};
  try {
    settings = readSettingsObject(settingsPath);
  } catch (error) {
    diagnostics.push({
      path: settingsPath,
      message: error instanceof Error ? error.message : "settings unreadable",
    });
  }
  pushLoose(items, opts, opts.scope, settings);

  const filters = readFilters(settingsPath);
  const packageSkills = buildPackageSkillInventory(opts);
  diagnostics.push(...packageSkills.diagnostics);
  for (const card of packageSkills.packages) {
    if (card.scope !== opts.scope) continue;
    const kindFilters = filters.get(card.source);
    for (const candidate of card.candidates) {
      items.push({
        kind: "skill",
        id: `package:skill:${card.identity}:${candidate.relativePath}`,
        name: candidate.name,
        description: candidate.description,
        origin: { type: "package", label: card.source, source: card.source },
        scope: card.scope,
        enabled: resourceEnabledByFilter(
          kindFilters?.skill,
          candidate.relativePath,
          candidate.name,
        ),
        path: candidate.canonicalPath,
        relativePath: candidate.relativePath,
        ambiguous: false,
      });
    }
  }

  const globalEntries = readSettingsPackagesWithDiags(
    join(opts.agentDir, "settings.json"),
    diagnostics,
  );
  const projectEntries = trusted
    ? readSettingsPackagesWithDiags(join(opts.cwd, ".pi", "settings.json"), diagnostics)
    : [];
  const resolved = dedupeConfiguredPackages(globalEntries, projectEntries, {
    agentDir: opts.agentDir,
    cwd: opts.cwd,
    projectTrusted: trusted,
  }).filter((pkg) => pkg.scope === opts.scope);
  for (const pkg of resolved) {
    const kindFilters = filters.get(pkg.source);
    for (const file of packageFiles(pkg)) {
      items.push({
        kind: file.kind,
        id: `package:${file.kind}:${pkg.identity}:${file.relativePath}`,
        name: file.name,
        description: file.description,
        origin: { type: "package", label: pkg.source, source: pkg.source },
        scope: opts.scope,
        enabled: resourceEnabledByFilter(kindFilters?.[file.kind], file.relativePath, file.name),
        path: file.path,
        relativePath: file.relativePath,
        ambiguous: false,
      });
    }
  }

  const order = KINDS;
  items.sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.name.localeCompare(b.name),
  );
  return { scope: opts.scope, trusted, items, diagnostics };
}

function nextPackageFilter(
  filters: string[] | undefined,
  relativePath: string,
  enabled: boolean,
): string[] | undefined {
  const rel = toPosix(relativePath).replace(/^\.\//, "");
  const drop = (entry: string) => entry.replace(/^[!+-]/, "").replace(/^\.\//, "") !== rel;
  if (!enabled) {
    const kept = (filters ?? []).filter(drop);
    kept.push(`-${rel}`);
    return kept;
  }
  if (filters === undefined) return undefined;
  if (filters.length === 0) return [`+${rel}`];
  const kept = filters.filter(drop);
  const positives = kept.filter((entry) => !/^[!+-]/.test(entry));
  if (positives.length > 0 && !positives.includes(rel)) kept.push(`+${rel}`);
  return kept.length === 0 ? undefined : kept;
}

export async function setResourceEnabled(
  opts: BuildSkillInventoryOptions & { kind: ResourceKind; id: string; enabled: boolean },
): Promise<{ inventory: ResourceInventory; runtimeRestartRequired: true }> {
  const current = buildResourceInventory(opts);
  const item = current.items.find((entry) => entry.id === opts.id && entry.kind === opts.kind);
  if (!item) throw new Error("Unknown resource");
  if (item.ambiguous) throw new Error("Resource is ambiguous; edit settings.json manually");
  if (opts.scope === "project" && !opts.projectTrusted) {
    throw new Error("Project is not trusted; cannot mutate project resources");
  }

  if (item.origin.type === "folder" && item.kind === "skill") {
    const canonical = item.id.slice(`folder:skill:${opts.scope}:`.length);
    await mutateSkillEnabled({
      ...opts,
      target: { kind: "skill", id: canonical },
      enabled: opts.enabled,
    });
    return { inventory: buildResourceInventory(opts), runtimeRestartRequired: true };
  }

  await updatePiSettings(
    (manager) => {
      const global = opts.scope === "global";
      const original = (
        global ? manager.getGlobalSettings() : manager.getProjectSettings()
      ) as Record<string, unknown>;
      if (item.origin.type === "folder") {
        const next = nextPackageFilter(
          kindArray(original, item.kind),
          item.relativePath,
          opts.enabled,
        ) as string[];
        writeFolderFilter(manager, item.kind, global, next);
        return;
      }
      const packages = Array.isArray(original.packages) ? [...original.packages] : [];
      const source = item.origin.source || item.origin.label;
      const index = packages.findIndex((entry) => {
        if (typeof entry === "string") return entry === source;
        return (
          Boolean(entry) &&
          typeof entry === "object" &&
          (entry as { source?: string }).source === source
        );
      });
      const existing = index >= 0 ? packages[index] : source;
      const objectForm: Record<string, unknown> =
        existing && typeof existing === "object"
          ? { ...(existing as Record<string, unknown>) }
          : { source };
      const key = kindKey(item.kind);
      const previous = Array.isArray(objectForm[key]) ? (objectForm[key] as string[]) : undefined;
      const next = nextPackageFilter(previous, item.relativePath, opts.enabled);
      if (next === undefined) delete objectForm[key];
      else objectForm[key] = next;
      if (index >= 0) packages[index] = objectForm;
      else packages.push(objectForm);
      const sources = packages as PackageSource[];
      if (global) manager.setPackages(sources);
      else manager.setProjectPackages(sources);
    },
    { scope: opts.scope, cwd: opts.cwd, agentDir: opts.agentDir },
  );
  return { inventory: buildResourceInventory(opts), runtimeRestartRequired: true };
}

/** `undefined` removes the key, which Pi reads as "load everything". */
function writeFolderFilter(
  manager: SettingsManager,
  kind: ResourceKind,
  global: boolean,
  paths: string[],
): void {
  if (kind === "extension") {
    if (global) manager.setExtensionPaths(paths);
    else manager.setProjectExtensionPaths(paths);
  } else if (kind === "skill") {
    if (global) manager.setSkillPaths(paths);
    else manager.setProjectSkillPaths(paths);
  } else if (kind === "prompt") {
    if (global) manager.setPromptTemplatePaths(paths);
    else manager.setProjectPromptTemplatePaths(paths);
  } else if (global) manager.setThemePaths(paths);
  else manager.setProjectThemePaths(paths);
}
