// ABOUTME: Holds one project's review drafts and saves them after each change.
// ABOUTME: The host stores the list. This module only adds, removes, and clears.

/**
 * @typedef {{
 *   id: string,
 *   scope: string,
 *   path: string,
 *   hunkHeader: string,
 *   original: string[],
 *   proposed: string[],
 *   note: string,
 * }} ReviewDraft
 */

/**
 * @typedef {ReturnType<typeof createReviewDrafts>} ReviewDraftStore
 */

/**
 * @param {unknown} value
 * @returns {value is ReviewDraft}
 */
function isDraft(value) {
  if (!value || typeof value !== "object") return false;
  return typeof (/** @type {ReviewDraft} */ (value).id) === "string";
}

/**
 * @param {{
 *   load: (workspaceId: string) => Promise<unknown>,
 *   save: (workspaceId: string, drafts: ReviewDraft[]) => Promise<unknown>,
 *   onChange?: () => void,
 * }} deps
 */
export function createReviewDrafts({ load, save, onChange }) {
  let workspaceId = "";
  let generation = 0;
  let revision = 0;
  /** @type {ReviewDraft[]} */
  let drafts = [];

  return {
    /**
     * Load this workspace's drafts. A slower, older load is ignored.
     * @param {string} id
     */
    async useWorkspace(id) {
      const next = id || "";
      if (next === workspaceId) return;
      workspaceId = next;
      const token = generation + 1;
      generation = token;
      const seen = revision;
      /** @type {unknown} */
      let loaded = [];
      if (next) {
        try {
          loaded = await load(next);
        } catch {
          loaded = [];
        }
      }
      // A newer workspace, or a comment added while this load ran, wins.
      if (token !== generation || seen !== revision) return;
      drafts = Array.isArray(loaded) ? loaded.filter(isDraft) : [];
      onChange?.();
    },
    /** @returns {ReviewDraft[]} */
    list() {
      return drafts;
    },
    /**
     * @param {{ scope?: string, path?: string, hunk?: { header?: string, original?: string[], proposed?: string[] }, note?: string }} draft
     */
    add(draft) {
      revision += 1;
      drafts = [
        ...drafts,
        {
          id: crypto.randomUUID(),
          scope: draft.scope || "",
          path: draft.path || "",
          hunkHeader: draft.hunk?.header || "",
          original: [...(draft.hunk?.original || [])],
          proposed: [...(draft.hunk?.proposed || [])],
          note: String(draft.note || ""),
        },
      ];
      onChange?.();
      return persist();
    },
    /** @param {string} id */
    remove(id) {
      revision += 1;
      drafts = drafts.filter((draft) => draft.id !== id);
      onChange?.();
      return persist();
    },
    clear() {
      revision += 1;
      drafts = [];
      onChange?.();
      return persist();
    },
  };

  /** A failed save keeps the drafts in memory; the next change saves them again. */
  async function persist() {
    if (!workspaceId) return drafts;
    try {
      await save(workspaceId, drafts);
    } catch (error) {
      console.error("[Review] Could not save the review drafts:", error);
    }
    return drafts;
  }
}
