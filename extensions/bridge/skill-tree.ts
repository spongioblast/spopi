// ABOUTME: Builds the skill group tree the Settings page renders.
// ABOUTME: A skill's treePath places it; the last segment is the leaf.

import { join, relative } from "node:path";
import { toPosix } from "./skill-paths.ts";
import type {
  DiscoveredRoot,
  SkillChild,
  SkillGroupNode,
  SkillInventoryItem,
  SkillRoot,
} from "./skill-types.ts";

export function insertSkillIntoTree(
  tree: SkillRoot,
  item: SkillInventoryItem,
  meta: DiscoveredRoot,
): void {
  const segs = item.treePath ? item.treePath.split("/").filter(Boolean) : [];
  let node: { children: SkillChild[] } = tree;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (i === segs.length - 1) {
      node.children.push(item);
    } else {
      const existing = node.children.find(
        (c): c is SkillGroupNode => c.kind === "group" && c.name === seg,
      );
      if (existing) {
        node = existing;
      } else {
        const groupTreePath = segs.slice(0, i + 1).join("/");
        const groupDir = join(meta.dir, groupTreePath);
        const group: SkillGroupNode = {
          kind: "group",
          id: `${meta.dir}::${groupTreePath}`,
          sourceRoot: meta.dir,
          ruleBaseDir: meta.baseDir,
          ruleBaseRelativePath: toPosix(relative(meta.baseDir, groupDir)),
          name: seg,
          scope: meta.scope,
          source: meta.source,
          state: "all-off",
          ambiguous: false,
          children: [],
        };
        node.children.push(group);
        node = group;
      }
    }
  }
  if (segs.length === 0) node.children.push(item);
}

export function collectLeaves(node: { children: SkillChild[] }): SkillInventoryItem[] {
  const out: SkillInventoryItem[] = [];
  for (const c of node.children) {
    if (c.kind === "skill") out.push(c);
    else out.push(...collectLeaves(c));
  }
  return out;
}

export function annotateTree(
  node: { children: SkillChild[] } & Partial<SkillGroupNode>,
  groupPathRoots: Map<string, Set<string>>,
): void {
  for (const c of node.children) {
    if (c.kind === "group") {
      annotateTree(c, groupPathRoots);
      const key = `${c.scope}::${c.ruleBaseRelativePath}`;
      const set = groupPathRoots.get(key) ?? new Set<string>();
      set.add(c.sourceRoot);
      groupPathRoots.set(key, set);
    }
  }
  if (node.kind === "group") {
    const leaves = collectLeaves(node);
    const enabled = leaves.filter((l) => l.status === "enabled").length;
    node.state =
      leaves.length === 0
        ? "all-off"
        : enabled === leaves.length
          ? "all-on"
          : enabled === 0
            ? "all-off"
            : "mixed";
  }
}

export function markGroupAmbiguity(
  node: { children: SkillChild[] },
  groupPathRoots: Map<string, Set<string>>,
): void {
  for (const c of node.children) {
    if (c.kind === "group") {
      c.ambiguous =
        (groupPathRoots.get(`${c.scope}::${c.ruleBaseRelativePath}`)?.size ?? 0) > 1 ||
        collectLeaves(c).some((l) => l.ambiguous);
      markGroupAmbiguity(c, groupPathRoots);
    }
  }
}

export function sortTree(node: { children: SkillChild[] }): void {
  node.children.sort((a, b) => {
    const aSkill = a.kind === "skill";
    const bSkill = b.kind === "skill";
    if (aSkill !== bSkill) return aSkill ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const c of node.children) if (c.kind === "group") sortTree(c);
}

export function findSkillInRoots(roots: SkillRoot[], id: string): SkillInventoryItem | undefined {
  for (const root of roots) {
    const found = findSkillInNode(root, id);
    if (found) return found;
  }
  return undefined;
}

export function findSkillInNode(
  node: { children: SkillChild[] },
  id: string,
): SkillInventoryItem | undefined {
  for (const c of node.children) {
    if (c.kind === "skill") {
      if (c.id === id) return c;
    } else {
      const found = findSkillInNode(c, id);
      if (found) return found;
    }
  }
  return undefined;
}

export function findGroupInRoots(roots: SkillRoot[], id: string): SkillGroupNode | undefined {
  for (const root of roots) {
    const found = findGroupInNode(root, id);
    if (found) return found;
  }
  return undefined;
}

export function findGroupInNode(
  node: { children: SkillChild[] },
  id: string,
): SkillGroupNode | undefined {
  for (const c of node.children) {
    if (c.kind === "group") {
      if (c.id === id) return c;
      const found = findGroupInNode(c, id);
      if (found) return found;
    }
  }
  return undefined;
}
