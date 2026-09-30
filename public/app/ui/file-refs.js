// ABOUTME: Turns workspace paths in chat code spans and @-mentions into preview buttons.
// ABOUTME: Only known source extensions are linked.

import { previewFile } from "../chat/file-actions.js";

const KNOWN_EXT = /\.(js|ts|tsx|jsx|mjs|cjs|py|go|md|json|css|html|sh|ps1|toml|yml|yaml|txt|rs)$/i;

/** @param {unknown} text */
export function looksLikeWorkspacePath(text) {
  const value = String(text || "").trim();
  if (!value || value.length > 200 || /\s/.test(value)) return false;
  if (/^https?:\/\//i.test(value) || /[<>]/.test(value)) return false;
  // A single /word is a slash command (`/thinking`, `/reload`), not a file.
  if (value.startsWith("/") && !value.slice(1).includes("/") && !KNOWN_EXT.test(value))
    return false;
  const path = value.split(":")[0];
  return /[\\/]/.test(path) || KNOWN_EXT.test(path);
}

/** @param {unknown} text */
export function parsePathRef(text) {
  const value = String(text || "").trim();
  const match = value.match(/^(.+?)(?::(\d+))?(?::(\d+))?$/);
  const path = match?.[1] || value;
  const line = match?.[2] ? Number(match[2]) : undefined;
  return { path, line: Number.isFinite(line) ? line : undefined };
}

/**
 * @param {{ path: string, line?: number }} parsed
 * @param {((path: string, line?: number) => void) | undefined} onOpen
 * @param {string} [title]
 */
function makeRefButton(parsed, onOpen, title) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chat-file-ref";
  button.dataset.path = parsed.path;
  if (parsed.line) button.dataset.line = String(parsed.line);
  button.title = title || parsed.path;
  button.textContent = parsed.line ? `${parsed.path}:${parsed.line}` : parsed.path;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onOpen?.(parsed.path, parsed.line);
    previewFile(parsed.path, parsed.line);
  });
  return button;
}

/**
 * @param {HTMLElement} root
 * @param {((path: string, line?: number) => void) | undefined} onOpen
 */
function linkifyAtMentions(root, onOpen) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    if (walker.currentNode.parentElement?.closest("button, a, code, .chat-file-ref")) continue;
    if (!walker.currentNode.nodeValue?.includes("@")) continue;
    nodes.push(walker.currentNode);
  }
  for (const node of nodes) {
    const parts = String(node.nodeValue).split(/(@(?:"[^"]+"|[A-Za-z0-9_./\\-]+\/?))/g);
    if (parts.length === 1) continue;
    const frag = document.createDocumentFragment();
    for (const part of parts) {
      if (part.startsWith("@") && looksLikeWorkspacePath(part.slice(1).replace(/^"|"$/g, ""))) {
        const path = part.slice(1).replace(/^"|"$/g, "");
        frag.appendChild(makeRefButton({ path }, onOpen));
      } else {
        frag.appendChild(document.createTextNode(part));
      }
    }
    if (node instanceof Text) node.replaceWith(frag);
  }
}

/**
 * @param {HTMLElement | null | undefined} root
 * @param {{ onOpen?: (path: string, line?: number) => void, resolveAbsolute?: (path: string) => string }} [options]
 */
export function linkifyFileRefs(root, { onOpen, resolveAbsolute = (path) => path } = {}) {
  if (!root) return;
  for (const code of root.querySelectorAll("code")) {
    if (code.closest(".chat-file-ref, .code-block-wrapper")) continue;
    const raw = (code.textContent || "").trim();
    if (!looksLikeWorkspacePath(raw)) continue;
    const parsed = parsePathRef(raw);
    code.replaceWith(makeRefButton(parsed, onOpen, resolveAbsolute(parsed.path)));
  }
  const user = root.closest?.(".message.user") || (root.classList?.contains("user") ? root : null);
  if (user instanceof HTMLElement) linkifyAtMentions(user, onOpen);
}
