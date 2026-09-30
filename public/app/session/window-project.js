// ABOUTME: Hands the project a page showed to the next page in the same tab or window.
// ABOUTME: Opening another project reloads the page, which skips the in-page switch.

const LEFT_PROJECT_KEY = "spopi:left-workspace";

/**
 * Records the project this page shows at the moment the page goes away. A tab
 * copied from this one (new tab, duplicate) copies sessionStorage while this
 * page is still open, so it never sees the handoff.
 * @param {() => string | undefined} getWorkspaceId
 * @param {{ addEventListener?: (type: string, listener: () => void) => void }} [target]
 * @param {Pick<Storage, "setItem"> | undefined} [storage]
 */
export function handOffProjectOnLeave(
  getWorkspaceId,
  target = globalThis,
  storage = globalThis.sessionStorage,
) {
  target.addEventListener?.("pagehide", () => {
    try {
      const workspaceId = getWorkspaceId();
      if (workspaceId) storage?.setItem(LEFT_PROJECT_KEY, workspaceId);
    } catch {
      // Without the handoff the next start sweeps the project instead.
    }
  });
}

/**
 * The project the previous page in this tab or window showed, once.
 * @param {Pick<Storage, "getItem" | "removeItem"> | undefined} [storage]
 * @returns {string | null}
 */
export function takeLeftProject(storage = globalThis.sessionStorage) {
  try {
    const left = storage?.getItem(LEFT_PROJECT_KEY) ?? null;
    storage?.removeItem(LEFT_PROJECT_KEY);
    return left;
  } catch {
    return null;
  }
}
