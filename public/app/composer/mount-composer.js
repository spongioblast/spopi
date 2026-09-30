// ABOUTME: Composer submit path: resolve the input, then send or run a builtin.
// ABOUTME: A failed send restores the draft, images, and any pending fork check.

import { openRegisteredTree } from "../session/session-tree-host.js";
import { appKeybindings } from "../ui/keybindings.js";
import { randomId } from "../utils/random-id.js";
import { mountComposerSubmitHandling } from "./composer-submit.js";
import { matchCatalogCommand, resolveComposerInput } from "./slash-commands.js";

/**
 * @typedef {import("./slash-commands.js").SlashCommand} SlashCommand
 *
 * @param {{
 *   input: HTMLTextAreaElement | HTMLInputElement,
 *   form: HTMLFormElement | null,
 *   pasteOffload?: { isBusy: () => boolean } | null,
 *   imageAttachments: {
 *     getImages: () => unknown[],
 *     clear: () => void,
 *     setImages: (images: unknown[]) => void,
 *   },
 *   composerAutoResize: { sync: () => void },
 *   commandCompatibility: { beginCommand: (command: unknown) => void },
 *   runtime: {
 *     request: (payload: unknown, target: unknown, opts?: unknown) => Promise<unknown>,
 *   },
 *   messageRenderer: { renderSystemMessage: (text: string) => void },
 *   settingsButton?: HTMLElement | null,
 *   showError: (error: unknown) => void,
 *   getStore: () => { lifecycle?: string },
 *   getTarget: () => unknown,
 *   getCommandCatalog: () => Map<string, SlashCommand>,
 *   clearPendingFork: () => void,
 *   allowPrompt?: (() => boolean) | null,
 * }} options
 */
export function mountComposer({
  input,
  form,
  pasteOffload,
  imageAttachments,
  composerAutoResize,
  commandCompatibility,
  runtime,
  messageRenderer,
  settingsButton,
  showError,
  getStore,
  getTarget,
  getCommandCatalog,
  clearPendingFork,
  allowPrompt,
}) {
  /**
   * @param {{ altKey: boolean }} options
   */
  async function sendComposerInput({ altKey }) {
    if (pasteOffload?.isBusy()) return;
    const images = imageAttachments.getImages();
    if (!input.value.trim() && images.length === 0) return;
    const value = input.value;
    const commandCatalog = getCommandCatalog();
    const intent = resolveComposerInput(value, commandCatalog, {
      working: getStore().lifecycle === "working",
      altKey,
      images,
    });
    if (intent.kind === "rejected") {
      const reason = "reason" in intent ? String(intent.reason) : "rejected";
      throw new Error(reason);
    }
    if (intent.kind === "builtin") {
      const action = "action" in intent ? intent.action : undefined;
      runBuiltin(action);
      return;
    }
    const catalogCommand = matchCatalogCommand(value, commandCatalog)?.command;
    if (!catalogCommand && allowPrompt && !allowPrompt()) return;
    const command = "command" in intent ? intent.command : undefined;
    input.value = "";
    input.scrollTop = 0;
    composerAutoResize.sync();
    imageAttachments.clear();
    // Open the attribution window before the command runs: an extension command
    // executes immediately over RPC, so a capability report can arrive while the
    // request is still in flight.
    commandCompatibility.beginCommand(catalogCommand);
    try {
      await runtime.request(command, getTarget(), { idempotencyKey: randomId() });
    } catch (error) {
      input.value = value;
      composerAutoResize.sync();
      imageAttachments.setImages(images);
      clearPendingFork();
      throw error;
    }
  }

  /** @param {unknown} action */
  function runBuiltin(action) {
    const binding = appKeybindings()
      .list()
      .find((item) => item.id === action);
    if (binding) {
      binding.run();
      return;
    }
    if (action === "open_settings") settingsButton?.click();
    else if (action === "open_tree") void openRegisteredTree();
    else if (action === "show_help") {
      messageRenderer.renderSystemMessage(
        "Enter sends a prompt; while working Enter steers and Alt+Enter queues a follow-up. Use // for a literal slash.",
      );
    }
  }

  mountComposerSubmitHandling({
    input,
    form,
    /**
     * @param {{ altKey: boolean }} options
     */
    onSubmit: ({ altKey }) => {
      sendComposerInput({ altKey }).catch(showError);
    },
  });

  return { sendComposerInput };
}
