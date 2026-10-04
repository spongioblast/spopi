// ABOUTME: Workbench and Focus as a patch for ui.layout.
// ABOUTME: Focus hides the sidebar and dock and keeps the chat near 72ch.

/**
 * @param {"workbench" | "focus"} preset
 * @returns {{ focus: boolean, sidebarHidden: boolean, dockHidden: boolean }}
 */
export function layoutPresetPatch(preset) {
  const focus = preset === "focus";
  return { focus, sidebarHidden: focus, dockHidden: focus };
}

/** @param {{ focus?: boolean } | null | undefined} layout */
export function toggledLayoutPreset(layout) {
  return layoutPresetPatch(layout?.focus ? "workbench" : "focus");
}
