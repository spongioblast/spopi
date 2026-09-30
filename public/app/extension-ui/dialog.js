// ABOUTME: Shows an extension dialog and parses its options.
// ABOUTME: The answer is sent back to the waiting Pi request.

import { openDialog } from "../ui/dialog.js";

/**
 * @typedef {{
 *   number: string,
 *   label: string,
 *   content: string,
 * }} DialogPreview
 *
 * @typedef {{
 *   header: string,
 *   title: string,
 *   body: string,
 *   previews: DialogPreview[],
 * }} DialogContent
 *
 * @typedef {{
 *   number: string,
 *   label: string,
 *   description: string,
 * }} DialogOption
 *
 * @typedef {{
 *   type?: string,
 *   kind?: string,
 *   method?: string,
 *   title?: string,
 *   message?: string,
 *   options?: unknown[],
 *   placeholder?: string,
 *   prefill?: string,
 *   timeout?: number,
 * }} ExtensionUiRequest
 *
 * @typedef {{
 *   cancelled?: boolean,
 *   value?: unknown,
 *   confirmed?: boolean,
 * }} DialogResult
 *
 * @typedef {{ close: () => void, element: HTMLElement }} DialogHandle
 */

/**
 * Closes a prompt when another client already answered that request id.
 * @param {unknown} request
 * @param {(result: DialogResult) => void} finish
 */
export function closeWhenResolved(request, finish) {
  const id =
    request && typeof request === "object" && "id" in request && typeof request.id === "string"
      ? request.id
      : "";
  if (!id) return () => {};
  /**
   * @param {Event} event
   */
  const onResolved = (event) => {
    const detail = /** @type {CustomEvent} */ (event).detail;
    if (!detail || detail.id !== id) return;
    finish({ cancelled: true });
  };
  document.addEventListener("spopi-ui-resolved", onResolved);
  return () => document.removeEventListener("spopi-ui-resolved", onResolved);
}

/**
 * @param {ExtensionUiRequest} request
 * @param {HTMLElement | null} [container]
 * @param {object} [options]
 * @param {Promise<unknown>} [options.dismissSignal]
 * @returns {Promise<DialogResult>}
 */
export function showNativeDialog(
  request,
  container = document.getElementById("dialog-container"),
  { dismissSignal } = {},
) {
  return new Promise((resolve) => {
    const content = parseDialogContent(request);
    const body = document.createElement("div");
    /** @type {{ label: string, onClick?: () => void }[]} */
    const actions = [];
    /** @type {HTMLInputElement | HTMLTextAreaElement | null} */
    let input = null;
    /** @type {DialogResult} */
    let result = { cancelled: true };
    let settled = false;
    /** @type {DialogHandle} */
    let handle;

    /** @type {() => void} */
    let stopResolved = () => {};
    /**
     * @param {DialogResult} value
     */
    const finish = (value) => {
      if (settled) return;
      settled = true;
      stopResolved();
      result = value;
      handle.close();
    };
    stopResolved = closeWhenResolved(request, finish);

    if (request.method === "select") {
      if (content.body) body.append(createMessage(content.body));
      const optionsHost = document.createElement("div");
      optionsHost.className =
        content.previews.length > 0 ? "dialog-body dialog-body--with-preview" : "dialog-body";
      const options = document.createElement("div");
      options.className = "dialog-options";
      for (const value of request.options ?? []) {
        const optionContent = parseOption(value);
        const option = document.createElement("button");
        option.type = "button";
        option.className = "dialog-option";
        if (optionContent.number) {
          const index = document.createElement("span");
          index.className = "dialog-option-index";
          index.textContent = optionContent.number;
          option.append(index);
        }
        const label = document.createElement("span");
        label.className = "dialog-option-label";
        label.textContent = optionContent.label;
        option.append(label);
        if (optionContent.description) {
          const description = document.createElement("span");
          description.className = "dialog-option-description";
          description.textContent = optionContent.description;
          option.append(description);
        }
        option.addEventListener("click", () => finish({ value }));
        options.append(option);
      }
      optionsHost.append(options);
      if (content.previews.length > 0) optionsHost.append(createPreviews(content.previews));
      body.append(optionsHost);
    } else if (request.method === "confirm") {
      body.append(createMessage(request.message || ""));
      actions.push(
        { label: "No", onClick: () => finish({ confirmed: false }) },
        { label: "Yes", onClick: () => finish({ confirmed: true }) },
      );
    } else {
      if (content.body) body.append(createMessage(content.body));
      const field =
        request.method === "editor"
          ? document.createElement("textarea")
          : document.createElement("input");
      field.className = request.method === "editor" ? "dialog-textarea" : "dialog-input";
      field.value = request.prefill || "";
      if (request.placeholder) field.placeholder = request.placeholder;
      body.append(field);
      input = field;
      actions.push({
        label: request.method === "editor" ? "Save" : "Submit",
        onClick: () => finish({ value: field.value }),
      });
    }
    actions.push({ label: "Cancel", onClick: () => finish({ cancelled: true }) });

    handle = openDialog({
      container,
      title: content.title || defaultTitle(request.method),
      body,
      actions,
      initialFocus: input || undefined,
      closeOnBackdrop: false,
      onClose: () => {
        if (timeout) clearTimeout(timeout);
        document.removeEventListener("keydown", keyHandler);
        if (!settled) settled = true;
        resolve(result);
      },
    });

    if (content.header) {
      const badge = document.createElement("span");
      badge.className = "dialog-header-badge";
      badge.textContent = content.header;
      handle.element.querySelector(".dialog-title")?.prepend(badge);
    }

    dismissSignal?.then(() => finish({ cancelled: true }));
    /** @type {ReturnType<typeof setTimeout> | 0} */
    let timeout = 0;
    if (request.timeout) timeout = setTimeout(() => finish({ cancelled: true }), request.timeout);
    /**
     * @param {KeyboardEvent} event
     */
    const keyHandler = (event) => {
      const field = input;
      if (field && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        finish({ value: field.value });
      }
    };
    document.addEventListener("keydown", keyHandler);
  });
}

/**
 * @param {ExtensionUiRequest} request
 * @returns {DialogContent}
 */
export function parseDialogContent(request) {
  const rawTitle = String(request.title || "");
  const previewStart = rawTitle.search(/\n\n--- \d+\. .+? preview ---\n/);
  const visibleTitle = previewStart >= 0 ? rawTitle.slice(0, previewStart) : rawTitle;
  const previews = previewStart >= 0 ? parsePreviewBlocks(rawTitle.slice(previewStart)) : [];
  const lines = visibleTitle.split(/\n+/).map((line) => line.trim());
  const titleLine = lines.shift() || "";
  const headerMatch = titleLine.match(/^\[([^\]]+)]\s*(.*)$/);
  return {
    header: headerMatch?.[1] ?? "",
    title: headerMatch?.[2] ?? titleLine,
    body: lines.filter(Boolean).join("\n\n"),
    previews,
  };
}

/**
 * @param {unknown} value
 * @returns {DialogOption}
 */
export function parseOption(value) {
  const text = String(value ?? "");
  const match = text.match(/^(\d+)\.\s+(.+?)(?:\s+[—-]\s+(.+))?$/);
  if (!match) return { number: "", label: text, description: "" };
  return {
    number: match[1],
    label: match[2],
    description: match[3] ?? "",
  };
}

/**
 * @param {string} text
 * @returns {DialogPreview[]}
 */
function parsePreviewBlocks(text) {
  return [
    ...text.matchAll(
      /\n\n--- (\d+)\. (.+?) preview ---\n([\s\S]*?)(?=\n\n--- \d+\. .+? preview ---\n|$)/g,
    ),
  ].map((match) => ({
    number: match[1],
    label: match[2],
    content: match[3].trim(),
  }));
}

/**
 * @param {string} value
 * @returns {HTMLDivElement}
 */
function createMessage(value) {
  const message = document.createElement("div");
  message.className = "dialog-message";
  message.textContent = value;
  return message;
}

/**
 * @param {DialogPreview[]} previews
 * @returns {HTMLDivElement}
 */
function createPreviews(previews) {
  const panel = document.createElement("div");
  panel.className = "dialog-preview-panel";
  for (const preview of previews) {
    const section = document.createElement("section");
    section.className = "dialog-preview";
    const title = document.createElement("div");
    title.className = "dialog-preview-title";
    title.textContent = `${preview.number}. ${preview.label}`;
    const body = document.createElement("pre");
    body.className = "dialog-preview-body";
    body.textContent = preview.content;
    section.append(title, body);
    panel.append(section);
  }
  return panel;
}

/**
 * @param {string | undefined} method
 * @returns {string}
 */
function defaultTitle(method) {
  return method === "confirm" ? "Confirm" : method === "editor" ? "Editor" : "Input";
}
