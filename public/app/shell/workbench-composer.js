// ABOUTME: Connects the composer to the workbench: context chips, @file mention pills, and editor selections.
// ABOUTME: Selections become mentions, pasted context, or inline edits; the composer chrome itself is not built here.

import {
  appendMentionToComposer,
  appendSelectionToComposer,
  mountContextChips,
} from "../chat/context-chips.js";
import { setComposerInsert, setInlineEdit } from "../composer/composer-actions.js";
import { mountMentionChips } from "../composer/mention-chips.js";
import {
  formatContextChip,
  formatSelectionMention,
  formatSelectionPrompt,
} from "../editor/editor-context.js";
import { openInlineEdit } from "../editor/inline-edit-host.js";
import { asHtmlHost, asTextInput, asTitled } from "./workbench-element-guards.js";

/**
 * @typedef {ReturnType<typeof import("./chrome/composer.js").composerChromeRefs>} ComposerRefs
 * @typedef {import("./mount-workbench.js").ConfigCall} ConfigCall
 * @typedef {ReturnType<typeof mountContextChips>} ContextChips
 *
 * @typedef {{
 *   path?: string,
 *   startLine?: number,
 *   endLine?: number,
 *   text?: string,
 *   kind?: string,
 *   truncated?: boolean,
 *   instruction?: string,
 *   apply?: (replacement: string) => boolean,
 * }} SelectionDetail
 */

/**
 * @param {{
 *   composerRefs: ComposerRefs,
 *   workspacePathEl: Element | null,
 *   onOpenFile?: ((path: string, line?: number) => unknown) | null,
 * }} deps
 */
export function mountWorkbenchComposer({ composerRefs, workspacePathEl, onOpenFile }) {
  const composer = asHtmlHost(composerRefs.card);
  const chips = mountContextChips(composer);
  const mentionInput = asTextInput(composerRefs.messageInput);
  if (mentionInput && composer) {
    mountMentionChips({
      input: /** @type {HTMLInputElement | HTMLTextAreaElement} */ (mentionInput),
      host: composer,
      resolveAbsolute: (path) => {
        const pathEl = asTitled(workspacePathEl);
        const root = pathEl?.title || "";
        return [root.replace(/[\\/]+$/, ""), path].filter(Boolean).join("/");
      },
      onOpen: (path) => onOpenFile?.(path),
    });
  }
  return chips;
}

/**
 * @param {{
 *   composerRefs: ComposerRefs,
 *   chips: ContextChips,
 *   previewPanel: Element | null,
 *   configCall?: ConfigCall | null,
 * }} deps
 */
export function connectEditorSelection({ composerRefs, chips, previewPanel, configCall }) {
  setInlineEdit((detail) => {
    openInlineEdit(/** @type {SelectionDetail} */ (detail), {
      previewParent: previewPanel,
      modelCall: configCall
        ? async (method, args) =>
            /** @type {{ data?: { text?: string }, text?: string } | null | undefined} */ (
              await configCall(method, args)
            )
        : undefined,
    });
  });
  setComposerInsert((detail) => {
    const input = asTextInput(composerRefs.messageInput);
    const selection = /** @type {SelectionDetail} */ ({ ...detail, instruction: "" });
    if (!selection.kind && selection.path && selection.startLine) {
      // An editor selection is a file on disk: a linked @file:lines pill, not a pasted copy.
      appendMentionToComposer(
        /** @type {HTMLInputElement | HTMLTextAreaElement | null} */ (input),
        formatSelectionMention(selection),
      );
      input?.focus();
      return;
    }
    const formatted = formatSelectionPrompt(selection).replace(/^\n+/, "");
    appendSelectionToComposer(
      /** @type {HTMLInputElement | HTMLTextAreaElement | null} */ (input),
      formatted,
    );
    chips?.add({
      id: `${selection.path}:${selection.startLine}`,
      label: formatContextChip(selection),
    });
    input?.focus();
  });
}
