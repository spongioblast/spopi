// ABOUTME: Tests that an open tab follows its file on disk.
// ABOUTME: Clean tabs reload in place; a tab with unsaved edits is flagged as a conflict.

import { afterEach, describe, expect, it, vi } from "vitest";
import { watchPreviewDisk } from "./file-preview-disk-watch.js";

/** @param {Record<string, unknown>} [tabPatch] */
function fakePanel(tabPatch = {}) {
  const tab = {
    id: "tab-1",
    filePath: "docs/notes.md",
    mtimeMs: 1000,
    loading: false,
    saving: false,
    dirty: false,
    conflict: false,
    ...tabPatch,
  };
  /** @type {Set<() => void>} */
  const listeners = new Set();
  return {
    tab,
    panelOpen: true,
    savePromises: new Map(),
    _reloadTab: vi.fn(async () => true),
    state: {
      activeTabId: tab.id,
      getActiveTab: () => tab,
      /** @param {string} id */
      getTab: (id) => (id === tab.id ? tab : null),
      /** @param {string} _id @param {Record<string, unknown>} patch */
      updateTab: vi.fn((_id, patch) => Object.assign(tab, patch)),
      /** @param {() => void} listener */
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
}

/** @param {number} mtimeMs */
const stat = (mtimeMs) => vi.fn(async () => new Response(JSON.stringify({ size: 1, mtimeMs })));

/** @type {Array<{ stop: () => void }>} */
const watches = [];

/**
 * @param {ReturnType<typeof fakePanel>} panel
 * @param {(path: string) => Promise<Response>} statFile
 */
function watch(panel, statFile) {
  const handle = watchPreviewDisk(/** @type {never} */ (panel), {
    statFile,
    intervalMs: 1e9,
  });
  watches.push(handle);
  return handle;
}

afterEach(() => {
  for (const handle of watches.splice(0)) handle.stop();
});

describe("preview disk watch", () => {
  it("reloads a clean tab in place when the file changed on disk", async () => {
    const panel = fakePanel();
    const statFile = stat(2000);
    await watch(panel, statFile).check();
    expect(statFile).toHaveBeenCalledWith("docs/notes.md");
    expect(panel._reloadTab).toHaveBeenCalledWith("tab-1", {
      skipConfirmation: true,
      keepView: true,
    });
  });

  it("leaves an unchanged file alone", async () => {
    const panel = fakePanel();
    await watch(panel, stat(1000)).check();
    expect(panel._reloadTab).not.toHaveBeenCalled();
  });

  it("flags a tab with unsaved edits instead of reloading it", async () => {
    const panel = fakePanel({ dirty: true });
    await watch(panel, stat(2000)).check();
    expect(panel._reloadTab).not.toHaveBeenCalled();
    expect(panel.tab.conflict).toBe(true);
  });

  it("ignores an answer that a save made stale", async () => {
    const panel = fakePanel();
    const statFile = vi.fn(async () => {
      panel.tab.mtimeMs = 3000;
      return new Response(JSON.stringify({ size: 1, mtimeMs: 3000 }));
    });
    await watch(panel, statFile).check();
    expect(panel._reloadTab).not.toHaveBeenCalled();
    expect(panel.tab.conflict).toBe(false);
  });

  it("does not ask while the panel is closed or the window is hidden", async () => {
    const closed = fakePanel();
    closed.panelOpen = false;
    const statClosed = stat(2000);
    await watch(closed, statClosed).check();
    expect(statClosed).not.toHaveBeenCalled();

    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const open = fakePanel();
    const statHidden = stat(2000);
    await watch(open, statHidden).check();
    hidden.mockRestore();
    expect(statHidden).not.toHaveBeenCalled();
  });
});
