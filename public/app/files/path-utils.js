// ABOUTME: Normalizes local filesystem paths for browser-side workspace features.
// ABOUTME: Preserves POSIX, Windows drive, and UNC roots without using the host OS APIs.

/** @param {string} value */
function parseRoot(value) {
  if (value.startsWith("//")) {
    const parts = value.slice(2).split("/").filter(Boolean);
    if (parts.length >= 2) return { root: `//${parts[0]}/${parts[1]}`, rest: parts.slice(2) };
    if (parts.length === 1) return { root: `//${parts[0]}`, rest: [] };
    return { root: "//", rest: [] };
  }
  if (/^[A-Za-z]:\//.test(value))
    return { root: value.slice(0, 3), rest: value.slice(3).split("/") };
  if (value.startsWith("/")) return { root: "/", rest: value.slice(1).split("/") };
  return { root: "", rest: value.split("/") };
}

/** @param {string} value */
function normalizedParts(value) {
  const slashPath = value.replaceAll("\\", "/");
  const { root, rest } = parseRoot(slashPath);
  /** @type {string[]} */
  const parts = [];
  for (const part of rest) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.at(-1) && parts.at(-1) !== "..") {
      parts.pop();
    } else if (part !== ".." || !root) {
      parts.push(part);
    }
  }
  return { root, parts };
}

/**
 * @param {string} root
 * @param {string[]} parts
 */
function joinRoot(root, parts) {
  const body = parts.join("/");
  if (root === "/") return body ? `/${body}` : "/";
  if (root.endsWith("/")) return body ? `${root}${body}` : root;
  if (root) return body ? `${root}/${body}` : root;
  return body;
}

/** @param {unknown} value @returns {string} */
export function normalizeLocalPath(value) {
  if (typeof value !== "string") return "";
  const { root, parts } = normalizedParts(value.trim());
  return joinRoot(root, parts);
}

/**
 * Format a local path for sidebar display without changing its filesystem meaning.
 * @param {unknown} value
 * @returns {string}
 */
export function displayLocalPath(value) {
  const normalized = normalizeLocalPath(value);
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    return normalized;
  }
  return `/${normalized}`;
}

/** @param {unknown} value @returns {string} */
export function basenameLocalPath(value) {
  const normalized = normalizeLocalPath(value);
  if (!normalized || normalized === "/" || /^[A-Za-z]:\/$/.test(normalized)) return normalized;
  const uncRoot = normalized.match(/^\/\/[^/]+\/[^/]+$/)?.[0];
  if (uncRoot) return uncRoot;
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

/**
 * Compact label for a workspace path: the folder name, omitting the home /
 * drive prefix that is the same on every typical project. Hover/title should
 * still carry the full path when those prefixes differ.
 */
/** @param {unknown} value @returns {string} */
export function compactWorkspaceLabel(value) {
  return basenameLocalPath(value) || displayLocalPath(value);
}

/**
 * Replaces a POSIX home folder prefix (`/Users/name`, `/home/name`) with `~`.
 * @param {unknown} path
 * @returns {string}
 */
export function shortenPath(path) {
  if (!path) return "";
  return String(path).replace(/^\/?(Users|home)\/[^/]+/, "~");
}

/** @param {unknown} rel @returns {string | null} */
export function parentPath(rel) {
  if (rel == null || rel === "") return null;
  const parts = String(rel).split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

/** @param {unknown} value @returns {string} */
export function parentLocalPath(value) {
  const normalized = normalizeLocalPath(value);
  if (!normalized || normalized === "/" || /^[A-Za-z]:\/$/.test(normalized)) return normalized;
  const { root, parts } = normalizedParts(normalized);
  if (parts.length === 0) return root;
  return joinRoot(root, parts.slice(0, -1));
}
