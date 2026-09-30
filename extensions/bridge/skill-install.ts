// ABOUTME: Scans a chosen folder for skills and appends them to Pi's skills list.
// ABOUTME: The write goes through SettingsManager so Pi owns the settings file.

import { realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ConfigContext } from "./paths";
import {
  type DiscoveredSkill,
  discoverSkillsFromRoot,
  type SkillDiagnostic,
} from "./skill-discovery";
import { serialized } from "./skill-mutate";
import { toPosix } from "./skill-paths";

export type SkillInstallNode = {
  kind: "group" | "skill";
  id: string;
  name: string;
  description?: string;
  displayCanonicalPath?: string;
  children?: SkillInstallNode[];
};

export type SkillInstallScan = {
  path: string;
  tree: SkillInstallNode[];
  defaultSelection: Array<{ kind: "skill"; id: string }>;
  diagnostics: SkillDiagnostic[];
};

type SelectionItem = { kind?: unknown; id?: unknown };

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function relativeParts(source: string, skillDir: string): string[] {
  const rel = relative(source, skillDir);
  if (!rel || rel === ".") return [];
  return rel.split(sep).filter(Boolean);
}

function nodeId(parts: string[]): string {
  return parts.map((part) => toPosix(part)).join("/");
}

/**
 * @param {string} source
 * @param {DiscoveredSkill[]} skills
 */
export function buildInstallTree(
  source: string,
  skills: DiscoveredSkill[],
): SkillInstallScan["tree"] {
  /** @type {SkillInstallNode[]} */
  const roots: SkillInstallNode[] = [];
  const groups = new Map<string, SkillInstallNode>();

  function ensureGroup(parts: string[]): SkillInstallNode {
    const id = nodeId(parts);
    const existing = groups.get(id);
    if (existing) return existing;
    const group: SkillInstallNode = {
      kind: "group",
      id,
      name: parts[parts.length - 1] ?? id,
      children: [],
    };
    groups.set(id, group);
    if (parts.length === 1) roots.push(group);
    else ensureGroup(parts.slice(0, -1)).children?.push(group);
    return group;
  }

  const sorted = [...skills].sort((a, b) => a.canonicalPath.localeCompare(b.canonicalPath));
  for (const skill of sorted) {
    const parts = relativeParts(source, skill.skillDir);
    const skillNode: SkillInstallNode = {
      kind: "skill",
      id: parts.length ? nodeId(parts) : skill.name,
      name: skill.name,
      description: skill.description,
      displayCanonicalPath: canonical(skill.skillDir),
    };
    if (parts.length <= 1) roots.push(skillNode);
    else ensureGroup(parts.slice(0, -1)).children?.push(skillNode);
  }
  return roots;
}

function indexNodes(tree: SkillInstallNode[]): Map<string, SkillInstallNode> {
  const nodes = new Map<string, SkillInstallNode>();
  const visit = (items: SkillInstallNode[]) => {
    for (const item of items) {
      nodes.set(item.id, item);
      if (item.children) visit(item.children);
    }
  };
  visit(tree);
  return nodes;
}

function flattenSkills(node: SkillInstallNode): SkillInstallNode[] {
  if (node.kind === "skill") return [node];
  return (node.children ?? []).flatMap(flattenSkills);
}

function commonDirectory(paths: string[]): string {
  if (paths.length === 0) throw new Error("Invalid skill install selection");
  if (paths.length === 1) return paths[0];
  const split = paths.map((path) => path.split(sep));
  const common: string[] = [];
  for (let index = 0; ; index += 1) {
    const next = split[0][index];
    if (next === undefined || split.some((parts) => parts[index] !== next)) break;
    common.push(next);
  }
  return common.length ? common.join(sep) : paths[0];
}

function encodeEntry(absPath: string, baseDir: string): string {
  const rel = toPosix(relative(baseDir, absPath));
  if (!rel || rel === "." || rel.startsWith("../") || rel === "..") {
    return absPath;
  }
  return `./${rel}`;
}

function existingCanonical(entry: string, baseDir: string): string {
  if (entry.startsWith("./") || entry.startsWith(".\\")) {
    return canonical(join(baseDir, entry.slice(2)));
  }
  if (entry.startsWith("/") || /^[A-Za-z]:/.test(entry)) return canonical(entry);
  return canonical(join(baseDir, entry));
}

export function scanSkillFolder(folder: string): SkillInstallScan {
  const source = canonical(folder);
  const diagnostics: SkillDiagnostic[] = [];
  const skills = discoverSkillsFromRoot(
    {
      dir: source,
      mode: "pi",
      baseDir: source,
      scope: "global",
      source: "install",
    },
    diagnostics,
  );
  const tree = buildInstallTree(source, skills);
  const defaultSelection = skills.map((skill) => {
    const parts = relativeParts(source, skill.skillDir);
    return { kind: "skill" as const, id: parts.length ? nodeId(parts) : skill.name };
  });
  return { path: source, tree, defaultSelection, diagnostics };
}

function currentSkills(manager: SettingsManager, scope: "global" | "project"): string[] {
  const settings = scope === "project" ? manager.getProjectSettings() : manager.getGlobalSettings();
  const skills = settings.skills;
  return Array.isArray(skills)
    ? skills.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export async function addSkillFolder(
  ctx: ConfigContext,
  folder: string,
  scope: "global" | "project",
  selection: SelectionItem[],
): Promise<{ addedEntries: string[]; skippedEntries: string[] }> {
  if (scope === "project" && ctx.isProjectTrusted && !ctx.isProjectTrusted()) {
    throw new Error("Project is not trusted");
  }
  const source = canonical(folder);
  const scan = scanSkillFolder(source);
  const nodes = indexNodes(scan.tree);
  const selected = new Set<string>();
  for (const item of selection) {
    if (typeof item.id !== "string" || (item.kind !== "skill" && item.kind !== "group")) {
      throw new Error("Invalid skill install selection");
    }
    const node = nodes.get(item.id);
    if (!node || node.kind !== item.kind) throw new Error("Invalid skill install selection");
    if (node.kind === "skill") {
      if (node.displayCanonicalPath) selected.add(node.displayCanonicalPath);
    } else {
      const paths = flattenSkills(node)
        .map((skill) => skill.displayCanonicalPath)
        .filter((path): path is string => Boolean(path));
      selected.add(commonDirectory(paths));
    }
  }
  const cwd = typeof ctx.cwd === "string" && ctx.cwd ? ctx.cwd : process.cwd();
  const agentDir = getAgentDir();
  const baseDir = scope === "project" ? join(cwd, ".pi") : agentDir;
  return serialized(`skills:${scope}:${baseDir}`, async () => {
    const manager = SettingsManager.create(cwd, agentDir);
    const existing = currentSkills(manager, scope);
    const configured = new Set(
      existing
        .filter(
          (entry) => !entry.startsWith("!") && !entry.startsWith("+") && !entry.startsWith("-"),
        )
        .map((entry) => existingCanonical(entry, baseDir)),
    );
    const addedEntries: string[] = [];
    const skippedEntries: string[] = [];
    for (const path of [...selected].sort()) {
      if (configured.has(canonical(path))) {
        skippedEntries.push(path);
        continue;
      }
      addedEntries.push(encodeEntry(path, baseDir));
    }
    if (addedEntries.length > 0) {
      const next = [...existing, ...addedEntries];
      if (scope === "project") manager.setProjectSkillPaths(next);
      else manager.setSkillPaths(next);
      await manager.flush();
    }
    return { addedEntries, skippedEntries };
  });
}
