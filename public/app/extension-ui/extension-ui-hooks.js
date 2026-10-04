// ABOUTME: Routes extension notify, title, editor-text, and widget requests to their owners.
// ABOUTME: Data-plane notifies are consumed; the rest become chat notices once per session.

import { isRpivTodoCommandNotify, isRpivTodoWidgetRequest } from "../chat/rpiv-todo-mirror.js";
import { paintExtensionNotice } from "../chat/turn-block.js";
import { historyNotice } from "../chat/undo-marker.js";
import {
  INSPECT_WIDGET,
  isSubagentWidget,
  parseInspect,
  parseRuns,
} from "../subagents/subagent-feed.js";
import { applySubagentInspect, noteSubagentRuns } from "../subagents/subagent-view.js";
import { emitExtensionNotify } from "./notify-observers.js";

/**
 * @typedef {import("./extension-ui-host.js").ExtensionUiRequest} ExtensionUiRequest
 * @typedef {import("./extension-ui-host.js").ExtensionUiHooks} ExtensionUiHooks
 */

/**
 * @param {{
 *   config: import("../transport/config-gateway.js").ConfigGateway,
 *   customUiPanel: import("./custom-ui-panel.js").CustomUiPanel,
 *   openCustomUiTab: () => void,
 *   commandCompatibility: import("./extension-command-compatibility.js").ExtensionCommandCompatibility,
 *   todoMirrorPanel: import("../chat/rpiv-todo-mirror.js").RpivTodoMirrorPanel,
 *   undoMarker: ReturnType<typeof import("../chat/undo-marker.js").createUndoMarker>,
 *   subagentStrip: import("../subagents/subagent-strip.js").SubagentStrip,
 *   extensionWidgets: import("./extension-widgets.js").ExtensionWidgets,
 *   input: HTMLTextAreaElement | null,
 *   composerAutoResize: { sync: () => void },
 *   messagesElement: Element | null,
 *   getSessionId: () => string | undefined,
 *   hydrateSnapshot: () => Promise<unknown>,
 *   showError: (error: unknown) => void,
 * }} deps
 * @returns {ExtensionUiHooks}
 */
export function createExtensionUiHooks(deps) {
  const { input, composerAutoResize, messagesElement } = deps;
  let undonePrompt = "";
  /** @type {Map<string, Set<string>>} */
  const noticesShown = new Map();

  /** @param {unknown} message */
  function firstNoticeInSession(message) {
    const text = typeof message === "string" ? message.trim() : "";
    if (!text) return true;
    const key = deps.getSessionId() || "";
    const seen = noticesShown.get(key) ?? new Set();
    noticesShown.set(key, seen);
    if (seen.has(text)) return false;
    seen.add(text);
    return true;
  }

  return {
    notify: (request) => {
      // Config responses, ctx.ui.custom panels, and terminal-only capability
      // reports all travel as notify events and never become chat messages.
      if (deps.config.consumeNotify(request)) return;
      if (deps.customUiPanel.consumeNotify(request)) {
        deps.openCustomUiTab();
        return;
      }
      if (deps.commandCompatibility.consumeNotify(request)) return;
      // rpiv-todo's /todos repeats what the native mirror shows; expand the
      // mirror instead, unless it is empty, so /todos is never silent.
      if (isRpivTodoCommandNotify(request.message) && deps.todoMirrorPanel.hasVisibleTasks) {
        deps.todoMirrorPanel.expand();
        return;
      }
      // /undo and /redo move Pi's session tree without an event; the chat is rebuilt from
      // the new position so it shows what the model now sees, and a marker holds the undone turn.
      const history = historyNotice(request.message);
      if (history) {
        // /undo puts the undone prompt in the composer; after /redo that text would run it twice.
        if (history.kind === "undo") undonePrompt = input?.value || "";
        else if (input && undonePrompt && input.value === undonePrompt) {
          input.value = "";
          composerAutoResize.sync();
        }
        void deps
          .hydrateSnapshot()
          .then(() => {
            if (history.kind === "undo") deps.undoMarker.show(history);
            else deps.undoMarker.clear();
          })
          .catch(deps.showError);
        return;
      }
      // Extensions repeat config warnings on every session start and restart; say each
      // one once per session.
      if (request.notifyType === "warning" && !firstNoticeInSession(request.message)) return;
      emitExtensionNotify(request);
      paintExtensionNotice(messagesElement, request);
    },
    title: (request) => {
      if (typeof request.title === "string" && request.title) document.title = request.title;
    },
    editorText: (request) => {
      if (!input) return;
      input.value = typeof request.text === "string" ? request.text : String(request.text ?? "");
      composerAutoResize.sync();
      input.focus();
    },
    widget: (request) => {
      // rpiv-todo owns the tool; SPOPI mirrors its persisted snapshots instead of the TUI widget.
      if (isRpivTodoWidgetRequest(/** @type {{ method?: string, widgetKey?: string }} */ (request)))
        return;
      // pi-subagents sends machine-readable JSON on its widget keys for hosts like this one.
      const widget = /** @type {{ method?: string, widgetKey?: string, widgetLines?: unknown }} */ (
        request
      );
      if (isSubagentWidget(widget)) {
        if (widget.widgetKey === INSPECT_WIDGET) {
          const reply = parseInspect(widget.widgetLines);
          if (reply) applySubagentInspect(reply);
          return;
        }
        const runs = parseRuns(widget.widgetLines);
        deps.subagentStrip.setRuns(runs);
        noteSubagentRuns(runs);
        return;
      }
      // Anything else goes to the generic renderer, so an extension's status panel shows.
      deps.extensionWidgets.apply(
        /** @type {import("./extension-widgets.js").SetWidgetRequest} */ (
          /** @type {unknown} */ (request)
        ),
      );
    },
  };
}
