// ABOUTME: Lists the recommended packages and which of them are missing.
// ABOUTME: Installing one is left to the package browser.
// ABOUTME: Recommended Pi packages, capability detection, and first-run card copy.

/**
 * @typedef {{
 *   source: string,
 *   name: string,
 *   why: string,
 *   enables: string,
 * }} RecommendedPackage
 *
 * @typedef {{
 *   packageName?: string | null,
 *   source?: string | null,
 *   disabled?: boolean,
 * }} PackageRef
 *
 * @typedef {{
 *   checkpoints: boolean,
 *   problems: boolean,
 *   workers: boolean,
 *   context: boolean,
 *   fff: boolean,
 * }} CapabilityState
 *
 * @typedef {keyof CapabilityState} CapabilityFeature
 */

/** @type {RecommendedPackage[]} */
export const RECOMMENDED_PACKAGES = [
  {
    source: "npm:pi-workspace-history",
    name: "pi-workspace-history",
    why: "packages.recommended.checkpoints.why",
    enables: "checkpoints",
  },
  {
    source: "npm:pi-lens",
    name: "pi-lens",
    why: "packages.recommended.problems.why",
    enables: "problems",
  },
  {
    source: "npm:pi-subagents",
    name: "pi-subagents",
    why: "packages.recommended.workers.why",
    enables: "workers",
  },
  {
    source: "npm:pi-context-view",
    name: "pi-context-view",
    why: "packages.recommended.context.why",
    enables: "context",
  },
  {
    source: "npm:@ff-labs/pi-fff",
    name: "@ff-labs/pi-fff",
    why: "packages.recommended.fff.why",
    enables: "fff",
  },
  {
    source: "npm:@pify/worktree",
    name: "@pify/worktree",
    why: "packages.recommended.worktrees.why",
    enables: "worktrees",
  },
  {
    source: "npm:pi-web-access",
    name: "pi-web-access",
    why: "packages.recommended.web.why",
    enables: "web",
  },
];

export const FIRST_RUN_KEY = "ui.extensions.firstRunDismissed";

/**
 * @param {PackageRef[]} [packages]
 * @returns {Set<string>}
 */
function installedNames(packages = []) {
  return new Set(
    packages
      .filter((pkg) => pkg && pkg.disabled !== true)
      .map((pkg) => String(pkg.packageName || pkg.source || "").replace(/^npm:/, "")),
  );
}

/**
 * @param {PackageRef[]} [packages]
 * @returns {CapabilityState}
 */
export function capabilityState(packages = []) {
  const names = installedNames(packages);
  return {
    checkpoints: names.has("pi-workspace-history"),
    problems: names.has("pi-lens"),
    workers: [...names].some((name) => name.includes("pi-subagents")),
    context: names.has("pi-context-view"),
    fff: [...names].some((name) => name.includes("pi-fff")),
  };
}

/**
 * @param {PackageRef[]} [packages]
 * @returns {RecommendedPackage[]}
 */
export function missingRecommended(packages = []) {
  const names = installedNames(packages);
  return RECOMMENDED_PACKAGES.filter(
    (item) => !names.has(item.name) && ![...names].some((name) => name.includes(item.name)),
  );
}

/**
 * @param {CapabilityFeature} feature
 * @param {PackageRef[]} [packages]
 * @returns {{ source: string, name: string, why: string } | null}
 */
export function createAffordances(feature, packages = []) {
  const caps = capabilityState(packages);
  if (caps[feature]) return null;
  const rec = RECOMMENDED_PACKAGES.find((item) => item.enables === feature);
  return rec ? { source: rec.source, name: rec.name, why: rec.why } : null;
}
