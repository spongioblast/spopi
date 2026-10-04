// ABOUTME: Tests extension status chips in the dock row.
// ABOUTME: A metrics repaint keeps the chips.
import { describe, expect, it } from "vitest";
import { renderDockStatus } from "../dock/dock.js";
import {
  paintStatusFooter,
  registerProblemsLanguageStatus,
  registerStatusFooter,
  setStatusCatalog,
} from "./status-footer.js";

describe("paintStatusFooter", () => {
  it("renders one chip per key and keeps them across a metrics paint", () => {
    const root = document.createElement("button");
    document.body.append(root);
    const unregister = registerStatusFooter(root);
    paintStatusFooter({ build: "running", lint: "3 warnings" });
    expect(root.querySelector('[data-status-key="build"]')?.textContent).toBe("running");
    expect(root.querySelector('[data-status-key="lint"]')?.textContent).toBe("3 warnings");
    renderDockStatus(root, { tokPerSec: 40 });
    expect(root.textContent).toContain("40 t/s");
    expect(root.querySelector('[data-status-key="build"]')?.textContent).toBe("running");
    unregister();
    root.remove();
  });

  it("leaves the guard key to the composer chip", () => {
    const root = document.createElement("button");
    document.body.append(root);
    const unregister = registerStatusFooter(root);
    paintStatusFooter({
      build: "running",
      "pi-permission-system": "ask",
    });
    expect(root.querySelector('[data-status-key="build"]')).not.toBeNull();
    expect(root.querySelector('[data-status-key="pi-permission-system"]')).toBeNull();
    setStatusCatalog(() => ({
      commands: [{ sourceInfo: { source: "npm:pi-web-access" } }],
    }));
    paintStatusFooter({ "pi-web-access": "ready" });
    expect(root.querySelector('[data-status-key="pi-web-access"]')?.getAttribute("title")).toBe(
      "pi-web-access · pi-web-access",
    );
    setStatusCatalog(null);
    unregister();
    root.remove();
  });

  it("leaves pi-lens-lsp out of the strip and forwards the text", () => {
    const root = document.createElement("button");
    document.body.append(root);
    const unregister = registerStatusFooter(root);
    /** @type {string[]} */
    const seen = [];
    const unregisterProblems = registerProblemsLanguageStatus((text) => {
      seen.push(text);
    });
    paintStatusFooter({
      build: "running",
      "pi-lens-lsp": "LSP Inactive",
    });
    expect(root.querySelector('[data-status-key="build"]')).not.toBeNull();
    expect(root.querySelector('[data-status-key="pi-lens-lsp"]')).toBeNull();
    expect(seen.at(-1)).toBe("LSP Inactive");
    unregisterProblems();
    unregister();
    root.remove();
  });
});
