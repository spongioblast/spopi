// ABOUTME: Recognizes the shortcut that toggles the file sidebar.
// ABOUTME: The shortcut uses the Command key on macOS and Control elsewhere.
// ABOUTME: SPOPI Ctrl/Cmd+B Files toggle, skipped when the SPOPI shell owns Ctrl+B.

export function isMacOS() {
  return navigator.platform.startsWith("Mac") || navigator.userAgent.includes("Macintosh");
}

/**
 * @param {EventTarget | null | undefined} target
 * @returns {boolean}
 */
function isFilePanelShortcutTypingTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select")) return true;
  return target.closest('[contenteditable="true"]') !== null;
}

/** @param {KeyboardEvent} event */
export function isFilePanelShortcut(event) {
  if (event.defaultPrevented || event.isComposing) return false;
  if (isFilePanelShortcutTypingTarget(event.target)) return false;
  if (event.altKey || event.shiftKey || event.key.toLowerCase() !== "b") return false;
  return event.metaKey || event.ctrlKey;
}
