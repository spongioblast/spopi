// ABOUTME: Normalizes a search query and groups hits by file.
// ABOUTME: The search itself is requested from the host.
// ABOUTME: Query helpers and hit grouping for the ripgrep Search rail panel.

import { search } from "../transport/workspace-http.js";

/**
 * @typedef {{ path?: string, line?: number, text?: string }} SearchHit
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeSearchQuery(value) {
  return String(value || "").trim();
}

/**
 * @param {SearchHit[]} [hits]
 * @returns {{ path: string, hits: SearchHit[] }[]}
 */
export function groupHitsByFile(hits = []) {
  /** @type {Map<string, SearchHit[]>} */
  const groups = new Map();
  for (const hit of hits) {
    const path = hit.path || "";
    const bucket = groups.get(path);
    if (bucket) bucket.push(hit);
    else groups.set(path, [hit]);
  }
  return [...groups.entries()].map(([path, items]) => ({ path, hits: items }));
}

/**
 * @param {{ query?: unknown, workspaceId?: string, fetchImpl?: typeof fetch }} [options]
 */
export async function searchWorkspace({ query, workspaceId, fetchImpl = fetch } = {}) {
  const q = normalizeSearchQuery(query);
  if (!q) return { query: q, hits: [], backend: "none", truncated: false };
  const response = await search(q, { workspaceId, fetchImpl });
  if (!response.ok) {
    throw new Error("search_failed");
  }
  return response.json();
}
