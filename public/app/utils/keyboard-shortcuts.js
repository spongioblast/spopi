// ABOUTME: Registers the window-level keyboard shortcuts.
// ABOUTME: Editor-only shortcuts stay with the editor.

import { cycleGuard } from "../composer/guard-chip.js";
import { requestNewProject } from "../session/workspace-actions.js";
import { isSettingsOpen } from "../settings/settings-panel.js";
import { composerChromeRefs } from "../shell/chrome/composer.js";
import { overlayChromeRefs } from "../shell/overlay-chrome.js";
import { closeTop, dialogOwnsEscape } from "../ui/dialog.js";
import { showKeybindingHelp } from "../ui/keybinding-help.js";
import { appKeybindings, listenForKeybindings } from "../ui/keybindings.js";

/** @type {(() => void) | null} */
let cycleModel = null;

/** @param {() => void} handler */
export function registerModelCycle(handler) {
  cycleModel = handler;
}

/**
 * @param {Element | null | undefined} element
 */
function isEditableElement(element) {
  if (!(element instanceof HTMLElement)) return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || element.isContentEditable;
}

/**
 * @param {Element | null | undefined} element
 */
function isVisible(element) {
  return Boolean(element && !element.classList.contains("hidden"));
}

/** Modals register with the dialog stack, so only non-modal surfaces are listed here. */
function overlayOwnsEscape() {
  return (
    dialogOwnsEscape() ||
    isSettingsOpen() ||
    isVisible(composerChromeRefs().modelMenu) ||
    isVisible(overlayChromeRefs().dialog)
  );
}

/**
 * @param {{
 *   input?: {
 *     focus: () => void,
 *     value?: string,
 *     setSelectionRange?: (start: number, end: number) => void,
 *   } | null,
 *   abort: () => void,
 *   isWorking: () => boolean,
 *   newChat: () => void,
 * }} options
 */
export function mountAppKeyboardShortcuts({ input, abort, isWorking, newChat }) {
  const keys = appKeybindings();
  keys.register({
    id: "abort",
    keys: "Escape",
    labelKey: "keybindings.abort",
    run: () => {
      if (closeTop()) return true;
      if (overlayOwnsEscape()) return false;
      if (!isWorking()) return false;
      abort();
      return true;
    },
  });
  keys.register({
    id: "slash",
    keys: "/",
    labelKey: "keybindings.slash",
    when: () => !isEditableElement(document.activeElement),
    run: () => {
      if (input && typeof input.value === "string" && input.value.trim() === "") {
        input.value = "/";
        input.setSelectionRange?.(1, 1);
      }
      input?.focus();
    },
  });
  keys.register({
    id: "cycle-model",
    keys: "Mod+Alt+M",
    labelKey: "keybindings.cycleModel",
    run: () => cycleModel?.(),
  });
  keys.register({
    id: "guard.cycle",
    keys: "Mod+Shift+M",
    labelKey: "keybindings.guardCycle",
    run: () => {
      void cycleGuard();
    },
  });
  keys.register({
    id: "new-session",
    keys: "Mod+N",
    labelKey: "keybindings.newSession",
    when: () => !isEditableElement(document.activeElement),
    run: () => newChat(),
  });
  keys.register({
    id: "new-project",
    keys: "Mod+Shift+N",
    labelKey: "keybindings.newProject",
    when: () => !isEditableElement(document.activeElement),
    run: () => requestNewProject(),
  });
  keys.register({
    id: "help",
    keys: "?",
    labelKey: "keybindings.hotkeys",
    when: () => !isEditableElement(document.activeElement),
    run: () => showKeybindingHelp(),
  });
  listenForKeybindings();
  return { destroy() {} };
}
