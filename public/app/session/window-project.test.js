// ABOUTME: Tests handOffProjectOnLeave and takeLeftProject.
// ABOUTME: Only a page that went away hands its project on, and only once.
import { describe, expect, it } from "vitest";
import { handOffProjectOnLeave, takeLeftProject } from "./window-project.js";

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: (/** @type {string} */ key) => values.get(key) ?? null,
    setItem: (/** @type {string} */ key, /** @type {string} */ value) => values.set(key, value),
    removeItem: (/** @type {string} */ key) => values.delete(key),
  };
}

function pageEvents() {
  /** @type {Map<string, () => void>} */
  const listeners = new Map();
  return {
    addEventListener: (/** @type {string} */ type, /** @type {() => void} */ listener) =>
      listeners.set(type, listener),
    fire: (/** @type {string} */ type) => listeners.get(type)?.(),
  };
}

describe("window project handoff", () => {
  it("hands the project on when the page goes away, and only once", () => {
    const storage = memoryStorage();
    const page = pageEvents();
    let workspaceId = "ws-old";
    handOffProjectOnLeave(() => workspaceId, page, storage);

    expect(takeLeftProject(storage)).toBeNull();
    workspaceId = "ws-now";
    page.fire("pagehide");
    expect(takeLeftProject(storage)).toBe("ws-now");
    expect(takeLeftProject(storage)).toBeNull();
  });

  it("a tab copied while the page is open gets no handoff", () => {
    const storage = memoryStorage();
    handOffProjectOnLeave(() => "ws-open", pageEvents(), storage);
    const copied = memoryStorage();
    for (const [key, value] of storage.values) copied.setItem(key, value);
    expect(takeLeftProject(copied)).toBeNull();
  });

  it("reports nothing when storage is unavailable", () => {
    const storage = {
      getItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {},
    };
    expect(takeLeftProject(storage)).toBeNull();
  });
});
