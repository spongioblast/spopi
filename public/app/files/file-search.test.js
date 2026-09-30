// ABOUTME: Tests mountFileSearch.
// ABOUTME: Includes "lists hits in the active project and opens the clicked file".
import { describe, expect, it } from "vitest";
import { mountFileSearch } from "./file-search.js";

function host() {
  const root = document.createElement("div");
  root.innerHTML = `
    <input id="file-search-input" />
    <button id="file-search-clear" class="hidden"></button>
    <div id="file-sidebar-path"></div>
    <div id="file-list"></div>
    <div id="file-search-results" class="hidden"></div>
  `;
  document.body.append(root);
  return root;
}

describe("mountFileSearch", () => {
  it("lists hits in the active project and opens the clicked file", async () => {
    const root = host();
    const opened = [];
    const seen = [];
    mountFileSearch({
      input: root.querySelector("#file-search-input"),
      clearButton: root.querySelector("#file-search-clear"),
      results: root.querySelector("#file-search-results"),
      tree: root.querySelector("#file-list"),
      pathEl: root.querySelector("#file-sidebar-path"),
      search: async ({ query }) => {
        seen.push(query);
        return { hits: [{ path: "a.js", line: 2, text: "foo" }] };
      },
      onOpenFile: (path, line) => opened.push({ path, line }),
    });
    const input = root.querySelector("#file-search-input");
    input.value = "foo";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await Promise.resolve();
    expect(seen).toEqual(["foo"]);
    expect(root.querySelector("#file-list").classList.contains("hidden")).toBe(true);
    const heading = root.querySelector(".search-hit-file");
    expect(heading.textContent).toBe("a.js");
    expect(heading.title).toBe("a.js");
    const hit = root.querySelector(".search-hit");
    expect(hit.querySelector(".search-hit-line").textContent).toBe("2");
    expect(hit.querySelector(".search-hit-text").textContent).toBe("foo");
    hit.click();
    expect(opened[0]).toEqual({ path: "a.js", line: 2 });
    root.remove();
  });

  it("restores the file tree when the query is cleared", async () => {
    const root = host();
    mountFileSearch({
      input: root.querySelector("#file-search-input"),
      clearButton: root.querySelector("#file-search-clear"),
      results: root.querySelector("#file-search-results"),
      tree: root.querySelector("#file-list"),
      search: async () => ({ hits: [] }),
      t: (key) => (key === "search.noHits" ? "No matches" : key),
    });
    const input = root.querySelector("#file-search-input");
    input.value = "missing";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await Promise.resolve();
    expect(root.textContent).toContain("No matches");
    root.querySelector("#file-search-clear").click();
    await Promise.resolve();
    expect(root.querySelector("#file-list").classList.contains("hidden")).toBe(false);
    expect(root.querySelector("#file-search-results").classList.contains("hidden")).toBe(true);
    root.remove();
  });
});
