// ABOUTME: Hosts the Ctrl+K prompt: one model call, then the edit lands in the editor.
// ABOUTME: There is no accept step; Ctrl+Z, Git discard, or the Git diff undo it like any edit.

import { t } from "../i18n/i18n.js";
import {
  buildInlinePrompt,
  fitToSelection,
  mountInlineEditPrompt,
  requestInlineEdit,
} from "./inline-edit.js";

/**
 * @typedef {(
 *   method: string,
 *   args: Record<string, unknown>,
 * ) => Promise<{ data?: { text?: string }, text?: string } | null | undefined>} InlineModelCall
 */

/**
 * @param {{
 *   path?: string,
 *   startLine?: number,
 *   endLine?: number,
 *   text?: string,
 *   apply?: (replacement: string) => boolean,
 * }} detail
 * @param {object} [options]
 * @param {Element | null | undefined} [options.previewParent]
 * @param {InlineModelCall | undefined} [options.modelCall]
 */
export function openInlineEdit(detail, { previewParent, modelCall } = {}) {
  const parent = previewParent || document.body;
  parent.querySelector(":scope > .inline-edit-prompt")?.remove();
  const root = document.createElement("div");
  parent.appendChild(root);
  const original = detail.text ?? "";
  const close = () => root.remove();
  const prompt = mountInlineEditPrompt(root, {
    t,
    onCancel: close,
    onSubmit: async (instruction) => {
      if (!prompt || !instruction.trim()) return;
      prompt.setBusy(true);
      try {
        const answer = await requestInlineEdit({
          prompt: buildInlinePrompt({ ...detail, instruction }),
          modelCall,
        });
        const replacement = fitToSelection(original, answer);
        if (replacement === original) {
          prompt.showMessage(t("editor.inlineEditNoChange"));
        } else if (detail.apply?.(replacement)) {
          close();
        } else {
          prompt.showMessage(t("editor.inlineEditStale"));
        }
      } catch (error) {
        const err = /** @type {{ message?: unknown } | null | undefined} */ (error);
        prompt.showMessage(String(err?.message || error));
      } finally {
        if (root.isConnected) {
          prompt.setBusy(false);
          prompt.input.focus();
        }
      }
    },
  });
}
