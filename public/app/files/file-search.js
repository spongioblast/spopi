// ABOUTME: File search inside the Files panel, scoped to the active workspace.
// ABOUTME: An empty query shows the tree again; hits open that project's files.

import { groupHitsByFile, normalizeSearchQuery } from "./search-model.js";

/**
 * @typedef {import("./search-model.js").SearchHit} SearchHit
 * @param {{
 *   input?: HTMLInputElement | null,
 *   clearButton?: HTMLElement | null,
 *   results?: HTMLElement | null,
 *   tree?: HTMLElement | null,
 *   pathEl?: HTMLElement | null,
 *   search?: (query: { query: string }) => Promise<{ hits?: SearchHit[] } | null | undefined>,
 *   onOpenFile?: (path: string, line?: number) => void,
 *   t?: (key: string) => string,
 * }} [options]
 */
export function mountFileSearch({
  input,
  clearButton,
  results,
  tree,
  pathEl,
  search,
  onOpenFile,
  t = (key) => key,
} = {}) {
  if (!input || !results) return null;
  /** @type {ReturnType<typeof setTimeout> | 0} */
  let timer = 0;

  /** @param {boolean} visible */
  const showTree = (visible) => {
    tree?.classList.toggle("hidden", !visible);
    pathEl?.classList.toggle("hidden", !visible);
    results.classList.toggle("hidden", visible);
  };

  const run = async () => {
    const query = normalizeSearchQuery(input.value);
    clearButton?.classList.toggle("hidden", !query);
    results.replaceChildren();
    if (!query) {
      showTree(true);
      return;
    }
    showTree(false);
    if (typeof search !== "function") throw new TypeError("search is not a function");
    try {
      const found = await search({ query });
      const groups = groupHitsByFile(found?.hits || []);
      if (groups.length === 0) {
        const empty = document.createElement("p");
        empty.className = "dock-empty";
        empty.textContent = t("search.noHits") || "No matches";
        results.appendChild(empty);
        return;
      }
      for (const group of groups) {
        const heading = document.createElement("strong");
        heading.className = "search-hit-file";
        heading.textContent = group.path;
        heading.title = group.path;
        results.appendChild(heading);
        for (const hit of group.hits) {
          const row = document.createElement("button");
          row.type = "button";
          row.className = "search-hit";
          const line = document.createElement("span");
          line.className = "search-hit-line";
          line.textContent = hit.line ? String(hit.line) : "";
          const text = document.createElement("span");
          text.className = "search-hit-text";
          text.textContent = hit.text || "";
          row.title = `${line.textContent} ${text.textContent}`.trim();
          row.append(line, text);
          row.addEventListener("click", () => onOpenFile?.(group.path, hit.line));
          results.appendChild(row);
        }
      }
    } catch (error) {
      const failure = document.createElement("p");
      failure.className = "dock-empty";
      const message =
        error && typeof error === "object" && "message" in error ? error.message : error;
      failure.textContent = String(message);
      results.appendChild(failure);
    }
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), 200);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    clearTimeout(timer);
    void run();
  });
  clearButton?.addEventListener("click", () => {
    input.value = "";
    clearTimeout(timer);
    void run();
    input.focus();
  });
  showTree(true);
  return { focus: () => input.focus() };
}
