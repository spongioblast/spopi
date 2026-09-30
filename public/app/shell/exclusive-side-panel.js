// ABOUTME: Opens one side panel at a time and closes the others.
// ABOUTME: The panel ids are passed in by the shell.

/**
 * Exclusive side-panel toggle — opening one panel collapses the others.
 * Kept in a leaf module so WebView ESM linking does not depend on
 * NativeFileBrowser's export list.
 *
 * @param {Element | null | undefined} panel
 * @param {Array<Element | null | undefined>} [otherPanels]
 * @returns {boolean}
 */
export function toggleExclusiveSidePanel(panel, otherPanels = []) {
  if (!panel) return false;
  const willOpen = panel.classList.contains("collapsed");
  if (willOpen) {
    for (const other of otherPanels) other?.classList.add("collapsed");
  }
  panel.classList.toggle("collapsed", !willOpen);
  return willOpen;
}

/**
 * Toggle a named view inside a shared exclusive side panel.
 * Header Files and Git each own one view: clicking the active view closes
 * the panel; clicking the other view switches without a tab bar.
 *
 * @param {Element | null | undefined} panel
 * @param {{
 *   otherPanels?: Array<Element | null | undefined>,
 *   currentView?: unknown,
 *   nextView?: unknown,
 * }} [options]
 * @returns {{ open: boolean, view: unknown }}
 */
export function toggleExclusiveSideView(panel, { otherPanels = [], currentView, nextView } = {}) {
  if (!panel) return { open: false, view: currentView ?? nextView };
  const isOpen = !panel.classList.contains("collapsed");
  if (isOpen && currentView === nextView) {
    panel.classList.add("collapsed");
    return { open: false, view: currentView };
  }
  for (const other of otherPanels) other?.classList.add("collapsed");
  panel.classList.remove("collapsed");
  return { open: true, view: nextView };
}
