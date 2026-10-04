// ABOUTME: Builds the pieces inside a tool card: chevron, copy button, args preview, diff, images, nested calls.
// ABOUTME: Pieces carry classes and data only; tool-card.js places them and handles clicks by delegation.

import { computeHunks, renderHunkList } from "../editor/merge-view.js";
import { t } from "../i18n/i18n.js";
import {
  filePathFromArgs,
  resultImages,
  savedOutputPath,
  toolArgsPreview,
} from "./tool-card-result.js";
import { displayToolName } from "./tool-display-name.js";

/**
 * @typedef {import("./tool-card-result.js").ToolArgs} ToolArgs
 * @typedef {import("./tool-card-result.js").ToolResult} ToolResult
 * @typedef {import("./tool-card-result.js").NestedCallRecord} NestedCallRecord
 * @typedef {{ id: string, name: string, status?: string, isError?: boolean, args?: unknown }} NestedCall
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * @param {boolean} [expanded]
 */
export function createToolChevron(expanded = false) {
  const chevron = document.createElement("span");
  chevron.className = `tool-card-chevron${expanded ? " expanded" : ""}`;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "8");
  svg.setAttribute("height", "8");
  svg.setAttribute("viewBox", "0 0 8 8");
  svg.setAttribute("fill", "currentColor");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M2 1l4 3-4 3z");
  svg.appendChild(path);
  chevron.appendChild(svg);
  return chevron;
}

export function createToolCopyButton() {
  const copyButton = document.createElement("button");
  copyButton.className = "tool-action-btn copy-output-btn";
  const label = t("tools.copyOutput");
  copyButton.title = label;
  copyButton.setAttribute("aria-label", label);

  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [name, value] of [
    ["width", "13"],
    ["height", "13"],
    ["viewBox", "0 0 24 24"],
    ["fill", "none"],
    ["stroke", "currentColor"],
    ["stroke-width", "2"],
    ["stroke-linecap", "round"],
    ["stroke-linejoin", "round"],
  ]) {
    svg.setAttribute(name, value);
  }
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("width", "14");
  rect.setAttribute("height", "14");
  rect.setAttribute("x", "8");
  rect.setAttribute("y", "8");
  rect.setAttribute("rx", "2");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2");
  svg.append(rect, path);
  copyButton.appendChild(svg);
  // Click handling is delegated to the container listener; no per-button
  // listener is needed here.
  return copyButton;
}

/**
 * @param {string} previewText
 * @param {ToolArgs | null | undefined} args
 */
export function createArgsPreview(previewText, args) {
  const filePath = filePathFromArgs(args);
  if (filePath) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tool-args-preview tool-file-ref";
    button.dataset.path = filePath;
    button.textContent = previewText;
    const label = t("tools.openInPreview");
    button.title = label;
    button.setAttribute("aria-label", `${label}: ${filePath}`);
    return button;
  }
  if (args?.command) {
    const wrap = document.createElement("span");
    wrap.className = "tool-args-preview-wrap";
    const preview = document.createElement("span");
    preview.className = "tool-args-preview";
    preview.textContent = previewText;
    preview.title = String(args.command);
    const run = document.createElement("button");
    run.type = "button";
    run.className = "tool-action-btn tool-run-in-terminal";
    run.dataset.command = args.command;
    run.title = t("files.runInTerminal") || "Run in terminal";
    run.setAttribute("aria-label", run.title);
    run.textContent = "▶";
    wrap.append(preview, run);
    return wrap;
  }
  const preview = document.createElement("span");
  preview.className = "tool-args-preview";
  preview.textContent = previewText;
  preview.title = previewText;
  return preview;
}

/** Render a hunk-level diff for Edit tool */
/**
 * @param {string} oldText
 * @param {string} newText
 */
export function renderToolDiff(oldText, newText) {
  const container = document.createElement("div");
  container.className = "tool-diff";
  renderHunkList(container, computeHunks(oldText || "", newText || ""));
  return container;
}

/**
 * @param {Element} outputElement
 * @param {ToolResult | string | null | undefined} result
 */
export function appendToolResultImages(outputElement, result) {
  outputElement.parentElement?.querySelector(".tool-result-images")?.remove();
  const images = resultImages(result);
  if (images.length === 0) return;
  const wrap = document.createElement("div");
  wrap.className = "tool-result-images";
  for (const block of images) {
    const img = document.createElement("img");
    img.className = "lightbox-image tool-result-image";
    img.src = `data:${block.mimeType};base64,${block.data}`;
    img.alt = t("tools.imageResult");
    img.loading = "lazy";
    img.decoding = "async";
    wrap.append(img);
  }
  outputElement.after(wrap);
}

/**
 * The card shows the full result; this line says the model got a digest and links the saved file.
 * @param {HTMLElement} card
 * @param {ToolResult | string | null | undefined} result
 */
export function showSavedOutput(card, result) {
  card.querySelector(".tool-output-saved")?.remove();
  const path = savedOutputPath(result);
  if (!path) return;
  const note = document.createElement("div");
  note.className = "tool-output-saved";
  const label = document.createElement("span");
  label.className = "tool-output-saved-label";
  label.textContent = t("tools.outputSaved");
  const link = document.createElement("button");
  link.type = "button";
  link.className = "tool-file-ref";
  link.dataset.path = path;
  link.textContent = path;
  const preview = t("tools.openInPreview");
  link.title = preview;
  link.setAttribute("aria-label", `${preview}: ${path}`);
  note.append(label, link);
  card.querySelector(".tool-card-body")?.appendChild(note);
}

/**
 * @param {NestedCall} call
 */
export function createNestedRow(call) {
  const row = document.createElement("div");
  row.className = "tool-nested-call";
  row.dataset.nestedId = call.id;
  const dot = document.createElement("span");
  const running = call.status === "pending" || call.status === "streaming";
  dot.className = `tool-nested-dot${call.isError ? " is-error" : running ? " is-running" : ""}`;
  const name = document.createElement("span");
  name.className = "tool-nested-name";
  name.textContent = displayToolName(call.name);
  name.title = call.name;
  row.append(dot, name);
  const preview = toolArgsPreview(
    call.args && typeof call.args === "object" ? /** @type {ToolArgs} */ (call.args) : undefined,
  );
  if (preview) {
    const args = document.createElement("span");
    args.className = "tool-nested-args";
    args.textContent = preview;
    row.append(args);
  }
  return row;
}

/**
 * @param {HTMLElement} card
 * @param {NestedCallRecord | null} record
 */
export function renderNestedRecord(card, record) {
  card.querySelector(".tool-nested-calls")?.remove();
  const calls = record?.calls;
  if (!Array.isArray(calls) || calls.length === 0) return;
  const list = document.createElement("div");
  list.className = "tool-nested-calls";
  for (const call of calls) {
    list.append(
      createNestedRow({
        id: String(call.id ?? ""),
        name: String(call.name ?? ""),
        status: call.status === "error" ? "error" : "done",
        isError: call.status === "error",
        args: call.arguments,
      }),
    );
  }
  if (record?.complete === false) {
    const more = document.createElement("div");
    more.className = "tool-nested-more";
    more.textContent = t("tools.nestedMore");
    list.append(more);
  }
  card.querySelector(".tool-card-body")?.append(list);
}
