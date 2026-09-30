// ABOUTME: Switches Workbench and Focus for the current project.
// ABOUTME: Focus hides the sidebar and dock and keeps the chat near 72ch.

const STORAGE_PREFIX = "spopi.layout.preset";

/**
 * @param {string} [workspaceId]
 * @returns {"workbench" | "focus"}
 */
function readLayoutPreset(workspaceId = "") {
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}:${workspaceId || "default"}`);
    return stored === "focus" ? "focus" : "workbench";
  } catch {
    return "workbench";
  }
}

/**
 * @param {string} [workspaceId]
 * @param {(patch: { sidebarHidden: boolean, dockHidden: boolean }) => void} [apply]
 * @returns {"workbench" | "focus"}
 */
export function toggleLayoutPreset(workspaceId = "", apply) {
  const next = readLayoutPreset(workspaceId) === "focus" ? "workbench" : "focus";
  try {
    localStorage.setItem(`${STORAGE_PREFIX}:${workspaceId || "default"}`, next);
  } catch {
    // Private mode can reject storage. The body flag still applies for this view.
  }
  document.body.dataset.layoutPreset = next;
  apply?.({
    sidebarHidden: next === "focus",
    dockHidden: next === "focus",
  });
  return next;
}
