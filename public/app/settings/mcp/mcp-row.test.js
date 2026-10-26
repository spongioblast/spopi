// ABOUTME: Tests the MCP server row's More menu.
// ABOUTME: The menu must survive the document click listener the session sidebar adds.

import { afterEach, describe, expect, it } from "vitest";
import { closeContextMenu } from "../../ui/context-menu.js";
import { renderServerRow } from "./mcp-row.js";

describe("MCP row More menu", () => {
  afterEach(() => {
    closeContextMenu();
    document.body.replaceChildren();
  });

  it("says a server offers resources when Pi reports the flag", () => {
    const withResources = renderServerRow(
      { name: "docs", scope: "global", state: "connected", exposure: "direct", resources: true },
      {},
    );
    expect(withResources.textContent).toContain("settings.mcp.offersResources");
    const without = renderServerRow(
      { name: "docs", scope: "global", state: "connected", exposure: "direct" },
      {},
    );
    expect(without.textContent).not.toContain("settings.mcp.offersResources");
  });

  it("stays open when a document click listener closes menus", () => {
    const closeOnClick = () => closeContextMenu();
    document.addEventListener("click", closeOnClick);
    try {
      const row = renderServerRow(
        { name: "mcp", scope: "global", state: "failed", exposure: "direct" },
        { onRemove: () => {} },
      );
      document.body.append(row);
      row.querySelector(".mcp-row-more")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const items = [...document.querySelectorAll(".ui-context-menu .context-menu-item")];
      expect(items.map((item) => item.textContent)).toEqual([
        "settings.mcp.reconnect",
        "settings.mcp.remove",
      ]);
    } finally {
      document.removeEventListener("click", closeOnClick);
    }
  });
});
